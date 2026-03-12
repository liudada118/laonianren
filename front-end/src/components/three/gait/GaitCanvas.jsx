/**
 * GaitCanvas - 基于 Three.js 粒子系统的步道压力可视化（性能优化版）
 *
 * 性能优化：
 *   1. 每个传感器使用预分配 Float32Array，避免 GC
 *   2. setAttribute 仅初始化时调用，后续只设 needsUpdate
 *   3. 全局共享纹理
 *   4. 帧率控制
 *
 * Props:
 *   - sensorData: { sensor1: 64×64矩阵, ... sensor4: ... }
 *   - particleParams: { gaussSigma, filterThreshold, initValue, colorRange, heightScale }
 *   - showHeatmap: boolean
 *   - onSceneReady: callback
 */
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls";
import { addSide, gaussBlur_1, interp, jet } from "../standing/util";
import React, { useEffect, useRef } from "react";

/* ─── 常量 ─── */
const N = 64;
const INTERP = 2;
const PAD = 4;
const AX = N * INTERP + PAD * 2;  // 136
const AY = N * INTERP + PAD * 2;  // 136
const SEP = 80;
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

/* ─── 创建单个传感器的缓冲区 ─── */
function createSensorBuffers(zOffset) {
  const padWidth = AX * SEP;
  const padDepth = AY * SEP;
  const positions = new Float32Array(TOTAL * 3);
  const colors    = new Float32Array(TOTAL * 3);
  const scales    = new Float32Array(TOTAL);

  let i3 = 0, i1 = 0;
  for (let ix = 0; ix < AX; ix++) {
    for (let iy = 0; iy < AY; iy++) {
      positions[i3]     = ix * SEP - padWidth / 2;
      positions[i3 + 1] = 0;
      positions[i3 + 2] = iy * SEP - padDepth / 2 + zOffset;
      scales[i1] = 1;
      colors[i3] = 0; colors[i3 + 1] = 0; colors[i3 + 2] = 1;
      i3 += 3; i1++;
    }
  }

  return {
    positions, colors, scales, zOffset,
    ndata:     new Float32Array(N * N),
    bigArr:    new Float32Array(N * INTERP * N * INTERP),
    bigArrg:   new Float32Array((N * INTERP + PAD * 2) * (N * INTERP + PAD * 2)),
    smoothBig: new Float32Array((N * INTERP + PAD * 2) * (N * INTERP + PAD * 2)),
  };
}

export default function GaitCanvas({
  sensorData = {},
  particleParams = {},
  showHeatmap = true,
  onSceneReady = null,
}) {
  const containerRef = useRef(null);
  const propsRef = useRef({ sensorData, particleParams });

  // 保持 props 引用最新（避免闭包过期）
  propsRef.current = { sensorData, particleParams };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* ─── 场景初始化 ─── */
    let w = container.clientWidth || window.innerWidth * 0.7;
    let h = container.clientHeight || window.innerHeight * 0.8;
    if (w < 10) w = window.innerWidth * 0.7;
    if (h < 10) h = window.innerHeight * 0.8;

    const camera = new THREE.PerspectiveCamera(45, w / h, 1, 200000);
    camera.position.set(0, 600, 800);
    camera.lookAt(0, 0, 0);

    const scene = new THREE.Scene();

    // 网格
    const grid = new THREE.GridHelper(4000, 80);
    grid.position.y = -10; grid.material.opacity = 0.2; grid.material.transparent = true;
    scene.add(grid);

    // 灯光
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444));
    const dl1 = new THREE.DirectionalLight(0xffffff, 0.8); dl1.position.set(0, 400, 200); scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(200, 100, 400); scene.add(dl2);

    /* ─── 初始化 4 个传感器 ─── */
    const padDepth = AY * SEP;
    const gap = padDepth * 0.15;
    const sensors = [];
    const sprite = getCircleTexture();

    for (let s = 0; s < 4; s++) {
      const zOffset = (s - 1.5) * (padDepth + gap);
      const buf = createSensorBuffers(zOffset);

      const geometry = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(buf.positions, 3);
      const colAttr = new THREE.BufferAttribute(buf.colors, 3);
      geometry.setAttribute("position", posAttr);
      geometry.setAttribute("color", colAttr);
      geometry.setAttribute("scale", new THREE.BufferAttribute(buf.scales, 1));

      const material = new THREE.PointsMaterial({
        vertexColors: true, transparent: true,
        map: sprite, size: 1,
        depthWrite: false, sizeAttenuation: true,
      });

      const particles = new THREE.Points(geometry, material);
      particles.scale.set(0.0062, 0.0062, 0.0062);
      particles.rotation.x = Math.PI / 3;

      const group = new THREE.Group();
      group.add(particles);
      scene.add(group);

      sensors.push({ ...buf, geometry, posAttr, colAttr, material, particles, group });
    }

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

    /* ─── 矩阵转 flat ─── */
    function matrixToFlat(matrix, target) {
      if (!matrix || !Array.isArray(matrix) || matrix.length === 0) return false;
      let idx = 0;
      for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[i].length; j++) {
          target[idx++] = matrix[i][j];
        }
      }
      return true;
    }

    /* ─── 更新单个传感器 ─── */
    function renewSensor(sp, sensorIdx) {
      const { sensorData: sd, particleParams: pp } = propsRef.current;
      const params = {
        gaussSigma:      pp.gaussSigma ?? 2,
        filterThreshold: pp.filterThreshold ?? 2,
        initValue:       pp.initValue ?? 2,
        colorRange:      pp.colorRange ?? 200,
        heightScale:     pp.heightScale ?? 2,
      };

      // 读取数据
      const key = SENSOR_KEYS[sensorIdx];
      matrixToFlat(sd[key], sp.ndata);

      // 过滤
      for (let i = 0; i < sp.ndata.length; i++) {
        if (sp.ndata[i] < params.filterThreshold) sp.ndata[i] = 0;
      }

      interp(sp.ndata, sp.bigArr, N, INTERP);
      const bigArrs = addSide(sp.bigArr, N * INTERP, N * INTERP, PAD, PAD);
      gaussBlur_1(bigArrs, sp.bigArrg, N * INTERP + PAD * 2, N * INTERP + PAD * 2, params.gaussSigma);

      const padWidth = AX * SEP;
      const padDepthLocal = AY * SEP;

      let k = 0, l = 0;
      for (let ix = 0; ix < AX; ix++) {
        for (let iy = 0; iy < AY; iy++) {
          const val = sp.bigArrg[l] * 10;
          sp.smoothBig[l] += (val - sp.smoothBig[l] + 0.5) / params.initValue;

          sp.positions[k]     = ix * SEP - padWidth / 2;
          sp.positions[k + 1] = sp.smoothBig[l] * params.heightScale;
          sp.positions[k + 2] = iy * SEP - padDepthLocal / 2 + sp.zOffset;

          const rgb = jet(0, params.colorRange, sp.smoothBig[l]);
          sp.colors[k]     = rgb[0] / 255;
          sp.colors[k + 1] = rgb[1] / 255;
          sp.colors[k + 2] = rgb[2] / 255;

          k += 3; l++;
        }
      }

      sp.posAttr.needsUpdate = true;
      sp.colAttr.needsUpdate = true;
    }

    /* ─── 渲染循环 ─── */
    let animId;
    function animate() {
      animId = requestAnimationFrame(animate);
      for (let s = 0; s < sensors.length; s++) {
        renewSensor(sensors[s], s);
      }
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
      sensors.forEach(sp => {
        sp.geometry.dispose();
        sp.material.dispose();
        scene.remove(sp.group);
      });
      if (renderer) renderer.dispose();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
