/**
 * GaitCanvas - 基于 Three.js 粒子系统的步道压力可视化
 *
 * 将 4 个 64×64 传感器的数据以粒子系统形式渲染为步道布局。
 * 4 个传感器沿 Z 轴排列（sensor1 最近，sensor4 最远）。
 * 兼容 three.js 0.177+
 *
 * Props:
 *   - sensorData: { sensor1: 64×64矩阵, sensor2: ..., sensor3: ..., sensor4: ... }
 *   - showHeatmap: boolean
 *   - depthScale: number
 *   - smoothness: number
 *   - onSceneReady: callback
 */
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls";
import {
  addSide,
  findMax,
  gaussBlur_1,
  interp,
  jet,
  jetgGrey,
} from "../standing/util";
import React, { useEffect, useRef } from "react";

const SENSOR_KEYS = ['sensor1', 'sensor2', 'sensor3', 'sensor4'];
const sitnum1 = 64;
const sitnum2 = 64;
const sitInterp = 2;
const sitOrder = 4;
const AMOUNTX = sitnum1 * sitInterp + sitOrder * 2;  // 136
const AMOUNTY = sitnum2 * sitInterp + sitOrder * 2;  // 136
const SEPARATION = 80;  // 粒子间距

// 每个传感器的参数默认值
const DEFAULT_VALUEJ = 200;
const DEFAULT_VALUEG = 2;
const DEFAULT_VALUE = 2;
const DEFAULT_VALUEL = 2;

