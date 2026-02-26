/**
 * FootpadScene.js - 足底压力传感器 3D 场景渲染器
 * 
 * 纯 Three.js 实现，无框架依赖。可在任何项目中使用。
 * 支持 1×N 水平排列的足底传感器无缝拼接显示。
 * 
 * 依赖：three >= 0.150.0
 * 
 * @example
 * import { FootpadScene } from './FootpadScene';
 * 
 * // 创建场景
 * const scene = new FootpadScene(document.getElementById('container'), {
 *   sensorCount: 4,
 *   padSize: 0.4,
 *   showHeatmap: true,
 *   depthScale: 0.15,
 *   smoothness: 0.5,
 * });
 * 
 * // 更新传感器数据
 * scene.updateSensorData(0, matrix64x64);
 * 
 * // 销毁
 * scene.dispose();
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { vertexShader, fragmentShader } from '../shaders/pressureShaders.js';
import { upscaleDataSmooth } from '../utils/dataProcessing.js';

const DEFAULT_OPTIONS = {
  sensorCount: 4,
  padSize: 0.8,
  thickness: 0.015,
  textureSize: 64,
  showHeatmap: true,
  depthScale: 0,
  smoothness: 0.5,
  baseColor: '#f0f0f0',
  backgroundColor: '#e0dcd8',
  showFloor: true,
  showBasePlate: true,
  cameraPosition: [0, 3.2, 2.8],
};

export class FootpadScene {
  /**
   * @param {HTMLElement} container - 挂载容器
   * @param {Object} [options] - 配置选项
   * @param {number} [options.sensorCount=4] - 传感器数量
   * @param {number} [options.padSize=0.4] - 每个传感器垫的尺寸
   * @param {number} [options.thickness=0.015] - 垫厚度
   * @param {number} [options.textureSize=128] - 纹理分辨率
   * @param {boolean} [options.showHeatmap=true] - 是否显示热图
   * @param {number} [options.depthScale=0.15] - 深度形变强度
   * @param {number} [options.smoothness=0.5] - 平滑度
   * @param {string} [options.baseColor='#f0f0f0'] - 基础颜色
   * @param {string} [options.backgroundColor='#e0dcd8'] - 背景颜色
   * @param {boolean} [options.showFloor=true] - 是否显示地板
   * @param {boolean} [options.showBasePlate=true] - 是否显示底板
   * @param {number[]} [options.cameraPosition=[0,1.8,1.5]] - 相机位置
   */
  constructor(container, options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.container = container;
    this.footpads = [];
    this.animFrameId = 0;
    this.disposed = false;

    this._init();
  }

  _init() {
    const { sensorCount, padSize, thickness, textureSize, backgroundColor, showFloor, showBasePlate, cameraPosition } = this.options;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(backgroundColor);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      this.container.clientWidth / this.container.clientHeight,
      0.01,
      100
    );
    this.camera.position.set(...cameraPosition);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = true;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 5;
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Lights
    const ambientLight = new THREE.AmbientLight('#fff8f0', 0.6);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight('#fffaf5', 0.8);
    dirLight.position.set(3, 5, 3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight('#e8f0ff', 0.35);
    fillLight.position.set(-3, 3, -2);
    this.scene.add(fillLight);
    const rimLight = new THREE.PointLight('#fff5e6', 0.2);
    rimLight.position.set(-1.5, 2, 3);
    this.scene.add(rimLight);

    // Floor
    if (showFloor) {
      const floorGeometry = new THREE.PlaneGeometry(8, 4);
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: '#e8e4e0', metalness: 0.02, roughness: 0.85, side: THREE.DoubleSide,
      });
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      floor.receiveShadow = true;
      this.scene.add(floor);
    }

    // Footpad meshes (1×N layout, seamless)
    const totalWidth = sensorCount * padSize;
    const startX = -totalWidth / 2 + padSize / 2;

    for (let i = 0; i < sensorCount; i++) {
      const fp = this._createFootpadMesh();
      fp.mesh.position.set(startX + i * padSize, 0.01, 0);
      this.scene.add(fp.mesh);
      this.footpads.push(fp);
    }

    // Base plate
    if (showBasePlate) {
      const baseGeometry = new THREE.PlaneGeometry(totalWidth + 0.04, padSize + 0.04);
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: '#e0e0e0', metalness: 0.1, roughness: 0.9, side: THREE.DoubleSide,
      });
      const basePlate = new THREE.Mesh(baseGeometry, baseMaterial);
      basePlate.rotation.x = -Math.PI / 2;
      basePlate.position.set(0, 0.005, 0);
      this.scene.add(basePlate);
    }

    // Resize handler
    this._handleResize = () => {
      if (!this.container) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this._handleResize);

    // Animation loop
    this._animate();
  }

  _createFootpadMesh() {
    const { padSize, thickness, textureSize } = this.options;
    const geometry = new THREE.PlaneGeometry(padSize, padSize, 64, 64);
    const size = textureSize * textureSize;
    const data = new Float32Array(size);
    data.fill(0);
    const texture = new THREE.DataTexture(data, textureSize, textureSize, THREE.RedFormat, THREE.FloatType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uPressureMap: { value: texture },
        uDisplacementScale: { value: this.options.depthScale },
        uThickness: { value: thickness },
        uShowHeatmap: { value: this.options.showHeatmap },
        uBaseColor: { value: new THREE.Color(this.options.baseColor) },
        uSmoothness: { value: this.options.smoothness },
      },
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, texture, material };
  }

  _animate() {
    if (this.disposed) return;
    this.animFrameId = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 更新指定传感器的数据
   * @param {number} sensorIndex - 传感器索引（0-based）
   * @param {number[][]} matrix - 64×64 二维矩阵，值范围 0-255
   */
  updateSensorData(sensorIndex, matrix) {
    const footpad = this.footpads[sensorIndex];
    if (!footpad) return;
    if (!matrix || matrix.length !== 64) return;

    // 直接写入原始数据，不做任何上采样/模糊/gamma处理
    // 纹理大小=64，与原始矩阵一致
    const texData = footpad.texture.image.data;
    for (let r = 0; r < 64; r++) {
      for (let c = 0; c < 64; c++) {
        // 纹理Y轴翻转：第r行 → 纹理第(63-r)行
        const texIdx = (63 - r) * 64 + c;
        const val = matrix[r][c] || 0;
        // 简单除以255归一化到0-1
        texData[texIdx] = val / 255.0;
      }
    }
    footpad.texture.needsUpdate = true;
  }

  /**
   * 批量更新所有传感器数据
   * @param {Object} dataMap - { sensor1: number[][], sensor2: number[][], ... }
   */
  updateAllSensorData(dataMap) {
    const keys = Object.keys(dataMap).sort();
    // 物理布局：传感器4在最左，传感器1在最右
    // 3D场景索引0=最左，所以需要反转顺序
    const reversed = [...keys].reverse(); // sensor4, sensor3, sensor2, sensor1
    reversed.forEach((key, idx) => {
      if (dataMap[key]) {
        this.updateSensorData(idx, dataMap[key]);
      }
    });
  }

  /**
   * 设置是否显示热图
   * @param {boolean} show
   */
  setShowHeatmap(show) {
    this.options.showHeatmap = show;
    this.footpads.forEach(({ material }) => {
      material.uniforms.uShowHeatmap.value = show;
    });
  }

  /**
   * 设置深度形变强度
   * @param {number} scale - 0 到 1
   */
  setDepthScale(scale) {
    this.options.depthScale = scale;
    this.footpads.forEach(({ material }) => {
      material.uniforms.uDisplacementScale.value = scale;
    });
  }

  /**
   * 设置平滑度
   * @param {number} smoothness - 0 到 1
   */
  setSmoothness(smoothness) {
    this.options.smoothness = smoothness;
    this.footpads.forEach(({ material }) => {
      material.uniforms.uSmoothness.value = smoothness;
    });
  }

  /**
   * 设置基础颜色
   * @param {string} color - CSS颜色值
   */
  setBaseColor(color) {
    this.options.baseColor = color;
    this.footpads.forEach(({ material }) => {
      material.uniforms.uBaseColor.value = new THREE.Color(color);
    });
  }

  /**
   * 获取当前场景截图
   * @returns {string} Base64 PNG 数据URL
   */
  captureScreenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * 重置相机位置
   */
  resetCamera() {
    this.camera.position.set(...this.options.cameraPosition);
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * 销毁场景，释放资源
   */
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this._handleResize);
    this.controls.dispose();
    this.footpads.forEach(({ mesh, texture, material }) => {
      mesh.geometry.dispose();
      texture.dispose();
      material.dispose();
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

export default FootpadScene;
