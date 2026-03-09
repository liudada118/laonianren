import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import EChart from '../../components/ui/EChart';
import {
  PressureScene3D, matrixStats, calculateCoP,
} from '../../lib/pressure-sensor';
import { backendBridge } from '../../lib/BackendBridge';
import SitStandReport from '../../components/report/SitStandReport';

/* ─── 图表样式常量 ─── */
const C = { text: '#6B7B8D', grid: '#EDF0F4', blue: '#0066CC', green: '#059669', red: '#DC2626', amber: '#D97706' };

/* ─── 左侧数据面板 ─── */
function LeftDataPanel({ seatStats, footpadStats, seatCoP, footpadCoP, seatHistory, footpadHistory, isRecording, timer, fmtTime }) {
  /* 坐垫压力曲线 */
  const seatLineOpt = useMemo(() => ({
    animation: false,
    grid: { top: 8, bottom: 16, left: 32, right: 8 },
    xAxis: { show: false, type: 'category', data: seatHistory.map((_, i) => i) },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.text, fontSize: 9 } },
    series: [{ type: 'line', smooth: true, symbol: 'none', data: seatHistory,
      lineStyle: { color: C.blue, width: 1.5 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: C.blue + '20' }, { offset: 1, color: 'transparent' }] } }
    }]
  }), [seatHistory]);

  /* 脚垫压力曲线 */
  const footLineOpt = useMemo(() => ({
    animation: false,
    grid: { top: 8, bottom: 16, left: 32, right: 8 },
    xAxis: { show: false, type: 'category', data: footpadHistory.map((_, i) => i) },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.text, fontSize: 9 } },
    series: [{ type: 'line', smooth: true, symbol: 'none', data: footpadHistory,
      lineStyle: { color: C.green, width: 1.5 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: C.green + '20' }, { offset: 1, color: 'transparent' }] } }
    }]
  }), [footpadHistory]);

  /* CoP 散点图 */
  const copOpt = useMemo(() => ({
    animation: false,
    grid: { top: 20, bottom: 28, left: 36, right: 12 },
    xAxis: { name: 'X', type: 'value', min: 0, max: 100, nameTextStyle: { color: C.text, fontSize: 9 }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.text, fontSize: 9 } },
    yAxis: { name: 'Y', type: 'value', min: 0, max: 100, nameTextStyle: { color: C.text, fontSize: 9 }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.text, fontSize: 9 } },
    series: [
      { type: 'scatter', symbolSize: 8, itemStyle: { color: C.blue },
        data: seatCoP ? [[+(seatCoP.x * 100).toFixed(1), +(seatCoP.y * 100).toFixed(1)]] : [],
        name: '坐垫' },
      { type: 'scatter', symbolSize: 8, itemStyle: { color: C.green },
        data: footpadCoP ? [[+(footpadCoP.x * 100).toFixed(1), +(footpadCoP.y * 100).toFixed(1)]] : [],
        name: '脚垫' },
    ]
  }), [seatCoP, footpadCoP]);

  const Metric = ({ label, value, color }) => (
    <div className="zeiss-data-row">
      <span className="zeiss-data-label text-[11px]">{label}</span>
      <span className="zeiss-data-value text-xs font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-3 overflow-y-auto">
      {/* 采集状态卡片 */}
      {isRecording && (
        <div className="zeiss-card p-3 flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: C.red }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>采集中</span>
          <span className="font-mono text-sm font-bold ml-auto" style={{ color: C.blue }}>{fmtTime(timer)}</span>
        </div>
      )}

      {/* 坐垫数据 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.blue }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>坐垫压力 (32x32)</h3>
        </div>
        <div className="h-[90px] px-1"><EChart option={seatLineOpt} height={90} /></div>
        <div className="px-4 py-2.5 space-y-1.5">
          <Metric label="最大压力" value={seatStats ? seatStats.max.toFixed(0) : '---'} color={C.blue} />
          <Metric label="平均压力" value={seatStats ? seatStats.mean.toFixed(1) : '---'} color={C.blue} />
          <Metric label="总压力" value={seatStats ? seatStats.totalPressure.toFixed(0) : '---'} color={C.blue} />
          <Metric label="有效点" value={seatStats ? seatStats.nonZeroCount : '---'} color={C.blue} />
          <Metric label="CoP X" value={seatCoP ? (seatCoP.x * 100).toFixed(1) + '%' : '---'} color={C.blue} />
          <Metric label="CoP Y" value={seatCoP ? (seatCoP.y * 100).toFixed(1) + '%' : '---'} color={C.blue} />
        </div>
      </div>

      {/* 脚垫数据 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.green }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>脚垫压力 (64x64)</h3>
        </div>
        <div className="h-[90px] px-1"><EChart option={footLineOpt} height={90} /></div>
        <div className="px-4 py-2.5 space-y-1.5">
          <Metric label="最大压力" value={footpadStats ? footpadStats.max.toFixed(0) : '---'} color={C.green} />
          <Metric label="平均压力" value={footpadStats ? footpadStats.mean.toFixed(1) : '---'} color={C.green} />
          <Metric label="总压力" value={footpadStats ? footpadStats.totalPressure.toFixed(0) : '---'} color={C.green} />
          <Metric label="有效点" value={footpadStats ? footpadStats.nonZeroCount : '---'} color={C.green} />
          <Metric label="CoP X" value={footpadCoP ? (footpadCoP.x * 100).toFixed(1) + '%' : '---'} color={C.green} />
          <Metric label="CoP Y" value={footpadCoP ? (footpadCoP.y * 100).toFixed(1) + '%' : '---'} color={C.green} />
        </div>
      </div>

      {/* CoP 散点图 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.amber }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>压力中心 (CoP)</h3>
        </div>
        <div className="h-[140px] px-1"><EChart option={copOpt} height={140} /></div>
      </div>
    </div>
  );
}

/* ─── 3D场景控制面板（浮动） ─── */
function SceneControlPanel({ config, onConfigChange }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-light)', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <h4 className="text-[10px] font-semibold mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>显示设置</h4>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={config.showHeatmap}
            onChange={(e) => onConfigChange({ showHeatmap: e.target.checked })}
            className="rounded" style={{ accentColor: 'var(--zeiss-blue)' }} />
          热力图
        </label>
        <div>
          <div className="flex justify-between text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>深度</span><span>{(config.depthScale * 100).toFixed(0)}%</span>
          </div>
          <input type="range" min={0} max={0.35} step={0.01} value={config.depthScale}
            onChange={(e) => onConfigChange({ depthScale: parseFloat(e.target.value) })}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: 'var(--zeiss-blue)' }} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>平滑度</span><span>{(config.smoothness * 100).toFixed(0)}%</span>
          </div>
          <input type="range" min={0} max={1} step={0.05} value={config.smoothness}
            onChange={(e) => onConfigChange({ smoothness: parseFloat(e.target.value) })}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: 'var(--zeiss-blue)' }} />
        </div>
      </div>
    </div>
  );
}

