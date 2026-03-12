/**
 * StandingCanvas - 基于 Three.js 粒子系统的静态站立压力可视化（性能优化版）
 *
 * 性能优化：
 *   1. 使用 useRef 管理所有内部状态，避免模块级变量污染
 *   2. 帧率控制：通过 clock.getDelta 限制数据处理频率
 *   3. 减少 GC：预分配 TypedArray，避免每帧创建新数组
 *   4. setAttribute 仅在初始化时调用，后续只设 needsUpdate
 *   5. 纹理缓存：全局共享一份 circle.png 纹理
 *
 * Props:
 *   - externalDataRef: React ref，ref.current 为 64×64 的二维数组
 *   - particleParams: { gaussSigma, filterThreshold, initValue, colorRange, heightScale }
 *   - showHeatmap: boolean
 *   - data: ref 对象（向外暴露 changeData / handleCharts）
 *   - changeSelect / changeStateData / local: 选区相关
 */
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls";
import { SelectionHelper } from "./SelectionHelper";
import { checkRectIndex, checkRectangleIntersection, getPointCoordinate } from "./threeUtil1";
import { addSide, findMax, gaussBlur_1, interp, jet, jetgGrey } from "./util";
import React, { useEffect, useImperativeHandle, useRef } from "react";

/* ─── 常量 ─── */
const N = 64;                         // 传感器尺寸
const INTERP = 2;                     // 插值倍数
const PAD = 4;                        // 边界填充
const AX = N * INTERP + PAD * 2;      // 136
const AY = N * INTERP + PAD * 2;      // 136
const SEP = 100;                      // 粒子间距
const TOTAL = AX * AY;                // 18496 粒子
const GX = 5, GY = 150, GZ = 230;    // group 位置

/* ─── 全局纹理缓存 ─── */
let _sharedTexture = null;
function getCircleTexture() {
  if (!_sharedTexture) {
    _sharedTexture = new THREE.TextureLoader().load("/circle.png");
  }
  return _sharedTexture;
}

/* ─── 预分配缓冲区工厂 ─── */
function createBuffers() {
  return {
    ndata:     new Float32Array(N * N),
    bigArr:    new Float32Array(N * INTERP * N * INTERP),
    bigArrg:   new Float32Array((N * INTERP + PAD * 2) * (N * INTERP + PAD * 2)),
    smoothBig: new Float32Array((N * INTERP + PAD * 2) * (N * INTERP + PAD * 2)),
    positions: new Float32Array(TOTAL * 3),
    colors:    new Float32Array(TOTAL * 3),
    scales:    new Float32Array(TOTAL),
  };
}

