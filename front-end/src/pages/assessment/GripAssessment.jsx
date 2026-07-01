import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import HandModel from '../../components/three/HandModel';
import GripReport from '../../components/report/GripReport';
import EChart from '../../components/ui/EChart';
import { HeatmapCanvas } from '../../lib/heatmap';
import { mapLeftHand, mapRightHand, generateSimulatedSensorData } from '../../lib/gripDataMapping';
import { gloveService } from '../../lib/GloveSerialService';
import { backendBridge } from '../../lib/BackendBridge';
import SerialLogPanel from '../../components/debug/SerialLogPanel';
import { generateGripReportData } from '../../lib/gripReportGenerator';
import { getNextAssessmentType, ASSESSMENT_PATH, ASSESSMENT_LABEL, isAllAssessmentsCompleted } from '../../lib/assessmentNav';
import { getDeviceRegion } from '../../lib/deviceRegion';

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
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </div>
              <span className="text-[9px] font-medium" style={{ color: done || active ? 'var(--zeiss-blue)' : 'var(--text-muted)' }}>{label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── 左侧统一数据面板（根据当前手只显示对应数据） ─── */
function LeftDataPanel({ leftData, rightData, leftStats, rightStats, phase, timer, fmtTime }) {
  const isLeftPhase = phase.startsWith('left');
  const isRightPhase = phase.startsWith('right');
  const isRecording = phase.includes('recording');

  // 根据当前 phase 决定显示哪只手的数据
  const showLeft = isLeftPhase;
  const showRight = isRightPhase || phase === 'processing';

  // 当前显示的数据和统计
  const activeData = showLeft ? leftData : rightData;
  const activeStats = showLeft ? leftStats : rightStats;
  const handLabel = showLeft ? '左手' : '右手';
  const lineColor = showLeft ? '#0066CC' : '#059669';
  const lineColorRgba = showLeft ? 'rgba(0,102,204' : 'rgba(5,150,105';

  const lineOpt = useMemo(() => ({
    animation: false,
    grid: { top: 8, bottom: 20, left: 36, right: 8 },
    xAxis: { type: 'category', data: activeData.map((_, i) => i), show: false, boundaryGap: false },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F0F2F5' } }, axisLabel: { color: '#8896A6', fontSize: 9 } },
    series: [{ type: 'line', data: activeData.map(d => d.value), smooth: true, symbol: 'none',
      lineStyle: { color: lineColor, width: 1.5 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${lineColorRgba},0.15)` }, { offset: 1, color: `${lineColorRgba},0)` }] } }
    }]
  }), [activeData, lineColor, lineColorRgba]);

  const normalOpt = useMemo(() => {
    const mean = parseFloat(activeStats.mean) || 190;
    const std = activeStats.std || 15;
    const xs = Array.from({ length: 100 }, (_, i) => (mean - 4 * std + i * 8 * std / 100).toFixed(1));
    const ys = xs.map(x => (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mean) / std) ** 2));
    return {
      animation: false,
      grid: { top: 8, bottom: 20, left: 36, right: 8 },
      xAxis: { type: 'category', data: xs, axisLabel: { color: '#8896A6', fontSize: 8, interval: 24 }, boundaryGap: false },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#F0F2F5' } }, axisLabel: { color: '#8896A6', fontSize: 9 } },
      series: [{ type: 'line', data: ys, smooth: true, symbol: 'none',
        lineStyle: { color: '#0891B2', width: 1.5 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(8,145,178,0.12)' }, { offset: 1, color: 'rgba(8,145,178,0)' }] } }
      }]
    };
  }, [activeStats.mean, activeStats.std]);

  const Metric = ({ label, value, color }) => (
    <div className="zeiss-data-row">
      <span className="zeiss-data-label text-[11px]">{label}</span>
      <span className="zeiss-data-value text-xs font-semibold" style={{ color }}>{value}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-3 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
      {/* 采集状态 */}
      {isRecording && (
        <div className="zeiss-card p-3 flex items-center gap-3 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: '#DC2626' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {handLabel}采集中
          </span>
          <span className="font-mono text-sm font-bold ml-auto" style={{ color: '#0066CC' }}>{fmtTime(timer)}</span>
        </div>
      )}

      {/* 当前手 - 压力曲线 */}
      <div className="zeiss-card overflow-hidden shrink-0">
        <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: lineColor }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>{handLabel} · 压力曲线</h3>
        </div>
        <div className="h-[100px] px-1"><EChart option={lineOpt} height={100} /></div>
        <div className="px-4 py-2 space-y-1">
          <Metric label="平均压力" value={activeStats.avg + ' mmHg'} color={lineColor} />
          <Metric label="最大压力" value={activeStats.max + ' mmHg'} color={lineColor} />
          <Metric label="压力总和" value={activeStats.sum + ' mmHg'} color={lineColor} />
        </div>
      </div>

      {/* 当前手 - 正态分布 */}
      <div className="zeiss-card overflow-hidden shrink-0">
        <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: '#0891B2' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>{handLabel} · 正态分布</h3>
        </div>
        <div className="h-[100px] px-1"><EChart option={normalOpt} height={100} /></div>
        <div className="px-4 py-2 space-y-1">
          <Metric label="均值" value={activeStats.mean} color="#0891B2" />
          <Metric label="方差" value={activeStats.variance} color="#0891B2" />
          <Metric label="偏度" value={activeStats.skewness} color="#0891B2" />
          <Metric label="峰度" value={activeStats.kurtosis} color="#0891B2" />
        </div>
      </div>
    </div>
  );
}

/* ─── 主组件 ─── */
export default function GripAssessment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, institution, completeAssessment, deviceConnStatus, backendBridge: globalBridge, assessments } = useAssessment();
  // 从 Dashboard "查看报告" 跳转过来时，直接显示报告
  const viewReportMode = location.state?.viewReport && assessments.grip?.completed;
  // 如果首页已一键连接，自动进入后端模式
  const isGlobalConnected = deviceConnStatus === 'connected';
  const [deviceStatus, setDeviceStatus] = useState(isGlobalConnected ? 'connected' : 'disconnected');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isBackendMode, setIsBackendMode] = useState(isGlobalConnected);
  const backendCleanupRef = useRef(null);
  const [leftGloveConnected, setLeftGloveConnected] = useState(false);
  const [rightGloveConnected, setRightGloveConnected] = useState(false);
  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'left-idle');
  const [timer, setTimer] = useState(0);
  const [pressure, setPressure] = useState(0);
  const [leftData, setLeftData] = useState([]);
  const [rightData, setRightData] = useState([]);
  const [showLeftToast, setShowLeftToast] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [gripReportData, setGripReportData] = useState(
    viewReportMode ? (assessments.grip?.report?.reportData || null) : null
  );
  const [csvExporting, setCsvExporting] = useState(false);
  const [showGripInstruction, setShowGripInstruction] = useState(!viewReportMode);
  const [instructionHand, setInstructionHand] = useState(viewReportMode ? null : 'left');
  const isPageMountedRef = useRef(true);
  const timerRef = useRef(null);
  const leftRawFramesRef = useRef([]);
  const rightRawFramesRef = useRef([]);
  // 完整数据用于报告（不截断）
  const leftFullDataRef = useRef([]);
  const rightFullDataRef = useRef([]);

  // Heatmap state
  const [heatmapCanvas, setHeatmapCanvas] = useState(null);
  const bodyCanvasRef = useRef(null);
  const frameRef = useRef(0);

  // 串口实时数据 ref（用于采集时记录）
  const isRecordingRef = useRef(false);
  const currentHandRef = useRef('left'); // 'left' | 'right'
  const leftAssessmentIdRef = useRef(null);
  const rightAssessmentIdRef = useRef(null);

  // ─── 戴错手检测（防呆） ───
  // 提示测右手时用户却在握左手手套（或反之），实时提示切换
  const [wrongHandWarning, setWrongHandWarning] = useState(null);
  const wrongHandWarningRef = useRef(null);
  const lastLeftAvgRef = useRef(0);   // 左手手套最近平均压力
  const lastRightAvgRef = useRef(0);  // 右手手套最近平均压力
  const wrongHandFramesRef = useRef(0);   // 错误手连续用力帧计数
  const correctHandFramesRef = useRef(0); // 正确手连续用力帧计数（用于自动消除警告）
  const WRONG_HAND_ACTIVE_AVG = 8;    // 平均 ADC 超过此值视为"正在用力握"
  const WRONG_HAND_IDLE_AVG = 3;      // 平均 ADC 低于此值视为"基本没用力"
  const WRONG_HAND_TRIGGER_FRAMES = 10; // 连续帧数（约 0.1-0.2s）才触发，防误报

  // 采集窗口内峰值，用于采集结束时硬校验"是否用错了手"
  const recExpectedPeakRef = useRef(0); // 本次采集中"应测手"的峰值平均压力
  const recOtherPeakRef = useRef(0);    // 本次采集中"另一只手"的峰值平均压力
  const REAL_GRIP_MIN = 4;              // 应测手峰值低于此值 → 视为没握 / 用错了手
  // 戴错手拦截弹窗：{ hand: 'left'|'right' }
  const [wrongHandModal, setWrongHandModal] = useState(null);
  const expectedHandRef = useRef('left'); // 当前阶段应测的手（left/right），用于判断是否切手

  const checkWrongHand = useCallback((sourceHand, avgPressure) => {
    const expected = currentHandRef.current; // 当前阶段应该测的手

    // 采集中：记录应测手 / 另一只手 的峰值，供采集结束硬校验
    if (isRecordingRef.current) {
      if (sourceHand === expected) {
        if (avgPressure > recExpectedPeakRef.current) recExpectedPeakRef.current = avgPressure;
      } else if (avgPressure > recOtherPeakRef.current) {
        recOtherPeakRef.current = avgPressure;
      }
    }

    if (sourceHand === 'left') lastLeftAvgRef.current = avgPressure;
    else lastRightAvgRef.current = avgPressure;

    const expectedAvg = expected === 'left' ? lastLeftAvgRef.current : lastRightAvgRef.current;
    const wrongAvg = expected === 'left' ? lastRightAvgRef.current : lastLeftAvgRef.current;

    // 错误手在持续用力 且 正确手基本没动 → 累计触发帧
    if (wrongAvg > WRONG_HAND_ACTIVE_AVG && expectedAvg < WRONG_HAND_IDLE_AVG) {
      wrongHandFramesRef.current += 1;
      correctHandFramesRef.current = 0;
      if (wrongHandFramesRef.current >= WRONG_HAND_TRIGGER_FRAMES && !wrongHandWarningRef.current) {
        const expectedLabel = expected === 'left' ? '左手' : '右手';
        const actualLabel = expected === 'left' ? '右手' : '左手';
        const msg = `检测到您正在使用${actualLabel}手套，当前应测【${expectedLabel}】，请切换到${expectedLabel}手套`;
        wrongHandWarningRef.current = msg;
        setWrongHandWarning(msg);
      }
    } else if (expectedAvg > WRONG_HAND_ACTIVE_AVG) {
      // 正确手开始用力 → 累计正确帧，连续达标后清除警告
      correctHandFramesRef.current += 1;
      wrongHandFramesRef.current = 0;
      if (correctHandFramesRef.current >= WRONG_HAND_TRIGGER_FRAMES && wrongHandWarningRef.current) {
        wrongHandWarningRef.current = null;
        setWrongHandWarning(null);
      }
    } else {
      // 双手都没明显用力 → 缓慢衰减计数，不立刻清警告（让用户看到提示）
      wrongHandFramesRef.current = Math.max(0, wrongHandFramesRef.current - 1);
    }
  }, []);

  // 仅在"应测手切换"（左→右 或 回到另一只手）时重置戴错手状态，
  // idle→recording 同一只手时不清除警告，让提示贯穿采集全程。
  useEffect(() => {
    const expected = phase.startsWith('left') ? 'left' : phase.startsWith('right') ? 'right' : expectedHandRef.current;
    if (expected !== expectedHandRef.current) {
      expectedHandRef.current = expected;
      wrongHandFramesRef.current = 0;
      correctHandFramesRef.current = 0;
      wrongHandWarningRef.current = null;
      setWrongHandWarning(null);
    }
  }, [phase]);

  // 让 currentHandRef 跟随 phase 自动同步，确保热力图始终显示当前阶段对应的手的数据
  useEffect(() => {
    if (phase.startsWith('left')) {
      currentHandRef.current = 'left';
    } else if (phase.startsWith('right')) {
      currentHandRef.current = 'right';
    }
  }, [phase]);

  // 调试面板
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [simLogs, setSimLogs] = useState([]);
  const simLogIdRef = useRef(0);

  useEffect(() => {
    isPageMountedRef.current = true;
    return () => {
      isPageMountedRef.current = false;
    };
  }, []);

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
      setHeatmapCanvas(bodyCanvasRef.current);
    }
  }, []);

  // 全局一键连接后，自动设置后端数据监听
  useEffect(() => {
    if (!isGlobalConnected || backendCleanupRef.current) return;

    // 设置手套模式，后端只推送 HL/HR 数据
    backendBridge.setActiveMode(1, { deviceRegion: getDeviceRegion() }).then(() => {
      console.log('[GripAssessment] 已设置为手套模式 (mode=1)');
      addSimLog('已设置为手套模式 (mode=1)', 'info');
      // 设置模式后延迟 500ms 执行清零，确保已收到稳定的基线数据
      // 如果某只手清零失败（HR 的 Packet1 经常丢失），自动重试最多 3 次
      const doTareWithRetry = async (attempt = 1, maxAttempts = 3) => {
        try {
          const r = await backendBridge.tareGrip();
          console.log('[GripAssessment] 握力清零完成 (attempt=%d):', attempt, r);
          const data = r?.data || r;
          if (data && data.HL && data.HR) {
            addSimLog('左右手传感器已清零', 'info');
          } else if (attempt < maxAttempts) {
            const failedHands = [];
            if (!data?.HL) failedHands.push('左手');
            if (!data?.HR) failedHands.push('右手');
            addSimLog(`${failedHands.join('、')}清零失败，1秒后重试 (${attempt}/${maxAttempts})`, 'warn');
            console.warn('[GripAssessment] 清零不完整, HL=%s HR=%s, 重试...', data?.HL, data?.HR);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return doTareWithRetry(attempt + 1, maxAttempts);
          } else {
            addSimLog('清零重试已达上限，部分传感器可能未清零', 'warn');
          }
        } catch (e) {
          console.error('[GripAssessment] tareGrip failed (attempt=%d):', attempt, e);
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return doTareWithRetry(attempt + 1, maxAttempts);
          }
        }
      };
      setTimeout(() => { doTareWithRetry(); }, 500);
    }).catch(e => console.error('[GripAssessment] setActiveMode failed:', e));

    setIsBackendMode(true);
    setDeviceStatus('connected');

    // 监听后端数据
    const unsubLeft = backendBridge.on('leftHandData', (arr) => {
      if (gloveService.onLeftHandData) {
        gloveService.onLeftHandData(arr);
      }
    });
    const unsubRight = backendBridge.on('rightHandData', (arr) => {
      if (gloveService.onRightHandData) {
        gloveService.onRightHandData(arr);
      }
    });

    backendCleanupRef.current = () => {
      unsubLeft();
      unsubRight();
    };

    addSimLog('已自动连接后端数据通道', 'info');

    return () => {
      if (backendCleanupRef.current) {
        backendCleanupRef.current();
        backendCleanupRef.current = null;
      }
      // 退出握力评估时清除基线，避免影响其他模式
      backendBridge.clearGripBaseline().catch(() => {});
    };
  }, [isGlobalConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // 设置手套串口数据回调
  useEffect(() => {
    const handleLeftData = (sensorArray) => {
      if (!leftGloveConnected) setLeftGloveConnected(true);

      // 只有当前阶段是左手时才更新热力图（避免右手数据覆盖）
      if (bodyCanvasRef.current && currentHandRef.current === 'left') {
        try {
          const mapped = mapLeftHand(sensorArray);
          bodyCanvasRef.current.changeHeatmap(mapped, 1, 1, 0);
        } catch (e) { console.error('[Left] heatmap error:', e); }
      }

      // 计算压力值
      const totalPressure = sensorArray.reduce((a, b) => a + b, 0);
      const avgPressure = totalPressure / sensorArray.length;

      // 戴错手检测（防呆）
      checkWrongHand('left', avgPressure);

      // 始终更新左侧面板的实时预览数据（无论是否在采集）
      if (currentHandRef.current === 'left') {
        setPressure(avgPressure);
      }
      setLeftData(prev => {
        const next = [...prev, { time: prev.length, value: avgPressure }];
        return next.length > 200 ? next.slice(-200) : next;
      });

      // 如果正在采集左手数据，额外记录完整数据用于报告
      if (isRecordingRef.current && currentHandRef.current === 'left') {
        leftFullDataRef.current.push({ time: leftFullDataRef.current.length, value: avgPressure, timestamp: Date.now() });
        leftRawFramesRef.current.push([...sensorArray]);
      }
    };

    const handleRightData = (sensorArray) => {
      if (!rightGloveConnected) setRightGloveConnected(true);

      // 只有当前阶段是右手时才更新热力图（避免左手数据覆盖）
      if (bodyCanvasRef.current && currentHandRef.current === 'right') {
        try {
          const mapped = mapRightHand(sensorArray);
          bodyCanvasRef.current.changeHeatmap(mapped, 1, 1, 0);
        } catch (e) { console.error('[Right] heatmap error:', e); }
      }

      // 计算压力值
      const totalPressure = sensorArray.reduce((a, b) => a + b, 0);
      const avgPressure = totalPressure / sensorArray.length;

      // 戴错手检测（防呆）
      checkWrongHand('right', avgPressure);

      // 始终更新左侧面板的实时预览数据（无论是否在采集）
      if (currentHandRef.current === 'right') {
        setPressure(avgPressure);
      }
      setRightData(prev => {
        const next = [...prev, { time: prev.length, value: avgPressure }];
        return next.length > 200 ? next.slice(-200) : next;
      });

      // 如果正在采集右手数据，额外记录完整数据用于报告
      if (isRecordingRef.current && currentHandRef.current === 'right') {
        rightFullDataRef.current.push({ time: rightFullDataRef.current.length, value: avgPressure, timestamp: Date.now() });
        rightRawFramesRef.current.push([...sensorArray]);
      }
    };

    gloveService.setOnLeftHandData(handleLeftData);
    gloveService.setOnRightHandData(handleRightData);

    return () => {
      gloveService.setOnLeftHandData(null);
      gloveService.setOnRightHandData(null);
    };
  }, [leftGloveConnected, rightGloveConnected, checkWrongHand]);

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
    // 断开后端模式（只取消事件监听，不断开全局 WebSocket）
    if (isBackendMode) {
      if (backendCleanupRef.current) {
        backendCleanupRef.current();
        backendCleanupRef.current = null;
      }
      // 不再调用 backendBridge.disconnect()，保持全局 ws 连接
      setIsBackendMode(false);
    }
    await gloveService.disconnect();
    setDeviceStatus('disconnected');
    setLeftGloveConnected(false);
    setRightGloveConnected(false);
    setIsSimulating(false);
  }, [isBackendMode]);

  /* ─── 模拟模式 ─── */
  const handleSimulate = useCallback(() => {
    setIsSimulating(true);
    setDeviceStatus('connected');
  }, []);

  /* ─── 后端模式：通过 WebSocket 连接后端 serialServer ─── */
  const handleBackendConnect = useCallback(async () => {
    try {
      setDeviceStatus('connecting');
      addSimLog('正在连接后端服务...', 'info');

      // 先调用后端API连接串口设备
      const connResult = await backendBridge.connPort();
      addSimLog(`后端连接结果: ${JSON.stringify(connResult)}`, 'info');

      // 设置手套模式 (mode=1)
      await backendBridge.setActiveMode(1, { deviceRegion: getDeviceRegion() });
      addSimLog('已设置为手套模式 (mode=1)', 'info');

      // 连接WebSocket
      backendBridge.connect();

      // 监听数据
      const unsubLeft = backendBridge.on('leftHandData', (arr) => {
        if (gloveService.onLeftHandData) {
          gloveService.onLeftHandData(arr);
        }
      });
      const unsubRight = backendBridge.on('rightHandData', (arr) => {
        if (gloveService.onRightHandData) {
          gloveService.onRightHandData(arr);
        }
      });
      const unsubConnect = backendBridge.on('connect', () => {
        addSimLog('WebSocket 已连接', 'info');
        setDeviceStatus('connected');
      });
      const unsubDisconnect = backendBridge.on('disconnect', () => {
        addSimLog('WebSocket 已断开', 'error');
      });

      // 保存清理函数
      backendCleanupRef.current = () => {
        unsubLeft();
        unsubRight();
        unsubConnect();
        unsubDisconnect();
      };

      setIsBackendMode(true);
      setDeviceStatus('connected');
      addSimLog('后端模式已启动，等待数据...', 'info');
    } catch (e) {
      console.error('后端连接失败:', e);
      addSimLog(`后端连接失败: ${e.message}`, 'error');
      setDeviceStatus('disconnected');
    }
  }, [addSimLog]);

  /* ─── 开始采集 ─── */
  const startRecording = async () => {
    const isLeft = phase === 'left-idle';
    setPhase(isLeft ? 'left-recording' : 'right-recording');
    setTimer(0);
    frameRef.current = 0;
    isRecordingRef.current = true;
    currentHandRef.current = isLeft ? 'left' : 'right';
    // 重置本次采集的戴错手硬校验峰值
    recExpectedPeakRef.current = 0;
    recOtherPeakRef.current = 0;

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
        // 模拟模式只生成应测手，更新峰值避免采集结束硬校验误判
        if (avgPressure > recExpectedPeakRef.current) recExpectedPeakRef.current = avgPressure;

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
    } else if (isBackendMode) {
      // 后端模式：调用后端API开始采集，数据通过WebSocket自动流入
      addSimLog(`后端模式开始采集 ${isLeft ? '左手' : '右手'}`, 'info');
      // 清空报告用的完整数据（显示数据保持实时更新，不清空）
      if (isLeft) {
        leftFullDataRef.current = [];
        leftRawFramesRef.current = [];
      } else {
        rightFullDataRef.current = [];
        rightRawFramesRef.current = [];
      }
      // 先切换到单手模式，等待完成后再开始采集
      const handMode = isLeft ? 11 : 12;
      const deviceRegion = getDeviceRegion();
      try {
        await backendBridge.setActiveMode(handMode, { deviceRegion });
        addSimLog(`已切换到${isLeft ? '左手' : '右手'}模式 (mode=${handMode})`, 'info');
      } catch (e) {
        addSimLog(`切换模式失败: ${e.message}`, 'error');
      }
      const aid = `grip_${isLeft ? 'L' : 'R'}_${Date.now()}`;
      if (isLeft) {
        leftAssessmentIdRef.current = aid;
      } else {
        rightAssessmentIdRef.current = aid;
      }
      try {
        await backendBridge.startCol({
          name: patientInfo?.name || 'test',
          assessmentId: aid,
          sampleType: '1',
          date: new Date().toISOString(),
          deviceRegion,
          colName: isLeft ? '左手握力' : '右手握力',
        });
        addSimLog(`后端采集已启动 (assessmentId=${aid})`, 'info');
      } catch (e) {
        addSimLog(`后端采集启动失败: ${e.message}`, 'error');
      }
      timerRef.current = setInterval(() => {
        setTimer(p => p + 1);
      }, 100);
    } else {
      // 真实设备模式：数据通过串口回调自动流入，只需要计时器
      timerRef.current = setInterval(() => {
        setTimer(p => p + 1);
      }, 100);
    }
  };

  const stopRecording = async () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    isRecordingRef.current = false;

    // 后端模式：先结束采集，再恢复双手模式
    if (isBackendMode) {
      try {
        await backendBridge.endCol();
        addSimLog('后端采集已结束', 'info');
      } catch (e) {
        addSimLog(`后端采集结束失败: ${e.message}`, 'error');
      }
      // 采集结束后恢复到双手模式，以便检测另一只手的连接状态
      try {
        await backendBridge.setActiveMode(1, { deviceRegion: getDeviceRegion() });
        addSimLog('已恢复双手模式 (mode=1)', 'info');
      } catch (e) {
        console.error('[GripAssessment] 恢复双手模式失败:', e);
      }
    }

    // ─── 采集结束硬校验：是否用错了手（有一只错握都不出报告） ───
    const expectedHand = currentHandRef.current; // 本次应测的手
    const expectedPeak = recExpectedPeakRef.current;
    const otherPeak = recOtherPeakRef.current;
    // ①另一只手有明显抓握且不弱于应测手 → 明确用错手（串口模式双手都推时最可靠）
    const otherHandGripped = otherPeak >= WRONG_HAND_ACTIVE_AVG && otherPeak >= expectedPeak * 0.8;
    // ②应测手全程几乎没握 → 没用正确的手（覆盖后端单手模式下另一只手数据不推送的情况）
    const expectedNeverGripped = expectedPeak < REAL_GRIP_MIN;
    if (!isSimulating && (otherHandGripped || expectedNeverGripped)) {
      addSimLog(`戴错手拦截：应测${expectedHand === 'left' ? '左' : '右'}手，应测手峰值=${expectedPeak.toFixed(1)}，另一只手峰值=${otherPeak.toFixed(1)}`, 'warn');
      // 清空本次采集数据，回到本手 idle 让用户重测，不进入下一阶段/不出报告
      if (expectedHand === 'left') {
        leftFullDataRef.current = [];
        leftRawFramesRef.current = [];
        setLeftData([]);
      } else {
        rightFullDataRef.current = [];
        rightRawFramesRef.current = [];
        setRightData([]);
      }
      setPhase(expectedHand === 'left' ? 'left-idle' : 'right-idle');
      setTimer(0);
      setWrongHandModal({ hand: expectedHand, reason: otherHandGripped ? 'wrong' : 'nogrip' });
      return;
    }

    if (phase === 'left-recording') {
      setShowLeftToast(true);
      setTimeout(() => setShowLeftToast(false), 3000);
      setPhase('right-idle');
      setInstructionHand('right');
      setShowGripInstruction(true);
      setTimer(0);
    } else {
      // 右手采集结束：立即弹完成窗，操作员可直接点「下一项」；报告在后台生成并写入历史
      setShowCompleteDialog(true);
      const gripAssessmentId = [leftAssessmentIdRef.current, rightAssessmentIdRef.current].filter(Boolean).join(',');

      (async () => {
        let report = null;
        // 生成报告数据：优先调用后端JS算法接口，失败时回退到前端算法
        try {
          if (isBackendMode) {
            // 后端模式：等待数据存储完成后调用后端报告接口
            await new Promise(r => setTimeout(r, 1000));
            const resp = await backendBridge.getGripReport({
              timestamp: Date.now(),
              collectName: patientInfo?.name || 'test',
              leftAssessmentId: leftAssessmentIdRef.current,
              rightAssessmentId: rightAssessmentIdRef.current,
              assessmentId: gripAssessmentId,
            });
            if (resp?.code === 0 && resp?.data?.render_data) {
              console.log('[GripAssessment] 后端报告数据已获取:', resp.data);
              report = resp.data.render_data;
            } else {
              console.warn('[GripAssessment] 后端报告接口返回异常，回退到前端算法:', resp?.msg);
            }
          }
        } catch (e) {
          console.warn('[GripAssessment] 后端报告接口调用失败，回退到前端算法:', e.message);
        }
        // 前端算法 fallback
        if (!report) {
          try {
            report = generateGripReportData(
              leftFullDataRef.current, rightFullDataRef.current,
              leftRawFramesRef.current, rightRawFramesRef.current,
              patientInfo?.name || ''
            );
            console.log('[GripAssessment] 前端报告数据已生成:', report);
          } catch (e) {
            console.error('[GripAssessment] 报告生成失败:', e);
          }
        }
        // 报告成功才写入历史，避免重复/空报告
        if (report) {
          setGripReportData(report);
          completeAssessment('grip', { completed: true, reportData: report }, { leftData, rightData }, gripAssessmentId);
        }
      })();
    }
  };

  const handleClose = async () => {
    // 断开串口
    if (gloveService.connected) {
      await gloveService.disconnect();
    }
    navigate('/dashboard');
  };

  const fmtTime = (t) => {
    const s = Math.floor(t / 10);
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    // 组件卸载时断开串口（仅串口直连模式）
    if (gloveService.connected) {
      gloveService.disconnect();
    }
    // 清理事件监听（不断开全局 WebSocket）
    if (backendCleanupRef.current) {
      backendCleanupRef.current();
      backendCleanupRef.current = null;
    }
    // 不再调用 backendBridge.disconnect()，保持全局连接
  }, []);

  /* ─── 导出CSV ─── */
  const handleExportCsv = async () => {
    setCsvExporting(true);
    try {
      const ids = [leftAssessmentIdRef.current, rightAssessmentIdRef.current].filter(Boolean);
      if (!ids.length) { alert('没有可导出的采集数据'); setCsvExporting(false); return; }
      const resp = await backendBridge.exportCsv({ assessmentIds: ids, sampleType: '1' });
      if (resp?.code === 0 && resp?.data?.fileName) {
        const url = backendBridge.getCsvDownloadUrl(resp.data.fileName);
        const a = document.createElement('a');
        a.href = url; a.download = resp.data.fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      } else {
        alert('导出失败: ' + (resp?.msg || '未知错误'));
      }
    } catch (e) {
      alert('导出失败: ' + e.message);
    }
    setCsvExporting(false);
  };

  /* ─── 报告模式 ─── */
  if (phase === 'report') {
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
            <button onClick={handleExportCsv} disabled={csvExporting}
              className="zeiss-btn-ghost text-xs flex items-center gap-1"
              style={csvExporting ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              {csvExporting ? '导出中...' : '保存CSV'}
            </button>
            <button onClick={handleClose} className="zeiss-btn-primary text-xs py-2 px-4">返回首页</button>
          </div>
        </header>
        <main className="flex-1 min-h-0 z-10">
          <GripReport patientName={patientInfo?.name || '未知'} patientInfo={patientInfo} onClose={handleClose} reportData={gripReportData} />
        </main>
      </div>
    );
  }

  /* ─── 设备连接状态文本 ─── */
  const getDeviceStatusText = () => {
    if (isBackendMode) return '后端模式';
    if (isSimulating) return '模拟模式';
    if (leftGloveConnected && rightGloveConnected) return '左右手已连接';
    if (leftGloveConnected) return '左手已连接';
    if (rightGloveConnected) return '右手已连接';
    if (gloveService.connected) return '等待数据...';
    return '未连接';
  };

  const getDeviceStatusColor = () => {
    if (isBackendMode) return '#7C3AED';
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
                <span style={{ color: 'var(--border-medium)' }}>|</span>
                <button onClick={handleBackendConnect} className="text-xs font-medium" style={{ color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer' }}>后端</button>
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

      {/* 握力指导弹窗 */}
      {showGripInstruction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[440px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ background: '#E8F2FF' }}>
              <svg className="w-8 h-8" style={{ color: '#0066CC' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>握力评估指导</h3>
            <p className="text-base leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
              开始评估后，请被评估者<span className="font-bold" style={{ color: '#0066CC' }}>手握圆柱体</span>，<span className="font-bold" style={{ color: '#0066CC' }}>用力抓握三次</span>
            </p>
            <button
              onClick={() => setShowGripInstruction(false)}
              className="w-full py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all"
              style={{ background: 'var(--zeiss-blue)' }}>
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {showLeftToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 animate-slideUp"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius-md)', padding: '10px 20px' }}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--zeiss-blue)' }}>
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>左手采集完成</span>
          </div>
        </div>
      )}

      {/* 戴错手拦截弹窗：用错手则不出报告，强制重测本手 */}
      {wrongHandModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 max-w-[420px] animate-scaleIn">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#FEF2F2' }}>
              <svg className="w-7 h-7" style={{ color: '#DC2626' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h3 className="text-lg font-bold text-center" style={{ color: '#DC2626' }}>
              本次{wrongHandModal.hand === 'left' ? '左手' : '右手'}采集无效
            </h3>
            <p className="text-sm text-center leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {wrongHandModal.reason === 'wrong'
                ? `检测到您本次用了【另一只手】的手套，本应测【${wrongHandModal.hand === 'left' ? '左手' : '右手'}】。`
                : `未检测到【${wrongHandModal.hand === 'left' ? '左手' : '右手'}】的有效抓握，可能用错了手或没有握紧。`}
              <br />为保证报告准确，<span style={{ color: '#DC2626', fontWeight: 700 }}>本次采集已作废</span>，请戴对手套后用【{wrongHandModal.hand === 'left' ? '左手' : '右手'}】重新采集。
            </p>
            <button onClick={() => setWrongHandModal(null)}
              className="zeiss-btn-primary w-full py-3 text-sm mt-2">重新采集{wrongHandModal.hand === 'left' ? '左手' : '右手'}</button>
          </div>
        </div>
      )}

      {/* 报告完成弹窗 */}
      {showCompleteDialog && (() => {
        const next = getNextAssessmentType(assessments, 'grip');
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 min-w-[360px] animate-scaleIn">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--success-light)' }}>
              <svg className="w-7 h-7" fill="none" stroke="var(--success)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>✓ 握力评估已完成</h3>
            <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>报告已在后台生成，可在历史记录查看</p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => navigate('/dashboard')} className="zeiss-btn-secondary flex-1 py-3 text-sm">返回首页</button>
              {next ? (
                <button onClick={() => navigate(ASSESSMENT_PATH[next])} className="zeiss-btn-primary flex-1 py-3 text-sm">下一项：{ASSESSMENT_LABEL[next]} ›</button>
              ) : (
                <button onClick={() => navigate('/dashboard')} className="zeiss-btn-primary flex-1 py-3 text-sm">四项已完成，返回</button>
              )}
            </div>
          </div>
        </div>
        );
      })()}

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
          {/* 戴错手警示条（防呆） */}
          {wrongHandWarning && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-5 py-3 rounded-xl animate-pulse"
              style={{ background: '#FEF2F2', border: '2px solid #DC2626', boxShadow: '0 8px 24px rgba(220,38,38,0.25)' }}>
              <span className="text-xl">⚠️</span>
              <span className="text-sm font-bold" style={{ color: '#DC2626' }}>{wrongHandWarning}</span>
            </div>
          )}
          <div className="relative w-full h-full flex items-center justify-center model-container m-3 rounded-xl">
            <HandModel isRecording={phase.includes('recording')} pressureValue={pressure} isLeftHand={phase.startsWith('left')} heatmapCanvas={heatmapCanvas} />
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
                <div onClick={startRecording} className="flex flex-col items-center gap-3 cursor-pointer">
                  <button
                    className="w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ border: '3px solid var(--border-medium)', background: 'transparent' }}>
                    <div className="w-11 h-11 rounded-full" style={{ background: 'linear-gradient(135deg, #F0F4F8, #FFFFFF)', boxShadow: 'var(--shadow-sm)' }} />
                  </button>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>开始采集{phase === 'left-idle' ? '左手' : '右手'}</span>
                </div>
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
                    <button onClick={handleBackendConnect}
                      className="text-[11px] py-1.5 px-3 rounded-lg font-medium"
                      style={{ color: '#7C3AED', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)' }}>后端</button>
                  </div>
                </div>
              )}
              {phase.includes('recording') && (
                <div onClick={stopRecording} className="flex flex-col items-center gap-3 cursor-pointer">
                  <button
                    className="w-16 h-16 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
                    style={{ border: '3px solid var(--zeiss-blue)', background: 'rgba(0,102,204,0.05)' }}>
                    <div className="w-7 h-7 rounded-sm" style={{ background: 'var(--zeiss-blue)' }} />
                  </button>
                  <div className="flex items-center gap-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <span>结束采集{phase === 'left-recording' ? '左手' : '右手'}</span>
                    <span className="font-mono px-3 py-1 rounded-md" style={{ background: 'var(--zeiss-blue-light)', color: 'var(--zeiss-blue)' }}>{fmtTime(timer)}</span>
                  </div>
                </div>
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
