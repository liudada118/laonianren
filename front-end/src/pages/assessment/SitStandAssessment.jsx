import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import { usePressureScene } from '../../hooks/usePressureScene';
import EChart from '../../components/ui/EChart';
import SitStandReport from '../../components/report/SitStandReport';
import { generateSitStandReportData } from '../../lib/sitstandReportGenerator';
import { backendBridge } from '../../lib/BackendBridge';

/* ─── 图表样式常量 ─── */
const C = { text: '#6B7B8D', grid: '#EDF0F4', blue: '#0066CC', green: '#059669', red: '#DC2626', amber: '#D97706' };
const ttStyle = { backgroundColor: '#fff', borderColor: '#E5E9EF', textStyle: { color: '#1A2332', fontSize: 11 }, extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,0.08);border-radius:8px;' };

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
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>坐垫压力 (32×32)</h3>
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
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>脚垫压力 (64×64)</h3>
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


/* ═══════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════ */
export default function SitStandAssessment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, institution, completeAssessment, assessments, deviceConnStatus } = useAssessment();
  const isGlobalConnected = deviceConnStatus === 'connected';
  const viewReportMode = location.state?.viewReport && assessments.sitstand?.completed;

  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'idle');
  const [reportMode, setReportMode] = useState('static');
  const [showComplete, setShowComplete] = useState(false);
  const [sitstandReportData, setSitstandReportData] = useState(viewReportMode ? (assessments.sitstand?.report?.reportData || null) : null);
  const [csvExporting, setCsvExporting] = useState(false);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);

  const [seatPressureHistory, setSeatPressureHistory] = useState([]);
  const [footpadPressureHistory, setFootpadPressureHistory] = useState([]);
  const assessmentIdRef = useRef(null);

  const [sceneConfig, setSceneConfig] = useState({
    showHeatmap: true,
    depthScale: 0,
    smoothness: 0.5,
  });

  const {
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
    isBackendMode,
  } = usePressureScene({
    sceneConfig,
    isGlobalConnected,
    backendMode: 3, // 模式3：坐垫+脚垫
    onSeatData: useCallback((frame, stats) => {
      setSeatPressureHistory(prev => {
        const next = [...prev, stats.totalPressure];
        return next.length > 100 ? next.slice(-100) : next;
      });
    }, []),
    onFootpadData: useCallback((frame, stats) => {
      setFootpadPressureHistory(prev => {
        const next = [...prev, stats.totalPressure];
        return next.length > 100 ? next.slice(-100) : next;
      });
    }, []),
  });

  const deviceConnected = isSeatConnected || isFootpadConnected || isSimulating || isBackendMode;

  const handleConfigChange = useCallback((cfg) => {
    setSceneConfig(prev => { const n = { ...prev, ...cfg }; updateConfig(cfg); return n; });
  }, [updateConfig]);

  const handleConnectSeat = useCallback(async () => { await connectSeat(); }, [connectSeat]);
  const handleConnectFootpad = useCallback(async () => { await connectFootpad(); }, [connectFootpad]);
  const handleSimulate = useCallback(async () => { await startSimulation(); }, [startSimulation]);

  const start = async () => {
    if (!deviceConnected) return;
    setPhase('recording'); setTimer(0);
    setSeatPressureHistory([]); setFootpadPressureHistory([]);

    // 后端模式：开始数据采集
    if (isBackendMode) {
      const aid = `sitstand_${Date.now()}`;
      assessmentIdRef.current = aid;
      try {
        await backendBridge.startCol({
          assessmentId: aid,
          sampleType: '3',
          name: patientInfo?.name || 'test',
          date: new Date().toISOString().split('T')[0],
        });
        console.log('[SitStand] startCol 成功, assessmentId:', aid);
      } catch (e) {
        console.warn('[SitStand] startCol 失败:', e.message);
      }
    }

    timerRef.current = setInterval(() => setTimer(p => p + 1), 100);
  };

  /* ─── 导出CSV ─── */
  const handleExportCsv = async () => {
    setCsvExporting(true);
    try {
      const aid = assessmentIdRef.current;
      if (!aid) { alert('没有可导出的采集数据'); setCsvExporting(false); return; }
      const resp = await backendBridge.exportCsv({ assessmentId: aid, sampleType: '3' });
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

  const stop = async () => {
    clearInterval(timerRef.current);
    stopSimulation(); // 停止模拟数据更新
    setPhase('processing');

    // 后端模式：结束数据采集
    if (isBackendMode) {
      try {
        await backendBridge.endCol();
        console.log('[SitStand] endCol 成功');
      } catch (e) {
        console.warn('[SitStand] endCol 失败:', e.message);
      }
    }

    // 生成报告数据：优先调用后端Python算法接口，失败时回退到前端算法
    const generateReport = async () => {
      try {
        if (isBackendMode) {
          await new Promise(r => setTimeout(r, 500));
          const resp = await backendBridge.getSitStandReport({
            timestamp: Date.now(),
            assessmentId: assessmentIdRef.current,
            collectName: patientInfo?.name || 'test',
          });
          if (resp?.code === 0 && resp?.data?.render_data) {
            console.log('[SitStand] 后端报告数据已获取:', resp.data);
            setSitstandReportData(resp.data.render_data);
            setShowComplete(true);
            return;
          }
          console.warn('[SitStand] 后端报告接口返回异常，回退到前端算法:', resp?.msg);
        }
      } catch (e) {
        console.warn('[SitStand] 后端报告接口调用失败，回退到前端算法:', e.message);
      }
      // 前端算法 fallback
      try {
        const report = generateSitStandReportData(
          seatPressureHistory, footpadPressureHistory,
          seatStats, footpadStats, seatCoP, footpadCoP, timer
        );
        console.log('[SitStand] 前端报告数据已生成:', report);
        setSitstandReportData(report);
      } catch (e) {
        console.error('[SitStand] 报告生成失败:', e);
      }
      setShowComplete(true);
    };
    generateReport();
  };

  const viewReport = () => {
    stopSimulation(); // 停止模拟，释放3D场景资源
    setShowComplete(false); setPhase('report'); setReportMode('static');
    completeAssessment('sitstand', { completed: true, reportData: sitstandReportData }, { seatPressureHistory, footpadPressureHistory });
  };

  const fmtTime = (t) => {
    const s = Math.floor(t / 10);
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

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
              className="zeiss-btn-ghost text-xs flex items-center gap-1"
              style={csvExporting ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              {csvExporting ? '导出中...' : '保存CSV'}
            </button>
            <button onClick={() => navigate('/dashboard')} className="zeiss-btn-primary text-xs py-2 px-3 md:px-4">返回首页</button>
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
            <SitStandReport patientInfo={patientInfo} reportData={sitstandReportData} />
          )}
        </main>
      </div>
    );
  }

  /* ═══════════════════════════════════════════
     采集模式 — 统一布局：
     ┌──────────── header ────────────┐
     │  左侧数据面板  │  3D 场景     │
     │  (坐垫+脚垫    │  (占满右侧)  │
     │   曲线+指标     │  + 浮动控件  │
     │   +CoP图)       │              │
     └──────────────────────────────┘
     ═══════════════════════════════════════════ */
  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      {/* ── 顶部栏 ── */}
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
          {/* 传感器连接状态 */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
            <div className={`zeiss-status-dot ${isSeatConnected ? 'connected' : 'disconnected'}`} />
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>坐垫</span>
            <div className={`zeiss-status-dot ${isFootpadConnected ? 'connected' : 'disconnected'}`} style={{ marginLeft: 4 }} />
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>脚垫</span>

            {/* 连接/模拟按钮：只要还有未连接的设备且不在模拟中就显示 */}
            {!isSimulating && (!isSeatConnected || !isFootpadConnected) && (
              <>
                <span style={{ color: 'var(--border-medium)', margin: '0 2px' }}>|</span>
                {!isSeatConnected && (
                  <button onClick={handleConnectSeat} className="text-[10px] font-medium" style={{ color: 'var(--zeiss-blue)' }}>连接坐垫</button>
                )}
                {!isFootpadConnected && (
                  <button onClick={handleConnectFootpad} className="text-[10px] font-medium" style={{ color: 'var(--zeiss-blue)' }}>连接脚垫</button>
                )}
                {!isSeatConnected && !isFootpadConnected && (
                  <>
                    <span style={{ color: 'var(--border-medium)', margin: '0 2px' }}>|</span>
                    <button onClick={handleSimulate} className="text-[10px] font-medium" style={{ color: 'var(--success)' }}>模拟</button>
                  </>
                )}
              </>
            )}
            {isSimulating && (
              <>
                <span className="text-[10px] font-medium" style={{ color: 'var(--success)' }}>模拟中</span>
                <button onClick={stopSimulation} className="text-[10px] font-medium" style={{ color: 'var(--danger, #DC2626)' }}>停止</button>
              </>
            )}
          </div>
          <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {/* ── 完成弹窗 ── */}
      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 min-w-[340px] animate-slideUp">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--success-light)' }}>
              <svg className="w-7 h-7" fill="none" stroke="var(--success)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>采集完成，报告已生成</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>您可以查看报告或返回首页继续其他评估</p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => { setShowComplete(false); completeAssessment('sitstand', { completed: true, reportData: sitstandReportData }, { seatPressureHistory, footpadPressureHistory }); navigate('/dashboard'); }}
                className="zeiss-btn-secondary flex-1 py-3 text-sm">返回首页</button>
              <button onClick={viewReport} className="zeiss-btn-primary flex-1 py-3 text-sm">查看报告</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 主内容区：左侧面板 + 右侧3D场景 ── */}
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

            {/* 浮动：传感器信息 - 左上角 */}
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1">
              {[
                { label: '坐垫 32×32', connected: isSeatConnected },
                { label: '脚垫 64×64', connected: isFootpadConnected },
              ].map(({ label, connected }) => (
                <div key={label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', color: isBackendMode ? '#7C3AED' : connected ? 'var(--success)' : isSimulating ? 'var(--warning, #D97706)' : 'var(--text-muted)' }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: isBackendMode ? '#7C3AED' : connected ? 'var(--success)' : isSimulating ? 'var(--warning, #D97706)' : '#D1D9E0' }} />
                  {label} {isBackendMode ? '(后端)' : connected ? '(硬件)' : isSimulating ? '(模拟)' : '(未连接)'}
                </div>
              ))}
            </div>

            {/* 浮动：操作按钮 - 底部居中 */}
            {phase !== 'processing' && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4">
                {phase === 'idle' && deviceConnected && (
                  <div className="flex flex-col items-center gap-1.5">
                    <button onClick={start} className="w-14 h-14 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform shadow-lg" style={{ borderColor: 'var(--border-medium)', background: 'rgba(255,255,255,0.9)' }}>
                      <div className="w-10 h-10 rounded-full" style={{ background: 'linear-gradient(135deg, #F8F9FA, #E8ECF0)' }} />
                    </button>
                    <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)' }}>开始采集</span>
                  </div>
                )}
                {phase === 'idle' && !deviceConnected && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-light)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>请先连接传感器</span>
                    <button onClick={handleConnectSeat} className="zeiss-btn-secondary text-[11px] py-1.5 px-2.5">连接坐垫</button>
                    <button onClick={handleConnectFootpad} className="zeiss-btn-secondary text-[11px] py-1.5 px-2.5">连接脚垫</button>
                    <button onClick={handleSimulate} className="text-[11px] py-1.5 px-3 rounded-md font-medium" style={{ background: 'var(--success-light)', color: 'var(--success)', border: '1px solid var(--success)' }}>模拟</button>
                  </div>
                )}
                {phase === 'idle' && deviceConnected && !isSimulating && (!isSeatConnected || !isFootpadConnected) && (
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-light)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {isSeatConnected ? '坐垫已连接' : '脚垫已连接'}，还需连接{isSeatConnected ? '脚垫' : '坐垫'}
                    </span>
                    {!isSeatConnected && <button onClick={handleConnectSeat} className="zeiss-btn-secondary text-[11px] py-1.5 px-2.5">连接坐垫</button>}
                    {!isFootpadConnected && <button onClick={handleConnectFootpad} className="zeiss-btn-secondary text-[11px] py-1.5 px-2.5">连接脚垫</button>}
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

            {/* 处理中遮罩 */}
            {phase === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center zeiss-overlay rounded-xl">
                <div className="w-64 h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full progress-animate" style={{ background: 'linear-gradient(to right, var(--zeiss-blue), #0891B2)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>正在生成报告，请稍候...</p>
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
