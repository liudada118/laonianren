import { useState, useCallback, useRef, useEffect } from 'react';
import { serialService } from '../lib/SerialService';

/**
 * 设备连接 Hook
 * 统一管理串口连接、模拟模式、数据采集
 */
export function useDevice({ onFrame, deviceType = 'generic' }) {
  const [status, setStatus] = useState('disconnected'); // disconnected | connecting | connected | error
  const [isSimulation, setIsSimulation] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [collectTime, setCollectTime] = useState(0);

  const simulationRef = useRef(null);
  const timerRef = useRef(null);
  const framesRef = useRef([]);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const connectDevice = useCallback(async () => {
    setStatus('connecting');
    try {
      serialService.setOnData((matrix) => {
        if (onFrameRef.current) onFrameRef.current(matrix);
      });
      serialService.setOnStatus((s) => {
        setStatus(s === 'connected' ? 'connected' : s === 'error' ? 'error' : 'disconnected');
      });
      const success = await serialService.connect();
      if (success) {
        setStatus('connected');
        setIsSimulation(false);
      } else {
        setStatus('error');
      }
    } catch (e) {
      setStatus('error');
    }
  }, []);

  const disconnectDevice = useCallback(async () => {
    if (isSimulation) {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
    } else {
      await serialService.disconnect();
    }
    setStatus('disconnected');
    setIsSimulation(false);
  }, [isSimulation]);

  const startSimulation = useCallback(() => {
    setStatus('connected');
    setIsSimulation(true);
    let frameNum = 0;
    simulationRef.current = setInterval(() => {
      frameNum++;
      const data = generateSimulationData(deviceType, frameNum);
      if (onFrameRef.current) onFrameRef.current(data);
    }, 50);
  }, [deviceType]);

  const startCollecting = useCallback(() => {
    framesRef.current = [];
    setIsCollecting(true);
    setCollectTime(0);
    timerRef.current = setInterval(() => {
      setCollectTime(t => t + 1);
    }, 1000);
  }, []);

  const stopCollecting = useCallback(() => {
    setIsCollecting(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return framesRef.current;
  }, []);

  const addFrame = useCallback((frameData) => {
    if (framesRef.current) framesRef.current.push(frameData);
  }, []);

  useEffect(() => {
    return () => {
      if (simulationRef.current) clearInterval(simulationRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return {
    status, isSimulation, isCollecting, collectTime,
    connectDevice, disconnectDevice, startSimulation,
    startCollecting, stopCollecting, addFrame, frames: framesRef
  };
}

// ==================== 模拟数据生成 ====================

function generateSimulationData(deviceType, frameNum) {
  const t = frameNum * 0.05;
  switch (deviceType) {
    case 'grip': return generateGripSimData(t);
    case 'standing': return generateStandingSimData(t);
    case 'sitstand': return generateSitStandSimData(t);
    case 'gait': return generateGaitSimData(t);
    default: return generateGripSimData(t);
  }
}

function generateGripSimData(t) {
  const base = 150 + Math.sin(t * 0.5) * 50;
  const n = () => (Math.random() - 0.5) * 20;
  return {
    type: 'grip',
    fingers: {
      thumb: Math.max(0, base * 0.9 + n()),
      index: Math.max(0, base * 1.1 + n()),
      middle: Math.max(0, base * 1.0 + n()),
      ring: Math.max(0, base * 0.8 + n()),
      pinky: Math.max(0, base * 0.6 + n()),
      palm: Math.max(0, base * 1.3 + n())
    },
    totalForce: base * 5.7,
    timestamp: t
  };
}

function generateStandingSimData(t) {
  const matrix = Array(64).fill(null).map(() => Array(64).fill(0));
  fillFootPressure(matrix, t, 5, 28, 8, 56);
  fillFootPressure(matrix, t, 36, 59, 8, 56);
  return matrix;
}

function fillFootPressure(matrix, t, colStart, colEnd, rowStart, rowEnd) {
  const centerCol = (colStart + colEnd) / 2;
  const colRadius = (colEnd - colStart) / 2;
  const rowRange = rowEnd - rowStart;
  for (let i = rowStart; i <= rowEnd; i++) {
    for (let j = colStart; j <= colEnd; j++) {
      const rn = (i - rowStart) / rowRange;
      const cn = (j - centerCol) / colRadius;
      let wf;
      if (rn < 0.15) wf = 0.5 + rn * 2;
      else if (rn < 0.4) wf = 0.8;
      else if (rn < 0.6) wf = 0.4;
      else if (rn < 0.85) wf = 0.7;
      else wf = 0.6;
      if (Math.abs(cn) > wf) continue;
      let p = rn < 0.35 ? 80 + Math.sin(t * 0.3) * 15 : rn < 0.6 ? 30 + Math.sin(t * 0.2) * 10 : 100 + Math.cos(t * 0.4) * 20;
      p *= (1 - Math.abs(cn) / wf * 0.3);
      p += (Math.random() - 0.5) * 10;
      matrix[i][j] = Math.max(0, Math.min(255, Math.round(p)));
    }
  }
}

function generateSitStandSimData(t) {
  const phase = t % 10;
  let angle, force;
  if (phase < 3) { angle = 90; force = 0.3; }
  else if (phase < 5) { const p = (phase - 3) / 2; angle = 90 - p * 90; force = 0.3 + p * 0.7; }
  else if (phase < 7) { angle = 0; force = 1.0; }
  else { const p = (phase - 7) / 3; angle = p * 90; force = 1.0 - p * 0.7; }
  return {
    type: 'sitstand',
    angle: angle + (Math.random() - 0.5) * 3,
    force: force * (200 + (Math.random() - 0.5) * 20),
    count: Math.floor(t / 10),
    timestamp: t
  };
}

function generateGaitSimData(t) {
  const sp = t % 2;
  return {
    type: 'gait',
    leftForce: Math.max(0, Math.sin(sp * Math.PI) * 200 + (Math.random() - 0.5) * 20),
    rightForce: Math.max(0, Math.sin((sp + 1) * Math.PI) * 200 + (Math.random() - 0.5) * 20),
    strideLength: 55 + (Math.random() - 0.5) * 5,
    cadence: 100 + (Math.random() - 0.5) * 10,
    speed: 0.8 + (Math.random() - 0.5) * 0.1,
    timestamp: t
  };
}

export default useDevice;
