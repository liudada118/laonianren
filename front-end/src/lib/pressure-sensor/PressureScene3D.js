/**
 * 压力传感器 3D 场景管理器
 * 
 * 纯 Three.js 实现（0.177.0+），无框架依赖。
 * 场景内容：极简椅子模型 + 坐垫压力垫 + 脚垫压力垫 + 暖灰色背景 + OrbitControls
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { pressurePadVertexShader, pressurePadFragmentShader, footpadFragmentShader } from './shaders';
import { upscaleDataSmooth } from './PressureDataProcessor';

/** 默认3D场景配置 */
const DEFAULT_SCENE_CONFIG = {
  showHeatmap: true,
  enableClipping: false,
  clipLevel: 0.5,
  depthScale: 0,
  smoothness: 0.5,
};

/** 默认压力垫配置 */
const DEFAULT_PRESSURE_PAD_CONFIG = {
  thickness: 0.015,
  textureSize: 256,
  baseColor: '#f5f5f5',
  geometrySegments: 128,
};

/** 默认椅子配置 */
const DEFAULT_CHAIR_CONFIG = {
  metalColor: '#1a1a1a',
  seatColor: '#3d3d3d',
  cushionColor: '#555555',
};

export class PressureScene3D {
  constructor(sceneConfig, chairConfig) {
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.animationId = 0;
    this.container = null;

    this.seatMaterial = null;
    this.seatTexture = null;
    this.footpadMaterial = null;
    this.footpadTexture = null;

    this.sceneConfig = { ...DEFAULT_SCENE_CONFIG, ...sceneConfig };
    this.chairConfig = { ...DEFAULT_CHAIR_CONFIG, ...chairConfig };
    this.seatPadConfig = { ...DEFAULT_PRESSURE_PAD_CONFIG };
    this.footpadPadConfig = { ...DEFAULT_PRESSURE_PAD_CONFIG, baseColor: '#f0f0f0' };

    this.SEAT_TEXTURE_SIZE = 256;
  this.FOOTPAD_TEXTURE_SIZE = 128;

    this.handleResize = () => {
      if (!this.container) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    };
  }

  /**
   * 挂载到 DOM 容器
   * @param {HTMLElement} container
   */
  mount(container) {
    this.container = container;
    this.initRenderer(container);
    this.initScene();
    this.initCamera();
    this.initLights();
    this.initChair();
    this.initSeatPad();
    this.initFootpad();
    this.initFloor();
    this.initControls();
    this.startRenderLoop();

    window.addEventListener('resize', this.handleResize);
  }

