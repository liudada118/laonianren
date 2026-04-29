import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import StandingReport from '../../components/report/StandingReport';
import EChart from '../../components/ui/EChart';
import StandingCanvas from '../../components/three/standing/StandingCanvas';
import ParticleControlPanel from '../../components/three/shared/ParticleControlPanel';
import { loadParams, saveParams, resetParams, loadTransform, saveTransform, resetTransform } from '../../components/three/shared/particleConfig';
import { serialService } from '../../lib/SerialService';
import { backendBridge } from '../../lib/BackendBridge';
import {
  splitLeftRight, calculateCOP, calculateTotalPressure, calculateContactArea,
  getValidCoords, divideXRegions, calculateRegionPressure, processFrameRealtime,
  generateFootReport, parseFrameData
} from '../../lib/FootAnalysis';

const C = { text: '#6B7B8D', grid: '#EDF0F4', blue: '#0066CC', green: '#059669', red: '#DC2626', amber: '#D97706' };

/* ─── 左侧统一数据面板 ─── */
function LeftDataPanel({ leftPressure, rightPressure, realtimeData, copTrajectory, timer, fmtTime, isRecording, filterThreshold, onFilterChange }) {
  const chartColors = { text: '#6B7B8D', grid: '#EDF0F4' };
  const tooltipStyle = { backgroundColor: '#fff', borderColor: '#E5E9EF', textStyle: { color: '#1A2332' }, extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,0.08);border-radius:8px;' };

  const leftPieOpt = useMemo(() => ({
    animation: false,
    tooltip: { show: false, trigger: 'none' },
    series: [{ type: 'pie', radius: ['35%', '65%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      emphasis: { scale: false, focus: 'none' },
      data: [
        { value: Number(leftPressure.forefoot.toFixed(1)), name: '前足', itemStyle: { color: C.blue } },
        { value: Number(leftPressure.midfoot.toFixed(1)), name: '中足', itemStyle: { color: C.green } },
        { value: Number(leftPressure.hindfoot.toFixed(1)), name: '后足', itemStyle: { color: C.amber } }
      ]
    }]
  }), [leftPressure]);

  const rightPieOpt = useMemo(() => ({
    animation: false,
    tooltip: { show: false, trigger: 'none' },
    series: [{ type: 'pie', radius: ['35%', '65%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      emphasis: { scale: false, focus: 'none' },
      data: [
        { value: Number(rightPressure.forefoot.toFixed(1)), name: '前足', itemStyle: { color: C.red } },
        { value: Number(rightPressure.midfoot.toFixed(1)), name: '中足', itemStyle: { color: C.green } },
        { value: Number(rightPressure.hindfoot.toFixed(1)), name: '后足', itemStyle: { color: C.amber } }
      ]
    }]
  }), [rightPressure]);

  const copOpt = useMemo(() => {
    const pts = copTrajectory.map(p => [p.y * 7, p.x * 7]);
    return {
      animation: false,
      tooltip: tooltipStyle, grid: { top: 12, bottom: 22, left: 32, right: 8, containLabel: false },
      xAxis: { name: '左右(mm)', type: 'value', nameTextStyle: { color: chartColors.text, fontSize: 8 }, splitLine: { lineStyle: { color: chartColors.grid } }, axisLabel: { color: chartColors.text, fontSize: 7 } },
      yAxis: { name: '前后(mm)', type: 'value', nameTextStyle: { color: chartColors.text, fontSize: 8 }, splitLine: { lineStyle: { color: chartColors.grid } }, axisLabel: { color: chartColors.text, fontSize: 7 } },
      series: [
        { type: 'line', data: pts, showSymbol: false, lineStyle: { color: '#93C5FD', width: 1.5, opacity: 0.6 } },
        { type: 'scatter', data: pts.length > 0 ? [pts[pts.length - 1]] : [], symbolSize: 8, itemStyle: { color: C.red } }
      ]
    };
  }, [copTrajectory]);

  const Metric = ({ label, value, color }) => (
    <div className="zeiss-data-row">
      <span className="zeiss-data-label text-[11px]">{label}</span>
      <span className="zeiss-data-value text-xs font-semibold tabular-nums text-right" style={{ color, minWidth: '60px', display: 'inline-block' }}>{value}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-2 overflow-y-auto">
      {/* 采集状态 */}
      {isRecording && (
        <div className="zeiss-card p-2 flex items-center gap-3 shrink-0">
          <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: C.red }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>采集中</span>
          <span className="font-mono text-sm font-bold ml-auto" style={{ color: C.blue }}>{fmtTime(timer)}</span>
        </div>
      )}

      {/* 左脚压力分布 */}
      <div className="zeiss-card overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 flex items-center gap-2 shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.blue }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>左脚压力分布</h3>
        </div>
        <div className="flex-1 min-h-[60px]"><EChart option={leftPieOpt} height="100%" /></div>
        <div className="px-3 py-1 space-y-0 shrink-0">
          <Metric label="总压力" value={realtimeData.leftTotal.toFixed(0)} color={C.blue} />
          <Metric label="面积" value={realtimeData.leftArea?.toFixed(1) + ' cm²' || '---'} color={C.blue} />
          <div className="flex items-center gap-2 pt-0.5 flex-wrap">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: C.blue }} />
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.blue, minWidth: '62px', display: 'inline-block' }}>前足 {leftPressure.forefoot.toFixed(1).padStart(5)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: C.green }} />
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.green, minWidth: '62px', display: 'inline-block' }}>中足 {leftPressure.midfoot.toFixed(1).padStart(5)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: C.amber }} />
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.amber, minWidth: '62px', display: 'inline-block' }}>后足 {leftPressure.hindfoot.toFixed(1).padStart(5)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* 右脚压力分布 */}
      <div className="zeiss-card overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1.5 flex items-center gap-2 shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.red }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>右脚压力分布</h3>
        </div>
        <div className="flex-1 min-h-[60px]"><EChart option={rightPieOpt} height="100%" /></div>
        <div className="px-3 py-1 space-y-0 shrink-0">
          <Metric label="总压力" value={realtimeData.rightTotal.toFixed(0)} color={C.red} />
          <Metric label="面积" value={realtimeData.rightArea?.toFixed(1) + ' cm²' || '---'} color={C.red} />
          <div className="flex items-center gap-2 pt-0.5 flex-wrap">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: C.red }} />
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.red, minWidth: '62px', display: 'inline-block' }}>前足 {rightPressure.forefoot.toFixed(1).padStart(5)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: C.green }} />
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.green, minWidth: '62px', display: 'inline-block' }}>中足 {rightPressure.midfoot.toFixed(1).padStart(5)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: C.amber }} />
              <span className="text-[10px] font-semibold tabular-nums" style={{ color: C.amber, minWidth: '62px', display: 'inline-block' }}>后足 {rightPressure.hindfoot.toFixed(1).padStart(5)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* CoP 轨迹 */}
      <div className="zeiss-card overflow-hidden flex flex-col min-h-0" style={{ flex: '1.2 1 0%' }}>
        <div className="px-3 py-1.5 flex items-center gap-2 shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.amber }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>CoP 轨迹</h3>
        </div>
        <div className="flex-1 min-h-[80px] px-1"><EChart option={copOpt} height="100%" /></div>
        <div className="px-3 py-1 space-y-0 shrink-0">
          <Metric label="左右平衡" value={realtimeData.balance.toFixed(1) + '%'} color={C.green} />
          <Metric label="轨迹点数" value={copTrajectory.length} color={C.blue} />
        </div>
      </div>
    </div>
  );
}