export default function GaitCanvas({
  sensorData = {},
  showHeatmap = true,
  depthScale = 0,
  smoothness = 0.5,
  onSceneReady = null,
}) {
  const containerRef = useRef(null);
  const internalsRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ─── 内部状态 ───
    let camera, scene, renderer, controls;
    let animationRequestId;
    const clock = new THREE.Clock();
    let timeS = 0;
    const FPS = 15;
    const renderT = 1 / FPS;

    // 每个传感器的粒子系统
    const sensorParticles = [];

    function getContainerSize() {
      let w = container.clientWidth;
      let h = container.clientHeight;
      if (w < 10) w = window.innerWidth * 0.7;
      if (h < 10) h = window.innerHeight * 0.8;
      return { w, h };
    }

    function init() {
      const { w, h } = getContainerSize();

      // 相机 - 俯视角度看步道
      camera = new THREE.PerspectiveCamera(45, w / h, 1, 200000);
      camera.position.set(0, 600, 800);
      camera.lookAt(0, 0, 0);

      scene = new THREE.Scene();

      // 网格辅助
      const helper = new THREE.GridHelper(4000, 80);
      helper.position.y = -10;
      helper.material.opacity = 0.2;
      helper.material.transparent = true;
      scene.add(helper);

      // 灯光
      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
      hemiLight.position.set(0, 400, 0);
      scene.add(hemiLight);
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
      dirLight.position.set(0, 400, 200);
      scene.add(dirLight);
      const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
      dirLight2.position.set(200, 100, 400);
      scene.add(dirLight2);

      // 初始化 4 个传感器的粒子系统
      initAllSensors();

      // 渲染器
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(w, h);
      if (renderer.outputColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }

      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(renderer.domElement);
      renderer.setClearColor(0x000000);

      // 控制器
      controls = new TrackballControls(camera, renderer.domElement);
      controls.dynamicDampingFactor = 0.2;
      controls.domElement = container;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.ZOOM,
        RIGHT: THREE.MOUSE.ROTATE,
      };

      window.addEventListener("resize", onWindowResize);

      if (onSceneReady) onSceneReady({ scene, camera, renderer });
    }

    function initAllSensors() {
      const sprite = new THREE.TextureLoader().load("/circle.png");

      // 4 个传感器沿 Z 轴排列，间隔一定距离
      // 传感器排列：sensor1(最前) -> sensor4(最后)
      const padWidth = AMOUNTX * SEPARATION;
      const padDepth = AMOUNTY * SEPARATION;
      const gap = padDepth * 0.15; // 传感器之间的间隙

      for (let s = 0; s < 4; s++) {
        const numParticles = AMOUNTX * AMOUNTY;
        const positions = new Float32Array(numParticles * 3);
        const colors = new Float32Array(numParticles * 3);
        const scales = new Float32Array(numParticles);

        // 该传感器在 Z 方向的偏移
        const zOffset = (s - 1.5) * (padDepth + gap);

        let i = 0, j = 0;
        for (let ix = 0; ix < AMOUNTX; ix++) {
          for (let iy = 0; iy < AMOUNTY; iy++) {
            positions[i] = ix * SEPARATION - padWidth / 2;
            positions[i + 1] = 0;
            positions[i + 2] = iy * SEPARATION - padDepth / 2 + zOffset;
            scales[j] = 1;
            colors[i] = 0;
            colors[i + 1] = 0;
            colors[i + 2] = 1;
            i += 3;
            j++;
          }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute("scale", new THREE.BufferAttribute(scales, 1));

        const material = new THREE.PointsMaterial({
          vertexColors: true,
          transparent: true,
          map: sprite,
          size: 1,
          depthWrite: false,
          sizeAttenuation: true,
        });

        const particles = new THREE.Points(geometry, material);
        particles.scale.set(0.0062, 0.0062, 0.0062);
        particles.rotation.x = Math.PI / 3;

        // 创建 group 使每个传感器可独立定位
        const group = new THREE.Group();
        group.add(particles);
        scene.add(group);

        // 存储每个传感器的数据
        sensorParticles.push({
          group,
          particles,
          geometry,
          positions,
          colors,
          scales,
          zOffset,
          ndata: new Array(sitnum1 * sitnum2).fill(0),
          bigArr: new Array(sitnum1 * sitInterp * sitnum2 * sitInterp).fill(0),
          bigArrg: new Array((sitnum1 * sitInterp + sitOrder * 2) * (sitnum2 * sitInterp + sitOrder * 2)).fill(0),
          smoothBig: new Array((sitnum1 * sitInterp + sitOrder * 2) * (sitnum2 * sitInterp + sitOrder * 2)).fill(0),
        });
      }
    }

    function matrixToFlat(matrix) {
      if (!matrix || !Array.isArray(matrix) || matrix.length === 0) return null;
      const flat = [];
      for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[i].length; j++) {
          flat.push(matrix[i][j]);
        }
      }
      return flat;
    }

    function renewSensor(sp, sensorIdx) {
      // 读取最新传感器数据
      const key = SENSOR_KEYS[sensorIdx];
      const matrix = sensorData[key];
      const flat = matrixToFlat(matrix);
      if (flat) {
        sp.ndata = flat;
      }

      interp(sp.ndata, sp.bigArr, sitnum1, sitInterp);

      const bigArrs = addSide(
        sp.bigArr,
        sitnum2 * sitInterp,
        sitnum1 * sitInterp,
        sitOrder,
        sitOrder
      );

      gaussBlur_1(
        bigArrs,
        sp.bigArrg,
        sitnum2 * sitInterp + sitOrder * 2,
        sitnum1 * sitInterp + sitOrder * 2,
        DEFAULT_VALUEG
      );

      const padWidth = AMOUNTX * SEPARATION;
      const padDepth = AMOUNTY * SEPARATION;

      let k = 0, l = 0;
      for (let ix = 0; ix < AMOUNTX; ix++) {
        for (let iy = 0; iy < AMOUNTY; iy++) {
          const value = sp.bigArrg[l] * 10;
          sp.smoothBig[l] = sp.smoothBig[l] + (value - sp.smoothBig[l] + 0.5) / DEFAULT_VALUEL;

          sp.positions[k] = ix * SEPARATION - padWidth / 2;
          sp.positions[k + 1] = sp.smoothBig[l] * DEFAULT_VALUE;
          sp.positions[k + 2] = iy * SEPARATION - padDepth / 2 + sp.zOffset;

          const rgb = jet(0, DEFAULT_VALUEJ, sp.smoothBig[l]);
          sp.colors[k] = rgb[0] / 255;
          sp.colors[k + 1] = rgb[1] / 255;
          sp.colors[k + 2] = rgb[2] / 255;

          k += 3;
          l++;
        }
      }

      sp.geometry.attributes.position.needsUpdate = true;
      sp.geometry.attributes.color.needsUpdate = true;
    }

    function render() {
      if (!renderer || !scene || !camera || !controls) return;

      // 更新所有传感器
      for (let s = 0; s < sensorParticles.length; s++) {
        renewSensor(sensorParticles[s], s);
      }

      controls.update();
      renderer.render(scene, camera);
    }

    function animate() {
      animationRequestId = requestAnimationFrame(animate);
      render();
    }

    function onWindowResize() {
      if (!renderer || !camera) return;
      const { w, h } = getContainerSize();
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    // 暴露内部方法供 sensorData 更新时使用
    internalsRef.current = { sensorParticles };

    init();
    animate();

    return () => {
      cancelAnimationFrame(animationRequestId);
      window.removeEventListener("resize", onWindowResize);
      // 清理粒子
      sensorParticles.forEach(sp => {
        sp.geometry.dispose();
        sp.particles.material.dispose();
        scene.remove(sp.group);
      });
      if (renderer) renderer.dispose();
    };
  }, []); // 只初始化一次

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }}></div>
    </div>
  );
}
