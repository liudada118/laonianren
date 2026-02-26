import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import StandingReport from '../../components/report/StandingReport';
import EChart from '../../components/ui/EChart';
import InsoleScene from '../../components/three/InsoleScene';
import { serialService } from '../../lib/SerialService';
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
    tooltip: { trigger: 'item', ...tooltipStyle },
    series: [{ type: 'pie', radius: ['35%', '65%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 9, color: chartColors.text },
      data: [
        { value: leftPressure.forefoot.toFixed(1), name: '前足', itemStyle: { color: C.blue } },
        { value: leftPressure.midfoot.toFixed(1), name: '中足', itemStyle: { color: C.green } },
        { value: leftPressure.hindfoot.toFixed(1), name: '后足', itemStyle: { color: C.amber } }
      ]
    }]
  }), [leftPressure]);

  const rightPieOpt = useMemo(() => ({
    tooltip: { trigger: 'item', ...tooltipStyle },
    series: [{ type: 'pie', radius: ['35%', '65%'], center: ['50%', '50%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 9, color: chartColors.text },
      data: [
        { value: rightPressure.forefoot.toFixed(1), name: '前足', itemStyle: { color: C.red } },
        { value: rightPressure.midfoot.toFixed(1), name: '中足', itemStyle: { color: C.green } },
        { value: rightPressure.hindfoot.toFixed(1), name: '后足', itemStyle: { color: C.amber } }
      ]
    }]
  }), [rightPressure]);

  const copOpt = useMemo(() => {
    const pts = copTrajectory.map(p => [p.y * 7, p.x * 7]);
    return {
      animation: false,
      tooltip: tooltipStyle, grid: { top: 20, bottom: 28, left: 36, right: 12 },
      xAxis: { name: '左右(mm)', type: 'value', nameTextStyle: { color: chartColors.text, fontSize: 9 }, splitLine: { lineStyle: { color: chartColors.grid } }, axisLabel: { color: chartColors.text, fontSize: 8 } },
      yAxis: { name: '前后(mm)', type: 'value', nameTextStyle: { color: chartColors.text, fontSize: 9 }, splitLine: { lineStyle: { color: chartColors.grid } }, axisLabel: { color: chartColors.text, fontSize: 8 } },
      series: [
        { type: 'line', data: pts, showSymbol: false, lineStyle: { color: '#93C5FD', width: 1.5, opacity: 0.6 } },
        { type: 'scatter', data: pts.length > 0 ? [pts[pts.length - 1]] : [], symbolSize: 8, itemStyle: { color: C.red } }
      ]
    };
  }, [copTrajectory]);

  const Metric = ({ label, value, color }) => (
    <div className="zeiss-data-row">
      <span className="zeiss-data-label text-[11px]">{label}</span>
      <span className="zeiss-data-value text-xs font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-3 overflow-y-auto">
      {/* 采集状态 */}
      {isRecording && (
        <div className="zeiss-card p-3 flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: C.red }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>采集中</span>
          <span className="font-mono text-sm font-bold ml-auto" style={{ color: C.blue }}>{fmtTime(timer)}</span>
        </div>
      )}

      {/* 左脚压力分布 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.blue }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>左脚压力分布</h3>
        </div>
        <div className="h-[140px]"><EChart option={leftPieOpt} height={140} /></div>
        <div className="px-4 py-2 space-y-1">
          <Metric label="总压力" value={realtimeData.leftTotal.toFixed(0)} color={C.blue} />
          <Metric label="面积" value={realtimeData.leftArea?.toFixed(1) + ' cm²' || '---'} color={C.blue} />
          <Metric label="前足" value={leftPressure.forefoot.toFixed(1) + '%'} color={C.blue} />
          <Metric label="中足" value={leftPressure.midfoot.toFixed(1) + '%'} color={C.green} />
          <Metric label="后足" value={leftPressure.hindfoot.toFixed(1) + '%'} color={C.amber} />
        </div>
      </div>

      {/* 右脚压力分布 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.red }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>右脚压力分布</h3>
        </div>
        <div className="h-[140px]"><EChart option={rightPieOpt} height={140} /></div>
        <div className="px-4 py-2 space-y-1">
          <Metric label="总压力" value={realtimeData.rightTotal.toFixed(0)} color={C.red} />
          <Metric label="面积" value={realtimeData.rightArea?.toFixed(1) + ' cm²' || '---'} color={C.red} />
          <Metric label="前足" value={rightPressure.forefoot.toFixed(1) + '%'} color={C.red} />
          <Metric label="中足" value={rightPressure.midfoot.toFixed(1) + '%'} color={C.green} />
          <Metric label="后足" value={rightPressure.hindfoot.toFixed(1) + '%'} color={C.amber} />
        </div>
      </div>

      {/* CoP 轨迹 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.amber }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>CoP 轨迹</h3>
        </div>
        <div className="h-[150px] px-1"><EChart option={copOpt} height={150} /></div>
        <div className="px-4 py-2 space-y-1">
          <Metric label="左右平衡" value={realtimeData.balance.toFixed(1) + '%'} color={C.green} />
          <Metric label="轨迹点数" value={copTrajectory.length} color={C.blue} />
        </div>
      </div>

      {/* 滤波阈值 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.green }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>滤波设置</h3>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>噪声阈值</span>
            <span className="text-xs font-semibold tabular-nums" style={{ color: C.green }}>{filterThreshold}</span>
          </div>
          <input type="range" min={0} max={50} value={filterThreshold} onChange={e => onFilterChange(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ background: `linear-gradient(to right, ${C.green} ${filterThreshold * 2}%, var(--border-light) ${filterThreshold * 2}%)` }} />
          <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>低于此值的数据将被过滤</p>
        </div>
      </div>
    </div>
  );
}

/* ─── 主组件 ─── */
export default function StandingAssessment() {
  const navigate = useNavigate();
  const { patientInfo, institution, completeAssessment } = useAssessment();

  // 设备与连接状态
  const [deviceStatus, setDeviceStatus] = useState('disconnected'); // disconnected | connecting | connected
  const [phase, setPhase] = useState('idle'); // idle | recording | processing | report
  const [reportMode, setReportMode] = useState('static');
  const [timer, setTimer] = useState(0);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const timerRef = useRef(null);

  // 3D 场景参数
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [depthScale, setDepthScale] = useState(0);
  const [smoothness, setSmoothness] = useState(0.8);
  const [filterThreshold, setFilterThreshold] = useState(0);

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
  const [reportData, setReportData] = useState(null);

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

  // ─── 滤波阈值 ───
  useEffect(() => {
    serialService.setFilterThreshold(filterThreshold);
  }, [filterThreshold]);

  // ─── 开始采集 ───
  const startRecording = () => {
    setPhase('recording');
    setTimer(0);
    setCopTrajectory([]);
    collectedFrames.current = [];
    isRecordingRef.current = true;
    timerRef.current = setInterval(() => setTimer(p => p + 1), 100);
  };

  // ─── 结束采集 ───
  const stopRecording = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    isRecordingRef.current = false;
    setPhase('processing');

    // 停止模拟
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }

    // 生成报告
    setTimeout(() => {
      if (collectedFrames.current.length > 0) {
        const report = generateFootReport(collectedFrames.current);
        console.log('分析报告:', report);
        setReportData(report);
      }
      setShowCompleteDialog(true);
    }, 2000);
  };

  const viewReport = () => { setShowCompleteDialog(false); setPhase('report'); setReportMode('static'); completeAssessment('standing', { completed: true }); };
  const handleClose = () => navigate('/dashboard');
  const fmtTime = (t) => { const s = Math.floor(t / 10); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  // 清理
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
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
              <button onClick={() => setReportMode('static')}
                className={`px-3 md:px-4 py-1.5 text-xs rounded-md transition-all font-medium ${reportMode === 'static' ? 'zeiss-btn-primary' : ''}`}
                style={reportMode !== 'static' ? { color: 'var(--text-muted)', background: 'transparent' } : { padding: '6px 16px', fontSize: '12px' }}>
                静态报告
              </button>
              <button onClick={() => setReportMode('dynamic')}
                className={`px-3 md:px-4 py-1.5 text-xs rounded-md transition-all font-medium ${reportMode === 'dynamic' ? 'zeiss-btn-primary' : ''}`}
                style={reportMode !== 'dynamic' ? { color: 'var(--text-muted)', background: 'transparent' } : { padding: '6px 16px', fontSize: '12px' }}>
                动态报告
              </button>
            </div>
            <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
            <button onClick={handleClose} className="zeiss-btn-primary text-xs py-2 px-3 md:px-4">返回首页</button>
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto">
          {reportMode === 'dynamic' ? (
            <div className="flex items-center justify-center h-full p-6">
              <div className="zeiss-card p-6 max-w-4xl w-full">
                <video src="/assets/dynamic_report.mp4" controls className="w-full rounded-xl" style={{ maxHeight: '70vh', background: '#000' }} />
              </div>
            </div>
          ) : (
            <StandingReport reportData={reportData} patientInfo={patientInfo} />
          )}
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
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {deviceStatus === 'connected' ? '已连接' : deviceStatus === 'connecting' ? '连接中...' : '未连接'}
            </span>
            {deviceStatus === 'disconnected' && (
              <>
                <button onClick={handleConnect} className="text-xs font-medium ml-1" style={{ color: 'var(--zeiss-blue)' }}>连接</button>
                <span style={{ color: 'var(--border-medium)' }}>|</span>
                <button onClick={handleSimulate} className="text-xs font-medium" style={{ color: 'var(--success)' }}>模拟</button>
              </>
            )}
            {deviceStatus === 'connected' && (
              <button onClick={handleDisconnect} className="text-xs font-medium ml-1" style={{ color: C.red }}>断开</button>
            )}
          </div>
          <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {/* 完成弹窗 */}
      {showCompleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 min-w-[340px] animate-slideUp">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--success-light)' }}>
              <svg className="w-7 h-7" fill="none" stroke="var(--success)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>采集完成，报告已生成</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>共采集 {collectedFrames.current.length} 帧数据</p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => { setShowCompleteDialog(false); completeAssessment('standing', { completed: true }); navigate('/dashboard'); }}
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

        {/* 右侧3D区域 - huisheng-sdk InsoleScene */}
        <div className="flex-1 min-w-0 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="relative w-full h-full model-container m-3 rounded-xl overflow-hidden">
            <InsoleScene
              showHeatmap={showHeatmap}
              enableClipping={false}
              clipLevel={0.5}
              depthScale={depthScale}
              smoothness={smoothness}
              externalDataRef={insoleDataRef}
            />

            {/* 浮动控件 - 右上角 */}
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-2" style={{ minWidth: '140px' }}>
              <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-light)' }}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} className="w-3.5 h-3.5 rounded" />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>热力图</span>
                </label>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>深度</span>
                    <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{depthScale.toFixed(1)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={depthScale} onChange={e => setDepthScale(Number(e.target.value))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light)' }} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>平滑度</span>
                    <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{smoothness.toFixed(1)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.05} value={smoothness} onChange={e => setSmoothness(Number(e.target.value))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light)' }} />
                </div>
              </div>
            </div>

            {/* 处理中遮罩 */}
            {phase === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center zeiss-overlay rounded-xl">
                <div className="w-64 h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full progress-animate" style={{ background: 'linear-gradient(to right, var(--zeiss-blue), #0891B2)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>正在分析足底压力数据，请稍候...</p>
              </div>
            )}
          </div>

          {/* 底部操作按钮 */}
          {phase !== 'processing' && (
            <div className="absolute bottom-10 z-20 flex flex-col items-center gap-3">
              {phase === 'idle' && deviceStatus === 'connected' && (
                <>
                  <button onClick={startRecording} className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--border-medium)' }}>
                    <div className="w-11 h-11 rounded-full" style={{ background: 'linear-gradient(135deg, #F8F9FA, #E8ECF0)' }} />
                  </button>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>开始采集</span>
                </>
              )}
              {phase === 'idle' && deviceStatus !== 'connected' && (
                <span className="text-sm px-5 py-2.5 rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>
                  请先连接设备或选择模拟模式
                </span>
              )}
              {phase === 'recording' && (
                <>
                  <button onClick={stopRecording} className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--zeiss-blue)', background: 'rgba(0,102,204,0.05)' }}>
                    <div className="w-7 h-7 rounded-sm" style={{ background: 'var(--zeiss-blue)' }} />
                  </button>
                  <div className="flex items-center gap-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <span>结束采集</span>
                    <span className="font-mono px-3 py-1 rounded-md" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', color: 'var(--zeiss-blue)' }}>{fmtTime(timer)}</span>
                  </div>
                </>
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
