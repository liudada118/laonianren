/**
 * StandingCanvas - 基于 Three.js 粒子系统的静态站立压力可视化
 * 
 * 适配自用户提供的 Canvas 样例组件，接入项目的 64×64 矩阵数据流。
 * 兼容 three.js 0.177+（使用 outputColorSpace / SRGBColorSpace）
 * 
 * Props:
 *   - externalDataRef: React ref，ref.current 为 64×64 的二维数组
 *   - showHeatmap: boolean
 *   - depthScale: number
 *   - smoothness: number
 *   - data: ref 对象
 *   - changeSelect: 选区变化回调
 *   - changeStateData: 选区尺寸回调
 *   - local: boolean
 */
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls";
import { SelectionHelper } from "./SelectionHelper";
import { checkRectIndex, checkRectangleIntersection, getPointCoordinate } from "./threeUtil1";
import {
  addSide,
  findMax,
  gaussBlur_1,
  interp,
  jet,
  jetgGrey,
} from "./util";
import { obj } from "./config";
import React, { useEffect, useImperativeHandle, useRef, useState } from "react";

let group = new THREE.Group();
const sitnum1 = 64;
const sitnum2 = 64;
const sitInterp = 2;
const sitOrder = 4;
let controlsFlag = true;
var ndata1 = new Array(sitnum1 * sitnum2).fill(0);

var valuej1 = localStorage.getItem('carValuej') ? JSON.parse(localStorage.getItem('carValuej')) : 200,
  valueg1 = localStorage.getItem('carValueg') ? JSON.parse(localStorage.getItem('carValueg')) : 2,
  value1 = localStorage.getItem('carValue') ? JSON.parse(localStorage.getItem('carValue')) : 2,
  valuel1 = localStorage.getItem('carValuel') ? JSON.parse(localStorage.getItem('carValuel')) : 2,
  valuef1 = localStorage.getItem('carValuef') ? JSON.parse(localStorage.getItem('carValuef')) : 2,
  valuelInit1 = localStorage.getItem('carValueInit') ? JSON.parse(localStorage.getItem('carValueInit')) : 2;

let timer;
function debounce(fn, time) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { fn(); }, time);
}

var FPS = 10;
var timeS = 0;
var renderT = 1 / FPS;
let totalArr = [], totalPointArr = [];
let local;
let camera;
let particles, material, sitGeometry;
let controls;

