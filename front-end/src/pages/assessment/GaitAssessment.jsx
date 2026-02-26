import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import EChart from '../../components/ui/EChart';
import FootpadSceneReact from '../../lib/footpad-sdk/components/FootpadSceneReact';
import { footpadServices, SENSOR_KEYS } from '../../lib/footpad-sdk/services/FootpadSerialService';
import { generateAnimatedWalkwayData } from '../../lib/footpad-sdk/utils/mockFootprintData';
import gaitDemoDataUrl from '../../assets/gait_demo_data.json?url';
import { generateGaitReportData } from '../../lib/gaitReportGenerator';

/* ─── 图表样式常量 ─── */
const C = { text: '#6B7B8D', grid: '#EDF0F4', blue: '#0066CC', green: '#059669', red: '#DC2626', amber: '#D97706', purple: '#7C3AED', cyan: '#0891B2' };
const tip = { backgroundColor: '#fff', borderColor: '#E5E9EF', textStyle: { color: '#1A2332', fontSize: 11 }, extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,0.08);border-radius:8px;' };

/* ─── 左侧统一数据面板 ─── */
function LeftDataPanel({ sensorStats, timer, fmtTime, isRecording, connectionState }) {
  /* 传感器压力曲线 */
  const sensorColors = ['#3b82f6', '#22c55e', '#a855f7', '#f97316'];
  const sensorLabels = ['传感器1', '传感器2', '传感器3', '传感器4'];

  const pressureLineOpt = useMemo(() => ({
    animation: false,
    grid: { top: 8, bottom: 16, left: 32, right: 8 },
    xAxis: { type: 'category', data: sensorStats.history.map((_, i) => i), show: false },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.text, fontSize: 9 } },
    series: [0, 1, 2, 3].map(idx => ({
      type: 'line', smooth: true, symbol: 'none',
      data: sensorStats.history.map(h => h[idx] || 0),
      lineStyle: { color: sensorColors[idx], width: 1.2 },
    })),
    tooltip: { trigger: 'axis', ...tip }
  }), [sensorStats.history]);

  const Metric = ({ label, value, color, unit }) => (
    <div className="zeiss-data-row">
      <span className="zeiss-data-label text-[11px]">{label}</span>
      <span className="zeiss-data-value text-xs font-semibold flex items-center gap-1" style={{ color }}>
        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />{value} {unit}
      </span>
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

      {/* 传感器连接状态 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.green }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>传感器状态</h3>
        </div>
        <div className="px-4 py-2.5 grid grid-cols-2 gap-2">
          {SENSOR_KEYS.map((key, idx) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: connectionState[key] ? '#22c55e' : '#d1d5db' }} />
              <span className="text-[10px]" style={{ color: connectionState[key] ? sensorColors[idx] : 'var(--text-muted)' }}>
                {sensorLabels[idx]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 实时压力曲线 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.blue }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>实时压力曲线</h3>
        </div>
        <div className="h-[110px] px-1"><EChart option={pressureLineOpt} height={110} /></div>
        <div className="px-4 py-2 flex gap-3 flex-wrap">
          {sensorLabels.map((label, idx) => (
            <span key={idx} className="flex items-center gap-1 text-[10px]" style={{ color: sensorColors[idx] }}>
              <span className="w-2 h-0.5 inline-block rounded" style={{ background: sensorColors[idx] }} />{label}
            </span>
          ))}
        </div>
      </div>

      {/* 各传感器实时数据 */}
      {[0, 1, 2, 3].map(idx => (
        <div key={idx} className="zeiss-card overflow-hidden">
          <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: sensorColors[idx] }} />
            <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>{sensorLabels[idx]}</h3>
          </div>
          <div className="px-4 py-2 space-y-1">
            <Metric label="总压力" value={sensorStats.totals[idx]} color={sensorColors[idx]} unit="" />
            <Metric label="最大值" value={sensorStats.maxVals[idx]} color={sensorColors[idx]} unit="" />
            <Metric label="有效点" value={sensorStats.activePoints[idx]} color={sensorColors[idx]} unit="" />
          </div>
        </div>
      ))}

      {/* 综合指标 */}
      <div className="zeiss-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: C.green }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>综合指标</h3>
        </div>
        <div className="px-4 py-3 space-y-1.5">
          <Metric label="步频" value={sensorStats.cadence} color={C.green} unit="steps/min" />
          <Metric label="步幅" value={sensorStats.stride} color={C.green} unit="cm" />
          <Metric label="速度" value={sensorStats.speed} color={C.cyan} unit="m/s" />
          <Metric label="对称性" value={sensorStats.symmetry} color={C.green} unit="" />
        </div>
      </div>
    </div>
  );
}

/* ─── 胶囊标签 ─── */
function CapsuleTag({ label, color = '#0066CC' }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: color + '12', color, border: `1px solid ${color}30` }}>
      {label}
    </span>
  );
}

