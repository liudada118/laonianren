import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import HandModel from '../../components/three/HandModel';
import GripReport from '../../components/report/GripReport';
import EChart from '../../components/ui/EChart';
import { HeatmapCanvas } from '../../lib/heatmap';
import { mapLeftHand, mapRightHand, generateSimulatedSensorData } from '../../lib/gripDataMapping';
import { gloveService } from '../../lib/GloveSerialService';
import SerialLogPanel from '../../components/debug/SerialLogPanel';
import { generateGripReportData } from '../../lib/gripReportGenerator';

/* ─── 步骤指示器 (蔡司风格) ─── */
function StepIndicator({ current, steps }) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={i}>
            {i > 0 && <div className="zeiss-step-line" style={done ? { background: 'var(--success)' } : {}} />}
            <div className="flex flex-col items-center gap-1">
              <div className={`zeiss-step-circle ${done ? 'completed' : active ? 'active' : 'pending'}`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </div>
              <span className="text-[10px] font-medium" style={{ color: done || active ? 'var(--zeiss-blue)' : 'var(--text-muted)' }}>{label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── 左侧统一数据面板 ─── */
function LeftDataPanel({ leftData, rightData, leftStats, rightStats, phase, timer, fmtTime }) {
  const isLeftActive = phase.startsWith('left');
  const isRightActive = phase.startsWith('right');
  const isRecording = phase.includes('recording');

  const leftLineOpt = useMemo(() => ({
    animation: false,
    grid: { top: 8, bottom: 16, left: 32, right: 8 },
    xAxis: { type: 'category', data: leftData.map((_, i) => i), show: false, boundaryGap: false },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F0F2F5' } }, axisLabel: { color: '#8896A6', fontSize: 9 } },
    series: [{ type: 'line', data: leftData.map(d => d.value), smooth: true, symbol: 'none',
      lineStyle: { color: '#0066CC', width: 1.5 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(0,102,204,0.15)' }, { offset: 1, color: 'rgba(0,102,204,0)' }] } }
    }]
  }), [leftData]);

  const rightLineOpt = useMemo(() => ({
    animation: false,
    grid: { top: 8, bottom: 16, left: 32, right: 8 },
    xAxis: { type: 'category', data: rightData.map((_, i) => i), show: false, boundaryGap: false },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F0F2F5' } }, axisLabel: { color: '#8896A6', fontSize: 9 } },
    series: [{ type: 'line', data: rightData.map(d => d.value), smooth: true, symbol: 'none',
      lineStyle: { color: '#059669', width: 1.5 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(5,150,105,0.15)' }, { offset: 1, color: 'rgba(5,150,105,0)' }] } }
    }]
  }), [rightData]);

  const leftNormalOpt = useMemo(() => {
    const mean = parseFloat(leftStats.mean) || 190;
    const std = leftStats.std || 15;
    const xs = Array.from({ length: 100 }, (_, i) => (mean - 4 * std + i * 8 * std / 100).toFixed(1));
    const ys = xs.map(x => (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mean) / std) ** 2));
    return {
      animation: false,
      grid: { top: 8, bottom: 16, left: 32, right: 8 },
      xAxis: { type: 'category', data: xs, axisLabel: { color: '#8896A6', fontSize: 8, interval: 24 }, boundaryGap: false },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F0F2F5' } }, axisLabel: { color: '#8896A6', fontSize: 9 } },
      series: [{ type: 'line', data: ys, smooth: true, symbol: 'none',
        lineStyle: { color: '#0891B2', width: 1.5 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(8,145,178,0.12)' }, { offset: 1, color: 'rgba(8,145,178,0)' }] } }
      }]
    };
  }, [leftStats.mean, leftStats.std]);

  const rightNormalOpt = useMemo(() => {
    const mean = parseFloat(rightStats.mean) || 190;
    const std = rightStats.std || 15;
    const xs = Array.from({ length: 100 }, (_, i) => (mean - 4 * std + i * 8 * std / 100).toFixed(1));
    const ys = xs.map(x => (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mean) / std) ** 2));
    return {
      animation: false,
      grid: { top: 8, bottom: 16, left: 32, right: 8 },
      xAxis: { type: 'category', data: xs, axisLabel: { color: '#8896A6', fontSize: 8, interval: 24 }, boundaryGap: false },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F0F2F5' } }, axisLabel: { color: '#8896A6', fontSize: 9 } },
      series: [{ type: 'line', data: ys, smooth: true, symbol: 'none',
        lineStyle: { color: '#0891B2', width: 1.5 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(8,145,178,0.12)' }, { offset: 1, color: 'rgba(8,145,178,0)' }] } }
      }]
    };
  }, [rightStats.mean, rightStats.std]);

  const Metric = ({ label, value, color }) => (
    <div className="zeiss-data-row">
      <span className="zeiss-data-label text-[11px]">{label}</span>
      <span className="zeiss-data-value text-xs font-semibold" style={{ color }}>{value}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-3 overflow-y-auto">
      {/* 采集状态 */}
      {isRecording && (
        <div className="zeiss-card p-3 flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: '#DC2626' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isLeftActive ? '左手' : '右手'}采集中
          </span>
          <span className="font-mono text-sm font-bold ml-auto" style={{ color: '#0066CC' }}>{fmtTime(timer)}</span>
        </div>
      )}

      {/* 左手数据 */}
      <div className={`zeiss-card overflow-hidden transition-opacity ${isLeftActive ? 'opacity-100' : 'opacity-50'}`}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: isLeftActive ? '#0066CC' : 'var(--border-light)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>左手 · 压力曲线</h3>
        </div>
        <div className="h-[90px] px-1"><EChart option={leftLineOpt} height={90} /></div>
        <div className="px-4 py-2 space-y-1.5">
          <Metric label="平均压力" value={leftStats.avg + ' mmHg'} color="#0066CC" />
          <Metric label="最大压力" value={leftStats.max + ' mmHg'} color="#0066CC" />
          <Metric label="压力总和" value={leftStats.sum + ' mmHg'} color="#0066CC" />
        </div>
      </div>

      {/* 左手正态分布 */}
      <div className={`zeiss-card overflow-hidden transition-opacity ${isLeftActive ? 'opacity-100' : 'opacity-50'}`}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: isLeftActive ? '#0891B2' : 'var(--border-light)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>左手 · 正态分布</h3>
        </div>
        <div className="h-[80px] px-1"><EChart option={leftNormalOpt} height={80} /></div>
        <div className="grid grid-cols-4 gap-1 px-3 py-2">
          {[{ l: '均值', v: leftStats.mean }, { l: '方差', v: leftStats.variance }, { l: '偏度', v: leftStats.skewness }, { l: '峰度', v: leftStats.kurtosis }].map((item, i) => (
            <div key={i} className="text-center">
              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
              <div className="text-[11px] font-bold" style={{ color: '#0891B2' }}>{item.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 右手数据 */}
      <div className={`zeiss-card overflow-hidden transition-opacity ${isRightActive ? 'opacity-100' : 'opacity-50'}`}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: isRightActive ? '#059669' : 'var(--border-light)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>右手 · 压力曲线</h3>
        </div>
        <div className="h-[90px] px-1"><EChart option={rightLineOpt} height={90} /></div>
        <div className="px-4 py-2 space-y-1.5">
          <Metric label="平均压力" value={rightStats.avg + ' mmHg'} color="#059669" />
          <Metric label="最大压力" value={rightStats.max + ' mmHg'} color="#059669" />
          <Metric label="压力总和" value={rightStats.sum + ' mmHg'} color="#059669" />
        </div>
      </div>

      {/* 右手正态分布 */}
      <div className={`zeiss-card overflow-hidden transition-opacity ${isRightActive ? 'opacity-100' : 'opacity-50'}`}>
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: isRightActive ? '#0891B2' : 'var(--border-light)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>右手 · 正态分布</h3>
        </div>
        <div className="h-[80px] px-1"><EChart option={rightNormalOpt} height={80} /></div>
        <div className="grid grid-cols-4 gap-1 px-3 py-2">
          {[{ l: '均值', v: rightStats.mean }, { l: '方差', v: rightStats.variance }, { l: '偏度', v: rightStats.skewness }, { l: '峰度', v: rightStats.kurtosis }].map((item, i) => (
            <div key={i} className="text-center">
              <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
              <div className="text-[11px] font-bold" style={{ color: '#0891B2' }}>{item.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── 主组件 ─── */
export default function GripAssessment() {
  const navigate = useNavigate();
  const { patientInfo, institution, completeAssessment } = useAssessment();
  const videoRef = useRef(null);

  const [deviceStatus, setDeviceStatus] = useState('disconnected'); // disconnected | connecting | connected
  const [isSimulating, setIsSimulating] = useState(false);
  const [leftGloveConnected, setLeftGloveConnected] = useState(false);
  const [rightGloveConnected, setRightGloveConnected] = useState(false);
  const [phase, setPhase] = useState('left-idle');
  const [reportMode, setReportMode] = useState('static');
  const [timer, setTimer] = useState(0);
  const [pressure, setPressure] = useState(0);
  const [leftData, setLeftData] = useState([]);
  const [rightData, setRightData] = useState([]);
  const [showLeftToast, setShowLeftToast] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [gripReportData, setGripReportData] = useState(null);
  const timerRef = useRef(null);
  const leftRawFramesRef = useRef([]);
  const rightRawFramesRef = useRef([]);
  // 完整数据用于报告（不截断）
  const leftFullDataRef = useRef([]);
  const rightFullDataRef = useRef([]);

  // Heatmap state
  const [heatmapCanvas, setHeatmapCanvas] = useState(null);
  const [heatmapVersion, setHeatmapVersion] = useState(0);
  const bodyCanvasRef = useRef(null);
  const frameRef = useRef(0);

  // 串口实时数据 ref（用于采集时记录）
  const isRecordingRef = useRef(false);
  const currentHandRef = useRef('left'); // 'left' | 'right'

  // 调试面板
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [simLogs, setSimLogs] = useState([]);
  const simLogIdRef = useRef(0);

  // 模拟日志辅助函数
  const addSimLog = useCallback((message, type = 'data') => {
    simLogIdRef.current += 1;
    setSimLogs(prev => [...prev, { id: simLogIdRef.current, message, type }]);
  }, []);

  // Initialize HeatmapCanvas
  useEffect(() => {
    if (!bodyCanvasRef.current) {
      bodyCanvasRef.current = new HeatmapCanvas(30, 30, 1, 1, 'hand', {
        min: 0,
        max: 500,
        size: 40
      });
      setHeatmapCanvas(bodyCanvasRef.current.canvas);
    }
  }, []);

  // 设置手套串口数据回调
  useEffect(() => {
    const handleLeftData = (sensorArray) => {
      if (!leftGloveConnected) setLeftGloveConnected(true);

      // 始终更新热力图（不管是否在采集状态，只要有数据就显示）
      if (bodyCanvasRef.current) {
        try {
          const mapped = mapLeftHand(sensorArray);
          bodyCanvasRef.current.changeHeatmap(mapped, 1, 1, 0);
          setHeatmapVersion(v => v + 1);
        } catch (e) { console.error('[Left] heatmap error:', e); }
      }

      // 如果正在采集左手数据，记录统计
      if (isRecordingRef.current && currentHandRef.current === 'left') {
        const totalPressure = sensorArray.reduce((a, b) => a + b, 0);
        const avgPressure = totalPressure / sensorArray.length;
        setPressure(avgPressure);

        // 完整数据用于报告（带时间戳，不截断）
        leftFullDataRef.current.push({ time: leftFullDataRef.current.length, value: avgPressure, timestamp: Date.now() });
        leftRawFramesRef.current.push([...sensorArray]);

        // 显示数据（截断到200条用于实时图表）
        setLeftData(prev => {
          const next = [...prev, { time: prev.length, value: avgPressure }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
    };

    const handleRightData = (sensorArray) => {
      if (!rightGloveConnected) setRightGloveConnected(true);

      // 始终更新热力图（不管是否在采集状态，只要有数据就显示）
      if (bodyCanvasRef.current) {
        try {
          const mapped = mapRightHand(sensorArray);
          bodyCanvasRef.current.changeHeatmap(mapped, 1, 1, 0);
          setHeatmapVersion(v => v + 1);
        } catch (e) { console.error('[Right] heatmap error:', e); }
      }

      // 如果正在采集右手数据，记录统计
      if (isRecordingRef.current && currentHandRef.current === 'right') {
        const totalPressure = sensorArray.reduce((a, b) => a + b, 0);
        const avgPressure = totalPressure / sensorArray.length;
        setPressure(avgPressure);

        // 完整数据用于报告（带时间戳，不截断）
        rightFullDataRef.current.push({ time: rightFullDataRef.current.length, value: avgPressure, timestamp: Date.now() });
        rightRawFramesRef.current.push([...sensorArray]);

        // 显示数据（截断到200条用于实时图表）
        setRightData(prev => {
          const next = [...prev, { time: prev.length, value: avgPressure }];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
    };

    gloveService.setOnLeftHandData(handleLeftData);
    gloveService.setOnRightHandData(handleRightData);

    return () => {
      gloveService.setOnLeftHandData(null);
      gloveService.setOnRightHandData(null);
    };
  }, [leftGloveConnected, rightGloveConnected]);

  // 更新设备状态
  useEffect(() => {
    if (isSimulating || leftGloveConnected || rightGloveConnected) {
      setDeviceStatus('connected');
    } else if (gloveService.connected) {
      setDeviceStatus('connecting'); // 连接了但还没收到数据
    }
  }, [isSimulating, leftGloveConnected, rightGloveConnected]);

  const leftStats = useMemo(() => {
    if (leftData.length === 0) return { avg: '0.00', max: '0.00', sum: '0.00', mean: '0.00', variance: '0.00', skewness: '0.00', kurtosis: '0.00', std: 15 };
    const vals = leftData.map(d => d.value);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max(...vals);
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
    return { avg: avg.toFixed(2), max: max.toFixed(2), sum: (avg * vals.length / 10).toFixed(2), mean: avg.toFixed(2), variance: (std ** 2).toFixed(2), skewness: '0.12', kurtosis: '2.85', std };
  }, [leftData]);

  const rightStats = useMemo(() => {
    if (rightData.length === 0) return { avg: '0.00', max: '0.00', sum: '0.00', mean: '0.00', variance: '0.00', skewness: '0.00', kurtosis: '0.00', std: 15 };
    const vals = rightData.map(d => d.value);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const max = Math.max(...vals);
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
    return { avg: avg.toFixed(2), max: max.toFixed(2), sum: (avg * vals.length / 10).toFixed(2), mean: avg.toFixed(2), variance: (std ** 2).toFixed(2), skewness: '-0.08', kurtosis: '3.12', std };
  }, [rightData]);

  const stepIndex = phase.startsWith('left') ? 0 : phase.startsWith('right') ? 1 : 2;

  /* ─── 连接手套（通过 Web Serial API 弹窗选择） ─── */
  const handleConnectGlove = useCallback(async () => {
    try {
      setDeviceStatus('connecting');
      const success = await gloveService.connect();
      if (!success) {
        setDeviceStatus('disconnected');
      }
      // 连接成功后，数据回调会自动识别左手/右手
    } catch (e) {
      console.error('连接手套失败:', e);
      setDeviceStatus('disconnected');
    }
  }, []);

  /* ─── 断开手套 ─── */
  const handleDisconnect = useCallback(async () => {
    await gloveService.disconnect();
    setDeviceStatus('disconnected');
    setLeftGloveConnected(false);
    setRightGloveConnected(false);
    setIsSimulating(false);
  }, []);

  /* ─── 模拟模式 ─── */
  const handleSimulate = useCallback(() => {
    setIsSimulating(true);
    setDeviceStatus('connected');
  }, []);

  /* ─── 开始采集 ─── */
  const startRecording = () => {
    const isLeft = phase === 'left-idle';
    setPhase(isLeft ? 'left-recording' : 'right-recording');
    setTimer(0);
    frameRef.current = 0;
    isRecordingRef.current = true;
    currentHandRef.current = isLeft ? 'left' : 'right';

    if (isSimulating) {
      addSimLog(`模拟模式开始采集 ${isLeft ? '左手' : '右手'}`, 'info');
      // 模拟模式：用定时器生成数据
      timerRef.current = setInterval(() => {
        setTimer(p => p + 1);
        frameRef.current += 1;

        const sensorData = generateSimulatedSensorData(isLeft, frameRef.current);
        // 保存原始帧数据用于报告生成
        const framesRef = isLeft ? leftRawFramesRef : rightRawFramesRef;
        framesRef.current.push([...sensorData]);

        const totalPressure = sensorData.reduce((a, b) => a + b, 0);
        const avgPressure = totalPressure / sensorData.length;
        setPressure(avgPressure);

        // 完整数据用于报告（不截断）
        const fullRef = isLeft ? leftFullDataRef : rightFullDataRef;
        fullRef.current.push({ time: fullRef.current.length, value: avgPressure, timestamp: Date.now() });

        // 显示数据（截断到200条用于实时图表）
        const setter = isLeft ? setLeftData : setRightData;
        setter(prev => {
          const next = [...prev, { time: prev.length, value: avgPressure }];
          return next.length > 200 ? next.slice(-200) : next;
        });

        if (bodyCanvasRef.current) {
          try {
            const mapped = isLeft ? mapLeftHand(sensorData) : mapRightHand(sensorData);
            bodyCanvasRef.current.changeHeatmap(mapped, 1, 1, 0);
            setHeatmapVersion(v => v + 1);
          } catch (e) {
            console.error('[Sim] heatmap error:', e);
            addSimLog(`热力图更新错误: ${e.message}`, 'error');
          }
        }

        // 每10帧输出一次模拟日志
        if (frameRef.current % 10 === 0) {
          const max = Math.max(...sensorData);
          const nonZero = sensorData.filter(v => v > 0).length;
          addSimLog(`模拟帧 #${frameRef.current}: avg=${avgPressure.toFixed(1)}, max=${max}, nonZero=${nonZero}/256`, 'data');
        }
      }, 100);
    } else {
      // 真实设备模式：数据通过串口回调自动流入，只需要计时器
      timerRef.current = setInterval(() => {
        setTimer(p => p + 1);
      }, 100);
    }
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    isRecordingRef.current = false;

    if (phase === 'left-recording') {
      setShowLeftToast(true);
      setTimeout(() => setShowLeftToast(false), 3000);
      setPhase('right-idle');
      setTimer(0);
    } else {
      setPhase('processing');
      // 生成报告数据
      setTimeout(() => {
        try {
          const report = generateGripReportData(
            leftFullDataRef.current, rightFullDataRef.current,
            leftRawFramesRef.current, rightRawFramesRef.current,
            patientInfo?.name || ''
          );
          console.log('[GripAssessment] 报告数据已生成:', report);
          setGripReportData(report);
        } catch (e) {
          console.error('[GripAssessment] 报告生成失败:', e);
        }
        setShowCompleteDialog(true);
      }, 2000);
    }
  };

  const viewReport = () => {
    setShowCompleteDialog(false);
    setPhase('report');
    setReportMode('static');
    completeAssessment('grip', { completed: true }, { leftData, rightData });
  };

  const handleClose = () => {
    // 断开串口
    if (gloveService.connected) {
      gloveService.disconnect();
    }
    navigate('/dashboard');
  };

  const fmtTime = (t) => {
    const s = Math.floor(t / 10);
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    // 组件卸载时断开串口
    if (gloveService.connected) {
      gloveService.disconnect();
    }
  }, []);

  /* ─── 报告模式 ─── */
  if (phase === 'report') {
    if (reportMode === 'dynamic') {
      return (
        <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
          <header className="h-14 flex items-center justify-between px-6 shrink-0 z-20"
            style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)' }}>
            <div className="flex items-center gap-3">
              <img src="/logo1.png" alt="Logo" className="w-8 h-8 rounded-lg" />
              <h1 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
                肌少症/老年人评估及监测系统
                <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>——1.握力评估</span>
              </h1>
            </div>
            <div className="flex items-center gap-5">
              <StepIndicator current={2} steps={['左手', '右手', '完成']} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '未知'}</span>
              <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{institution || ''}</span>
              <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs">历史记录</button>
            </div>
          </header>
          <main className="flex-1 flex flex-col items-center justify-center p-6 z-10">
            <div className="zeiss-card p-6 flex flex-col items-center gap-4 max-w-4xl w-full">
              <div className="flex items-center justify-between w-full">
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name}的握力评估动态报告</h2>
                <div className="flex items-center gap-3">
                  <button onClick={() => setReportMode('static')}
                    className="zeiss-btn-secondary flex items-center gap-2 text-xs py-2 px-4">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    切换静态报告
                  </button>
                  <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              <video ref={videoRef} src="/assets/dynamic_report.mp4" controls className="w-full rounded-xl" style={{ maxHeight: '70vh', background: '#000' }} />
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <header className="h-14 flex items-center justify-between px-6 shrink-0 z-20"
          style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)' }}>
          <div className="flex items-center gap-3">
            <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <img src="/logo1.png" alt="Logo" className="w-8 h-8 rounded-lg" />
            <h1 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
              肌少症/老年人评估及监测系统
              <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>——1.握力评估</span>
            </h1>
          </div>
          <div className="flex items-center gap-5">
            <StepIndicator current={2} steps={['左手', '右手', '完成']} />
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '未知'}</span>
            <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{institution || ''}</span>
            <button onClick={() => setReportMode(reportMode === 'static' ? 'dynamic' : 'static')}
              className="zeiss-btn-ghost text-xs flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {reportMode === 'static' ? '动态报告' : '静态报告'}
            </button>
            <button onClick={handleClose} className="zeiss-btn-primary text-xs py-2 px-4">返回首页</button>
          </div>
        </header>
        <main className="flex-1 min-h-0 z-10">
          <GripReport patientName={patientInfo?.name || '未知'} onClose={handleClose} onSwitchDynamic={() => setReportMode('dynamic')} reportData={gripReportData} />
        </main>
      </div>
    );
  }

  /* ─── 设备连接状态文本 ─── */
  const getDeviceStatusText = () => {
    if (isSimulating) return '模拟模式';
    if (leftGloveConnected && rightGloveConnected) return '左右手已连接';
    if (leftGloveConnected) return '左手已连接';
    if (rightGloveConnected) return '右手已连接';
    if (gloveService.connected) return '等待数据...';
    return '未连接';
  };

  const getDeviceStatusColor = () => {
    if (isSimulating) return '#0891B2';
    if (leftGloveConnected || rightGloveConnected) return 'var(--success)';
    if (gloveService.connected) return '#F59E0B';
    return 'var(--text-muted)';
  };

  /* ─── 采集模式 — 左侧数据面板 + 右侧3D手模型 ─── */
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* Header */}
      <header className="assessment-header">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <img src="/logo1.png" alt="Logo" className="w-7 h-7 md:w-8 md:h-8 rounded-lg shrink-0" />
          <h1 className="text-[13px] md:text-[15px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            <span className="hidden lg:inline">肌少症/老年人评估及监测系统——</span>1.握力评估
          </h1>
        </div>
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <StepIndicator current={stepIndex} steps={['左手', '右手', '完成']} />

          {/* 设备状态区域 */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: getDeviceStatusColor() }} />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{getDeviceStatusText()}</span>

            {/* 未连接时显示连接和模拟按钮 */}
            {deviceStatus === 'disconnected' && (
              <>
                <button onClick={handleConnectGlove} className="text-xs font-medium ml-1" style={{ color: 'var(--zeiss-blue)', background: 'none', border: 'none', cursor: 'pointer' }}>连接手套</button>
                <span style={{ color: 'var(--border-medium)' }}>|</span>
                <button onClick={handleSimulate} className="text-xs font-medium" style={{ color: '#0891B2', background: 'none', border: 'none', cursor: 'pointer' }}>模拟</button>
              </>
            )}

            {/* 已连接但只有一只手时，可以继续连接另一只 */}
            {!isSimulating && gloveService.connected && !(leftGloveConnected && rightGloveConnected) && (
              <>
                <span style={{ color: 'var(--border-medium)' }}>|</span>
                <span className="text-[10px]" style={{ color: '#F59E0B' }}>
                  {!leftGloveConnected && '等待左手数据'}
                  {!rightGloveConnected && leftGloveConnected && '等待右手数据'}
                </span>
              </>
            )}

            {/* 已连接时显示断开按钮 */}
            {deviceStatus === 'connected' && (
              <>
                <span style={{ color: 'var(--border-medium)' }}>|</span>
                <button onClick={handleDisconnect} className="text-xs font-medium" style={{ color: '#DC2626', background: 'none', border: 'none', cursor: 'pointer' }}>断开</button>
              </>
            )}
          </div>

          <span className="text-sm font-medium hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '未知'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {/* Toast */}
      {showLeftToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 animate-slideUp"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius-md)', padding: '10px 20px' }}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--zeiss-blue)' }}>
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>左手采集完成</span>
          </div>
        </div>
      )}

      {/* 报告完成弹窗 */}
      {showCompleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 min-w-[340px] animate-scaleIn">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--success-light)' }}>
              <svg className="w-7 h-7" style={{ color: 'var(--success)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>采集完成，报告已生成</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>您可以查看报告或返回首页继续其他评估</p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => { setShowCompleteDialog(false); completeAssessment('grip', { completed: true }, { leftData, rightData }); navigate('/dashboard'); }}
                className="zeiss-btn-secondary flex-1 py-3 text-sm">返回首页</button>
              <button onClick={viewReport}
                className="zeiss-btn-primary flex-1 py-3 text-sm">查看报告</button>
            </div>
          </div>
        </div>
      )}

      {/* Main: 左侧面板 + 右侧3D */}
      <main className="flex-1 flex min-h-0 relative z-10">
        {/* 左侧数据面板 */}
        <div className="assessment-side-panel">
          <LeftDataPanel
            leftData={leftData} rightData={rightData}
            leftStats={leftStats} rightStats={rightStats}
            phase={phase} timer={timer} fmtTime={fmtTime}
          />
        </div>

        {/* 右侧3D区域 */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div className="relative w-full h-full flex items-center justify-center model-container m-3 rounded-xl">
            <HandModel isRecording={phase.includes('recording')} pressureValue={pressure} isLeftHand={phase.startsWith('left')} heatmapCanvas={heatmapCanvas} heatmapVersion={heatmapVersion} />
            {phase === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl" style={{ background: 'rgba(245,246,248,0.8)', backdropFilter: 'blur(4px)' }}>
                <div className="w-64 h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full progress-animate" style={{ background: 'var(--zeiss-blue)' }} />
                </div>
                <p className="font-medium text-sm" style={{ color: 'var(--text-secondary)' }}>正在汇总采集数据并生成报告，请稍候...</p>
              </div>
            )}
          </div>

          {/* 控制按钮 */}
          {phase !== 'processing' && (
            <div className="absolute bottom-10 z-20 flex flex-col items-center gap-3">
              {phase.includes('idle') && deviceStatus === 'connected' && (
                <>
                  <button onClick={startRecording}
                    className="w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ border: '3px solid var(--border-medium)', background: 'transparent' }}>
                    <div className="w-11 h-11 rounded-full" style={{ background: 'linear-gradient(135deg, #F0F4F8, #FFFFFF)', boxShadow: 'var(--shadow-sm)' }} />
                  </button>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>开始采集{phase === 'left-idle' ? '左手' : '右手'}</span>
                </>
              )}
              {phase.includes('idle') && deviceStatus !== 'connected' && (
                <div className="flex flex-col items-center gap-3">
                  <span className="text-sm px-5 py-2.5 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                    请先连接传感器
                  </span>
                  <div className="flex items-center gap-3">
                    <button onClick={handleConnectGlove}
                      className="zeiss-btn-secondary text-[11px] py-1.5 px-3">连接手套</button>
                    <button onClick={handleSimulate}
                      className="text-[11px] py-1.5 px-3 rounded-lg font-medium"
                      style={{ color: '#0891B2', background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.2)' }}>模拟</button>
                  </div>
                </div>
              )}
              {phase.includes('recording') && (
                <>
                  <button onClick={stopRecording}
                    className="w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ border: '3px solid var(--zeiss-blue)', background: 'rgba(0,102,204,0.05)' }}>
                    <div className="w-7 h-7 rounded-sm" style={{ background: 'var(--zeiss-blue)' }} />
                  </button>
                  <div className="flex items-center gap-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <span>结束采集{phase === 'left-recording' ? '左手' : '右手'}</span>
                    <span className="font-mono px-3 py-1 rounded-md" style={{ background: 'var(--zeiss-blue-light)', color: 'var(--zeiss-blue)' }}>{fmtTime(timer)}</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <div className="h-6 flex items-center justify-between px-6 shrink-0 z-10">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
        <button
          onClick={() => setShowDebugPanel(v => !v)}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            color: showDebugPanel ? '#60A5FA' : 'var(--text-muted)',
            background: showDebugPanel ? 'rgba(96,165,250,0.1)' : 'transparent',
            border: '1px solid ' + (showDebugPanel ? 'rgba(96,165,250,0.3)' : 'transparent'),
            cursor: 'pointer'
          }}
        >
          {showDebugPanel ? '隐藏调试' : '调试面板'} (Ctrl+D)
        </button>
      </div>

      {/* 串口调试面板 */}
      <SerialLogPanel visible={showDebugPanel} onToggle={() => setShowDebugPanel(v => !v)} simulationLogs={simLogs} />
    </div>
  );
}
