/**
 * React Hook: usePressureScene
 * 
 * 管理 Three.js 3D 压力场景的生命周期，
 * 包括传感器连接、模拟数据、场景配置等。
 * 
 * 数据源优先级：
 * 1. 后端模式（全局一键连接后自动启用）：通过 BackendBridge WebSocket 接收后端数据
 * 2. WebSerial 模式：通过浏览器 WebSerial API 直接连接传感器
 * 3. 模拟模式：使用本地模拟数据
 * 
 * 模拟模式支持两种数据源：
 * 1. 真实数据回放：从 sit_sim_data.json / stand_sim_data.json 加载
 * 2. 随机模拟：使用 PressureSimulator 生成
 * 
 * 性能优化：模拟数据以固定帧率（~20fps）更新，避免 CPU 过载
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import {
  PressureScene3D,
  createSeatSensorSerial,
  createFootpadSensorSerial,
  PressureSimulator,
  matrixStats,
  calculateCoP,
} from '../lib/pressure-sensor';
import { backendBridge } from '../lib/BackendBridge';

const SIM_INTERVAL = 50; // 模拟数据更新间隔（ms），约 20fps

/**
 * 将 flat 数组转换为 2D 矩阵
 * @param {number[]} flat - 一维数组
 * @param {number} size - 矩阵尺寸（32 或 64）
 * @returns {number[][]} 2D 矩阵
 */
function flatToMatrix(flat, size) {
  const matrix = [];
  for (let r = 0; r < size; r++) {
    matrix.push(flat.slice(r * size, (r + 1) * size));
  }
  return matrix;
}

/**
 * 矩阵旋转180度
 * @param {number[][]} matrix
 * @returns {number[][]}
 */
function rotate180(matrix) {
  const n = matrix.length;
  const result = [];
  for (let r = n - 1; r >= 0; r--) {
    result.push([...matrix[r]].reverse());
  }
  return result;
}

/**
 * 矩阵逆时针旋转90度
 * @param {number[][]} matrix
 * @returns {number[][]}
 */
function rotateCCW90(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = [];
  for (let c = cols - 1; c >= 0; c--) {
    const newRow = [];
    for (let r = 0; r < rows; r++) {
      newRow.push(matrix[r][c]);
    }
    result.push(newRow);
  }
  return result;
}

/**
 * 过滤点状噪音：去除孤立的低压力点
 * 对每个非零像素，检查其周围邻域内的非零像素数量，
 * 如果邻居太少则认为是噪音并清零。
 * @param {number[][]} matrix - 2D压力矩阵
 * @param {number} [minNeighbors=2] - 最少邻居数（3×3邻域内）
 * @param {number} [threshold=5] - 低于此值的压力视为可疑噪音
 * @returns {number[][]} 过滤后的矩阵
 */
function denoiseMatrix(matrix, minNeighbors = 2, threshold = 5) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = matrix.map(row => [...row]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (matrix[r][c] <= 0 || matrix[r][c] > threshold) continue;
      // 统计3×3邻域内非零邻居数
      let neighbors = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && matrix[nr][nc] > 0) {
            neighbors++;
          }
        }
      }
      if (neighbors < minNeighbors) {
        result[r][c] = 0;
      }
    }
  }
  return result;
}

/**
 * @param {object} options
 * @param {object} [options.sceneConfig] - 3D场景配置
 * @param {function} [options.onSeatData] - 坐垫数据回调
 * @param {function} [options.onFootpadData] - 脚垫数据回调
 * @param {boolean} [options.isGlobalConnected] - 是否已全局一键连接
 * @param {number} [options.backendMode] - 后端模式编号（3=坐垫+脚垫, 5=脚垫）
 */