const StandingCanvas = React.forwardRef((props, refs) => {
  const containerRef = useRef(null);
  const stateRef = useRef(null);   // 所有内部可变状态

  /* ─── 读取外部矩阵 → flat Float32Array ─── */
  function readExternalData(target) {
    const ref = props.externalDataRef;
    if (!ref?.current) return false;
    const m = ref.current;
    if (!Array.isArray(m) || m.length === 0) return false;
    let idx = 0;
    for (let i = 0; i < m.length; i++) {
      for (let j = 0; j < m[i].length; j++) {
        target[idx++] = m[i][j];
      }
    }
    return true;
  }

  /* ─── 获取参数（实时从 props 读取） ─── */
  function getParams() {
    const p = props.particleParams || {};
    return {
      gaussSigma:      p.gaussSigma ?? 2,
      filterThreshold: p.filterThreshold ?? 2,
      initValue:       p.initValue ?? 2,
      colorRange:      p.colorRange ?? 200,
      heightScale:     p.heightScale ?? 2,
    };
  }

  function getTransform() {
    const t = props.transformParams || {};
    return {
      posX:         t.posX ?? 0,
      posY:         t.posY ?? 0,
      posZ:         t.posZ ?? 0,
      particleSize: t.particleSize ?? 1,
      scale:        t.scale ?? 1,
    };
  }

  /* ─── 初始化 ─── */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const buf = createBuffers();
    let { positions, colors, scales, ndata, bigArr, bigArrg, smoothBig } = buf;

    // 初始化位置（逆时针旋转 90 度：原 (ix,iy) → 新 X=(AY-1-iy), 新 Z=ix）
    let idx3 = 0, idx1 = 0;
    for (let ix = 0; ix < AX; ix++) {
      for (let iy = 0; iy < AY; iy++) {
        positions[idx3]     = (AY - 1 - iy) * SEP - (AY * SEP) / 2;
        positions[idx3 + 1] = 0;
        positions[idx3 + 2] = ix * SEP - (AX * SEP) / 2;
        scales[idx1] = 1;
        colors[idx3] = 0; colors[idx3 + 1] = 0; colors[idx3 + 2] = 1;
        idx3 += 3; idx1++;
      }
    }

    // 几何体 & 材质
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
    const BASE_SCALE = 0.0062 * 0.4;
    particles.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
    particles.rotation.x = Math.PI / 3;

    const group = new THREE.Group();
    group.add(particles);
    group.position.set(GX, GY, GZ);

    // 场景
    let w = container.clientWidth || window.innerWidth * 0.7;
    let h = container.clientHeight || window.innerHeight * 0.8;
    if (w < 10) w = window.innerWidth * 0.7;
    if (h < 10) h = window.innerHeight * 0.8;

    const camera = new THREE.PerspectiveCamera(40, w / h, 1, 150000);
    camera.position.set(0, 200, 300);

    const scene = new THREE.Scene();
    scene.add(group);

    const grid = new THREE.GridHelper(2000, 100);
    grid.position.y = -199; grid.material.opacity = 0.25; grid.material.transparent = true;
    scene.add(grid);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444));
    const dl1 = new THREE.DirectionalLight(0xffffff); dl1.position.set(0, 200, 10); scene.add(dl1);
    const dl2 = new THREE.DirectionalLight(0xffffff); dl2.position.set(0, 10, 200); scene.add(dl2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    if (renderer.outputColorSpace !== undefined) renderer.outputColorSpace = THREE.SRGBColorSpace;
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);
    renderer.setClearColor(0x000000);

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.dynamicDampingFactor = 0.2;
    controls.domElement = container;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ZOOM, RIGHT: THREE.MOUSE.ROTATE };
    controls.keys = [18, 17, 91];

    let controlsFlag = true;
    const selectHelper = new SelectionHelper(renderer, controls, 'selectBox');
    let sitIndexArr = [], sitIndexEndArr = [];
    let selectStartArr = [], selectEndArr = [], sitMatrix = [];
    let colSelectFlag = false;

    // 统计数据（预分配）
    let totalArr = [], totalPointArr = [];
    const clock = new THREE.Clock();
    let timeS = 0;
    const renderT = 1 / 10; // 10 FPS 数据处理

    // 临时数组（避免每帧 GC）
    const tempBigArrs = new Float32Array((N * INTERP + PAD * 2) * (N * INTERP + PAD * 2));

    /* ─── 数据更新（每帧调用） ─── */
    function renewData() {
      const params = getParams();
      const tf = getTransform();

      // 实时更新空间变换
      const s = BASE_SCALE * tf.scale;
      particles.scale.set(s, s, s);
      material.size = tf.particleSize;
      group.position.set(GX + tf.posX, GY + tf.posY, GZ + tf.posZ);

      readExternalData(ndata);

      // 过滤
      for (let i = 0; i < ndata.length; i++) {
        if (ndata[i] < params.filterThreshold) ndata[i] = 0;
      }

      interp(ndata, bigArr, N, INTERP);

      const bigArrs = addSide(bigArr, N * INTERP, N * INTERP, PAD, PAD);

      gaussBlur_1(bigArrs, bigArrg, N * INTERP + PAD * 2, N * INTERP + PAD * 2, params.gaussSigma);

      let k = 0, l = 0;
      let dataArr = [];
      const hasSelection = sitIndexArr.length > 0 && !sitIndexArr.every(a => a === 0);

      for (let ix = 0; ix < AX; ix++) {
        for (let iy = 0; iy < AY; iy++) {
          const val = bigArrg[l] * 10;
          smoothBig[l] += (val - smoothBig[l] + 0.5) / params.initValue;

          // 逆时针旋转 90 度：原 (ix,iy) → 新 X=(AY-1-iy), 新 Z=ix
          positions[k]     = (AY - 1 - iy) * SEP - (AY * SEP) / 2;
          positions[k + 1] = smoothBig[l] * params.heightScale;
          positions[k + 2] = ix * SEP - (AX * SEP) / 2;

          let rgb;
          if (hasSelection) {
            if (ix >= sitIndexArr[0] && ix < sitIndexArr[1] && iy >= sitIndexArr[2] && iy < sitIndexArr[3]) {
              rgb = jet(0, params.colorRange, smoothBig[l]);
              dataArr.push(bigArrg[l]);
            } else {
              rgb = jetgGrey(0, params.colorRange, smoothBig[l]);
            }
          } else {
            rgb = jet(0, params.colorRange, smoothBig[l]);
          }

          colors[k]     = rgb[0] / 255;
          colors[k + 1] = rgb[1] / 255;
          colors[k + 2] = rgb[2] / 255;

          k += 3; l++;
        }
      }

      if (!hasSelection) dataArr = Array.from(bigArrg);

      // 标记需要更新（不重新 setAttribute）
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      // 统计（限频）
      const T = clock.getDelta();
      timeS += T;
      if (timeS > renderT) {
        dataArr = dataArr.filter(a => a > params.colorRange * 0.025);
        const max = findMax(dataArr);
        const point = dataArr.filter(a => a > 0).length;
        const press = dataArr.reduce((a, b) => a + b, 0);
        const mean = press / (point || 1);

        if (props.data?.current?.changeData) {
          props.data.current.changeData({ meanPres: mean.toFixed(2), maxPres: max, point, totalPres: press });
        }

        if (totalArr.length < 20) totalArr.push(press); else { totalArr.shift(); totalArr.push(press); }
        const maxTotal = findMax(totalArr);
        if (!props.local && props.data?.current?.handleCharts) props.data.current.handleCharts(totalArr, maxTotal + 1000);

        if (totalPointArr.length < 20) totalPointArr.push(point); else { totalPointArr.shift(); totalPointArr.push(point); }
        const max1 = findMax(totalPointArr);
        if (!props.local && props.data?.current?.handleChartsArea) props.data.current.handleChartsArea(totalPointArr, max1 + 100);

        timeS = 0;
      }
    }

    /* ─── 渲染循环 ─── */
    let animId;
    function animate() {
      animId = requestAnimationFrame(animate);
      renewData();
      if (controlsFlag) controls.update();
      renderer.render(scene, camera);
    }

    /* ─── 事件处理 ─── */
    function onResize() {
      let w = container.clientWidth || window.innerWidth * 0.7;
      let h = container.clientHeight || window.innerHeight * 0.8;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function onKeyDown(e) {
      if (e.key === 'Shift') { controls.mouseButtons = null; controls.keys = null; }
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && selectHelper.element) {
        const d = 1;
        const el = selectHelper.element;
        if (e.key === 'ArrowUp') el.style.top = parseInt(el.style.top || 0) - d + 'px';
        if (e.key === 'ArrowDown') el.style.top = parseInt(el.style.top || 0) + d + 'px';
        if (e.key === 'ArrowLeft') el.style.left = parseInt(el.style.left || 0) - d + 'px';
        if (e.key === 'ArrowRight') el.style.left = parseInt(el.style.left || 0) + d + 'px';
        if (!controlsFlag) {
          const rect = el.getBoundingClientRect();
          const sm = [rect.left, rect.top, rect.right, rect.bottom];
          const inter = checkRectangleIntersection(sm, sitMatrix);
          if (inter) sitIndexArr = checkRectIndex(sitMatrix, inter, AX, AY);
          if (props.changeSelect) {
            clearTimeout(stateRef.current?._debounce);
            stateRef.current._debounce = setTimeout(() => props.changeSelect({ sit: sitIndexArr, back: [] }), 500);
          }
        }
      }
    }
    function onKeyUp(e) {
      if (e.key === 'Shift') {
        controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ZOOM, RIGHT: THREE.MOUSE.ROTATE };
        controls.keys = [18, 17, 91];
      }
    }
    function onPointerDown(e) {
      if (selectHelper.isShiftPressed) {
        sitIndexArr = [];
        selectStartArr = [e.clientX, e.clientY];
        const arr = getPointCoordinate({ particles, camera, position: { x: GX, y: GY, z: GZ } });
        sitMatrix = [arr[0].x, arr[0].y, arr[1].x, arr[1].y];
        colSelectFlag = true;
      }
    }
    function onPointerMove(e) {
      if (selectHelper.isShiftPressed && colSelectFlag) {
        selectEndArr = [e.clientX, e.clientY];
        const sm = [
          Math.min(selectStartArr[0], selectEndArr[0]), Math.min(selectStartArr[1], selectEndArr[1]),
          Math.max(selectStartArr[0], selectEndArr[0]), Math.max(selectStartArr[1], selectEndArr[1]),
        ];
        if (!controlsFlag) {
          const inter = checkRectangleIntersection(sm, sitMatrix);
          if (inter) { sitIndexArr = checkRectIndex(sitMatrix, inter, AX, AY); sitIndexEndArr = [...sitIndexArr]; }
          if (props.changeStateData) {
            props.changeStateData({ width: Math.abs(selectEndArr[0] - selectStartArr[0]), height: Math.abs(selectEndArr[1] - selectStartArr[1]) });
          }
        }
      }
    }
    function onPointerUp() {
      if (selectHelper.isShiftPressed) {
        if (props.changeSelect) props.changeSelect({ sit: sitIndexEndArr, back: [] });
        selectStartArr = []; selectEndArr = []; colSelectFlag = false;
      }
    }

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // 暴露方法
    stateRef.current = {
      particles, group, controls, renderer, scene, camera,
      controlsFlag, selectHelper, sitIndexArr,
      ndata, bigArr, bigArrg, smoothBig,
      _debounce: null,
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      geometry.dispose(); material.dispose();
      if (renderer) renderer.dispose();
    };
  }, []);

  /* ─── imperative handle ─── */
  useImperativeHandle(refs, () => ({
    sitData(prop, localFlag) {
      if (!stateRef.current) return;
      const { ndata } = stateRef.current;
      const { wsPointData, valuef, valuelInit } = prop;
      const params = getParams();
      for (let i = 0; i < wsPointData.length; i++) {
        ndata[i] = wsPointData[i] - params.filterThreshold < 0 ? 0 : wsPointData[i];
      }
      const sum = ndata.reduce((a, b) => a + b, 0);
      if (sum < valuelInit) ndata.fill(0);
    },
    changeDataFlag() {},
    sitValue() {},
    changeSelectFlag(value, flag) {
      if (!stateRef.current) return;
      stateRef.current.controlsFlag = value;
      stateRef.current.selectHelper.isShiftPressed = !value;
      if (value) {
        stateRef.current.selectHelper.onSelectOver();
        if (flag && props.changeSelect) props.changeSelect({ sit: [0, 72, 0, 72] });
      }
    },
    sitRenew() {},
    changeGroupRotate(obj) {
      if (!stateRef.current) return;
      const { group, particles } = stateRef.current;
      if (typeof obj.x === 'number') group.rotation.x = -((obj.x) * 6) / 12;
      if (typeof obj.z === 'number') particles.rotation.z = (obj.z) * 6 / 12;
    },
    reset() {
      if (!stateRef.current) return;
      const { controls, group, particles } = stateRef.current;
      if (controls) controls.reset();
      group.rotation.x = -(Math.PI * 2) / 12;
      group.rotation.y = 0;
      if (particles) particles.rotation.z = 0;
      group.position.set(GX, GY, GZ);
    },
  }));

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
});

export default StandingCanvas;