const StandingCanvas = React.forwardRef((props, refs) => {
  local = props.local;
  const containerRef = useRef(null);
  var selectStartArr = [], selectEndArr = [], sitArr, sitMatrix = [], selectMatrix = [], selectHelper = {};
  let sitIndexArr = [], sitIndexEndArr = [];
  var animationRequestId, colSelectFlag = false;
  let dataFlag = false;

  const changeDataFlag = () => { dataFlag = true; };

  let bigArr = new Array(sitnum1 * sitInterp * sitnum2 * sitInterp).fill(1);
  let bigArrg = new Array(
    (sitnum1 * sitInterp + sitOrder * 2) * (sitnum2 * sitInterp + sitOrder * 2)
  ).fill(1),
    smoothBig = new Array(
      (sitnum1 * sitInterp + sitOrder * 2) * (sitnum2 * sitInterp + sitOrder * 2)
    ).fill(1);

  let container;
  let scene, renderer;
  const clock = new THREE.Clock();
  const ALT_KEY = 18;
  const CTRL_KEY = 17;
  const CMD_KEY = 91;
  const AMOUNTX = sitnum1 * sitInterp + sitOrder * 2;  // 136
  const AMOUNTY = sitnum2 * sitInterp + sitOrder * 2;  // 136
  const SEPARATION = 100;
  const groupX = 5, groupY = 150, groupZ = 230;
  let positions;
  let colors, scales;

  // 从 externalDataRef 读取 64×64 矩阵并转为 flat 数组
  function readExternalData() {
    if (props.externalDataRef && props.externalDataRef.current) {
      const matrix = props.externalDataRef.current;
      if (Array.isArray(matrix) && matrix.length > 0) {
        const flat = [];
        for (let i = 0; i < matrix.length; i++) {
          for (let j = 0; j < matrix[i].length; j++) {
            flat.push(matrix[i][j]);
          }
        }
        return flat;
      }
    }
    return null;
  }

  function init() {
    container = containerRef.current;
    if (!container) return;

    // 获取容器实际尺寸
    let w = container.clientWidth;
    let h = container.clientHeight;
    if (w < 10) w = window.innerWidth * 0.7;
    if (h < 10) h = window.innerHeight * 0.8;

    camera = new THREE.PerspectiveCamera(40, w / h, 1, 150000);
    camera.position.z = 300;
    camera.position.y = 200;

    scene = new THREE.Scene();

    initSet();
    group.position.x = groupX;
    group.position.y = groupY;
    group.position.z = groupZ;
    scene.add(group);

    const helper = new THREE.GridHelper(2000, 100);
    helper.position.y = -199;
    helper.material.opacity = 0.25;
    helper.material.transparent = true;
    scene.add(helper);

    // lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff);
    dirLight.position.set(0, 200, 10);
    scene.add(dirLight);
    const dirLight1 = new THREE.DirectionalLight(0xffffff);
    dirLight1.position.set(0, 10, 200);
    scene.add(dirLight1);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);

    // three.js 0.177+ 使用 outputColorSpace 替代 outputEncoding
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    // 清空旧子节点后挂载
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    renderer.setClearColor(0x000000);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.dynamicDampingFactor = 0.2;
    controls.domElement = container;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.ZOOM,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.keys = [ALT_KEY, CTRL_KEY, CMD_KEY];

    window.addEventListener("resize", onWindowResize);

    selectHelper = new SelectionHelper(renderer, controls, 'selectBox');

    renderer.domElement.addEventListener('pointerdown', pointDown);
    renderer.domElement.addEventListener('pointermove', pointMove);
    renderer.domElement.addEventListener('pointerup', pointUp);

    document.addEventListener('keydown', handleKeyDown);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!selectHelper.element) return;
      const delta = 1;
      if (e.key === 'ArrowUp') selectHelper.element.style.top = parseInt(selectHelper.element.style.top || 0) - delta + 'px';
      if (e.key === 'ArrowDown') selectHelper.element.style.top = parseInt(selectHelper.element.style.top || 0) + delta + 'px';
      if (e.key === 'ArrowLeft') selectHelper.element.style.left = parseInt(selectHelper.element.style.left || 0) - delta + 'px';
      if (e.key === 'ArrowRight') selectHelper.element.style.left = parseInt(selectHelper.element.style.left || 0) + delta + 'px';

      if (!controlsFlag && selectHelper.element) {
        const elementLocal = selectHelper.element.getBoundingClientRect();
        const sm = [elementLocal.left, elementLocal.top, elementLocal.right, elementLocal.bottom];
        const sitInterArr = checkRectangleIntersection(sm, sitMatrix);
        if (sitInterArr) {
          sitIndexArr = checkRectIndex(sitMatrix, sitInterArr, AMOUNTX, AMOUNTY);
        }
        if (props.changeSelect) {
          debounce(() => props.changeSelect({ sit: sitIndexArr, back: [] }), 500);
        }
      }
    }
  }

  function pointDown(event) {
    if (selectHelper.isShiftPressed) {
      sitIndexArr = [];
      selectStartArr = [event.clientX, event.clientY];
      sitArr = getPointCoordinate({ particles, camera, position: { x: groupX, y: groupY, z: groupZ } });
      sitMatrix = [sitArr[0].x, sitArr[0].y, sitArr[1].x, sitArr[1].y];
      colSelectFlag = true;
    }
  }

  function pointMove(event) {
    if (selectHelper.isShiftPressed && colSelectFlag) {
      selectEndArr = [event.clientX, event.clientY];
      selectMatrix = [...selectStartArr, ...selectEndArr];
      if (selectStartArr[0] > selectEndArr[0]) { selectMatrix[0] = selectEndArr[0]; selectMatrix[2] = selectStartArr[0]; }
      else { selectMatrix[0] = selectStartArr[0]; selectMatrix[2] = selectEndArr[0]; }
      if (selectStartArr[1] > selectEndArr[1]) { selectMatrix[1] = selectEndArr[1]; selectMatrix[3] = selectStartArr[1]; }
      else { selectMatrix[1] = selectStartArr[1]; selectMatrix[3] = selectEndArr[1]; }

      if (!controlsFlag) {
        const sitInterArr = checkRectangleIntersection(selectMatrix, sitMatrix);
        if (sitInterArr) { sitIndexArr = checkRectIndex(sitMatrix, sitInterArr, AMOUNTX, AMOUNTY); sitIndexEndArr = [...sitIndexArr]; }
        const width = Math.abs(Math.round(selectEndArr[0] - selectStartArr[0]));
        const height = Math.abs(Math.round(selectEndArr[1] - selectStartArr[1]));
        if (props.changeStateData) { props.changeStateData({ width, height }); }
      }
    }
  }

  function pointUp(event) {
    if (selectHelper.isShiftPressed) {
      if (props.changeSelect) { props.changeSelect({ sit: sitIndexEndArr, back: [] }); }
      selectStartArr = []; selectEndArr = []; colSelectFlag = false;
    }
  }

  // 初始化粒子系统
  function initSet() {
    const numParticles = AMOUNTX * AMOUNTY;
    positions = new Float32Array(numParticles * 3);
    scales = new Float32Array(numParticles);
    colors = new Float32Array(numParticles * 3);
    let i = 0, j = 0;

    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        positions[i] = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2 + ix * 20;
        positions[i + 1] = 0;
        positions[i + 2] = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;
        scales[j] = 1;
        colors[i] = 0;
        colors[i + 1] = 0;
        colors[i + 2] = 1;  // 蓝色
        i += 3;
        j++;
      }
    }

    sitGeometry = new THREE.BufferGeometry();
    sitGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    // 使用绝对路径加载纹理（Electron/Vite 中 ./circle.png 可能无法解析）
    const sprite = new THREE.TextureLoader().load("/circle.png");

    material = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      map: sprite,
      size: 1,
      // 确保深度测试和写入正确
      depthWrite: false,
      sizeAttenuation: true,
    });

    sitGeometry.setAttribute("scale", new THREE.BufferAttribute(scales, 1));
    sitGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    particles = new THREE.Points(sitGeometry, material);

    particles.scale.x = 0.0062;
    particles.scale.y = 0.0062;
    particles.scale.z = 0.0062;
    particles.rotation.x = Math.PI / 3;

    group.add(particles);
  }

  function onWindowResize() {
    const c = containerRef.current;
    if (!c || !renderer || !camera) return;
    let w = c.clientWidth;
    let h = c.clientHeight;
    if (w < 10) w = window.innerWidth * 0.7;
    if (h < 10) h = window.innerHeight * 0.8;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function animate() {
    animationRequestId = requestAnimationFrame(animate);
    render();
  }

  function changeSelectFlag(value, flag) {
    controlsFlag = value;
    selectHelper.isShiftPressed = !value;
    if (value) {
      selectHelper.onSelectOver();
      if (flag && props.changeSelect) { props.changeSelect({ sit: [0, 72, 0, 72] }); }
    }
  }

  // 更新座椅数据
  function sitRenew() {
    // 从 externalDataRef 读取最新数据
    const externalFlat = readExternalData();
    if (externalFlat) {
      ndata1 = externalFlat;
    }

    interp(ndata1, bigArr, sitnum1, sitInterp);

    let bigArrs = addSide(
      bigArr,
      sitnum2 * sitInterp,
      sitnum1 * sitInterp,
      sitOrder,
      sitOrder
    );

    gaussBlur_1(
      bigArrs,
      bigArrg,
      sitnum2 * sitInterp + sitOrder * 2,
      sitnum1 * sitInterp + sitOrder * 2,
      valueg1
    );

    let k = 0, l = 0;
    let dataArr = [];
    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        const value = bigArrg[l] * 10;
        smoothBig[l] = smoothBig[l] + (value - smoothBig[l] + 0.5) / valuel1;

        positions[k] = ix * SEPARATION - (AMOUNTX * SEPARATION) / 2;
        positions[k + 1] = smoothBig[l] * value1;
        positions[k + 2] = iy * SEPARATION - (AMOUNTY * SEPARATION) / 2;

        let rgb;
        if (sitIndexArr && sitIndexArr.length > 0 && !sitIndexArr.every((a) => a === 0)) {
          if (ix >= sitIndexArr[0] && ix < sitIndexArr[1] && iy >= sitIndexArr[2] && iy < sitIndexArr[3]) {
            rgb = jet(0, valuej1, smoothBig[l]);
            dataArr.push(bigArrg[l]);
          } else {
            rgb = jetgGrey(0, valuej1, smoothBig[l]);
          }
        } else {
          rgb = jet(0, valuej1, smoothBig[l]);
        }

        colors[k] = rgb[0] / 255;
        colors[k + 1] = rgb[1] / 255;
        colors[k + 2] = rgb[2] / 255;

        k += 3;
        l++;
      }
    }

    if (!sitIndexArr.length || sitIndexArr.every((a) => a === 0)) {
      dataArr = [...bigArrg];
    }

    var T = clock.getDelta();
    timeS = timeS + T;
    if (timeS > renderT) {
      dataArr = dataArr.filter((a) => a > valuej1 * 0.025);
      const max = findMax(dataArr);
      const point = dataArr.filter((a) => a > 0).length;
      const press = dataArr.reduce((a, b) => a + b, 0);
      const mean = press / (point === 0 ? 1 : point);

      if (props.data && props.data.current && props.data.current.changeData) {
        props.data.current.changeData({ meanPres: mean.toFixed(2), maxPres: max, point: point, totalPres: press });
      }

      if (totalArr.length < 20) { totalArr.push(press); }
      else { totalArr.shift(); totalArr.push(press); }

      const maxTotal = findMax(totalArr);
      if (!local && props.data && props.data.current && props.data.current.handleCharts) {
        props.data.current.handleCharts(totalArr, maxTotal + 1000);
      }

      if (totalPointArr.length < 20) { totalPointArr.push(point); }
      else { totalPointArr.shift(); totalPointArr.push(point); }

      const max1 = findMax(totalPointArr);
      if (!local && props.data && props.data.current && props.data.current.handleChartsArea) {
        props.data.current.handleChartsArea(totalPointArr, max1 + 100);
      }
      timeS = 0;
    }

    particles.geometry.attributes.position.needsUpdate = true;
    particles.geometry.attributes.color.needsUpdate = true;

    sitGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    sitGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }

  function render() {
    if (!renderer || !scene || !camera || !controls || !particles) return;
    sitRenew();
    if (controlsFlag) {
      controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ZOOM, RIGHT: THREE.MOUSE.ROTATE };
      controls.keys = [ALT_KEY, CTRL_KEY, CMD_KEY];
      controls.update();
    } else {
      controls.keys = [];
      controls.mouseButtons = [];
    }
    renderer.render(scene, camera);
  }

  function sitData(prop, localFlag) {
    local = localFlag;
    const { wsPointData, valuef, valuelInit } = prop;
    ndata1 = wsPointData;
    ndata1 = ndata1.map((a) => (a - valuef1 < 0 ? 0 : a));
    const ndata1Num = ndata1.reduce((a, b) => a + b, 0);
    if (ndata1Num < valuelInit) { ndata1 = new Array(sitnum1 * sitnum2).fill(0); }
  }

  function sitValue(prop) {
    const { valuej, valueg, value, valuel, valuef, valuelInit } = prop;
    if (valuej) valuej1 = valuej;
    if (valueg) valueg1 = valueg;
    if (value) value1 = value;
    if (valuel) valuel1 = valuel;
    if (valuef) valuef1 = valuef;
    if (valuelInit) valuelInit1 = valuelInit;
    ndata1 = ndata1.map((a) => (a - valuef1 < 0 ? 0 : a));
  }

  function changeGroupRotate(obj) {
    if (typeof obj.x === 'number') { group.rotation.x = -((obj.x) * 6) / 12; }
    if (typeof obj.z === 'number') { particles.rotation.z = (obj.z) * 6 / 12; }
  }

  function reset() {
    if (controls) controls.reset();
    group.rotation.x = -(Math.PI * 2) / 12;
    group.rotation.y = 0;
    if (particles) particles.rotation.z = 0;
    group.position.x = groupX;
    group.position.y = groupY;
    group.position.z = groupZ;
  }

  useImperativeHandle(refs, () => ({
    sitData, changeDataFlag, sitValue, changeSelectFlag, sitRenew, changeGroupRotate, reset,
  }));

  function onKeyDown(event) {
    if (event.key === 'Shift' && controls) { controls.mouseButtons = null; controls.keys = null; }
  }

  function onKeyUp(event) {
    if (event.key === 'Shift' && controls) {
      controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ZOOM, RIGHT: THREE.MOUSE.ROTATE };
      controls.keys = [ALT_KEY, CTRL_KEY, CMD_KEY];
    }
  }

  useEffect(() => {
    init();
    animate();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(animationRequestId);
      // 清理 group 中的对象
      while (group.children.length > 0) {
        group.remove(group.children[0]);
      }
      group = new THREE.Group();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('keydown', handleKeyDown);
      // 清理 renderer
      if (renderer) {
        renderer.dispose();
      }
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }}></div>
    </div>
  );
});

export default StandingCanvas;