export function usePressureScene(options = {}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const seatSensorRef = useRef(null);
  const footpadSensorRef = useRef(null);
  const simTimerRef = useRef(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 真实模拟数据缓存
  const seatSimDataRef = useRef(null);   // sit_sim_data.json frames
  const footSimDataRef = useRef(null);   // stand_sim_data.json frames
  const simFrameIdxRef = useRef(0);      // 当前回放帧索引

  // 后端数据通道清理函数
  const backendCleanupRef = useRef(null);

  const [isSeatConnected, setIsSeatConnected] = useState(false);
  const [isFootpadConnected, setIsFootpadConnected] = useState(false);
  const [seatStats, setSeatStats] = useState(null);
  const [footpadStats, setFootpadStats] = useState(null);
  const [seatCoP, setSeatCoP] = useState(null);
  const [footpadCoP, setFootpadCoP] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isBackendMode, setIsBackendMode] = useState(false);

  // 初始化场景
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new PressureScene3D(options.sceneConfig);
    scene.mount(containerRef.current);
    sceneRef.current = scene;

    // 初始化传感器（WebSerial 模式备用）
    const seatSensor = createSeatSensorSerial();
    const footpadSensor = createFootpadSensorSerial();
    seatSensorRef.current = seatSensor;
    footpadSensorRef.current = footpadSensor;

    // 坐垫数据回调（WebSerial 模式）
    seatSensor.onData((frame) => {
      scene.updateSeatData(frame.matrix);
      const stats = matrixStats(frame.matrix);
      const cop = calculateCoP(frame.matrix);
      setSeatStats(stats);
      setSeatCoP(cop);
      if (optionsRef.current.onSeatData) {
        optionsRef.current.onSeatData(frame, stats, cop);
      }
    });

    // 脚垫数据回调（WebSerial 模式）
    footpadSensor.onData((frame) => {
      scene.updateFootpadData(frame.matrix);
      const stats = matrixStats(frame.matrix);
      const cop = calculateCoP(frame.matrix);
      setFootpadStats(stats);
      setFootpadCoP(cop);
      if (optionsRef.current.onFootpadData) {
        optionsRef.current.onFootpadData(frame, stats, cop);
      }
    });

    // 连接状态回调
    seatSensor.onConnectionChange(setIsSeatConnected);
    footpadSensor.onConnectionChange(setIsFootpadConnected);

    return () => {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
      if (backendCleanupRef.current) {
        backendCleanupRef.current();
        backendCleanupRef.current = null;
      }
      seatSensor.disconnect();
      footpadSensor.disconnect();
      scene.unmount();
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 后端数据通道：当全局一键连接后自动启用 ───
  useEffect(() => {
    const isGlobalConnected = optionsRef.current.isGlobalConnected;
    if (!isGlobalConnected || !sceneRef.current) return;
    if (backendCleanupRef.current) return; // 已经在监听了

    const mode = optionsRef.current.backendMode || 3;

    // 设置后端采集模式
    backendBridge.setActiveMode(mode).then(() => {
      console.log(`[usePressureScene] 已设置后端模式 mode=${mode}`);
    }).catch(e => console.error('[usePressureScene] setActiveMode failed:', e));

    setIsBackendMode(true);
    setIsSeatConnected(true);
    setIsFootpadConnected(true);

    // 处理后端推送的坐垫数据
    const handleSitData = (arr) => {
      const scene = sceneRef.current;
      if (!scene || !arr || arr.length === 0) return;

      // 后端推送的是 1024 个值的 flat 数组，转为 32x32 矩阵
      const size = Math.round(Math.sqrt(arr.length));
      const matrix = denoiseMatrix(rotate180(flatToMatrix(arr, size)), 3, 15);
      scene.updateSeatData(matrix);
      const stats = matrixStats(matrix);
      const cop = calculateCoP(matrix);
      setSeatStats(stats);
      setSeatCoP(cop);
      if (optionsRef.current.onSeatData) {
        optionsRef.current.onSeatData({
          matrix,
          maxVal: stats.max,
          minVal: stats.min,
          nonZeroCount: stats.nonZeroCount,
          timestamp: Date.now(),
        }, stats, cop);
      }
    };

    // 处理后端推送的脚垫数据（合并 foot1-4 为一个 64x64 矩阵）
    const footBuffers = { foot1: null, foot2: null, foot3: null, foot4: null };
    const handleFootData = (type) => (arr) => {
      const scene = sceneRef.current;
      if (!scene || !arr || arr.length === 0) return;

      footBuffers[type] = arr;

      // 当所有4个脚垫都有数据时，合并为 64x64 矩阵
      // 每个脚垫是 32x32 = 1024 个值（从4096中提取有效区域）
      // 或者直接使用 64x64 = 4096 个值
      // 根据后端数据格式，每个 foot 是 4096 个值 = 64x64
      // 但实际上4个脚垫组合成一个完整的足底压力图
      // 这里先用 foot1 的数据作为左脚，foot3 作为右脚（简化处理）
      
      // 使用当前可用的脚垫数据更新场景
      const combined = combineFootpads(footBuffers);
      if (combined) {
        const matrix = denoiseMatrix(rotateCCW90(combined), 3, 12);
        scene.updateFootpadData(matrix);
        const stats = matrixStats(matrix);
        const cop = calculateCoP(matrix);
        setFootpadStats(stats);
        setFootpadCoP(cop);
        if (optionsRef.current.onFootpadData) {
          optionsRef.current.onFootpadData({
            matrix,
            maxVal: stats.max,
            minVal: stats.min,
            nonZeroCount: stats.nonZeroCount,
            timestamp: Date.now(),
          }, stats, cop);
        }
      }
    };

    // 注册事件监听
    const unsubSit = backendBridge.on('sitData', handleSitData);
    const unsubFoot1 = backendBridge.on('foot1Data', handleFootData('foot1'));
    const unsubFoot2 = backendBridge.on('foot2Data', handleFootData('foot2'));
    const unsubFoot3 = backendBridge.on('foot3Data', handleFootData('foot3'));
    const unsubFoot4 = backendBridge.on('foot4Data', handleFootData('foot4'));

    backendCleanupRef.current = () => {
      unsubSit();
      unsubFoot1();
      unsubFoot2();
      unsubFoot3();
      unsubFoot4();
      setIsBackendMode(false);
    };

    console.log('[usePressureScene] 后端数据通道已建立');

    return () => {
      if (backendCleanupRef.current) {
        backendCleanupRef.current();
        backendCleanupRef.current = null;
      }
    };
  }, [options.isGlobalConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // 开始模拟（使用 setInterval 限制帧率）
  const startSimulation = useCallback(async () => {
    if (!sceneRef.current) return;
    if (isBackendMode) return; // 后端模式下不启动模拟
    if (seatSensorRef.current?.getIsConnected() || footpadSensorRef.current?.getIsConnected()) return;
    if (simTimerRef.current) return; // 防止重复启动

    setIsSimulating(true);

    // 尝试加载真实数据
    let useRealData = false;
    if (!seatSimDataRef.current || !footSimDataRef.current) {
      try {
        console.log('[模拟] 正在加载真实坐起数据...');
        const [sitResp, standResp] = await Promise.all([
          fetch('/sit_sim_data.json'),
          fetch('/stand_sim_data.json'),
        ]);
        const sitData = await sitResp.json();
        const standData = await standResp.json();
        seatSimDataRef.current = sitData.frames;
        footSimDataRef.current = standData.frames;
        console.log(`[模拟] 加载完成: 坐垫 ${sitData.frames.length} 帧, 脚垫 ${standData.frames.length} 帧`);
        useRealData = true;
      } catch (err) {
        console.warn('[模拟] 加载真实数据失败，使用随机模拟:', err);
        seatSimDataRef.current = null;
        footSimDataRef.current = null;
      }
    } else {
      useRealData = true;
    }

    simFrameIdxRef.current = 0;

    if (useRealData && seatSimDataRef.current && footSimDataRef.current) {
      // ── 真实数据回放模式 ──
      const seatFrames = seatSimDataRef.current;
      const footFrames = footSimDataRef.current;
      const totalFrames = Math.max(seatFrames.length, footFrames.length);

      simTimerRef.current = setInterval(() => {
        const scene = sceneRef.current;
        if (!scene) return;

        const idx = simFrameIdxRef.current % totalFrames;

        // 坐垫数据（32×32）
        if (!seatSensorRef.current?.getIsConnected() && seatFrames.length > 0) {
          const seatFlat = seatFrames[idx % seatFrames.length];
          const seatMatrix = denoiseMatrix(rotate180(flatToMatrix(seatFlat, 32)), 3, 15);
          scene.updateSeatData(seatMatrix);
          const stats = matrixStats(seatMatrix);
          const cop = calculateCoP(seatMatrix);
          setSeatStats(stats);
          setSeatCoP(cop);
          if (optionsRef.current.onSeatData) {
            optionsRef.current.onSeatData({
              matrix: seatMatrix,
              maxVal: stats.max,
              minVal: stats.min,
              nonZeroCount: stats.nonZeroCount,
              timestamp: Date.now(),
            }, stats, cop);
          }
        }

        // 脚垫数据（64×64）
        if (!footpadSensorRef.current?.getIsConnected() && footFrames.length > 0) {
          const footFlat = footFrames[idx % footFrames.length];
          const footMatrix = denoiseMatrix(rotateCCW90(flatToMatrix(footFlat, 64)), 3, 12);
          scene.updateFootpadData(footMatrix);
          const stats = matrixStats(footMatrix);
          const cop = calculateCoP(footMatrix);
          setFootpadStats(stats);
          setFootpadCoP(cop);
          if (optionsRef.current.onFootpadData) {
            optionsRef.current.onFootpadData({
              matrix: footMatrix,
              maxVal: stats.max,
              minVal: stats.min,
              nonZeroCount: stats.nonZeroCount,
              timestamp: Date.now(),
            }, stats, cop);
          }
        }

        simFrameIdxRef.current++;
      }, SIM_INTERVAL);
    } else {
      // ── 随机模拟降级模式 ──
      const seatSim = new PressureSimulator(32, 'sitting');
      const footpadSim = new PressureSimulator(64, 'static');

      simTimerRef.current = setInterval(() => {
        const scene = sceneRef.current;
        if (!scene) return;

        const dt = SIM_INTERVAL / 1000;

        if (!seatSensorRef.current?.getIsConnected()) {
          const seatMatrix = seatSim.update(dt);
          scene.updateSeatData(seatMatrix);
          const stats = matrixStats(seatMatrix);
          const cop = calculateCoP(seatMatrix);
          setSeatStats(stats);
          setSeatCoP(cop);
          if (optionsRef.current.onSeatData) {
            optionsRef.current.onSeatData({
              matrix: seatMatrix,
              maxVal: stats.max,
              minVal: stats.min,
              nonZeroCount: stats.nonZeroCount,
              timestamp: Date.now(),
            }, stats, cop);
          }
        }

        if (!footpadSensorRef.current?.getIsConnected()) {
          const footpadMatrix = footpadSim.update(dt);
          scene.updateFootpadData(footpadMatrix);
          const stats = matrixStats(footpadMatrix);
          const cop = calculateCoP(footpadMatrix);
          setFootpadStats(stats);
          setFootpadCoP(cop);
          if (optionsRef.current.onFootpadData) {
            optionsRef.current.onFootpadData({
              matrix: footpadMatrix,
              maxVal: stats.max,
              minVal: stats.min,
              nonZeroCount: stats.nonZeroCount,
              timestamp: Date.now(),
            }, stats, cop);
          }
        }
      }, SIM_INTERVAL);
    }
  }, [isBackendMode]);

  // 停止模拟
  const stopSimulation = useCallback(() => {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    setIsSimulating(false);
  }, []);

  // 连接坐垫传感器（WebSerial 模式）
  const connectSeat = useCallback(async () => {
    if (isBackendMode) return; // 后端模式下不允许 WebSerial 连接
    if (isSeatConnected) {
      await seatSensorRef.current?.disconnect();
    } else {
      stopSimulation();
      await seatSensorRef.current?.connect();
    }
  }, [isSeatConnected, stopSimulation, isBackendMode]);

  // 连接脚垫传感器（WebSerial 模式）
  const connectFootpad = useCallback(async () => {
    if (isBackendMode) return; // 后端模式下不允许 WebSerial 连接
    if (isFootpadConnected) {
      await footpadSensorRef.current?.disconnect();
    } else {
      stopSimulation();
      await footpadSensorRef.current?.connect();
    }
  }, [isFootpadConnected, stopSimulation, isBackendMode]);

  // 更新场景配置
  const updateConfig = useCallback((config) => {
    sceneRef.current?.updateConfig(config);
  }, []);

  return {
    containerRef,
    isSeatConnected,
    isFootpadConnected,
    isSimulating,
    isBackendMode,
    seatStats,
    footpadStats,
    seatCoP,
    footpadCoP,
    connectSeat,
    connectFootpad,
    startSimulation,
    stopSimulation,
    updateConfig,
  };
}

/**
 * 合并4个脚垫数据为一个完整的足底压力矩阵
 * 布局：foot1(左前) foot2(右前)
 *       foot3(左后) foot4(右后)
 * 每个脚垫是 64x64 = 4096 个值
 * 合并后为 128x128 矩阵（或根据实际需要调整）
 * 
 * 简化方案：如果只有部分脚垫数据，使用可用的数据
 */
function combineFootpads(buffers) {
  // 找到第一个有数据的脚垫
  const available = Object.entries(buffers).filter(([, v]) => v && v.length > 0);
  if (available.length === 0) return null;

  // 如果只有一个脚垫有数据，直接使用它
  if (available.length === 1) {
    const [, arr] = available[0];
    const size = Math.round(Math.sqrt(arr.length));
    return flatToMatrix(arr, size);
  }

  // 多个脚垫数据：合并为更大的矩阵
  // 每个脚垫 64x64，4个合并为 128x128
  const size = 64;
  const combined = Array.from({ length: size * 2 }, () => new Array(size * 2).fill(0));

  // foot1 → 左上 (0,0)
  if (buffers.foot1 && buffers.foot1.length >= size * size) {
    const m = flatToMatrix(buffers.foot1, size);
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        combined[r][c] = m[r][c];
  }

  // foot2 → 右上 (0, size)
  if (buffers.foot2 && buffers.foot2.length >= size * size) {
    const m = flatToMatrix(buffers.foot2, size);
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        combined[r][size + c] = m[r][c];
  }

  // foot3 → 左下 (size, 0)
  if (buffers.foot3 && buffers.foot3.length >= size * size) {
    const m = flatToMatrix(buffers.foot3, size);
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        combined[size + r][c] = m[r][c];
  }

  // foot4 → 右下 (size, size)
  if (buffers.foot4 && buffers.foot4.length >= size * size) {
    const m = flatToMatrix(buffers.foot4, size);
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        combined[size + r][size + c] = m[r][c];
  }

  return combined;
}
