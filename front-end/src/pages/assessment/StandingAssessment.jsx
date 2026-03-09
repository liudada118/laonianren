import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import StandingReport from '../../components/report/StandingReport';
import EChart from '../../components/ui/EChart';
import InsoleScene from '../../components/three/InsoleScene';
import {
  splitLeftRight, calculateCOP, calculateTotalPressure, calculateContactArea,
  getValidCoords, divideXRegions, calculateRegionPressure, parseFrameData
} from '../../lib/FootAnalysis';
import { backendBridge } from '../../lib/BackendBridge';

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

/* ===============================================
   主组件 — 纯 BackendBridge 模式
   =============================================== */
export default function StandingAssessment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, completeAssessment, assessments, deviceConnStatus } = useAssessment();
  const isGlobalConnected = deviceConnStatus === 'connected';
  const viewReportMode = location.state?.viewReport && assessments.standing?.completed;

  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'idle');
  const assessmentIdRef = useRef(`standing_${Date.now()}`);
  const [csvExporting, setCsvExporting] = useState(false);
  const [reportMode, setReportMode] = useState('static');
  const [timer, setTimer] = useState(0);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const timerRef = useRef(null);

  // 3D 场景参数
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [depthScale, setDepthScale] = useState(0);
  const [smoothness, setSmoothness] = useState(0.8);
  const [filterThreshold, setFilterThreshold] = useState(0);

  // 实时数据
  const insoleDataRef = useRef(null);
  const [copTrajectory, setCopTrajectory] = useState([]);
  const [leftPressure, setLeftPressure] = useState({ forefoot: 0, midfoot: 0, hindfoot: 0 });
  const [rightPressure, setRightPressure] = useState({ forefoot: 0, midfoot: 0, hindfoot: 0 });
  const [realtimeData, setRealtimeData] = useState({ leftTotal: 0, rightTotal: 0, leftArea: 0, rightArea: 0, balance: 50 });

  // 报告数据
  const [pythonResult, setPythonResult] = useState(
    viewReportMode ? (assessments.standing?.report?.reportData || assessments.standing?.data?.pythonResult || null) : null
  );
  const [pythonImages, setPythonImages] = useState(null);

  // ─── 噪音过滤（连通域分析） ───
  const denoiseMatrix = useCallback((matrix, threshold = 12, minArea = 15) => {
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (rows === 0 || cols === 0) return matrix;

    const cleaned = matrix.map(row => row.map(v => v < threshold ? 0 : v));

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

    for (const cells of regions) {
      if (cells.length < minArea) {
        for (const [r, c] of cells) cleaned[r][c] = 0;
      }
    }
    return cleaned;
  }, []);

  // ─── 处理传感器数据 ───
  const handleSensorData = useCallback((matrix) => {
    insoleDataRef.current = matrix;

    const { left: leftMatrix, right: rightMatrix } = splitLeftRight(matrix);
    const leftTotal = calculateTotalPressure(leftMatrix);
    const rightTotal = calculateTotalPressure(rightMatrix);
    const totalPressure = leftTotal + rightTotal;
    const leftArea = calculateContactArea(leftMatrix);
    const rightArea = calculateContactArea(rightMatrix);

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

    const cop = calculateCOP(matrix);
    if (cop) {
      setCopTrajectory(prev => {
        const next = [...prev, cop];
        return next.length > 500 ? next.slice(-500) : next;
      });
    }
  }, []);

  // ─── 后端数据监听 ───
  useEffect(() => {
    if (!isGlobalConnected) return;

    const handleFoot1Data = (arr) => {
      const matrix = parseFrameData(arr);
      const denoised = denoiseMatrix(matrix, 12, 15);
      handleSensorData(denoised);
    };

    backendBridge.on('foot1Data', handleFoot1Data);

    return () => {
      backendBridge.off('foot1Data', handleFoot1Data);
    };
  }, [isGlobalConnected, handleSensorData, denoiseMatrix]);

  // ─── CSV 导出 ───
  const handleExportCsv = async () => {
    setCsvExporting(true);
    try {
      const resp = await backendBridge.exportCsv({ assessmentId: assessmentIdRef.current, sampleType: 'standing' });
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

  const handleClose = () => navigate('/dashboard');
  const fmtTime = (t) => { const s = Math.floor(t / 10); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  /* ─── 开始采集 ─── */
  const startRecording = async () => {
    setPhase('recording');
    setTimer(0);
    setCopTrajectory([]);
    setAnalysisError('');

    try {
      await backendBridge.setActiveMode(4); // 4=静态站立评估（仅foot1）
      await backendBridge.startCol({
        name: patientInfo?.name || '未知',
        assessmentId: assessmentIdRef.current,
        date: new Date().toISOString().split('T')[0],
        colName: 'standing_assessment',
      });
    } catch (e) {
      console.error('后端采集启动失败:', e);
    }

    timerRef.current = setInterval(() => setTimer(p => p + 1), 100);
  };

  /* ─── 停止采集 ─── */
  const stopRecording = async () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    setPhase('processing');
    setAnalyzing(true);
    setAnalysisError('');

    try {
      await backendBridge.endCol();
      await new Promise(r => setTimeout(r, 500));
      const resp = await backendBridge.getStandingReport({
        timestamp: new Date().toISOString(),
        assessmentId: assessmentIdRef.current,
        fps: 20,
        threshold_ratio: 0.05,
      });
      if (resp?.data?.render_data) {
        setPythonResult(resp.data.render_data);
        setPythonImages(resp.data.render_data?.images || null);
        completeAssessment('standing', { completed: true, reportData: resp.data.render_data }, { pythonResult: resp.data.render_data });
      } else {
        throw new Error('后端未返回报告数据');
      }
    } catch (e) {
      console.error('报告生成失败:', e);
      setAnalysisError(e.message || '报告生成失败');
    } finally {
      setAnalyzing(false);
      setShowCompleteDialog(true);
    }
  };

  const viewReport = () => {
    setShowCompleteDialog(false);
    setPhase('report');
    setReportMode('static');
    completeAssessment('standing', { completed: true, reportData: pythonResult }, { pythonResult });
  };

  // 清理
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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
            <button onClick={handleExportCsv} disabled={csvExporting}
              className="zeiss-btn-secondary text-xs py-2 px-4">
              {csvExporting ? '导出中...' : '保存CSV'}
            </button>
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
            <StandingReport patientInfo={patientInfo} pythonResult={pythonResult} pythonImages={pythonImages} reportDataFromBackend={pythonResult} />
          )}
        </main>
      </div>
    );
  }

  /* ─── 采集模式 ─── */
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
          {/* 设备连接状态 */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
            <div className={`zeiss-status-dot ${isGlobalConnected ? 'connected' : 'disconnected'}`} />
            <span className="text-xs" style={{ color: isGlobalConnected ? 'var(--success)' : 'var(--text-muted)' }}>
              {isGlobalConnected ? '设备已连接' : '设备未连接'}
            </span>
          </div>
          <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {/* 完成弹窗 */}
      {showCompleteDialog && (
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
              <button onClick={() => { setShowCompleteDialog(false); completeAssessment('standing', { completed: true, reportData: pythonResult }, { pythonResult }); navigate('/dashboard'); }}
                className="zeiss-btn-secondary flex-1 py-3 text-sm">返回首页</button>
              {pythonResult && (
                <button onClick={viewReport} className="zeiss-btn-primary flex-1 py-3 text-sm">查看报告</button>
              )}
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

        {/* 右侧3D区域 */}
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

            {/* 浮动：设备状态 - 左上角 */}
            <div className="absolute top-3 left-3 z-10">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium"
                style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', color: isGlobalConnected ? 'var(--success)' : 'var(--text-muted)' }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: isGlobalConnected ? 'var(--success)' : '#D1D9E0' }} />
                脚垫 64x64 {isGlobalConnected ? '(已连接)' : '(未连接)'}
              </div>
            </div>

            {/* 处理中遮罩 */}
            {phase === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center zeiss-overlay rounded-xl">
                <div className="w-64 h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full progress-animate" style={{ background: 'linear-gradient(to right, var(--zeiss-blue), #0891B2)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {analyzing ? '正在分析足底压力数据，请稍候...' : '正在生成报告，请稍候...'}
                </p>
              </div>
            )}
          </div>

          {/* 底部操作按钮 */}
          {phase !== 'processing' && (
            <div className="absolute bottom-10 z-20 flex flex-col items-center gap-3">
              {phase === 'idle' && isGlobalConnected && (
                <>
                  <button onClick={startRecording} className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--border-medium)' }}>
                    <div className="w-11 h-11 rounded-full" style={{ background: 'linear-gradient(135deg, #F8F9FA, #E8ECF0)' }} />
                  </button>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>开始采集</span>
                </>
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
