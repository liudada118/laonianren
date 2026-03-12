/**
 * GaitCanvas - 基于 Three.js 粒子系统的步道压力可视化（性能优化版）
 *
 * 4 个 64×64 传感器合并为一个 64×256 的整体粒子系统。
 * 传感器排列：sensor1 | sensor2 | sensor3 | sensor4（沿 Y 轴拼接）
 * 整体顺时针旋转 90 度显示。
 *
 * Props:
 *   - sensorData: { sensor1: 64×64矩阵, ... sensor4: ... }
 *   - particleParams: { gaussSigma, filterThreshold, initValue, colorRange, heightScale }
 *   - showHeatmap: boolean
 *   - onSceneReady: callback
 */
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls";
import { addSide, gaussBlur_1, interp1016, jet } from "../standing/util";
import React, { useEffect, useRef } from "react";

/* ─── 常量 ─── */
const NX = 64;                          // 合并后行数（传感器宽度）
const NY = 256;                         // 合并后列数（4 × 64）
const INTERP = 2;
const PAD = 4;
const AX = NX * INTERP + PAD * 2;      // 136
const AY = NY * INTERP + PAD * 2;      // 520
const SEP = 80;                         // 粒子间距
const TOTAL = AX * AY;
const SENSOR_KEYS = ['sensor1', 'sensor2', 'sensor3', 'sensor4'];

/* ─── 全局纹理缓存 ─── */
let _sharedTexture = null;
function getCircleTexture() {
  if (!_sharedTexture) {
    _sharedTexture = new THREE.TextureLoader().load("/circle.png");
  }
  return _sharedTexture;
}