/* ─── 主组件 ─── */
export default function StandingAssessment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, institution, completeAssessment, updateAssessmentAiReport, deviceConnStatus, assessments } = useAssessment();
  // 从 Dashboard "查看报告" 跳转过来时，直接显示报告
  const viewReportMode = location.state?.viewReport && assessments.standing?.completed;
  const isGlobalConnected = deviceConnStatus === 'connected';

  // 设备与连接状态
  const [deviceStatus, setDeviceStatus] = useState('disconnected'); // disconnected | connecting | connected
  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'idle'); // idle | recording | processing | report
  const [timer, setTimer] = useState(0);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const timerRef = useRef(null);
  const [showGuideTip, setShowGuideTip] = useState(!viewReportMode);

  // 3D 场景参数
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [depthScale, setDepthScale] = useState(0);
  const [smoothness, setSmoothness] = useState(0.8);
  const [filterThreshold, setFilterThreshold] = useState(0);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [standingFilterThreshold, setStandingFilterThreshold] = useState(10);
  const [standingFilterMinArea, setStandingFilterMinArea] = useState(8);
  const [optimizeEnabled, setOptimizeEnabled] = useState(true);
  const [standingOptimizeBad, setStandingOptimizeBad] = useState(40);
  const [standingOptimizeGood, setStandingOptimizeGood] = useState(100);
  const [filterParamsLoaded, setFilterParamsLoaded] = useState(false);

  // 进入页面时从后端读取持久化的滤波参数
  useEffect(() => {
    backendBridge.getFootFilter().then(res => {
      if (res && res.code === 0 && res.data && res.data.standing) {
        const cfg = res.data.standing;
        if (typeof cfg.filterEnabled === 'boolean') setFilterEnabled(cfg.filterEnabled);
        if (typeof cfg.filterThreshold === 'number') setStandingFilterThreshold(cfg.filterThreshold);
        if (typeof cfg.filterMinArea === 'number') setStandingFilterMinArea(cfg.filterMinArea);
        if (typeof cfg.optimizeEnabled === 'boolean') setOptimizeEnabled(cfg.optimizeEnabled);
        if (typeof cfg.optimizeBad === 'number') setStandingOptimizeBad(cfg.optimizeBad);
        if (typeof cfg.optimizeGood === 'number') setStandingOptimizeGood(cfg.optimizeGood);
        console.log('[StandingAssessment] 已加载持久化滤波参数:', cfg);
      }
    }).catch(e => console.warn('读取滤波参数失败:', e)).finally(() => {
      setFilterParamsLoaded(true);
    });
  }, []);

  // 同步滤波/优化参数到后端（等待持久化参数加载完成后才同步，避免默认值覆盖）
  useEffect(() => {
    if (!filterParamsLoaded) return;
    backendBridge.setFootFilter('standing', { filterEnabled, filterThreshold: standingFilterThreshold, filterMinArea: standingFilterMinArea }).catch(e => console.warn('设置静态滤波失败:', e));
  }, [filterParamsLoaded, filterEnabled, standingFilterThreshold, standingFilterMinArea]);
  useEffect(() => {
    if (!filterParamsLoaded) return;
    backendBridge.setFootFilter('standing', { optimizeEnabled, optimizeBad: standingOptimizeBad, optimizeGood: standingOptimizeGood }).catch(e => console.warn('设置静态优化失败:', e));
  }, [filterParamsLoaded, optimizeEnabled, standingOptimizeBad, standingOptimizeGood]);

  // 粒子系统共用参数
  const [particleParams, setParticleParams] = useState(() => loadParams('standing'));
  const handleParamChange = useCallback((key, value) => {
    setParticleParams(prev => {
      const next = { ...prev, [key]: value };
      saveParams(next, 'standing');
      return next;
    });
  }, []);
  const handleParamReset = useCallback(() => {
    const defaults = resetParams('standing');
    setParticleParams(defaults);
  }, []);

  // 空间变换参数（静态独立）
  const [transformParams, setTransformParams] = useState(() => loadTransform('standing'));
  const handleTransformChange = useCallback((key, value) => {
    setTransformParams(prev => {
      const next = { ...prev, [key]: value };
      saveTransform('standing', next);
      return next;
    });
  }, []);
  const handleTransformReset = useCallback(() => {
    const defaults = resetTransform('standing');
    setTransformParams(defaults);
  }, []);

  // 实时数据
  const insoleDataRef = useRef(null); // 直接通过 ref 传递给 InsoleScene，避免 memo 阻止更新
  const [realtimeMatrix, setRealtimeMatrix] = useState(null); // 64×64 矩阵 → 用于左侧面板数据计算
  const [copTrajectory, setCopTrajectory] = useState([]);
  const [leftPressure, setLeftPressure] = useState({ forefoot: 0, midfoot: 0, hindfoot: 0 });
  const [rightPressure, setRightPressure] = useState({ forefoot: 0, midfoot: 0, hindfoot: 0 });
  const [realtimeData, setRealtimeData] = useState({ leftTotal: 0, rightTotal: 0, leftArea: 0, rightArea: 0, balance: 50 });

  // 采集数据缓存
  const collectedFrames = useRef([]);
  const prevFrame = useRef(null);
  const isRecordingRef = useRef(false);


  // 报告数据
  const [reportData, setReportData] = useState(
    viewReportMode ? (assessments.standing?.report?.reportData || null) : null
  );
  const [csvExporting, setCsvExporting] = useState(false);
  const [processingText, setProcessingText] = useState('正在保存采集数据...');

  // 后端模式
  const [isBackendMode, setIsBackendMode] = useState(false);
  const backendCleanupRef = useRef(null);
  const assessmentIdRef = useRef(null);

  // 模拟定时器
  const simIntervalRef = useRef(null);
  const simDataRef = useRef(null);  // 真实模拟数据缓存
  const simFrameIdx = useRef(0);    // 当前回放帧索引
  const currentRawFlat = useRef(null); // 当前帧的原始flat数据（未经parseFrameData变换）

  // ─── 串口数据回调 ───
  const handleSerialData = useCallback((matrix) => {
    // 更新 3D 可视化（通过 ref 直接更新，绕过 memo）
    insoleDataRef.current = matrix;
    setRealtimeMatrix(matrix);

    // 分离左右脚
    const { left: leftMatrix, right: rightMatrix } = splitLeftRight(matrix);

    // 计算压力
    const leftTotal = calculateTotalPressure(leftMatrix);
    const rightTotal = calculateTotalPressure(rightMatrix);
    const totalPressure = leftTotal + rightTotal;
    const leftArea = calculateContactArea(leftMatrix);
    const rightArea = calculateContactArea(rightMatrix);

    // 计算区域压力
    const leftCoords = getValidCoords(leftMatrix);
    const rightCoords = getValidCoords(rightMatrix);
    const leftSections = divideXRegions(leftCoords);
    const rightSections = divideXRegions(rightCoords);
    const leftRegion = calculateRegionPressure(leftMatrix, leftSections);
    const rightRegion = calculateRegionPressure(rightMatrix, rightSections);

    setLeftPressure({
      forefoot: leftRegion.forefoot.percent,
      midfoot: leftRegion.midfoot.percent,
      hindfoot: leftRegion.hindfoot.percent
    });
    setRightPressure({
      forefoot: rightRegion.forefoot.percent,
      midfoot: rightRegion.midfoot.percent,
      hindfoot: rightRegion.hindfoot.percent
    });
    setRealtimeData({
      leftTotal, rightTotal, leftArea, rightArea,
      balance: totalPressure > 0 ? (leftTotal / totalPressure) * 100 : 50
    });

    // COP 轨迹
    const cop = calculateCOP(matrix);
    if (cop) {
      setCopTrajectory(prev => {
        const next = [...prev, cop];
        return next.length > 500 ? next.slice(-500) : next;
      });
    }

    // 采集中保存帧数据
    if (isRecordingRef.current) {
      // 如果有原始flat数据（模拟模式），使用原始数据；否则用matrix.flat()（真实硬件模式）
      const frameToSave = currentRawFlat.current || matrix.flat();
      collectedFrames.current.push(frameToSave);
    }

    prevFrame.current = matrix.flat();
  }, []);

  // ─── 停止模拟 ───
  const stopSimulation = useCallback(() => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
  }, []);

  // ─── 连接真实设备 ───
  const handleConnect = useCallback(async () => {
    // 连接前先停止模拟，防止数据冲突
    stopSimulation();
    // 清空3D显示（白板）
    insoleDataRef.current = null;
    setDeviceStatus('connecting');
    try {
      serialService.setOnData(handleSerialData);
      serialService.setOnLog((msg, type) => {
        console.log(`[Serial ${type}] ${msg}`);
      });
      serialService.setOnStatus((status) => {
        if (status === 'connected') setDeviceStatus('connected');
        else if (status === 'disconnected') setDeviceStatus('disconnected');
        else if (status === 'error') setDeviceStatus('disconnected');
      });
      const ok = await serialService.connect();
      if (!ok) setDeviceStatus('disconnected');
    } catch (err) {
      console.error('连接失败:', err);
      setDeviceStatus('disconnected');
    }
  }, [handleSerialData, stopSimulation]);

  // ─── 断开连接 ───
  const handleDisconnect = useCallback(async () => {
    // 停止模拟定时器
    stopSimulation();
    await serialService.disconnect();
    setDeviceStatus('disconnected');
    setRealtimeMatrix(null);
    // 清空3D显示（白板）
    insoleDataRef.current = null;
    // 重置所有实时数据
    setCopTrajectory([]);
    setLeftPressure({ forefoot: 0, midfoot: 0, hindfoot: 0 });
    setRightPressure({ forefoot: 0, midfoot: 0, hindfoot: 0 });
    setRealtimeData({ leftTotal: 0, rightTotal: 0, leftArea: 0, rightArea: 0, balance: 50 });
  }, [stopSimulation]);

   // ─── 噪音过滤（连通域分析） ───
  const denoiseMatrix = useCallback((matrix, threshold = 12, minArea = 15) => {
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (rows === 0 || cols === 0) return matrix;

    // 步骤1：低压力置零
    const cleaned = matrix.map(row => row.map(v => v < threshold ? 0 : v));

    // 步骤2：BFS 连通域分析
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const regions = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (visited[r][c] || cleaned[r][c] === 0) continue;
        const queue = [[r, c]];
        const cells = [];
        visited[r][c] = true;
        while (queue.length > 0) {
          const [cr, cc] = queue.shift();
          cells.push([cr, cc]);
          for (const [dr, dc] of dirs) {
            const nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && cleaned[nr][nc] > 0) {
              visited[nr][nc] = true;
              queue.push([nr, nc]);
            }
          }
        }
        regions.push(cells);
      }
    }

    // 步骤3：小区域置零
    for (const cells of regions) {
      if (cells.length < minArea) {
        for (const [r, c] of cells) cleaned[r][c] = 0;
      }
    }
    return cleaned;
  }, []);

  // ─── 模拟数据（使用真CSV数据回放） ───
  const handleSimulate = useCallback(async () => {
    setDeviceStatus('connected');
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);

    // 加载真实数据（如果尚未加载）
    if (!simDataRef.current) {
      try {
        const resp = await fetch('/standing_sim_data.json');
        simDataRef.current = await resp.json();
        console.log(`[模拟] 加载真实数据: ${simDataRef.current.length} 帧`);
      } catch (err) {
        console.error('[模拟] 加载数据失败，使用随机数据:', err);
        simDataRef.current = null;
      }
    }

    simFrameIdx.current = 0;

    simIntervalRef.current = setInterval(() => {
      let matrix;
      if (simDataRef.current && simDataRef.current.length > 0) {
        // 使用真实数据循环回放 - 数据是原始flat数组，需要parseFrameData变换
        const flatData = simDataRef.current[simFrameIdx.current % simDataRef.current.length];
        currentRawFlat.current = flatData; // 保存原始数据供采集时使用
        matrix = parseFrameData(flatData);
        simFrameIdx.current++;
      } else {
        currentRawFlat.current = null; // 随机数据没有原始flat
        // 降级：生成随机模拟数据
        matrix = [];
        const t = Date.now() * 0.001;
        for (let i = 0; i < 64; i++) {
          const row = [];
          for (let j = 0; j < 64; j++) {
            let val = 0;
            if (j < 32) {
              const cx = 32, cy = 16;
              const dx = (i - cx) / 20, dy = (j - cy) / 12;
              const dist = dx * dx + dy * dy;
              if (dist < 1.2) val = Math.max(0, (1 - dist) * 80 + Math.sin(t * 2 + i * 0.1 + j * 0.1) * 15 + Math.random() * 5);
            } else {
              const cx = 32, cy = 48;
              const dx = (i - cx) / 20, dy = (j - cy) / 12;
              const dist = dx * dx + dy * dy;
              if (dist < 1.2) val = Math.max(0, (1 - dist) * 75 + Math.sin(t * 2.2 + i * 0.1 + j * 0.1) * 15 + Math.random() * 5);
            }
            row.push(Math.min(255, Math.round(val)));
          }
          matrix.push(row);
        }
      }
      // 应用噪音过滤
      matrix = denoiseMatrix(matrix, 12, 15);
      handleSerialData(matrix);
    }, 50); // 20fps
  }, [handleSerialData, denoiseMatrix]);

  // ─── 后端数据通道：全局一键连接后自动启用 ───
  useEffect(() => {
    if (!isGlobalConnected) return;
    if (backendCleanupRef.current) return; // 已在监听

    // 设置静态站立模式，后端只推送 foot1 数据，滤波使用 standing 参数
    backendBridge.setActiveMode(4).then(() => {
      console.log('[StandingAssessment] 已设置后端模式 mode=4');
    }).catch(e => console.error('[StandingAssessment] setActiveMode failed:', e));

    setIsBackendMode(true);
    setDeviceStatus('connected');

    // 监听后端推送的脚垫数据（使用 foot1 作为主数据源）
    const handleBackendFootData = (arr) => {
      if (!arr || arr.length === 0) return;
      // 后端推送的是 4096 个值的 flat 数组
      currentRawFlat.current = arr;
      const matrix = parseFrameData(arr);
      // 滤波和优化已在后端数据源头处理，前端直接使用
      handleSerialData(matrix);
    };

    const unsubFoot1 = backendBridge.on('foot1Data', handleBackendFootData);

    backendCleanupRef.current = () => {
      unsubFoot1();
      setIsBackendMode(false);
    };

    console.log('[StandingAssessment] 后端数据通道已建立');

    return () => {
      if (backendCleanupRef.current) {
        backendCleanupRef.current();
        backendCleanupRef.current = null;
      }
    };
  }, [isGlobalConnected, handleSerialData]);

  // ─── 滤波阈值 ───
  useEffect(() => {
    serialService.setFilterThreshold(filterThreshold);
  }, [filterThreshold]);

  // ─── 开始采集 ───
  const startRecording = async () => {
    setPhase('recording');
    setTimer(0);
    setCopTrajectory([]);
    collectedFrames.current = [];
    isRecordingRef.current = true;

    // 后端模式：开始数据采集
    if (isBackendMode) {
      const aid = `standing_${Date.now()}`;
      assessmentIdRef.current = aid;
      try {
        await backendBridge.startCol({
          assessmentId: aid,
          sampleType: '4',
          name: patientInfo?.name || 'test',
          date: new Date().toISOString().split('T')[0],
        });
        console.log('[Standing] startCol 成功, assessmentId:', aid);
      } catch (e) {
        console.warn('[Standing] startCol 失败:', e.message);
      }
    }

    timerRef.current = setInterval(() => {
      setTimer(p => {
        const next = p + 1;
        // 10秒自动停止（timer每100ms+1，100 = 10秒）
        if (next === 100) {
          // 立即清除定时器，确保只触发一次
          clearInterval(timerRef.current);
          timerRef.current = null;
          setTimeout(() => {
            if (isRecordingRef.current) {
              stopRecording();
            }
          }, 0);
        }
        return next;
      });
    }, 100);
  };

  // ─── 结束采集 ───
  const stopRecording = async () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    isRecordingRef.current = false;
    setProcessingText('正在保存采集数据...');
    setPhase('processing');

    // 停止模拟
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }

    // 后端模式：结束数据采集（后端会等待数据全部写入数据库后才返回）
    if (isBackendMode) {
      try {
        await backendBridge.endCol();
        console.log('[Standing] endCol 成功，数据已全部写入');
        setProcessingText('数据保存完成，正在生成报告...');
      } catch (e) {
        console.warn('[Standing] endCol 失败:', e.message);
      }
    }

    // 生成报告：优先调用后端Python算法接口，失败时回退到前端算法
    const generateReport = async () => {
      try {
        if (isBackendMode) {
          setProcessingText('正在分析足底压力数据，请稍候...');
          const resp = await backendBridge.getStandingReport({
            timestamp: Date.now(),
            assessmentId: assessmentIdRef.current,
          });
          if (resp?.code === 0 && resp?.data?.render_data) {
            console.log('[StandingAssessment] 后端报告数据已获取:', resp.data);
            setReportData(resp.data.render_data);
            setShowCompleteDialog(true);
            return;
          }
          console.warn('[StandingAssessment] 后端报告接口返回异常，回退到前端算法:', resp?.msg);
        }
      } catch (e) {
        console.warn('[StandingAssessment] 后端报告接口调用失败，回退到前端算法:', e.message);
      }
      // 前端算法 fallback
      if (collectedFrames.current.length > 0) {
        const report = generateFootReport(collectedFrames.current);
        console.log('分析报告:', report);
        setReportData(report);
      }
      setShowCompleteDialog(true);
    };
    generateReport();
  };

  /* ─── 导出CSV ─── */
  const handleExportCsv = async () => {
    setCsvExporting(true);
    try {
      const aid = assessmentIdRef.current;
      if (!aid) { alert('没有可导出的采集数据'); setCsvExporting(false); return; }
      const resp = await backendBridge.exportCsv({ assessmentId: aid, sampleType: '4' });
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

  const viewReport = () => { setShowCompleteDialog(false); setPhase('report'); completeAssessment('standing', { completed: true, reportData }, null, assessmentIdRef.current); };
  const handleClose = () => navigate('/dashboard');
  const fmtTime = (t) => { const s = Math.floor(t / 10); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const handleStandingAiReportReady = useCallback((aiData) => {
    updateAssessmentAiReport('standing', aiData, assessmentIdRef.current);
  }, [updateAssessmentAiReport]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, []);

  /* ─── 报告模式 ─── */
  if (phase === 'report') {
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <header className="assessment-header">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-[13px] md:text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              <span className="hidden lg:inline">肌少症/老年人评估及监测系统——</span>3.静态站立评估
            </h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
            <button onClick={handleExportCsv} disabled={csvExporting}
              className="zeiss-btn-ghost text-xs flex items-center gap-1"
              style={csvExporting ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              {csvExporting ? '导出中...' : '保存CSV'}
            </button>
            <button onClick={handleClose} className="zeiss-btn-primary text-xs py-2 px-3 md:px-4">返回首页</button>
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto">
          <StandingReport
              reportData={reportData}
              patientInfo={patientInfo}
              onAiReportReady={handleStandingAiReportReady}
            />
        </main>
      </div>
    );
  }

  /* ─── 采集模式 — 左侧数据面板 + 右侧3D InsoleScene ─── */
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <header className="assessment-header">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-[13px] md:text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            <span className="hidden lg:inline">肌少症/老年人评估及监测系统——</span>3.静态站立评估
          </h1>
        </div>
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
            <div className={`zeiss-status-dot ${deviceStatus}`} />
            <span className="text-xs" style={{ color: isBackendMode ? '#7C3AED' : 'var(--text-tertiary)' }}>
              {isBackendMode ? '后端已连接' : deviceStatus === 'connected' ? '已连接' : deviceStatus === 'connecting' ? '连接中...' : '未连接'}
            </span>
            {!isBackendMode && deviceStatus === 'disconnected' && (
              <>
                <button onClick={handleConnect} className="text-xs font-medium ml-1" style={{ color: 'var(--zeiss-blue)' }}>连接</button>
                <span style={{ color: 'var(--border-medium)' }}>|</span>
                <button onClick={handleSimulate} className="text-xs font-medium" style={{ color: 'var(--success)' }}>模拟</button>
              </>
            )}
            {!isBackendMode && deviceStatus === 'connected' && (
              <button onClick={handleDisconnect} className="text-xs font-medium ml-1" style={{ color: C.red }}>断开</button>
            )}
          </div>
          <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {/* ── 站立评估指导弹窗 ── */}
      {showGuideTip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 w-[420px] max-w-[90vw] animate-scaleIn text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ background: '#E8F2FF' }}>
              <svg className="w-7 h-7" style={{ color: '#0066CC' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>静态站立评估指导</h3>
            <p className="text-base leading-relaxed mb-6" style={{ color: 'var(--text-secondary)' }}>
              点击屏幕下方采集按钮后，请被评估者站在<span className="font-bold" style={{ color: '#0066CC' }}>足底压力传感器中心</span>，<span className="font-bold" style={{ color: '#0066CC' }}>自然站立状态</span>，保持<span className="font-bold" style={{ color: '#0066CC' }}>10秒以上</span>，10秒后系统会自动结束采集。
            </p>
            <button
              onClick={() => setShowGuideTip(false)}
              className="w-full py-3 rounded-[10px] font-semibold text-sm text-white border-none cursor-pointer transition-all"
              style={{ background: 'var(--zeiss-blue)' }}>
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* 完成弹窗 */}
      {showCompleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 min-w-[340px] animate-slideUp">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--success-light)' }}>
              <svg className="w-7 h-7" fill="none" stroke="var(--success)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>采集完成，报告已生成</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>共采集 {collectedFrames.current.length} 帧数据</p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => { setShowCompleteDialog(false); completeAssessment('standing', { completed: true, reportData }, null, assessmentIdRef.current); navigate('/dashboard'); }}
                className="zeiss-btn-secondary flex-1 py-3 text-sm">返回首页</button>
              <button onClick={viewReport}
                className="zeiss-btn-primary flex-1 py-3 text-sm">查看报告</button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧数据面板 */}
        <div className="assessment-side-panel">
          <LeftDataPanel
            leftPressure={leftPressure} rightPressure={rightPressure}
            realtimeData={realtimeData} copTrajectory={copTrajectory}
            timer={timer} fmtTime={fmtTime} isRecording={phase === 'recording'}
            filterThreshold={filterThreshold} onFilterChange={setFilterThreshold}
          />
        </div>

        {/* 右侧3D区域 - Three.js 粒子系统可视化 */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="relative w-full h-full model-container m-3 rounded-xl overflow-hidden">
            <StandingCanvas
              showHeatmap={showHeatmap}
              externalDataRef={insoleDataRef}
              particleParams={particleParams}
              transformParams={transformParams}
            />

            {/* 粒子参数调节面板 */}
            <ParticleControlPanel
              params={particleParams}
              onChange={handleParamChange}
              onReset={handleParamReset}
              transform={transformParams}
              onTransformChange={handleTransformChange}
              onTransformReset={handleTransformReset}
              showHeatmap={showHeatmap}
              onHeatmapChange={setShowHeatmap}
              extra={
                <>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={filterEnabled} onChange={e => setFilterEnabled(e.target.checked)} className="w-3.5 h-3.5 rounded accent-blue-500" />
                    <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary, #4a5568)' }}>滤波</span>
                  </label>
                  {filterEnabled && (
                    <div className="pl-5 space-y-1">
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted, #9ca3af)' }}>压力阈值</span>
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{standingFilterThreshold}</span>
                        </div>
                        <input type="range" min={0} max={100} step={1} value={standingFilterThreshold} onChange={e => setStandingFilterThreshold(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted, #9ca3af)' }}>最小连通域</span>
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{standingFilterMinArea}</span>
                        </div>
                        <input type="range" min={0} max={100} step={1} value={standingFilterMinArea} onChange={e => setStandingFilterMinArea(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
                      </div>
                    </div>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={optimizeEnabled} onChange={e => setOptimizeEnabled(e.target.checked)} className="w-3.5 h-3.5 rounded accent-blue-500" />
                    <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary, #4a5568)' }}>优化</span>
                  </label>
                  {optimizeEnabled && (
                    <div className="pl-5 space-y-1">
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted, #9ca3af)' }}>坏线阈值</span>
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{standingOptimizeBad}</span>
                        </div>
                        <input type="range" min={0} max={200} step={1} value={standingOptimizeBad} onChange={e => setStandingOptimizeBad(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted, #9ca3af)' }}>正常阈值</span>
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{standingOptimizeGood}</span>
                        </div>
                        <input type="range" min={0} max={500} step={1} value={standingOptimizeGood} onChange={e => setStandingOptimizeGood(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
                      </div>
                    </div>
                  )}
                </>
              }
            />

            {/* 处理中遮罩 */}
            {phase === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center zeiss-overlay rounded-xl">
                <div className="w-64 h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full progress-animate" style={{ background: 'linear-gradient(to right, var(--zeiss-blue), #0891B2)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{processingText}</p>
              </div>
            )}
          </div>

          {/* 底部操作按钮 */}
          {phase !== 'processing' && (
            <div className="absolute bottom-10 z-20 flex flex-col items-center gap-3">
              {phase === 'idle' && deviceStatus === 'connected' && (
                <div onClick={startRecording} className="flex flex-col items-center gap-3 cursor-pointer">
                  <button className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--border-medium)' }}>
                    <div className="w-11 h-11 rounded-full" style={{ background: 'linear-gradient(135deg, #F8F9FA, #E8ECF0)' }} />
                  </button>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>开始采集</span>
                </div>
              )}
              {phase === 'idle' && deviceStatus !== 'connected' && (
                <span className="text-sm px-5 py-2.5 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                  请先连接设备或选择模拟模式
                </span>
              )}
              {phase === 'recording' && (
                <div onClick={stopRecording} className="flex flex-col items-center gap-3 cursor-pointer">
                  <button className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--zeiss-blue)', background: 'rgba(0,102,204,0.05)' }}>
                    <div className="w-7 h-7 rounded-sm" style={{ background: 'var(--zeiss-blue)' }} />
                  </button>
                  <div className="flex items-center gap-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <span>结束采集</span>
                    <span className="font-mono px-3 py-1 rounded-md" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--zeiss-blue)' }}>{fmtTime(timer)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <div className="h-6 flex items-center px-6 shrink-0">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
      </div>
    </div>
  );
}