/* ─── 步态报告组件（使用真实数据） ─── */
function GaitReportContent({ patientInfo, reportData: propsReportData }) {
  const [realData, setRealData] = useState(null);
  const [loading, setLoading] = useState(!propsReportData);

  // 优先使用 props 传入的报告数据（采集数据生成），否则从 JSON 文件加载
  useEffect(() => {
    if (propsReportData) {
      setRealData(propsReportData);
      setLoading(false);
      return;
    }
    fetch('/gait_report_data/report_data.json')
      .then(res => res.json())
      .then(data => { setRealData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [propsReportData]);

  const sections = [
    { id: 'spatiotemporal', title: '1. 步态时空参数' },
    { id: 'balance', title: '2. 足底平衡分析' },
    { id: 'evolution', title: '3. 足印与平均步态' },
    { id: 'heatmap', title: '4. 足印热力图' },
    { id: 'timeseries', title: '5. 时序曲线' },
    { id: 'partition', title: '6. 分区压力特征' },
    { id: 'regions', title: '7. 分区点位图' },
    { id: 'partcurves', title: '8. 分区曲线' },
    { id: 'support', title: '9. 单脚支撑相' },
    { id: 'cycle', title: '10. 步态周期' },
    { id: 'conclusion', title: '综合评估' },
  ];
  const [activeSection, setActiveSection] = useState('spatiotemporal');
  const scrollToSection = (id) => {
    document.getElementById(`gait-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  const gp = realData?.gaitParams || {};
  const gaitParams = [
    { name: '左脚同步平均步长时间', unit: 's', value: gp.leftStepTime || '—' },
    { name: '右脚同步平均步长时间', unit: 's', value: gp.rightStepTime || '—' },
    { name: '左右对侧脚步长时间', unit: 's', value: gp.crossStepTime || '—' },
    { name: '左脚同脚平均步长', unit: 'cm', value: gp.leftStepLength || '—' },
    { name: '右脚同脚平均步长', unit: 'cm', value: gp.rightStepLength || '—' },
    { name: '左右对侧脚平均步长', unit: 'cm', value: gp.crossStepLength || '—' },
    { name: '左右对侧脚平均宽度', unit: 'cm', value: gp.stepWidth || '—' },
    { name: '整体行走速度', unit: 'm/s', value: gp.walkingSpeed || '—' },
    { name: '左脚平均足偏角 (FPA)', unit: '°', value: gp.leftFPA || '—' },
    { name: '右脚平均足偏角 (FPA)', unit: '°', value: gp.rightFPA || '—' },
    { name: '双脚触地时间', unit: 's', value: gp.doubleContactTime || '—' },
  ];

  const bal = realData?.balance || {};
  const balanceData = ['整足平衡', '前足平衡', '足跟平衡'].map(type => ({
    type,
    lPeak: bal.left?.[type]?.['峰值'] ?? '—',
    lMean: bal.left?.[type]?.['均值'] ?? '—',
    lStd: bal.left?.[type]?.['标准差'] ?? '—',
    rPeak: bal.right?.[type]?.['峰值'] ?? '—',
    rMean: bal.right?.[type]?.['均值'] ?? '—',
    rStd: bal.right?.[type]?.['标准差'] ?? '—',
  }));

  const leftSteps = realData?.fpaPerStep?.left || [];
  const rightSteps = realData?.fpaPerStep?.right || [];
  const ts = realData?.timeSeries || {};
  const leftTime = ts.left?.time || [];
  const rightTime = ts.right?.time || [];

  const leftPartitions = (realData?.partitionFeatures?.left || []).map((p, i) => ({
    zone: i + 1, peakForce: p['压力峰值'], impulse: p['冲量'], loadRate: p['负载率'],
    peakTimePct: p['峰值时间_百分比'], contactTimePct: p['接触时间_百分比'],
  }));
  const rightPartitions = (realData?.partitionFeatures?.right || []).map((p, i) => ({
    zone: i + 1, peakForce: p['压力峰值'], impulse: p['冲量'], loadRate: p['负载率'],
    peakTimePct: p['峰值时间_百分比'], contactTimePct: p['接触时间_百分比'],
  }));

  const leftPartCurves = realData?.partitionCurves?.left || [];
  const rightPartCurves = realData?.partitionCurves?.right || [];

  const spLeft = realData?.supportPhases?.left || {};
  const spRight = realData?.supportPhases?.right || {};
  const supportPhases = [
    { name: '支撑前期', range: '0-10%' },
    { name: '支撑初期', range: '11-40%' },
    { name: '支撑中期', range: '41-80%' },
    { name: '支撑末期', range: '81-100%' },
  ].map(p => ({
    ...p,
    left: { duration: spLeft[p.name]?.['时长ms'] ?? '—', copSpeed: spLeft[p.name]?.['平均COP速度(mm/s)'] ?? '—', maxArea: spLeft[p.name]?.['最大面积cm2'] ?? '—', maxLoad: spLeft[p.name]?.['最大负荷'] ?? '—' },
    right: { duration: spRight[p.name]?.['时长ms'] ?? '—', copSpeed: spRight[p.name]?.['平均COP速度(mm/s)'] ?? '—', maxArea: spRight[p.name]?.['最大面积cm2'] ?? '—', maxLoad: spRight[p.name]?.['最大负荷'] ?? '—' },
  }));

  const cpLeft = realData?.cyclePhases?.left || {};
  const cpRight = realData?.cyclePhases?.right || {};
  const cycleNames = ['双脚加载期', '左脚单支撑期', '双脚摇摆期', '右脚单支撑期'];
  const cyclePhases = cycleNames.map(name => ({
    name,
    left: { duration: cpLeft[name]?.['时长ms'] ?? '—', copSpeed: cpLeft[name]?.['平均COP速度(mm/s)'] ?? '—', maxArea: cpLeft[name]?.['最大面积cm2'] ?? '—', maxLoad: cpLeft[name]?.['最大负荷'] ?? '—' },
    right: { duration: cpRight[name]?.['时长ms'] ?? '—', copSpeed: cpRight[name]?.['平均COP速度(mm/s)'] ?? '—', maxArea: cpRight[name]?.['最大面积cm2'] ?? '—', maxLoad: cpRight[name]?.['最大负荷'] ?? '—' },
  }));

  const images = realData?.images || {};

  /* EChart options */
  const fpaOption = useMemo(() => ({
    animation: false,
    grid: { top: 30, bottom: 30, left: 50, right: 20 },
    legend: { top: 0, textStyle: { fontSize: 10, color: C.text } },
    xAxis: { type: 'category', name: '步序', data: Array.from({ length: Math.max(leftSteps.length, rightSteps.length) }, (_, i) => i + 1), axisLabel: { fontSize: 10, color: C.text } },
    yAxis: { type: 'value', name: 'FPA (°)', axisLabel: { fontSize: 10, color: C.text }, splitLine: { lineStyle: { color: C.grid } } },
    series: [
      { name: '左脚', type: 'bar', data: leftSteps, itemStyle: { color: C.blue } },
      { name: '右脚', type: 'bar', data: rightSteps, itemStyle: { color: C.amber } },
    ],
    tooltip: { trigger: 'axis', ...tip },
  }), [leftSteps, rightSteps]);

  const makeTimeOpt = (field, label) => ({
    animation: false,
    grid: { top: 20, bottom: 30, left: 50, right: 20 },
    legend: { top: 0, textStyle: { fontSize: 10, color: C.text } },
    xAxis: { type: 'category', data: leftTime.length > 0 ? leftTime : rightTime, axisLabel: { fontSize: 9, color: C.text, rotate: 30 }, show: leftTime.length > 0 },
    yAxis: { type: 'value', name: label, axisLabel: { fontSize: 10, color: C.text }, splitLine: { lineStyle: { color: C.grid } } },
    series: [
      { name: '左脚', type: 'line', smooth: true, symbol: 'none', data: ts.left?.[field] || [], lineStyle: { color: C.blue, width: 1.5 } },
      { name: '右脚', type: 'line', smooth: true, symbol: 'none', data: ts.right?.[field] || [], lineStyle: { color: C.amber, width: 1.5 } },
    ],
    tooltip: { trigger: 'axis', ...tip },
  });
  const areaOption = useMemo(() => makeTimeOpt('area', 'cm²'), [ts]);
  const forceOption = useMemo(() => makeTimeOpt('force', 'N'), [ts]);
  const copSpeedOption = useMemo(() => makeTimeOpt('copSpeed', 'mm/s'), [ts]);
  const pressureOption = useMemo(() => makeTimeOpt('pressure', 'N/cm²'), [ts]);

  const partColors = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c'];
  const makePartOpt = (curves) => ({
    animation: false,
    grid: { top: 30, bottom: 30, left: 50, right: 20 },
    legend: { top: 0, textStyle: { fontSize: 10, color: C.text } },
    xAxis: { type: 'category', data: curves[0]?.data?.map((_, i) => i) || [], show: false },
    yAxis: { type: 'value', name: 'N', axisLabel: { fontSize: 10, color: C.text }, splitLine: { lineStyle: { color: C.grid } } },
    series: curves.map((c, i) => ({
      name: `S${i + 1}`, type: 'line', smooth: true, symbol: 'none', data: c.data || [],
      lineStyle: { color: partColors[i % partColors.length], width: 1.5 },
    })),
    tooltip: { trigger: 'axis', ...tip },
  });
  const leftPartOpt = useMemo(() => makePartOpt(leftPartCurves), [leftPartCurves]);
  const rightPartOpt = useMemo(() => makePartOpt(rightPartCurves), [rightPartCurves]);

  const thStyle = 'px-3 py-2 text-left text-[11px] font-semibold';
  const tdStyle = 'px-3 py-2 text-[11px]';

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-sm" style={{ color: 'var(--text-muted)' }}>正在加载报告数据...</div></div>;
  }

  const walkSpeed = parseFloat(gp.walkingSpeed) || 0;
  const leftStepTime = parseFloat(gp.leftStepTime) || 0;
  const rightStepTime = parseFloat(gp.rightStepTime) || 0;
  const leftStepLen = parseFloat(gp.leftStepLength) || 0;
  const rightStepLen = parseFloat(gp.rightStepLength) || 0;

  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <nav className="w-48 shrink-0 p-3 overflow-y-auto hidden lg:block" style={{ borderRight: '1px solid var(--border-light)' }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => scrollToSection(s.id)}
            className={`w-full text-left px-3 py-2 text-xs rounded-lg mb-1 transition-colors ${activeSection === s.id ? 'font-semibold' : ''}`}
            style={{ background: activeSection === s.id ? 'var(--zeiss-blue-light)' : 'transparent', color: activeSection === s.id ? 'var(--zeiss-blue)' : 'var(--text-muted)' }}>
            {s.title}
          </button>
        ))}
      </nav>

      {/* 右侧报告内容 */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {/* 1. 步态时空参数 */}
        <section id="gait-spatiotemporal">
          <div className="zeiss-section-title">1. 步态时空参数</div>
          <div className="zeiss-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="zeiss-table-header">
                {['参数', '单位', '测量值'].map(h => <th key={h} className={thStyle} style={{ color: 'var(--text-tertiary)' }}>{h}</th>)}
              </tr></thead>
              <tbody>{gaitParams.map((r, i) => (
                <tr key={i} className="zeiss-table-row">
                  <td className={tdStyle} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.name}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-muted)' }}>{r.unit}</td>
                  <td className={tdStyle} style={{ color: 'var(--zeiss-blue)', fontWeight: 600 }}>{r.value}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        {/* 2. 足底平衡分析 */}
        <section id="gait-balance">
          <div className="zeiss-section-title">2. 足底平衡分析</div>
          <div className="zeiss-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="zeiss-table-header">
                <th className={thStyle} style={{ color: 'var(--text-tertiary)' }}>类型</th>
                <th className={thStyle} colSpan={3} style={{ color: C.blue, textAlign: 'center' }}>左脚</th>
                <th className={thStyle} colSpan={3} style={{ color: C.amber, textAlign: 'center' }}>右脚</th>
              </tr><tr className="zeiss-table-header">
                <th className={thStyle}></th>
                {['峰值', '均值', '标准差', '峰值', '均值', '标准差'].map((h, i) => <th key={i} className={thStyle} style={{ color: 'var(--text-muted)' }}>{h}</th>)}
              </tr></thead>
              <tbody>{balanceData.map((r, i) => (
                <tr key={i} className="zeiss-table-row">
                  <td className={tdStyle} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.type}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.lPeak}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.lMean}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.lStd}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.rPeak}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.rMean}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.rStd}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        {/* 3. 完整足印与平均步态 */}
        <section id="gait-evolution">
          <div className="zeiss-section-title">3. 完整足印与平均步态</div>
          <div className="zeiss-card p-4 mb-4">
            <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Foot Pressure Evolution (Start → End)</h4>
            <div className="overflow-x-auto">
              <img src={images.pressureEvolution || '/gait_report_data/pressure_evolution.png'} alt="Foot Pressure Evolution" className="w-full min-w-[700px]" style={{ imageRendering: 'auto' }} />
            </div>
          </div>
          <div className="zeiss-card p-4">
            <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Gait Average Summary (Smoothed)</h4>
            <div className="flex justify-center">
              <img src={images.gaitAverage || '/gait_report_data/gait_average.png'} alt="Gait Average Summary" className="max-w-full" style={{ maxHeight: '500px', imageRendering: 'auto' }} />
            </div>
          </div>
        </section>

        {/* 4. 足印热力图 */}
        <section id="gait-heatmap">
          <div className="zeiss-section-title">4. 足印热力图 (FPA Analysis)</div>
          <div className="zeiss-card p-4 flex justify-center">
            <img src={images.footprintHeatmap || '/gait_report_data/footprint_heatmap.png'} alt="Footprint Heatmap" className="max-w-full" style={{ maxHeight: '800px', imageRendering: 'auto' }} />
          </div>
        </section>

        {/* 5. 时序曲线 */}
        <section id="gait-timeseries">
          <div className="zeiss-section-title">5. 时序曲线</div>
          <div className="zeiss-card p-4 mb-4">
            <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>足偏角 (FPA) 分析</h4>
            <EChart option={fpaOption} height={220} />
          </div>
          {images.timeSeries ? (
            <div className="zeiss-card p-4 mb-4">
              <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>面积 / 负荷 / COP速度 / 压强 时序曲线</h4>
              <div className="overflow-x-auto">
                <img src={images.timeSeries} alt="Time Series Curves" className="w-full min-w-[600px]" style={{ imageRendering: 'auto' }} />
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>面积 (cm²)</h4><EChart option={areaOption} height={200} /></div>
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>负荷 (N)</h4><EChart option={forceOption} height={200} /></div>
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>COP速度 (mm/s)</h4><EChart option={copSpeedOption} height={200} /></div>
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>压强 (N/cm²)</h4><EChart option={pressureOption} height={200} /></div>
          </div>
        </section>

        {/* 6. 分区压力特征 */}
        <section id="gait-partition">
          <div className="zeiss-section-title">6. 分区压力特征</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[{ data: leftPartitions, label: '左足特征', color: C.blue }, { data: rightPartitions, label: '右足特征', color: C.amber }].map(({ data: partData, label, color }) => (
              <div key={label}>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} /> {label}
                </h4>
                <div className="zeiss-card overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="zeiss-table-header">
                      {['分区', '压力峰值(N)', '冲量(N·s)', '负载率(N/s)', '峰值时间(%)', '接触时间(%)'].map(h => <th key={h} className={thStyle} style={{ color: 'var(--text-tertiary)' }}>{h}</th>)}
                    </tr></thead>
                    <tbody>{partData.map((r, i) => (
                      <tr key={i} className="zeiss-table-row">
                        <td className={tdStyle} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>S{r.zone}</td>
                        <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.peakForce}</td>
                        <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.impulse}</td>
                        <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.loadRate}</td>
                        <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.peakTimePct}%</td>
                        <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.contactTimePct}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 7. 分区点位图 */}
        <section id="gait-regions">
          <div className="zeiss-section-title">7. 分区点位图 (Pressure Regions S1-S6)</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="zeiss-card p-4">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: C.blue }}>
                <span className="w-2 h-2 rounded-full" style={{ background: C.blue }} /> 左足分区点
              </h4>
              <img src={images.leftPressureRegions || '/gait_report_data/left_pressure_regions.png'} alt="Left Pressure Regions" className="w-full" />
            </div>
            <div className="zeiss-card p-4">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: C.amber }}>
                <span className="w-2 h-2 rounded-full" style={{ background: C.amber }} /> 右足分区点
              </h4>
              <img src={images.rightPressureRegions || '/gait_report_data/right_pressure_regions.png'} alt="Right Pressure Regions" className="w-full" />
            </div>
          </div>
        </section>

        {/* 8. 分区曲线 */}
        <section id="gait-partcurves">
          <div className="zeiss-section-title">8. 分区曲线</div>
          {(images.leftPartitionCurves || images.rightPartitionCurves) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {images.leftPartitionCurves && <div className="zeiss-card p-4"><img src={images.leftPartitionCurves} alt="Left Partition Curves" className="w-full" /></div>}
              {images.rightPartitionCurves && <div className="zeiss-card p-4"><img src={images.rightPartitionCurves} alt="Right Partition Curves" className="w-full" /></div>}
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: C.blue }}>左足分区曲线</h4><EChart option={leftPartOpt} height={200} /></div>
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: C.amber }}>右足分区曲线</h4><EChart option={rightPartOpt} height={200} /></div>
          </div>
        </section>

        {/* 9. 单脚支撑相 */}
        <section id="gait-support">
          <div className="zeiss-section-title">9. 单脚支撑相</div>
          <div className="zeiss-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="zeiss-table-header">
                <th className={thStyle} style={{ color: 'var(--text-tertiary)' }}>阶段</th>
                <th className={thStyle} style={{ color: 'var(--text-tertiary)' }}>范围</th>
                <th className={thStyle} colSpan={4} style={{ color: C.blue, textAlign: 'center' }}>左脚</th>
                <th className={thStyle} colSpan={4} style={{ color: C.amber, textAlign: 'center' }}>右脚</th>
              </tr><tr className="zeiss-table-header">
                <th className={thStyle}></th><th className={thStyle}></th>
                {['时长ms', 'COP速度', '最大面积', '最大负荷', '时长ms', 'COP速度', '最大面积', '最大负荷'].map((h, i) => <th key={i} className={thStyle} style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{h}</th>)}
              </tr></thead>
              <tbody>{supportPhases.map((r, i) => (
                <tr key={i} className="zeiss-table-row">
                  <td className={tdStyle} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.name}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-muted)' }}>{r.range}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.duration}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.copSpeed}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.maxArea}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.maxLoad}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.duration}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.copSpeed}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.maxArea}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.maxLoad}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        {/* 10. 步态周期 */}
        <section id="gait-cycle">
          <div className="zeiss-section-title">10. 步态周期</div>
          <div className="zeiss-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="zeiss-table-header">
                <th className={thStyle} style={{ color: 'var(--text-tertiary)' }}>阶段</th>
                <th className={thStyle} colSpan={4} style={{ color: C.blue, textAlign: 'center' }}>左脚</th>
                <th className={thStyle} colSpan={4} style={{ color: C.amber, textAlign: 'center' }}>右脚</th>
              </tr><tr className="zeiss-table-header">
                <th className={thStyle}></th>
                {['时长ms', 'COP速度', '最大面积', '最大负荷', '时长ms', 'COP速度', '最大面积', '最大负荷'].map((h, i) => <th key={i} className={thStyle} style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{h}</th>)}
              </tr></thead>
              <tbody>{cyclePhases.map((r, i) => (
                <tr key={i} className="zeiss-table-row">
                  <td className={tdStyle} style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.name}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.duration}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.copSpeed}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.maxArea}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.left.maxLoad}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.duration}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.copSpeed}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.maxArea}</td>
                  <td className={tdStyle} style={{ color: 'var(--text-secondary)' }}>{r.right.maxLoad}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        {/* 综合评估 */}
        <section id="gait-conclusion">
          <div className="zeiss-section-title">综合评估</div>
          <div className="zeiss-card-inner p-5 mt-3">
            <h5 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>发现的问题</h5>
            <div className="space-y-2">
              {[
                walkSpeed < 0.8 && { text: `行走速度 ${gp.walkingSpeed} m/s 低于正常参考值 (≥0.8 m/s)`, level: 'warning' },
                Math.abs(leftStepTime - rightStepTime) > 0.15 && { text: `左右脚步长时间不对称 (差异 ${Math.abs(leftStepTime - rightStepTime).toFixed(3)}s)`, level: 'info' },
                Math.abs(leftStepLen - rightStepLen) > 5 && { text: `左右脚步长差异 ${Math.abs(leftStepLen - rightStepLen).toFixed(1)} cm`, level: 'info' },
                leftSteps.some(a => Math.abs(a) > 25) && { text: '部分左脚步FPA角度偏大（>25°），可能存在异常步态', level: 'warning' },
                rightSteps.some(a => Math.abs(a) > 25) && { text: '部分右脚步FPA角度偏大（>25°），可能存在异常步态', level: 'warning' },
              ].filter(Boolean).map((issue, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg text-xs"
                  style={{ background: issue.level === 'warning' ? '#FEF3C7' : '#EFF6FF', color: issue.level === 'warning' ? '#92400E' : '#1E40AF' }}>
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {issue.level === 'warning'
                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    }
                  </svg>
                  <span>{issue.text}</span>
                </div>
              ))}
              {walkSpeed >= 0.8 && Math.abs(leftStepTime - rightStepTime) <= 0.15 && !leftSteps.some(a => Math.abs(a) > 25) && !rightSteps.some(a => Math.abs(a) > 25) && (
                <div className="flex items-center gap-2 p-2 rounded-lg text-xs" style={{ background: '#ECFDF5', color: '#065F46' }}>
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>各项步态指标均在正常范围内</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─── 主组件 ─── */
export default function GaitAssessment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, institution, completeAssessment, assessments } = useAssessment();
  const viewReportMode = location.state?.viewReport && assessments.gait?.completed;

  const [deviceStatus, setDeviceStatus] = useState('disconnected');
  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'idle');
  const [reportMode, setReportMode] = useState('static');
  const [showComplete, setShowComplete] = useState(false);
  const [gaitReportData, setGaitReportData] = useState(null);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);

  /* 3D场景相关 */
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [depthScale, setDepthScale] = useState(0);
  const [smoothness, setSmoothness] = useState(0.5);
  const [sensorData, setSensorData] = useState({});
  const [connectionState, setConnectionState] = useState({});
  const sceneRef = useRef(null);

  /* 模拟数据相关 */
  const simRef = useRef(null);
  const simFrameRef = useRef(0);
  const demoDataRef = useRef(null);

  /* 实时统计 */
  const [sensorStats, setSensorStats] = useState({
    totals: [0, 0, 0, 0],
    maxVals: [0, 0, 0, 0],
    activePoints: [0, 0, 0, 0],
    history: [],
    cadence: '—', stride: '—', speed: '—', symmetry: '—',
  });

  /* 计算传感器统计数据 */
  const computeStats = useCallback((data) => {
    const totals = [];
    const maxVals = [];
    const activePoints = [];
    SENSOR_KEYS.forEach((key) => {
      const matrix = data[key];
      if (!matrix || matrix.length === 0) {
        totals.push(0); maxVals.push(0); activePoints.push(0);
        return;
      }
      let total = 0, maxVal = 0, active = 0;
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          const v = matrix[r][c];
          total += v;
          if (v > maxVal) maxVal = v;
          if (v > 5) active++;
        }
      }
      totals.push(total);
      maxVals.push(maxVal);
      activePoints.push(active);
    });

    setSensorStats(prev => {
      const newHistory = [...prev.history, totals].slice(-60);
      return {
        totals,
        maxVals,
        activePoints,
        history: newHistory,
        cadence: '110',
        stride: '65.5',
        speed: '1.10',
        symmetry: '0.95',
      };
    });
  }, []);

  /* 设置串口数据回调 */
  useEffect(() => {
    SENSOR_KEYS.forEach((key) => {
      footpadServices[key].setOnData((matrix) => {
        setSensorData(prev => {
          const newData = { ...prev, [key]: matrix };
          computeStats(newData);
          return newData;
        });
      });
      footpadServices[key].setOnConnectionChange((connected) => {
        setConnectionState(prev => ({ ...prev, [key]: connected }));
        if (connected) setDeviceStatus('connected');
      });
    });
    return () => {
      SENSOR_KEYS.forEach(key => {
        footpadServices[key].setOnData(null);
        footpadServices[key].setOnConnectionChange(null);
      });
    };
  }, [computeStats]);

  /* 连接串口 */
  const handleConnect = useCallback(async (key) => {
    if (key) {
      // 连接单个传感器
      const success = await footpadServices[key].connect();
      if (success) setDeviceStatus('connected');
    } else {
      // 依次连接所有传感器
      setDeviceStatus('connecting');
      for (const k of SENSOR_KEYS) {
        try { await footpadServices[k].connect(); } catch (e) { console.warn(`Failed to connect ${k}:`, e); }
      }
      setDeviceStatus('connected');
    }
  }, []);

  /* 断开串口 */
  const handleDisconnect = useCallback(async () => {
    for (const key of SENSOR_KEYS) {
      try { await footpadServices[key].disconnect(); } catch (e) {}
    }
    setDeviceStatus('disconnected');
    setConnectionState({});
  }, []);

  /* 噪音过滤：去除低压力孤立点 + 连通域过滤小区域 */
  const denoiseMatrix = useCallback((matrix, threshold = 10, minRegionSize = 15) => {
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (rows === 0 || cols === 0) return matrix;
    const result = matrix.map(row => [...row]);
    
    // 第一步：低于阈值的点直接置零
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (result[r][c] < threshold) result[r][c] = 0;
      }
    }
    
    // 第二步：连通域分析，去除面积太小的区域
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const regions = [];
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (visited[r][c] || result[r][c] <= 0) continue;
        // BFS 找连通域
        const region = [];
        const queue = [[r, c]];
        visited[r][c] = true;
        while (queue.length > 0) {
          const [cr, cc] = queue.shift();
          region.push([cr, cc]);
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = cr + dr, nc = cc + dc;
              if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && result[nr][nc] > 0) {
                visited[nr][nc] = true;
                queue.push([nr, nc]);
              }
            }
          }
        }
        regions.push(region);
      }
    }
    
    // 去除面积小于 minRegionSize 的连通域
    for (const region of regions) {
      if (region.length < minRegionSize) {
        for (const [r, c] of region) {
          result[r][c] = 0;
        }
      }
    }
    
    return result;
  }, []);

  /* 模拟数据 - 使用真实CSV数据回放 */
  const handleSimulate = useCallback(async () => {
    setDeviceStatus('connecting');

    // 加载真实步态数据
    if (!demoDataRef.current) {
      try {
        const res = await fetch(gaitDemoDataUrl);
        demoDataRef.current = await res.json();
      } catch (e) {
        console.warn('Failed to load demo data, using mock data');
        demoDataRef.current = null;
      }
    }

    setDeviceStatus('connected');
    setConnectionState({ sensor1: true, sensor2: true, sensor3: true, sensor4: true });
    simFrameRef.current = 0;

    // 启动模拟回放
    if (simRef.current) clearInterval(simRef.current);
    simRef.current = setInterval(() => {
      const demoData = demoDataRef.current;
      const frame = simFrameRef.current;
      const newData = {};

      if (demoData && demoData.sensors) {
        // 使用真实CSV数据回放
        SENSOR_KEYS.forEach((key) => {
          const sensorFrames = demoData.sensors[key];
          if (sensorFrames && sensorFrames.length > 0) {
            const idx = frame % sensorFrames.length;
            const flat = sensorFrames[idx];
            if (flat && flat.length === 4096) {
              // 将一维数组转为64×64矩阵
              const matrix = [];
              for (let r = 0; r < 64; r++) {
                matrix.push(flat.slice(r * 64, (r + 1) * 64));
              }
              newData[key] = denoiseMatrix(matrix, 15, 20);
            } else {
              newData[key] = Array.from({ length: 64 }, () => new Array(64).fill(0));
            }
          }
        });
      } else {
        // 使用SDK内置假数据
        const mockData = generateAnimatedWalkwayData(frame, 120);
        Object.assign(newData, mockData);
      }

      setSensorData(newData);
      computeStats(newData);
      simFrameRef.current++;
    }, 100); // ~10fps to reduce CPU load
  }, [computeStats, denoiseMatrix]);

  /* 停止模拟 */
  const stopSimulate = useCallback(() => {
    if (simRef.current) { clearInterval(simRef.current); simRef.current = null; }
    setDeviceStatus('disconnected');
    setConnectionState({});
    setSensorData({});
  }, []);

  /* 采集控制 */
  const start = () => {
    if (deviceStatus !== 'connected') return;
    setPhase('recording'); setTimer(0);
    timerRef.current = setInterval(() => setTimer(p => p + 1), 100);
  };

  const stop = () => {
    clearInterval(timerRef.current);
    if (simRef.current) { clearInterval(simRef.current); simRef.current = null; }
    setPhase('processing');
    // 生成报告数据
    setTimeout(() => {
      try {
        const report = generateGaitReportData(sensorData, sensorStats, timer);
        console.log('[GaitAssessment] 报告数据已生成:', report);
        setGaitReportData(report);
      } catch (e) {
        console.error('[GaitAssessment] 报告生成失败:', e);
      }
      setShowComplete(true);
    }, 2000);
  };

  const viewReport = () => {
    setShowComplete(false); setPhase('report'); setReportMode('static');
    completeAssessment('gait', { completed: true }, { sensorData });
  };

  const fmtTime = (t) => { const s = Math.floor(t / 10); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (simRef.current) clearInterval(simRef.current);
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
              <span className="hidden lg:inline">肌少症/老年人评估及监测系统——</span>4.行走步态评估
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
            <GaitReportContent patientInfo={patientInfo} reportData={gaitReportData} />
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
          <button onClick={() => navigate('/dashboard')} className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-[13px] md:text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            <span className="hidden lg:inline">肌少症/老年人评估及监测系统——</span>4.行走步态评估
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
                <button onClick={() => handleConnect()} className="text-xs font-medium ml-1" style={{ color: 'var(--zeiss-blue)' }}>连接</button>
                <span style={{ color: 'var(--border-medium)' }}>|</span>
                <button onClick={handleSimulate} className="text-xs font-medium" style={{ color: 'var(--success)' }}>模拟</button>
              </>
            )}
            {deviceStatus === 'connected' && (
              <button onClick={simRef.current ? stopSimulate : handleDisconnect} className="text-xs font-medium ml-1" style={{ color: C.red }}>断开</button>
            )}
          </div>
          <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {showComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-4 min-w-[340px] animate-slideUp">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--success-light)' }}>
              <svg className="w-7 h-7" fill="none" stroke="var(--success)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>采集完成，报告已生成</h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>您可以查看报告或返回首页继续其他评估</p>
            <div className="flex gap-3 w-full mt-2">
              <button onClick={() => { setShowComplete(false); completeAssessment('gait', { completed: true }, { sensorData }); navigate('/dashboard'); }}
                className="zeiss-btn-secondary flex-1 py-3 text-sm">返回首页</button>
              <button onClick={viewReport} className="zeiss-btn-primary flex-1 py-3 text-sm">查看报告</button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧数据面板 */}
        <div className="assessment-side-panel">
          <LeftDataPanel
            sensorStats={sensorStats}
            timer={timer}
            fmtTime={fmtTime}
            isRecording={phase === 'recording'}
            connectionState={connectionState}
          />
        </div>

        {/* 右侧3D区域 */}
        <div className="flex-1 flex flex-col items-center justify-center relative min-w-0 overflow-hidden">
          <div className="relative w-full h-full m-3 rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #d4d0cc 0%, #e0dcd8 50%, #d8d4d0 100%)' }}>
            <FootpadSceneReact
              sensorCount={4}
              showHeatmap={showHeatmap}
              depthScale={depthScale}
              smoothness={smoothness}
              sensorData={sensorData}
              onSceneReady={(scene) => { sceneRef.current = scene; }}
              style={{ width: '100%', height: '100%' }}
            />

            {/* 浮动控件 */}
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 p-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.5)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} className="rounded" /> 热力图
              </label>

              <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <span>平滑</span>
                <input type="range" min={0} max={100} value={smoothness * 100} onChange={e => setSmoothness(e.target.value / 100)} className="w-16 h-1" />
                <span>{smoothness.toFixed(1)}</span>
              </div>
            </div>

            {/* 处理中遮罩 */}
            {phase === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center zeiss-overlay rounded-xl">
                <div className="w-64 h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--border-light)' }}>
                  <div className="h-full rounded-full progress-animate" style={{ background: 'linear-gradient(to right, var(--zeiss-blue), #0891B2)' }} />
                </div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>正在分析步态数据，请稍候...</p>
              </div>
            )}
          </div>

          {/* 底部操作按钮 */}
          {phase !== 'processing' && (
            <div className="absolute bottom-6 z-20 flex flex-col items-center gap-3">
              {phase === 'idle' && deviceStatus === 'connected' && (
                <>
                  <button onClick={start} className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--border-medium)' }}>
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
                  <button onClick={stop} className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--zeiss-blue)', background: 'rgba(0,102,204,0.05)' }}>
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