export default function GaitCanvas({
  sensorData = {},
  particleParams = {},
  showHeatmap = true,
  onSceneReady = null,
}) {
  const containerRef = useRef(null);
  const propsRef = useRef({ sensorData, particleParams });
  propsRef.current = { sensorData, particleParams };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* ─── 预分配缓冲区 ─── */
    const ndata     = new Float32Array(NX * NY);
    const bigArr    = new Float32Array(NX * INTERP * NY * INTERP);
    const bigArrg   = new Float32Array(AX * AY);
    const smoothBig = new Float32Array(AX * AY);
    const positions = new Float32Array(TOTAL * 3);
    const colors    = new Float32Array(TOTAL * 3);
    const scales    = new Float32Array(TOTAL);

    // 初始化位置（逆时针旋转 90 度：原 (ix,iy) → 新 X=(AY-1-iy), 新 Z=ix）
    const padWidth = AX * SEP;
    const padDepth = AY * SEP;
    let i3 = 0, i1 = 0;
    for (let ix = 0; ix < AX; ix++) {
      for (let iy = 0; iy < AY; iy++) {
        positions[i3]     = (AY - 1 - iy) * SEP - padDepth / 2;
        positions[i3 + 1] = 0;
        positions[i3 + 2] = ix * SEP - padWidth / 2;
        scales[i1] = 1;
        colors[i3] = 0; colors[i3 + 1] = 0; colors[i3 + 2] = 1;
        i3 += 3; i1++;
      }
    }

    /* ─── 几何体 & 材质 ─── */
    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const colAttr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute("position", posAttr);
    geometry.setAttribute("color", colAttr);
    geometry.setAttribute("scale", new THREE.BufferAttribute(scales, 1));

    const material = new THREE.PointsMaterial({
      vertexColors: true, transparent: true,
      map: getCircleTexture(), size: 1,
      depthWrite: false, sizeAttenuation: true,
    });

    const particles = new THREE.Points(geometry, material);
    // 放大 3 倍：0.0062 * 3 = 0.0186
    const SCALE = 0.0062 * 3;
    particles.scale.set(SCALE, SCALE, SCALE);
    particles.rotation.x = Math.PI / 3;

    const group = new THREE.Group();
    group.add(particles);

    /* ─── 场景 ─── */
    let w = container.clientWidth || window.innerWidth * 0.7;
    let h = container.clientHeight || window.innerHeight * 0.8;
    if (w < 10) w = window.innerWidth * 0.7;
    if (h < 10) h = window.innerHeight * 0.8;

    const camera = new THREE.PerspectiveCamera(45, w / h, 1, 200000);
    camera.position.set(0, 600, 800);
    camera.lookAt(0, 0, 0);

    const scene = new THREE.Scene();
    scene.add(group);

    const grid = new THREE.GridHelper(4000, 80);
    grid.position.y = -10; grid.material.opacity = 0.2; grid.material.transparent = true;
    scene.add(grid);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444));
    const dl1 = new THREE.DirectionalLight(0xffffff, 0.8); dl1.position.set(0, 400, 200); scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(200, 100, 400); scene.add(dl2);

    /* ─── 渲染器 ─── */
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);
    renderer.setClearColor(0x000000);

    /* ─── 控制器 ─── */
    const controls = new TrackballControls(camera, renderer.domElement);
    controls.dynamicDampingFactor = 0.2;
    controls.domElement = container;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ZOOM, RIGHT: THREE.MOUSE.ROTATE };

    if (onSceneReady) onSceneReady({ scene, camera, renderer });

    /* ─── 合并 4 个传感器矩阵为 64×256 flat 数组 ─── */
    // 每个 64×64 传感器顺时针旋转 90 度后再拼接
    // 顺时针 90°：原 (row,col) → 新 (col, 63-row)
    function mergeSensorData() {
      const { sensorData: sd } = propsRef.current;
      ndata.fill(0);
      for (let s = 0; s < 4; s++) {
        const key = SENSOR_KEYS[s];
        const matrix = sd[key];
        if (!matrix || !Array.isArray(matrix) || matrix.length === 0) continue;
        const colOffset = s * 64;
        for (let row = 0; row < 64 && row < matrix.length; row++) {
          for (let col = 0; col < 64 && col < matrix[row].length; col++) {
            // 顺时针旋转 90 度：新行 = col，新列 = 63 - row
            const newRow = col;
            const newCol = 63 - row;
            ndata[newRow * NY + colOffset + newCol] = matrix[row][col];
          }
        }
      }
    }

    /* ─── 数据更新 ─── */
    function renewData() {
      const { particleParams: pp } = propsRef.current;
      const params = {
        gaussSigma:      pp.gaussSigma ?? 2,
        filterThreshold: pp.filterThreshold ?? 2,
        initValue:       pp.initValue ?? 2,
        colorRange:      pp.colorRange ?? 200,
        heightScale:     pp.heightScale ?? 2,
      };

      mergeSensorData();

      // 过滤
      for (let i = 0; i < ndata.length; i++) {
        if (ndata[i] < params.filterThreshold) ndata[i] = 0;
      }

      // 非方阵插值：64×256 → 128×512
      interp1016(ndata, bigArr, NX, NY, INTERP);

      // 添加边界填充
      const bigArrs = addSide(bigArr, NY * INTERP, NX * INTERP, PAD, PAD);

      // 高斯模糊
      gaussBlur_1(bigArrs, bigArrg, AY, AX, params.gaussSigma);

      // 更新粒子位置和颜色
      let k = 0, l = 0;
      for (let ix = 0; ix < AX; ix++) {
        for (let iy = 0; iy < AY; iy++) {
          const val = bigArrg[l] * 10;
          smoothBig[l] += (val - smoothBig[l] + 0.5) / params.initValue;

          // 逆时针旋转 90 度：原 (ix,iy) → 新 X=(AY-1-iy), 新 Z=ix
          positions[k]     = (AY - 1 - iy) * SEP - padDepth / 2;
          positions[k + 1] = smoothBig[l] * params.heightScale;
          positions[k + 2] = ix * SEP - padWidth / 2;

          const rgb = jet(0, params.colorRange, smoothBig[l]);
          colors[k]     = rgb[0] / 255;
          colors[k + 1] = rgb[1] / 255;
          colors[k + 2] = rgb[2] / 255;

          k += 3; l++;
        }
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    /* ─── 渲染循环 ─── */
    let animId;
    function animate() {
      animId = requestAnimationFrame(animate);
      renewData();
      controls.update();
      renderer.render(scene, camera);
    }

    function onResize() {
      let w = container.clientWidth || window.innerWidth * 0.7;
      let h = container.clientHeight || window.innerHeight * 0.8;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    window.addEventListener("resize", onResize);
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      geometry.dispose(); material.dispose();
      if (renderer) renderer.dispose();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
