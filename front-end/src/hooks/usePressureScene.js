/**
 * React Hook: usePressureScene
 * 
 * 管理 Three.js 3D 压力场景的生命周期，
 * 包括传感器连接、模拟数据、场景配置等。
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

  const [isSeatConnected, setIsSeatConnected] = useState(false);
  const [isFootpadConnected, setIsFootpadConnected] = useState(false);
  const [seatStats, setSeatStats] = useState(null);
  const [footpadStats, setFootpadStats] = useState(null);
  const [seatCoP, setSeatCoP] = useState(null);
  const [footpadCoP, setFootpadCoP] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  // 初始化场景
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new PressureScene3D(options.sceneConfig);
    scene.mount(containerRef.current);
    sceneRef.current = scene;

    // 初始化传感器
    const seatSensor = createSeatSensorSerial();
    const footpadSensor = createFootpadSensorSerial();
    seatSensorRef.current = seatSensor;
    footpadSensorRef.current = footpadSensor;

    // 坐垫数据回调
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

    // 脚垫数据回调
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
      seatSensor.disconnect();
      footpadSensor.disconnect();
      scene.unmount();
      sceneRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 开始模拟（使用 setInterval 限制帧率）
  const startSimulation = useCallback(async () => {
    if (!sceneRef.current) return;
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
  }, []);

  // 停止模拟
  const stopSimulation = useCallback(() => {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    setIsSimulating(false);
  }, []);

  // 连接坐垫传感器
  const connectSeat = useCallback(async () => {
    if (isSeatConnected) {
      await seatSensorRef.current?.disconnect();
    } else {
      stopSimulation();
      await seatSensorRef.current?.connect();
    }
  }, [isSeatConnected, stopSimulation]);

  // 连接脚垫传感器
  const connectFootpad = useCallback(async () => {
    if (isFootpadConnected) {
      await footpadSensorRef.current?.disconnect();
    } else {
      stopSimulation();
      await footpadSensorRef.current?.connect();
    }
  }, [isFootpadConnected, stopSimulation]);

  // 更新场景配置
  const updateConfig = useCallback((config) => {
    sceneRef.current?.updateConfig(config);
  }, []);

  return {
    containerRef,
    isSeatConnected,
    isFootpadConnected,
    isSimulating,
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
