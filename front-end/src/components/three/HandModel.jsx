import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * HandModel - 3D hand model with real-time heatmap overlay
 *
 * Performance optimizations:
 * - On-demand rendering: only re-renders when heatmap data changes (dirty flag)
 * - Polls HeatmapCanvas._version via ref instead of React setState
 * - Avoids React re-render cycle for texture updates
 * - Reduced requestAnimationFrame overhead with idle frame skipping
 */
export function HandModel({
  isRecording = false,
  pressureValue = 0,
  isLeftHand = true,
  heatmapCanvas = null
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const animationRef = useRef(null);
  const handGroupRef = useRef(null);
  const heatmapTextureRef = useRef(null);
  const modelRef = useRef(null);
  const modelLoadedRef = useRef(false);
  const baseScaleRef = useRef(1);
  // Track the HeatmapCanvas instance for polling _version
  const heatmapCanvasRef = useRef(null);
  // Last applied version from HeatmapCanvas._version
  const lastAppliedVersionRef = useRef(-1);
  // 用 ref 跟踪 isLeftHand，确保模型加载完成后能读到最新值
  const isLeftHandRef = useRef(isLeftHand);

  // 创建自定义 ShaderMaterial 混合原始材质和热力图
  const createHeatmapOverlayMaterial = useCallback((originalMaterial, heatmapTexture) => {
    // Use a clean light gray base color for the hand model
    const origColor = new THREE.Color(0.82, 0.82, 0.85);

    // Get heatmap texture dimensions for texel size calculation
    const heatW = heatmapTexture.image ? heatmapTexture.image.width : 512;
    const heatH = heatmapTexture.image ? heatmapTexture.image.height : 512;

    return new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uOrigColor: { value: origColor },
        uOrigMap: { value: null },
        uHasOrigMap: { value: 0.0 },
        uHeatmap: { value: heatmapTexture },
        uHeatTexel: { value: new THREE.Vector2(1.0 / heatW, 1.0 / heatH) },
        uLightDir: { value: new THREE.Vector3(0.4, 0.6, 0.8).normalize() },
        uLightDir2: { value: new THREE.Vector3(-0.3, 0.4, 0.2).normalize() },
        uAmbient: { value: 0.65 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        uniform vec3 uOrigColor;
        uniform sampler2D uOrigMap;
        uniform float uHasOrigMap;
        uniform sampler2D uHeatmap;
        uniform vec2 uHeatTexel;
        uniform vec3 uLightDir;
        uniform vec3 uLightDir2;
        uniform float uAmbient;

        // 13-tap Gaussian blur on heatmap texture for soft edges
        vec4 sampleHeatmapBlurred(vec2 uv) {
          vec4 sum = vec4(0.0);
          float blurSize = 3.5;
          vec2 off1 = uHeatTexel * blurSize;
          vec2 off2 = uHeatTexel * blurSize * 2.0;
          // Center (highest weight)
          sum += texture2D(uHeatmap, uv) * 0.20;
          // Ring 1: 4 cardinal neighbors
          sum += texture2D(uHeatmap, uv + vec2( off1.x,    0.0)) * 0.10;
          sum += texture2D(uHeatmap, uv + vec2(-off1.x,    0.0)) * 0.10;
          sum += texture2D(uHeatmap, uv + vec2(   0.0,  off1.y)) * 0.10;
          sum += texture2D(uHeatmap, uv + vec2(   0.0, -off1.y)) * 0.10;
          // Ring 1: 4 diagonal neighbors
          sum += texture2D(uHeatmap, uv + vec2( off1.x,  off1.y)) * 0.05;
          sum += texture2D(uHeatmap, uv + vec2(-off1.x,  off1.y)) * 0.05;
          sum += texture2D(uHeatmap, uv + vec2( off1.x, -off1.y)) * 0.05;
          sum += texture2D(uHeatmap, uv + vec2(-off1.x, -off1.y)) * 0.05;
          // Ring 2: 4 cardinal far neighbors
          sum += texture2D(uHeatmap, uv + vec2( off2.x,    0.0)) * 0.05;
          sum += texture2D(uHeatmap, uv + vec2(-off2.x,    0.0)) * 0.05;
          sum += texture2D(uHeatmap, uv + vec2(   0.0,  off2.y)) * 0.05;
          sum += texture2D(uHeatmap, uv + vec2(   0.0, -off2.y)) * 0.05;
          return sum;
        }

        void main() {
          vec3 baseColor = uOrigColor;
          if (uHasOrigMap > 0.5) {
            baseColor *= texture2D(uOrigMap, vUv).rgb;
          }
          float diff1 = max(dot(vNormal, uLightDir), 0.0);
          float diff2 = max(dot(vNormal, uLightDir2), 0.0) * 0.4;
          float totalDiff = min(diff1 + diff2, 1.0);
          vec3 litBase = baseColor * (uAmbient + (1.0 - uAmbient) * totalDiff);

          // Sample with blur for soft edges
          vec4 heatColor = sampleHeatmapBlurred(vUv);
          float heatAlpha = heatColor.a;

          // Quintic smoothstep for ultra-soft edge falloff
          float t = clamp(heatAlpha, 0.0, 1.0);
          float blendAlpha = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
          // Extra attenuation at very low alpha
          blendAlpha *= smoothstep(0.0, 0.12, heatAlpha);

          vec3 boostedHeat = heatColor.rgb * 1.05;
          vec3 heatLit = boostedHeat * (0.7 + 0.3 * totalDiff);
          vec3 finalColor = mix(litBase, heatLit, blendAlpha * 0.90);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });
  }, []);

  // 将纹理应用到模型的函数 - 使用自定义 shader 混合
  const applyTextureToModel = useCallback((group, texture) => {
    if (!group || !texture) return;

    let meshCount = 0;
    group.traverse((child) => {
      if (child.isMesh) {
        // 保存原始材质（如果还没保存）
        if (!child.userData._origMaterial) {
          child.userData._origMaterial = child.material;
        }

        const origMat = child.userData._origMaterial;

        if (Array.isArray(origMat)) {
          child.material = origMat.map((mat) => createHeatmapOverlayMaterial(mat, texture));
        } else {
          child.material = createHeatmapOverlayMaterial(origMat, texture);
        }
        meshCount++;
      }
    });
    if (meshCount > 0) {
      console.log(`[HandModel] 热力图叠加材质已应用到 ${meshCount} 个 mesh`);
    }
  }, [createHeatmapOverlayMaterial]);

  // 应用左右手镜像 scale 的辅助函数
  const applyHandScale = useCallback((model, baseScale, leftHand) => {
    if (!model) return;
    const sign = leftHand ? 1 : -1;
    model.scale.set(baseScale * sign, baseScale, baseScale);
    console.log(`[HandModel] scale 已更新: isLeftHand=${leftHand}, scaleX=${baseScale * sign}`);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xBCC6D0);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0.2, 5);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x to avoid excessive GPU load on HiDPI
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x3B82F6, 0.4);
    pointLight.position.set(-3, 3, 3);
    scene.add(pointLight);

    // Create hand group
    const handGroup = new THREE.Group();
    handGroupRef.current = handGroup;
    scene.add(handGroup);

    // Load GLB model
    const loader = new GLTFLoader();
    const modelUrl = '/assets/hand0423g.glb';
    console.log('[HandModel] 开始加载模型:', modelUrl);
    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        let meshInfo = [];
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            const hasUV = child.geometry && child.geometry.attributes.uv;
            meshInfo.push({
              name: child.name,
              hasUV: !!hasUV,
              materialType: Array.isArray(child.material) ? 'array' : child.material?.type,
              vertexCount: child.geometry?.attributes?.position?.count || 0
            });
          }
        });
        console.log('[HandModel] 模型加载成功, mesh信息:', JSON.stringify(meshInfo));

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2.6 / maxDim;
        baseScaleRef.current = scale;
        modelRef.current = model;
        modelLoadedRef.current = true;

        // 模型加载完成后，根据当前 isLeftHand ref 设置正确的 scale（包括镜像）
        applyHandScale(model, scale, isLeftHandRef.current);

        handGroup.add(model);

        // Always apply custom shader to override model's built-in heatmap texture
        if (heatmapTextureRef.current) {
          console.log('[HandModel] 模型加载完成，应用自定义 shader');
          applyTextureToModel(handGroup, heatmapTextureRef.current);
        }

        // Force initial render after model load
        needsRenderRef.current = true;
      },
      (progress) => {
        if (progress.total) {
          console.log(`[HandModel] 模型加载进度: ${Math.round(progress.loaded / progress.total * 100)}%`);
        }
      },
      (err) => {
        console.error('[HandModel] 模型加载失败:', err);
      }
    );

    handGroup.rotation.x = -Math.PI / 3;
    handGroup.position.set(-1, -1, 0);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 20,
      new THREE.Color(0.7, 0.7, 0.7),
      new THREE.Color(0.85, 0.85, 0.85)
    );
    gridHelper.material.transparent = true;
    gridHelper.position.y = -4;
    scene.add(gridHelper);

    // On-demand rendering: only re-render when data changes
    const needsRenderRef_ = { current: true }; // initial render needed
    // Expose to outer scope via component ref
    needsRenderRef.current = true;

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);

      // Check if HeatmapCanvas has new data by polling _version
      const hc = heatmapCanvasRef.current;
      if (hc && hc._version !== undefined) {
        const currentVersion = hc._version;
        if (currentVersion !== lastAppliedVersionRef.current) {
          // New heatmap data available
          const texture = heatmapTextureRef.current;
          if (texture && modelLoadedRef.current && handGroupRef.current) {
            texture.needsUpdate = true;
            lastAppliedVersionRef.current = currentVersion;
            needsRenderRef_.current = true;
          }
        }
      }

      // Also check the component-level dirty flag (for model load, resize, etc.)
      if (needsRenderRef.current) {
        needsRenderRef_.current = true;
        needsRenderRef.current = false;
      }

      // Only render when dirty
      if (needsRenderRef_.current) {
        renderer.render(scene, camera);
        needsRenderRef_.current = false;
      }
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      needsRenderRef_.current = true;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (rendererRef.current && containerRef.current) {
        try {
          containerRef.current.removeChild(rendererRef.current.domElement);
        } catch (e) { /* ignore */ }
        rendererRef.current.dispose();
      }
      if (handGroupRef.current) {
        handGroupRef.current.traverse((child) => {
          if (child.isMesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ref for triggering render from outside the animate closure
  const needsRenderRef = useRef(true);

  // 创建/更新 heatmap 纹理 - 只在 heatmapCanvas 首次传入时创建纹理并绑定到模型
  useEffect(() => {
    if (!heatmapCanvas) return;

    // heatmapCanvas is now a HeatmapCanvas instance (not a DOM canvas)
    // Store reference for polling _version in animate loop
    heatmapCanvasRef.current = heatmapCanvas;
    const domCanvas = heatmapCanvas.canvas; // The actual DOM canvas element

    // 创建纹理（只创建一次）
    if (!heatmapTextureRef.current) {
      const texture = new THREE.CanvasTexture(domCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      // Disable premultiplied alpha to ensure transparent pixels stay transparent
      texture.premultiplyAlpha = false;
      heatmapTextureRef.current = texture;
      console.log('[HandModel] 创建新的 CanvasTexture, canvas尺寸:', domCanvas.width, 'x', domCanvas.height);
    }

    // Apply custom shader to model if not already applied
    if (heatmapTextureRef.current && modelLoadedRef.current && handGroupRef.current) {
      let hasShaderMat = false;
      handGroupRef.current.traverse((child) => {
        if (child.isMesh && child.material?.uniforms?.uHeatmap) {
          hasShaderMat = true;
        }
      });
      if (!hasShaderMat) {
        applyTextureToModel(handGroupRef.current, heatmapTextureRef.current);
      }
    }
  }, [heatmapCanvas, applyTextureToModel]); // Only re-run when canvas instance changes, NOT on every version

  // Mirror model for left/right hand
  useEffect(() => {
    // 始终更新 ref，确保模型加载回调能读到最新值
    isLeftHandRef.current = isLeftHand;

    // 如果模型已加载，立即应用 scale
    const model = modelRef.current;
    if (!model) return;
    const baseScale = baseScaleRef.current || 1;
    applyHandScale(model, baseScale, isLeftHand);
    needsRenderRef.current = true; // trigger re-render for mirror change
  }, [isLeftHand, applyHandScale]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
}

export default HandModel;