/* ===============================================
   主组件 — 纯 BackendBridge 模式
   =============================================== */
export default function SitStandAssessment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, completeAssessment, assessments, deviceConnStatus } = useAssessment();
  const isGlobalConnected = deviceConnStatus === 'connected';
  const viewReportMode = location.state?.viewReport && assessments.sitstand?.completed;

  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'idle');
  const assessmentIdRef = useRef(`sitstand_${Date.now()}`);
  const [csvExporting, setCsvExporting] = useState(false);
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const [showComplete, setShowComplete] = useState(false);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  const [seatPressureHistory, setSeatPressureHistory] = useState([]);
  const [footpadPressureHistory, setFootpadPressureHistory] = useState([]);

  const [pythonResult, setPythonResult] = useState(
    viewReportMode ? (assessments.sitstand?.report?.reportData || assessments.sitstand?.data?.pythonResult || null) : null
  );

  const [sceneConfig, setSceneConfig] = useState({
    showHeatmap: true,
    depthScale: 0,
    smoothness: 0.5,
  });

  /* ─── 3D 场景与数据状态 ─── */
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const [seatStats, setSeatStats] = useState(null);
  const [footpadStats, setFootpadStats] = useState(null);
  const [seatCoP, setSeatCoP] = useState(null);
  const [footpadCoP, setFootpadCoP] = useState(null);

  /** 过滤点状噪音 */
  const denoiseMatrix = useCallback((matrix, minNeighbors = 2, threshold = 5) => {
    const rows = matrix.length, cols = matrix[0].length;
    const result = matrix.map(row => [...row]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (matrix[r][c] <= 0 || matrix[r][c] > threshold) continue;
        let neighbors = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && matrix[nr][nc] > 0) neighbors++;
          }
        }
        if (neighbors < minNeighbors) result[r][c] = 0;
      }
    }
    return result;
  }, []);

  /** flat 数组转 2D 矩阵 */
  const flatToMatrix = useCallback((flat, size) => {
    const matrix = [];
    for (let r = 0; r < size; r++) matrix.push(flat.slice(r * size, (r + 1) * size));
    return matrix;
  }, []);

  /** 顺时针旋转90° */
  const rotateCW90 = useCallback((matrix) => {
    const rows = matrix.length, cols = matrix[0]?.length || 0;
    const result = [];
    for (let c = 0; c < cols; c++) {
      const newRow = [];
      for (let r = rows - 1; r >= 0; r--) newRow.push(matrix[r][c]);
      result.push(newRow);
    }
    return result;
  }, []);

  /** 旋转180° */
  const rotate180 = useCallback((matrix) => {
    return matrix.slice().reverse().map(row => [...row].reverse());
  }, []);

  /** 处理传感器数据 */
  const processSensorData = useCallback((matrix, role) => {
    const scene = sceneRef.current;
    const stats = matrixStats(matrix);
    const cop = calculateCoP(matrix);
    if (role === 'seat') {
      if (scene) scene.updateSeatData(rotateCW90(matrix));
      setSeatStats(stats);
      setSeatCoP(cop);
      setSeatPressureHistory(prev => {
        const next = [...prev, stats.totalPressure];
        return next.length > 100 ? next.slice(-100) : next;
      });
    } else {
      if (scene) scene.updateFootpadData(rotate180(matrix));
      setFootpadStats(stats);
      setFootpadCoP(cop);
      setFootpadPressureHistory(prev => {
        const next = [...prev, stats.totalPressure];
        return next.length > 100 ? next.slice(-100) : next;
      });
    }
  }, [rotateCW90, rotate180]);

  // ─── 初始化 3D 场景 ───
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new PressureScene3D(sceneConfig);
    scene.mount(containerRef.current);
    sceneRef.current = scene;
    return () => { scene.unmount(); sceneRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfigChange = useCallback((cfg) => {
    setSceneConfig(prev => { const n = { ...prev, ...cfg }; sceneRef.current?.updateConfig(cfg); return n; });
  }, []);

  // ─── 后端数据监听 ───
  useEffect(() => {
    if (!isGlobalConnected) return;

    const handleSitData = (arr) => {
      const size = Math.round(Math.sqrt(arr.length));
      const matrix = flatToMatrix(arr, size);
      // 后端 hand() 已处理线序修正和左右镜像，前端只需转置
      const transposed = [];
      for (let c = 0; c < size; c++) {
        const newRow = [];
        for (let r = 0; r < size; r++) newRow.push(matrix[r][c]);
        transposed.push(newRow);
      }
      const mat = denoiseMatrix(transposed, 3, 15);
      processSensorData(mat, 'seat');
    };

    const handleFoot1Data = (arr) => {
      const size = Math.round(Math.sqrt(arr.length));
      const raw = flatToMatrix(arr, size);
      const cols = raw[0].length, rows = raw.length;
      const rotated = [];
      for (let c = cols - 1; c >= 0; c--) {
        const newRow = [];
        for (let r = 0; r < rows; r++) newRow.push(raw[r][c]);
        rotated.push(newRow);
      }
      const mirrored = rotated.map(row => [...row].reverse());
      const flipped = [...mirrored].reverse();
      const mat = denoiseMatrix(flipped, 3, 12);
      processSensorData(mat, 'footpad');
    };

    backendBridge.on('sitData', handleSitData);
    backendBridge.on('foot1Data', handleFoot1Data);

    return () => {
      backendBridge.off('sitData', handleSitData);
      backendBridge.off('foot1Data', handleFoot1Data);
    };
  }, [isGlobalConnected, flatToMatrix, denoiseMatrix, processSensorData]);

  // ─── CSV 导出 ───
  const handleExportCsv = async () => {
    setCsvExporting(true);
    try {
      const resp = await backendBridge.exportCsv({ assessmentId: assessmentIdRef.current, sampleType: 'sitstand' });
      if (resp?.data?.fileName) {
        const url = backendBridge.getCsvDownloadUrl(resp.data.fileName);
        const a = document.createElement('a');
        a.href = url;
        a.download = resp.data.fileName;
        a.click();
      }
    } catch (e) {
      console.error('CSV导出失败:', e);
    } finally {
      setCsvExporting(false);
    }
  };

  const fmtTime = (t) => {
    const s = Math.floor(t / 10);
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  /* ─── 开始采集 ─── */
  const start = async () => {
    if (!isGlobalConnected) return;
    setPhase('recording'); setTimer(0);
    setSeatPressureHistory([]); setFootpadPressureHistory([]);
    setPythonResult(null); setAnalysisError('');

    try {
      await backendBridge.setActiveMode(3); // 3=坐垫+脚垫模式
      await backendBridge.startCol({
        name: patientInfo?.name || '未知',
        assessmentId: assessmentIdRef.current,
        date: new Date().toISOString().split('T')[0],
        colName: 'sitstand_assessment',
      });
    } catch (e) {
      console.error('后端采集启动失败:', e);
    }

    timerRef.current = setInterval(() => setTimer(p => p + 1), 100);
  };

  /* ─── 停止采集 ─── */
  const stop = async () => {
    clearInterval(timerRef.current);
    setPhase('processing');
    setAnalyzing(true);
    setAnalysisError('');

    try {
      await backendBridge.endCol();
      await new Promise(r => setTimeout(r, 500));
      const resp = await backendBridge.getSitStandReport({
        timestamp: new Date().toISOString(),
        assessmentId: assessmentIdRef.current,
        collectName: 'sitstand_assessment',
      });
      if (resp?.data?.render_data) {
        setPythonResult(resp.data.render_data);
        completeAssessment('sitstand', { completed: true, reportData: resp.data.render_data }, { pythonResult: resp.data.render_data });
      } else {
        throw new Error('后端未返回报告数据');
      }
    } catch (e) {
      console.error('报告生成失败:', e);
      setAnalysisError(e.message || '报告生成失败');
    } finally {
      setAnalyzing(false);
      setShowComplete(true);
    }
  };

  const viewReport = () => {
    setShowComplete(false); setPhase('report');
    completeAssessment('sitstand', { completed: true, reportData: pythonResult }, { seatPressureHistory, footpadPressureHistory, pythonResult });
  };

  // ─── 组件卸载清理 ───
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  /* ─── 报告模式 ─── */
  if (phase === 'report') {
    return (
      <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
        <header className="assessment-header">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <button onClick={() => navigate('/dashboard')} className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <h1 className="text-[13px] md:text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              <span className="hidden lg:inline">肌少症/老年人评估及监测系统——</span>2.起坐能力评估
            </h1>
          </div>
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
            <button onClick={handleExportCsv} disabled={csvExporting}
              className="zeiss-btn-secondary text-xs py-2 px-4">
              {csvExporting ? '导出中...' : '保存CSV'}
            </button>
            <button onClick={() => navigate('/dashboard')} className="zeiss-btn-primary text-xs py-2 px-3 md:px-4">返回首页</button>
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto">
          <SitStandReport patientInfo={patientInfo} reportData={pythonResult} />
        </main>
      </div>
    );
  }

  /* ===============================================
     采集模式布局
     =============================================== */
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* 顶部栏 */}
      <header className="assessment-header">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <button onClick={() => navigate('/dashboard')} className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-[13px] md:text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            <span className="hidden lg:inline">肌少症/老年人评估及监测系统——</span>2.起坐能力评估
          </h1>
        </div>
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {/* 设备连接状态 */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
            <div className={`zeiss-status-dot ${isGlobalConnected ? 'connected' : 'disconnected'}`} />
            <span className="text-[10px]" style={{ color: isGlobalConnected ? 'var(--success)' : 'var(--text-muted)' }}>
              {isGlobalConnected ? '设备已连接' : '设备未连接'}
            </span>
          </div>
          <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {/* 完成弹窗 */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 min-w-[340px] animate-slideUp">
            {pythonResult ? (
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--success-light)' }}>
                <svg className="w-7 h-7" fill="none" stroke="var(--success)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
            ) : (
              <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: '#FEF3C7' }}>
                <svg className="w-7 h-7" fill="none" stroke="#D97706" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
              </div>
            )}
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{pythonResult ? '采集完成，报告已生成' : analysisError ? '采集完成，分析失败' : '采集完成'}</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{pythonResult ? '您可以查看报告或返回首页继续其他评估' : analysisError || '可返回首页继续其他评估'}</p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => { setShowComplete(false); completeAssessment('sitstand', { completed: true, reportData: pythonResult }, { seatPressureHistory, footpadPressureHistory, pythonResult }); navigate('/dashboard'); }}
                className="zeiss-btn-secondary flex-1 py-3 text-sm">返回首页</button>
              {pythonResult && (
                <button onClick={viewReport} className="zeiss-btn-primary flex-1 py-3 text-sm">查看报告</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 主内容区：左侧面板 + 右侧3D场景 */}
      <main className="flex-1 flex min-h-0">
        {/* 左侧数据面板 */}
        <div className="assessment-side-panel">
          <LeftDataPanel
            seatStats={seatStats} footpadStats={footpadStats}
            seatCoP={seatCoP} footpadCoP={footpadCoP}
            seatHistory={seatPressureHistory} footpadHistory={footpadPressureHistory}
            isRecording={phase === 'recording'} timer={timer} fmtTime={fmtTime}
          />
        </div>

        {/* 右侧 3D 场景 */}
        <div className="flex-1 flex flex-col items-center justify-center relative">
          <div className="relative w-full h-full m-3 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
            <div ref={containerRef} className="w-full h-full" style={{ minHeight: 200 }} />

            {/* 浮动：场景控制面板 - 右上角 */}
            <div className="absolute top-3 right-3 w-[150px] z-10">
              <SceneControlPanel config={sceneConfig} onConfigChange={handleConfigChange} />
            </div>

            {/* 浮动：设备状态 - 左上角 */}
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium"
                style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', color: isGlobalConnected ? 'var(--success)' : 'var(--text-muted)' }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: isGlobalConnected ? 'var(--success)' : '#D1D9E0' }} />
                坐垫+脚垫 {isGlobalConnected ? '(已连接)' : '(未连接)'}
              </div>
            </div>

            {/* 浮动：操作按钮 - 底部居中 */}
            {phase !== 'processing' && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4">
                {phase === 'idle' && isGlobalConnected && (
                  <div className="flex flex-col items-center gap-1.5">
                    <button onClick={start} className="w-14 h-14 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform shadow-lg" style={{ borderColor: 'var(--border-medium)', background: 'rgba(255,255,255,0.9)' }}>
                      <div className="w-10 h-10 rounded-full" style={{ background: 'linear-gradient(135deg, #F8F9FA, #E8ECF0)' }} />
                    </button>
                    <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)' }}>开始采集</span>
                  </div>
                )}
                {phase === 'idle' && !isGlobalConnected && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-light)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                    <svg className="w-4 h-4" style={{ color: 'var(--text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>请先在首页连接设备</span>
                  </div>
                )}
                {phase === 'recording' && (
                  <div className="flex items-center gap-4 px-5 py-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-light)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                    <button onClick={stop} className="w-12 h-12 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: C.blue, background: 'rgba(0,102,204,0.05)' }}>
                      <div className="w-5 h-5 rounded-sm" style={{ background: C.blue }} />
                    </button>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>结束采集</span>
                      <span className="font-mono text-sm font-bold" style={{ color: C.blue }}>{fmtTime(timer)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {phase === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center zeiss-overlay rounded-xl">
                <div className="w-64 h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full progress-animate" style={{ background: 'linear-gradient(to right, var(--zeiss-blue), #0891B2)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {analyzing ? '正在分析采集数据，请稍候...' : '正在生成报告，请稍候...'}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      <div className="h-6 flex items-center px-6 shrink-0">
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>powered by 矩侨工业</span>
      </div>
    </div>
  );
}
