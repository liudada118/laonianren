import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import { usePressureScene } from '../../hooks/usePressureScene';
import EChart from '../../components/ui/EChart';
import { generateSitStandReportData } from '../../lib/sitstandReportGenerator';

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

/* ─── 起坐报告组件（真实数据版） ─── */
function SitStandReport({ patientInfo, reportData: propsReportData }) {
  const sections = [
    { id: 'overview', title: '基本信息' },
    { id: 'summary', title: '总体指标' },
    { id: 'stand-evo', title: '站立压力演变' },
    { id: 'stand-cop', title: '站立COP轨迹' },
    { id: 'sit-evo', title: '坐姿压力演变' },
    { id: 'sit-cop', title: '坐姿COP轨迹' },
    { id: 'force-curve', title: '力-时间曲线' },
    { id: 'conclusion', title: '综合评估' },
  ];
  const [activeSection, setActiveSection] = useState('overview');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(!propsReportData);

  // 优先使用 props 传入的报告数据（采集数据生成），否则从 JSON 文件加载
  useEffect(() => {
    if (propsReportData) {
      setReportData(propsReportData);
      setLoading(false);
      return;
    }
    fetch('/sitstand_report_data/sitstand_report.json')
      .then(r => r.json())
      .then(data => { setReportData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [propsReportData]);

  const scrollToSection = (id) => {
    document.getElementById(`sit-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  const BASE = '/sitstand_report_data/';
  const d = reportData;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--zeiss-blue)', borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载报告数据...</p>
      </div>
    </div>
  );

  if (!d) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>报告数据加载失败</p>
    </div>
  );

  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 p-4 sticky top-0" style={{ borderRight: '1px solid var(--border-light)' }}>
        <h3 className="text-xs font-semibold mb-4 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>报告目录</h3>
        {sections.map(s => (
          <button key={s.id} onClick={() => scrollToSection(s.id)}
            className={`zeiss-nav-item mb-1 ${activeSection === s.id ? 'active' : ''}`}>
            {s.title}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* ── 基本信息 ── */}
        <section id="sit-overview">
          <div className="zeiss-section-title">基本信息</div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { l: '姓名', v: patientInfo?.name || '---' },
              { l: '测试类型', v: '五次起坐测试' },
              { l: '测试时间', v: d.test_date || new Date().toLocaleString() },
              { l: '完成周期', v: `${d.duration_stats?.num_cycles || 5}次` },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-4">
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 总体指标 ── */}
        <section id="sit-summary">
          <div className="zeiss-section-title">总体指标</div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { l: '总时长', v: `${d.duration_stats?.total_duration?.toFixed(1) || '--'}s`, c: C.blue },
              { l: '起坐周期数', v: `${d.duration_stats?.num_cycles || '--'}次`, c: C.green },
              { l: '平均周期时长', v: `${d.duration_stats?.avg_duration?.toFixed(2) || '--'}s`, c: '#0891B2' },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-5 text-center">
                <div className="text-3xl font-bold" style={{ color: item.c }}>{item.v}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 站立足底压力演变 ── */}
        <section id="sit-stand-evo">
          <div className="zeiss-section-title">站立足底压力演变</div>
          <div className="zeiss-card p-4">
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>站立过程中左右脚足底压力分布随时间的变化（0%~100%）</p>
            {/* 标签行 */}
            <div className="flex gap-1 mb-1 pl-12">
              {(d.stand_evolution?.labels || []).map((label, i) => (
                <div key={i} className="flex-1 text-center text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
              ))}
            </div>
            {/* 左脚行 */}
            <div className="flex items-center gap-1 mb-1">
              <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: 'var(--zeiss-blue)' }}>左脚</div>
              <div className="flex gap-1 flex-1">
                {(d.stand_evolution?.heatmaps || []).filter(h => h.foot === 'left').sort((a, b) => a.col - b.col).map((h, i) => (
                  <div key={i} className="flex-1">
                    <img src={`${BASE}${h.file}`} alt={`左脚 ${d.stand_evolution.labels[h.col]}`}
                      className="w-full rounded" style={{ background: '#f8f9fa' }} />
                  </div>
                ))}
              </div>
            </div>
            {/* 右脚行 */}
            <div className="flex items-center gap-1">
              <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: 'var(--success)' }}>右脚</div>
              <div className="flex gap-1 flex-1">
                {(d.stand_evolution?.heatmaps || []).filter(h => h.foot === 'right').sort((a, b) => a.col - b.col).map((h, i) => (
                  <div key={i} className="flex-1">
                    <img src={`${BASE}${h.file}`} alt={`右脚 ${d.stand_evolution.labels[h.col]}`}
                      className="w-full rounded" style={{ background: '#f8f9fa' }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 站立COP轨迹 ── */}
        <section id="sit-stand-cop">
          <div className="zeiss-section-title">站立COP轨迹</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="zeiss-card p-4 text-center">
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>左脚 COP 轨迹</div>
              <img src={`${BASE}${d.stand_cop?.left_image}`} alt="左脚COP" className="mx-auto rounded-lg" style={{ maxHeight: 360, objectFit: 'contain' }} />
            </div>
            <div className="zeiss-card p-4 text-center">
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>右脚 COP 轨迹</div>
              <img src={`${BASE}${d.stand_cop?.right_image}`} alt="右脚COP" className="mx-auto rounded-lg" style={{ maxHeight: 360, objectFit: 'contain' }} />
            </div>
          </div>
        </section>

        {/* ── 坐姿压力演变 ── */}
        <section id="sit-sit-evo">
          <div className="zeiss-section-title">坐姿压力演变</div>
          <div className="zeiss-card p-4">
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>坐姿过程中坐垫压力分布随时间的变化（Start~End）</p>
            <div className="flex gap-1 mb-1">
              {(d.sit_evolution?.labels || []).map((label, i) => (
                <div key={i} className="flex-1 text-center text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
              ))}
            </div>
            <div className="flex gap-1">
              {(d.sit_evolution?.heatmaps || []).sort((a, b) => a.col - b.col).map((h, i) => (
                <div key={i} className="flex-1">
                  <img src={`${BASE}${h.file}`} alt={`坐姿 ${d.sit_evolution.labels[h.col]}`}
                    className="w-full rounded" style={{ background: '#f8f9fa' }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 坐姿COP轨迹 ── */}
        <section id="sit-sit-cop">
          <div className="zeiss-section-title">坐姿COP轨迹</div>
          <div className="zeiss-card p-4 text-center">
            <img src={`${BASE}${d.sit_cop?.image}`} alt="坐姿COP" className="mx-auto rounded-lg" style={{ maxHeight: 400, objectFit: 'contain' }} />
          </div>
        </section>

        {/* ── 力-时间曲线 ── */}
        <section id="sit-force-curve">
          <div className="zeiss-section-title">力-时间曲线</div>
          <div className="grid grid-cols-1 gap-4">
            <div className="zeiss-card p-4">
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>站立脚垫 - 总力随时间变化</div>
              <img src={`${BASE}${d.force_curves?.stand_curve}`} alt="站立力曲线" className="w-full rounded-lg" />
            </div>
            <div className="zeiss-card p-4">
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>坐姿坐垫 - 总力随时间变化</div>
              <img src={`${BASE}${d.force_curves?.sit_curve}`} alt="坐姿力曲线" className="w-full rounded-lg" />
            </div>
          </div>
        </section>

        {/* ── 综合评估 ── */}
        <section id="sit-conclusion">
          <div className="zeiss-section-title">综合评估</div>
          <div className="zeiss-card-inner p-5">
            <h5 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>评估结论</h5>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              受试者完成五次起坐测试，总时长 {d.duration_stats?.total_duration?.toFixed(1) || '--'} 秒，
              共 {d.duration_stats?.num_cycles || '--'} 个完整周期，
              平均周期时长 {d.duration_stats?.avg_duration?.toFixed(2) || '--'} 秒。
              站立过程中足底压力分布显示左右脚受力基本对称，COP轨迹集中在足部中心区域，表明站立稳定性良好。
              坐姿压力分布均匀，重心控制稳定。根据国际肌少症工作组(EWGSOP2)标准，
              五次起坐测试时间{(d.duration_stats?.total_duration || 0) < 15 ? '小于' : '大于'}15秒，
              {(d.duration_stats?.total_duration || 0) < 15 ? '该受试者下肢肌力正常' : '建议进一步评估下肢肌力'}。
            </p>
          </div>
        </section>
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
  const { patientInfo, institution, completeAssessment, assessments } = useAssessment();
  const viewReportMode = location.state?.viewReport && assessments.sitstand?.completed;

  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'idle');
  const [reportMode, setReportMode] = useState('static');
  const [showComplete, setShowComplete] = useState(false);
  const [sitstandReportData, setSitstandReportData] = useState(null);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);

  const [seatPressureHistory, setSeatPressureHistory] = useState([]);
  const [footpadPressureHistory, setFootpadPressureHistory] = useState([]);

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
  } = usePressureScene({
    sceneConfig,
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

  const deviceConnected = isSeatConnected || isFootpadConnected || isSimulating;

  const handleConfigChange = useCallback((cfg) => {
    setSceneConfig(prev => { const n = { ...prev, ...cfg }; updateConfig(cfg); return n; });
  }, [updateConfig]);

  const handleConnectSeat = useCallback(async () => { await connectSeat(); }, [connectSeat]);
  const handleConnectFootpad = useCallback(async () => { await connectFootpad(); }, [connectFootpad]);
  const handleSimulate = useCallback(async () => { await startSimulation(); }, [startSimulation]);

  const start = () => {
    if (!deviceConnected) return;
    setPhase('recording'); setTimer(0);
    setSeatPressureHistory([]); setFootpadPressureHistory([]);
    timerRef.current = setInterval(() => setTimer(p => p + 1), 100);
  };

  const stop = () => {
    clearInterval(timerRef.current);
    stopSimulation(); // 停止模拟数据更新
    setPhase('processing');
    // 生成报告数据
    setTimeout(() => {
      try {
        const report = generateSitStandReportData(
          seatPressureHistory, footpadPressureHistory,
          seatStats, footpadStats, seatCoP, footpadCoP, timer
        );
        console.log('[SitStand] 报告数据已生成:', report);
        setSitstandReportData(report);
      } catch (e) {
        console.error('[SitStand] 报告生成失败:', e);
      }
      setShowComplete(true);
    }, 2000);
  };

  const viewReport = () => {
    stopSimulation(); // 停止模拟，释放3D场景资源
    setShowComplete(false); setPhase('report'); setReportMode('static');
    completeAssessment('sitstand', { completed: true }, { seatPressureHistory, footpadPressureHistory });
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
              <button onClick={() => { setShowComplete(false); completeAssessment('sitstand', { completed: true }, { seatPressureHistory, footpadPressureHistory }); navigate('/dashboard'); }}
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
                  style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', color: connected ? 'var(--success)' : isSimulating ? 'var(--warning, #D97706)' : 'var(--text-muted)' }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? 'var(--success)' : isSimulating ? 'var(--warning, #D97706)' : '#D1D9E0' }} />
                  {label} {connected ? '(硬件)' : isSimulating ? '(模拟)' : '(未连接)'}
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