  /**
   * 卸载并释放资源
   */
  unmount() {
    window.removeEventListener('resize', this.handleResize);
    cancelAnimationFrame(this.animationId);

    if (this.controls) this.controls.dispose();
    if (this.renderer) this.renderer.dispose();
    if (this.seatTexture) this.seatTexture.dispose();
    if (this.footpadTexture) this.footpadTexture.dispose();
    if (this.seatMaterial) this.seatMaterial.dispose();
    if (this.footpadMaterial) this.footpadMaterial.dispose();

    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.isMesh) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(m => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        }
      });
    }

    if (this.container && this.renderer) {
      try {
        this.container.removeChild(this.renderer.domElement);
      } catch (e) {
        // ignore
      }
    }
    this.container = null;
  }

  /**
   * 更新坐垫压力数据
   * @param {number[][]} matrix - 32×32 压力矩阵（值范围 0-255）
   */
  updateSeatData(matrix) {
    this.updateTextureForSize(this.seatTexture, this.seatMaterial, matrix, this.SEAT_TEXTURE_SIZE);
  }

  /**
   * 更新脚垫压力数据
   * @param {number[][]} matrix - 64×64 压力矩阵（值范围 0-255）
   */
  updateFootpadData(matrix) {
    this.updateTextureForSize(this.footpadTexture, this.footpadMaterial, matrix, this.FOOTPAD_TEXTURE_SIZE);
  }

  /**
   * 更新场景配置
   * @param {object} config
   */
  updateConfig(config) {
    Object.assign(this.sceneConfig, config);
    this.syncUniforms();
  }

  /**
   * 获取当前场景配置
   */
  getConfig() {
    return { ...this.sceneConfig };
  }

  // ============================================================
  // 初始化方法
  // ============================================================

  initRenderer(container) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#ddd8d4');
  }

  initCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(48, aspect, 0.01, 100);
    this.camera.position.set(0.85, 0.88, 1.3);
    this.camera.lookAt(0, 0.28, 0.2);
  }

  initLights() {
    // 暖色环境光
    const ambient = new THREE.AmbientLight('#fff8f0', 0.5);
    this.scene.add(ambient);

    // 主方向光
    const keyLight = new THREE.DirectionalLight('#fffaf5', 0.9);
    keyLight.position.set(4, 6, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.far = 15;
    keyLight.shadow.camera.left = -3;
    keyLight.shadow.camera.right = 3;
    keyLight.shadow.camera.top = 3;
    keyLight.shadow.camera.bottom = -3;
    this.scene.add(keyLight);

    // 填充光
    const fillLight = new THREE.DirectionalLight('#e8f0ff', 0.35);
    fillLight.position.set(-3, 3, -2);
    this.scene.add(fillLight);

    // 边缘光
    const rimLight = new THREE.PointLight('#fff5e6', 0.2);
    rimLight.position.set(-1.5, 2, 3);
    this.scene.add(rimLight);
  }

  initChair() {
    const { metalColor, seatColor, cushionColor } = this.chairConfig;
    const chairGroup = new THREE.Group();

    // 座面
    const seatGeo = new THREE.BoxGeometry(0.44, 0.025, 0.44);
    const seatMat = new THREE.MeshStandardMaterial({ color: seatColor, metalness: 0.2, roughness: 0.8 });
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.set(0, 0.43, 0);
    chairGroup.add(seat);

    // 靠背
    const backGeo = new THREE.BoxGeometry(0.42, 0.48, 0.02);
    const backMat = new THREE.MeshStandardMaterial({ color: cushionColor, metalness: 0.1, roughness: 0.9 });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.set(0, 0.72, -0.20);
    back.rotation.set(0.08, 0, 0);
    chairGroup.add(back);

    // 四条椅腿
    const legMat = new THREE.MeshStandardMaterial({ color: metalColor, metalness: 0.7, roughness: 0.3 });
    const legPositions = [
      [-0.18, 0.215, 0.18],
      [0.18, 0.215, 0.18],
      [-0.18, 0.215, -0.18],
      [0.18, 0.215, -0.18],
    ];
    for (const pos of legPositions) {
      const legGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.43, 12);
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(pos[0], pos[1], pos[2]);
      chairGroup.add(leg);
    }

    // 靠背支撑
    const supportMat = new THREE.MeshStandardMaterial({ color: metalColor, metalness: 0.7, roughness: 0.3 });
    const supportPositions = [
      [-0.18, 0.58, -0.19],
      [0.18, 0.58, -0.19],
    ];
    for (const pos of supportPositions) {
      const geo = new THREE.CylinderGeometry(0.008, 0.008, 0.30, 8);
      const mesh = new THREE.Mesh(geo, supportMat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      chairGroup.add(mesh);
    }

    // 扶手
    const armMat = new THREE.MeshStandardMaterial({ color: cushionColor, metalness: 0.2, roughness: 0.8 });
    const armPositions = [
      [-0.24, 0.58, 0.02],
      [0.24, 0.58, 0.02],
    ];
    for (const pos of armPositions) {
      const geo = new THREE.BoxGeometry(0.025, 0.02, 0.28);
      const mesh = new THREE.Mesh(geo, armMat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      chairGroup.add(mesh);
    }

    // 扶手支撑
    const armSupportPositions = [
      [-0.24, 0.51, -0.08],
      [0.24, 0.51, -0.08],
    ];
    for (const pos of armSupportPositions) {
      const geo = new THREE.CylinderGeometry(0.006, 0.006, 0.14, 8);
      const mesh = new THREE.Mesh(geo, supportMat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      chairGroup.add(mesh);
    }

    this.scene.add(chairGroup);
  }

  initSeatPad() {
    const { thickness, textureSize, baseColor, geometrySegments } = this.seatPadConfig;

    this.seatTexture = this.createEmptyTexture(this.SEAT_TEXTURE_SIZE);

    this.seatMaterial = new THREE.ShaderMaterial({
      vertexShader: pressurePadVertexShader,
      fragmentShader: pressurePadFragmentShader,
      uniforms: {
        uPressureMap: { value: this.seatTexture },
        uDisplacementScale: { value: this.sceneConfig.depthScale },
        uThickness: { value: thickness },
        uShowHeatmap: { value: this.sceneConfig.showHeatmap },
        uBaseColor: { value: new THREE.Color(baseColor) },
        uEnableClipping: { value: this.sceneConfig.enableClipping },
        uClipLevel: { value: this.sceneConfig.clipLevel },
        uSmoothness: { value: this.sceneConfig.smoothness },
      },
      side: THREE.DoubleSide,
    });

    const geometry = new THREE.BoxGeometry(0.45, 0.45, thickness, geometrySegments, geometrySegments, 1);
    const mesh = new THREE.Mesh(geometry, this.seatMaterial);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.position.set(0, 0.455, 0);
    this.scene.add(mesh);
  }

  initFootpad() {
    const { thickness, textureSize, baseColor } = this.footpadPadConfig;

    this.footpadTexture = this.createEmptyTexture(this.FOOTPAD_TEXTURE_SIZE);

    this.footpadMaterial = new THREE.ShaderMaterial({
      vertexShader: pressurePadVertexShader,
      fragmentShader: footpadFragmentShader,
      uniforms: {
        uPressureMap: { value: this.footpadTexture },
        uDisplacementScale: { value: this.sceneConfig.depthScale * 0.6 },
        uThickness: { value: thickness },
        uShowHeatmap: { value: this.sceneConfig.showHeatmap },
        uBaseColor: { value: new THREE.Color(baseColor) },
        uSmoothness: { value: this.sceneConfig.smoothness },
      },
      side: THREE.DoubleSide,
    });

    const geometry = new THREE.BoxGeometry(1.5, 1, thickness, 128, 128, 1);
    const mesh = new THREE.Mesh(geometry, this.footpadMaterial);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.position.set(0, 0.008, 0.62);
    mesh.scale.set(0.65, 0.75, 1);
    this.scene.add(mesh);
  }

  initFloor() {
    const floorGeo = new THREE.PlaneGeometry(6, 6);
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#e8e4e0',
      metalness: 0.02,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.set(-Math.PI / 2, 0, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const highlightGeo = new THREE.CircleGeometry(0.8, 64);
    const highlightMat = new THREE.MeshStandardMaterial({
      color: '#f0ece8',
      metalness: 0.05,
      roughness: 0.7,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.rotation.set(-Math.PI / 2, 0, 0);
    highlight.position.set(0, 0.002, 0.2);
    this.scene.add(highlight);
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = true;
    this.controls.minPolarAngle = Math.PI / 6;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 3.5;
    this.controls.target.set(0, 0.38, 0.05);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.update();
  }

  // ============================================================
  // 渲染循环
  // ============================================================

  startRenderLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  // ============================================================
  // 工具方法
  // ============================================================

  createEmptyTexture(size) {
    const data = new Float32Array(size * size);
    data.fill(0);
    const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }

  updateTextureForSize(texture, material, matrix, texSize) {
    if (!texture || !material) return;

    const upscaledData = upscaleDataSmooth(matrix, texSize);
    const data = texture.image.data;

    for (let r = 0; r < texSize; r++) {
      const rFlip = (texSize - 1 - r) * texSize;
      const rOff = r * texSize;
      for (let c = 0; c < texSize; c++) {
        data[rOff + c] = Math.min(upscaledData[rFlip + c] / 255.0, 1.0);
      }
    }
    texture.needsUpdate = true;
  }

  syncUniforms() {
    const cfg = this.sceneConfig;

    if (this.seatMaterial) {
      this.seatMaterial.uniforms.uShowHeatmap.value = cfg.showHeatmap;
      this.seatMaterial.uniforms.uEnableClipping.value = cfg.enableClipping;
      this.seatMaterial.uniforms.uClipLevel.value = cfg.clipLevel;
      this.seatMaterial.uniforms.uDisplacementScale.value = cfg.depthScale;
      this.seatMaterial.uniforms.uSmoothness.value = cfg.smoothness;
    }

    if (this.footpadMaterial) {
      this.footpadMaterial.uniforms.uShowHeatmap.value = cfg.showHeatmap;
      this.footpadMaterial.uniforms.uDisplacementScale.value = cfg.depthScale * 0.6;
      this.footpadMaterial.uniforms.uSmoothness.value = cfg.smoothness;
    }
  }
}
