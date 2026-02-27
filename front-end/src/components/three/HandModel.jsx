import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function HandModel({
  isRecording = false,
  pressureValue = 0,
  isLeftHand = true,
  heatmapCanvas = null,
  heatmapVersion = 0
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
  const textureNeedsApplyRef = useRef(false);
  // 用 ref 跟踪最新的 heatmapVersion，在 animate 循环中检查
  const heatmapVersionRef = useRef(0);
  const lastAppliedVersionRef = useRef(-1);
  // 用 ref 跟踪 isLeftHand，确保模型加载完成后能读到最新值
  const isLeftHandRef = useRef(isLeftHand);
  // 保存原始材质信息
  const originalMaterialsRef = useRef([]);

  // 创建自定义 ShaderMaterial 混合原始材质和热力图
  const createHeatmapOverlayMaterial = useCallback((originalMaterial, heatmapTexture) => {
    // Use a clean light gray base color for the hand model
    // Don't use original material's map texture as it contains the old block-style heatmap
    const origColor = new THREE.Color(0.82, 0.82, 0.85);
    const origMap = null; // Ignore original texture to avoid showing built-in heatmap

    const material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uOrigColor: { value: origColor },
        uOrigMap: { value: origMap },
        uHasOrigMap: { value: origMap ? 1.0 : 0.0 },
        uHeatmap: { value: heatmapTexture },
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
        uniform vec3 uLightDir;
        uniform vec3 uLightDir2;
        uniform float uAmbient;

        void main() {
          // Base color from original material
          vec3 baseColor = uOrigColor;
          if (uHasOrigMap > 0.5) {
            baseColor *= texture2D(uOrigMap, vUv).rgb;
          }

          // Two-light setup for better illumination
          float diff1 = max(dot(vNormal, uLightDir), 0.0);
          float diff2 = max(dot(vNormal, uLightDir2), 0.0) * 0.4;
          float totalDiff = min(diff1 + diff2, 1.0);
          vec3 litBase = baseColor * (uAmbient + (1.0 - uAmbient) * totalDiff);

          // Heatmap overlay
          vec4 heatColor = texture2D(uHeatmap, vUv);
          float heatAlpha = heatColor.a;

          // Boost heatmap color brightness slightly for better visibility
          vec3 boostedHeat = heatColor.rgb * 1.1;

          // Mix: where heatmap has data, show heatmap color with lighting; otherwise show original
          vec3 heatLit = boostedHeat * (0.7 + 0.3 * totalDiff);
          vec3 finalColor = mix(litBase, heatLit, heatAlpha * 0.88);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });

    return material;
  }, []);

  // 将纹理应用到模型的函数 - 使用自定义 shader 混合
  const applyTextureToModel = useCallback((group, texture) => {
    if (!group || !texture) return;

    let meshCount = 0;
    group.traverse((child) => {
      if (child.isMesh && child.name !== 'pressureIndicator') {
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

  // 更新热力图纹理（不重新创建材质）
  const updateHeatmapTexture = useCallback((group, texture) => {
    if (!group || !texture) return;
    group.traverse((child) => {
      if (child.isMesh && child.name !== 'pressureIndicator') {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => {
            if (mat.uniforms && mat.uniforms.uHeatmap) {
              mat.uniforms.uHeatmap.value = texture;
              mat.uniformsNeedUpdate = true;
            }
          });
        } else {
          if (child.material.uniforms && child.material.uniforms.uHeatmap) {
            child.material.uniforms.uHeatmap.value = texture;
            child.material.uniformsNeedUpdate = true;
          }
        }
      }
    });
  }, []);

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
    renderer.setPixelRatio(window.devicePixelRatio);
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

    // Load GLB model - 使用相对路径兼容 Electron
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

    // Add pressure indicator (glowing sphere)
    const indicatorGeometry = new THREE.SphereGeometry(0.15, 32, 32);
    const indicatorMaterial = new THREE.MeshBasicMaterial({
      color: 0xEF4444,
      transparent: true,
      opacity: 0.8
    });
    const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
    indicator.position.set(0, -0.5, 0.6);
    indicator.name = 'pressureIndicator';
    indicator.visible = false;
    handGroup.add(indicator);

    handGroup.rotation.x = -Math.PI / 3;
    handGroup.position.set(-1, -1, 0);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 20, 0xffffff, 0xffffff);
    gridHelper.material.opacity = 0.1;
    gridHelper.material.transparent = true;
    gridHelper.position.y = -4;
    scene.add(gridHelper);

    // Animation loop - 在这里检查纹理更新
    let frameCount = 0;
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      frameCount++;

      // 在渲染循环中检查纹理是否需要更新
      const currentVersion = heatmapVersionRef.current;
      if (currentVersion !== lastAppliedVersionRef.current) {
        const texture = heatmapTextureRef.current;
        if (texture && modelLoadedRef.current && handGroupRef.current) {
          texture.needsUpdate = true;
          lastAppliedVersionRef.current = currentVersion;

          // 每100帧打印一次调试信息
          if (frameCount % 100 === 0) {
            console.log(`[HandModel] animate: 纹理更新 version=${currentVersion}, canvas=${texture.image?.width}x${texture.image?.height}`);
          }
        }
      }

      renderer.render(scene, camera);
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

  // Update pressure indicator
  useEffect(() => {
    if (handGroupRef.current) {
      const indicator = handGroupRef.current.getObjectByName('pressureIndicator');
      if (indicator) {
        indicator.visible = isRecording;
        if (isRecording) {
          const scale = 0.5 + (pressureValue / 200) * 1.5;
          indicator.scale.setScalar(scale);
          const hue = Math.max(0, 0.6 - (pressureValue / 200) * 0.6);
          indicator.material.color.setHSL(hue, 0.8, 0.5);
          indicator.material.opacity = 0.9;
        }
      }
    }
  }, [pressureValue, isRecording]);

  // 创建/更新 heatmap 纹理 - 只在 heatmapCanvas 首次传入时创建纹理并绑定到模型
  useEffect(() => {
    if (!heatmapCanvas) {
      return;
    }

    // 创建纹理（只创建一次）
    if (!heatmapTextureRef.current) {
      const texture = new THREE.CanvasTexture(heatmapCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      // Disable premultiplied alpha to ensure transparent pixels stay transparent
      texture.premultiplyAlpha = false;
      heatmapTextureRef.current = texture;
      console.log('[HandModel] 创建新的 CanvasTexture, canvas尺寸:', heatmapCanvas.width, 'x', heatmapCanvas.height);

      // Don't apply texture until we have actual data (heatmapVersion > 0)
      // This prevents showing stale/empty heatmap on initial load
    }

    // Apply custom shader to model (always, to override built-in heatmap texture)
    if (heatmapTextureRef.current) {
      if (modelLoadedRef.current && handGroupRef.current) {
        // Check if shader materials are already applied
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
    }

    // 更新 version ref，让 animate 循环知道需要刷新纹理
    heatmapVersionRef.current = heatmapVersion;

  }, [heatmapCanvas, heatmapVersion, applyTextureToModel]);

  // Mirror model for left/right hand
  useEffect(() => {
    // 始终更新 ref，确保模型加载回调能读到最新值
    isLeftHandRef.current = isLeftHand;

    // 如果模型已加载，立即应用 scale
    const model = modelRef.current;
    if (!model) return;
    const baseScale = baseScaleRef.current || 1;
    applyHandScale(model, baseScale, isLeftHand);
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
