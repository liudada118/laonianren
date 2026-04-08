import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAssessment } from '../../contexts/AssessmentContext';
import EChart from '../../components/ui/EChart';
import GaitCanvas from '../../components/three/gait/GaitCanvas';
import ParticleControlPanel from '../../components/three/shared/ParticleControlPanel';
import { loadParams, saveParams, resetParams, loadTransform, saveTransform, resetTransform } from '../../components/three/shared/particleConfig';
import { backendBridge } from '../../lib/BackendBridge';
import GaitRegionChart from '../../components/report/GaitRegionChart';
import FootprintHeatmapChart from '../../components/ui/FootprintHeatmapChart';
import GaitAverageChart from '../../components/ui/GaitAverageChart';
import PressureEvolutionChart from '../../components/ui/PressureEvolutionChart';
import { exportToPdf } from '../../lib/pdfExport';
import AssessmentAiPanel from '../../components/report/AssessmentAiPanel';
import {
  ASSESSMENT_AI_SECTION_CONFIG,
  buildGaitAiPayload,
  requestAssessmentAIReport,
} from '../../lib/assessmentAi';

/* ─── 传感器常量 ─── */
const SENSOR_KEYS = ['sensor1', 'sensor2', 'sensor3', 'sensor4'];

/* ─── 图表样式常量 ─── */
const C = { text: '#6B7B8D', grid: '#EDF0F4', blue: '#0066CC', green: '#059669', red: '#DC2626', amber: '#D97706', purple: '#7C3AED', cyan: '#0891B2' };
const tip = { backgroundColor: '#fff', borderColor: '#E5E9EF', textStyle: { color: '#1A2332', fontSize: 11 }, extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,0.08);border-radius:8px;' };

const PAD_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f97316'];

/* ─── 左侧统一数据面板 ─── */
function LeftDataPanel({ sensorStats, timer, fmtTime, isRecording, isConnected }) {
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
              <div className="w-2 h-2 rounded-full" style={{ background: isConnected ? '#22c55e' : '#d1d5db' }} />
              <span className="text-[10px]" style={{ color: isConnected ? sensorColors[idx] : 'var(--text-muted)' }}>
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

/* ─── 步态报告组件（使用真实数据） ─── */
export function GaitReportContent({ patientInfo, pythonResult: externalResult, onClose, onAiReportReady }) {
  const [realData, setRealData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiReport, setAiReport] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const aiRequestStartedRef = useRef(false);
  const onAiReportReadyRef = useRef(onAiReportReady);

  useEffect(() => {
    onAiReportReadyRef.current = onAiReportReady;
  }, [onAiReportReady]);

  useEffect(() => {
    if (externalResult) {
      setRealData(externalResult);
      setLoading(false);
      return;
    }
    // 没有传入真实数据时，不再 fallback 到静态假数据
    setRealData(null);
    setLoading(false);
  }, [externalResult]);

  useEffect(() => {
    if (externalResult?.aiReport && !aiReport) {
      setAiReport(externalResult.aiReport);
    }
  }, [externalResult, aiReport]);

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

  const leftRegionCoords = realData?.regionCoords?.left || {};
  const rightRegionCoords = realData?.regionCoords?.right || {};
  // Desired page order:
  // left foot = outer -> inner
  // right foot = inner -> outer
  const innerOnRight = useMemo(() => ({ left: true, right: false }), []);

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
  const footprintHeatmapData = realData?.footprintHeatmapData || null;
  const gaitAverageData = realData?.gaitAverageData || null;
  const pressureEvolutionData = realData?.pressureEvolutionData || null;

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

  const makeTimeOpt = (field, label) => {
    const timeData = leftTime.length > 0 ? leftTime : rightTime;
    const totalPoints = timeData.length;
    // 计算合理的标签间距，避免密集显示导致乱码
    const labelInterval = totalPoints > 0 ? Math.max(0, Math.floor(totalPoints / 8) - 1) : 0;
    return {
      animation: false,
      grid: { top: 20, bottom: 40, left: 55, right: 20 },
      legend: { top: 0, textStyle: { fontSize: 10, color: C.text } },
      xAxis: {
        type: 'category',
        name: '时间(s)',
        nameTextStyle: { fontSize: 10, color: C.text, padding: [8, 0, 0, 0] },
        nameLocation: 'end',
        data: timeData,
        axisLabel: {
          fontSize: 9,
          color: C.text,
          rotate: 0,
          interval: labelInterval,
          formatter: v => {
            const num = parseFloat(v);
            return isNaN(num) ? '' : num.toFixed(1);
          },
        },
        axisTick: { alignWithLabel: true },
        show: timeData.length > 0,
      },
      yAxis: { type: 'value', name: label, axisLabel: { fontSize: 10, color: C.text, formatter: v => v.toFixed(2) }, splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: '左脚', type: 'line', smooth: true, symbol: 'none', data: ts.left?.[field] || [], lineStyle: { color: C.blue, width: 1.5 } },
        { name: '右脚', type: 'line', smooth: true, symbol: 'none', data: ts.right?.[field] || [], lineStyle: { color: C.amber, width: 1.5 } },
      ],
      tooltip: {
        trigger: 'axis', ...tip,
        formatter: params => {
          if (!params || params.length === 0) return '';
          const timeVal = parseFloat(params[0].axisValue);
          const timeStr = isNaN(timeVal) ? params[0].axisValue : `${timeVal.toFixed(2)}s`;
          let html = `<div style="font-size:11px;font-weight:600;margin-bottom:4px">${timeStr}</div>`;
          params.forEach(p => {
            const val = typeof p.value === 'number' ? p.value.toFixed(2) : p.value;
            html += `<div style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>${p.seriesName}: ${val}</div>`;
          });
          return html;
        },
      },
    };
  };
  const areaOption = useMemo(() => makeTimeOpt('area', 'cm²'), [ts]);
  const forceOption = useMemo(() => makeTimeOpt('load', 'N'), [ts]);
  const pressureOption = useMemo(() => makeTimeOpt('pressure', 'N/cm²'), [ts]);

  const partColors = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c'];
  const makePartOpt = (curves) => ({
    animation: false,
    grid: { top: 30, bottom: 30, left: 50, right: 20 },
    legend: { top: 0, textStyle: { fontSize: 10, color: C.text } },
    xAxis: { type: 'category', data: curves[0]?.data?.map((_, i) => i) || [], show: false },
    yAxis: { type: 'value', name: 'N', axisLabel: { fontSize: 10, color: C.text, formatter: v => v.toFixed(2) }, splitLine: { lineStyle: { color: C.grid } } },
    series: curves.map((c, i) => ({
      name: `S${i + 1}`, type: 'line', smooth: true, symbol: 'none', data: c.data || [],
      lineStyle: { color: partColors[i % partColors.length], width: 1.5 },
    })),
    tooltip: { trigger: 'axis', ...tip, valueFormatter: v => typeof v === 'number' ? v.toFixed(2) : v },
  });
  const leftPartOpt = useMemo(() => makePartOpt(leftPartCurves), [leftPartCurves]);
  const rightPartOpt = useMemo(() => makePartOpt(rightPartCurves), [rightPartCurves]);

  const thStyle = 'px-3 py-2 text-left text-[11px] font-semibold';
  const tdStyle = 'px-3 py-2 text-[11px]';
  const aiPayload = useMemo(() => buildGaitAiPayload(realData), [realData]);

  useEffect(() => {
    // 当报告数据切换时，允许重新发起一次 AI 请求
    aiRequestStartedRef.current = false;
  }, [aiPayload, externalResult?.aiReport]);

  useEffect(() => {
    if (!aiPayload || aiReport || externalResult?.aiReport) return;
    if (aiRequestStartedRef.current) return;
    aiRequestStartedRef.current = true;

    let cancelled = false;
    setAiLoading(true);
    setAiError(null);

    requestAssessmentAIReport(
      'gait',
      patientInfo || { name: '未知' },
      aiPayload,
    ).then(res => {
      if (res.success) {
        if (!cancelled) {
          setAiReport(res.data);
        }
        if (onAiReportReadyRef.current) onAiReportReadyRef.current(res.data);
      } else {
        if (!cancelled) {
          setAiError(res.error || 'AI 分析失败');
        }
      }
    }).catch(err => {
      if (!cancelled) setAiError(err.message);
    }).finally(() => {
      if (!cancelled) setAiLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [aiPayload, patientInfo, aiReport, externalResult?.aiReport]);

  // Hooks 必须在所有条件分支之前调用
  const gaitContentRef = React.useRef(null);
  const [pdfExporting, setPdfExporting] = React.useState(false);

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-sm" style={{ color: 'var(--text-muted)' }}>正在加载报告数据...</div></div>;
  }

  if (!realData) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <svg className="w-16 h-16 mb-4" style={{ color: 'var(--border-light)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-base font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>暂无报告数据</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>请先完成步态评估采集</p>
        {onClose && <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg text-sm text-white" style={{ background: 'var(--zeiss-blue)' }}>返回</button>}
      </div>
    );
  }

  const walkSpeed = parseFloat(gp.walkingSpeed) || 0;
  const leftStepTime = parseFloat(gp.leftStepTime) || 0;
  const rightStepTime = parseFloat(gp.rightStepTime) || 0;
  const leftStepLen = parseFloat(gp.leftStepLength) || 0;
  const rightStepLen = parseFloat(gp.rightStepLength) || 0;
  const handlePdfExport = async () => {
    if (pdfExporting) return;
    setPdfExporting(true);
    try { await exportToPdf(gaitContentRef?.current, `${patientInfo?.name || '报告'}_步态评估`, { title: '步态评估报告' }); } finally { setPdfExporting(false); }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="shrink-0 px-4 md:px-6 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
        <h2 className="text-sm md:text-base font-bold" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'} 的步态评估报告</h2>
        <div className="flex items-center gap-2">
        <button onClick={handlePdfExport} disabled={pdfExporting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{ color: pdfExporting ? 'var(--text-muted)' : '#DC2626', background: pdfExporting ? 'var(--bg-tertiary)' : '#FEF2F2', border: '1px solid #FCA5A530', cursor: pdfExporting ? 'wait' : 'pointer' }}>
          {pdfExporting ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          )}
          {pdfExporting ? '导出中...' : '导出 PDF'}
        </button>
        {onClose && (
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
        </div>
      </div>
    <div className="flex flex-1 overflow-hidden">
      <nav className="w-48 shrink-0 p-3 overflow-y-auto hidden lg:block" style={{ borderRight: '1px solid var(--border-light)' }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => scrollToSection(s.id)}
            className={`w-full text-left px-3 py-2 text-xs rounded-lg mb-1 transition-colors ${activeSection === s.id ? 'font-semibold' : ''}`}
            style={{ background: activeSection === s.id ? 'var(--zeiss-blue-light)' : 'transparent', color: activeSection === s.id ? 'var(--zeiss-blue)' : 'var(--text-muted)' }}>
            {s.title}
          </button>
        ))}
      </nav>

      <div ref={gaitContentRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
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
                {['峰值(N)', '均值(N)', '标准差(N)', '峰值(N)', '均值(N)', '标准差(N)'].map((h, i) => <th key={i} className={thStyle} style={{ color: 'var(--text-muted)' }}>{h}</th>)}
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
            <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>瞬时足底压力演变（落地 → 离地）</h4>
            <div className="overflow-x-auto">
              {pressureEvolutionData ? (
                <PressureEvolutionChart evolutionData={pressureEvolutionData} />
              ) : images.pressureEvolution ? (
                <img src={images.pressureEvolution} alt="Foot Pressure Evolution" className="w-full min-w-[700px]" style={{ imageRendering: 'auto' }} />
              ) : (
                <div className="flex items-center justify-center py-12 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无足底压力演变数据</span>
                </div>
              )}
            </div>
          </div>
          <div className="zeiss-card p-4">
            <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>步态平均摘要</h4>
            <div>
              {gaitAverageData ? (
                <GaitAverageChart gaitAvgData={gaitAverageData} innerOnRight={innerOnRight} />
              ) : images.gaitAverage ? (
                <img src={images.gaitAverage} alt="Gait Average Summary" className="max-w-full" style={{ maxHeight: '500px', imageRendering: 'auto' }} />
              ) : (
                <div className="flex items-center justify-center py-12 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无步态平均数据</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 4. 足印热力图 */}
        <section id="gait-heatmap">
          <div className="zeiss-section-title">4. 足印热力图（足偏角分析）</div>
          <div className="zeiss-card p-4">
            {footprintHeatmapData ? (
              <FootprintHeatmapChart heatmapData={footprintHeatmapData} />
            ) : images.footprintHeatmap ? (
              <img src={images.footprintHeatmap} alt="Footprint Heatmap" className="max-w-full" style={{ maxHeight: '500px', imageRendering: 'auto' }} />
            ) : (
              <div className="flex items-center justify-center py-12 rounded-lg" style={{ background: 'var(--bg-tertiary)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无足印热力图数据</span>
              </div>
            )}
          </div>
        </section>

        {/* 5. 时序曲线 */}
        <section id="gait-timeseries">
          <div className="zeiss-section-title">5. 时序曲线</div>
          <div className="zeiss-card p-4 mb-4">
            <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>足偏角 (FPA) 分析</h4>
            <EChart option={fpaOption} height={220} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>面积 (cm²)</h4><EChart option={areaOption} height={200} /></div>
            <div className="zeiss-card p-4"><h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>负荷 (N)</h4><EChart option={forceOption} height={200} /></div>
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

        <section id="gait-regions">
          <div className="zeiss-section-title">7. 分区点位图（压力分区 S1-S6）</div>
          <div className="zeiss-card p-4">
            <GaitRegionChart leftRegionCoords={leftRegionCoords} rightRegionCoords={rightRegionCoords} innerOnRight={innerOnRight} />
          </div>
        </section>

        {/* 8. 分区曲线 */}
        <section id="gait-partcurves">
          <div className="zeiss-section-title">8. 分区曲线</div>
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
                {['时长(ms)', 'COP速度(mm/s)', '最大面积(cm²)', '最大负荷(N)', '时长(ms)', 'COP速度(mm/s)', '最大面积(cm²)', '最大负荷(N)'].map((h, i) => <th key={i} className={thStyle} style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{h}</th>)}
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
                {['时长(ms)', 'COP速度(mm/s)', '最大面积(cm²)', '最大负荷(N)', '时长(ms)', 'COP速度(mm/s)', '最大面积(cm²)', '最大负荷(N)'].map((h, i) => <th key={i} className={thStyle} style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{h}</th>)}
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
          <div className="zeiss-section-title">AI综合评估</div>
          <div className="zeiss-card-inner p-5 mt-3">
            <AssessmentAiPanel
              aiLoading={aiLoading}
              aiError={aiError}
              aiReport={aiReport}
              sections={ASSESSMENT_AI_SECTION_CONFIG.gait}
            />
          </div>
        </section>
      </div>
    </div>
    </div>
  );
}

/* ===============================================
   主组件 — 纯 BackendBridge 模式
   =============================================== */
export default function GaitAssessment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { patientInfo, completeAssessment, updateAssessmentAiReport, assessments, deviceConnStatus } = useAssessment();
  const isGlobalConnected = deviceConnStatus === 'connected';
  const viewReportMode = location.state?.viewReport && assessments.gait?.completed;

  const [phase, setPhase] = useState(viewReportMode ? 'report' : 'idle');
  const [showGuideDialog, setShowGuideDialog] = useState(!viewReportMode);
  const assessmentIdRef = useRef(`gait_${Date.now()}`);
  const [csvExporting, setCsvExporting] = useState(false);
  const [reportMode, setReportMode] = useState('static');
  const [showComplete, setShowComplete] = useState(false);
  const [timer, setTimer] = useState(0);
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const timerRef = useRef(null);

  const [pythonResult, setPythonResult] = useState(
    viewReportMode ? (assessments.gait?.report?.reportData || assessments.gait?.data?.pythonResult || null) : null
  );

  /* 3D场景相关 */
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [depthScale, setDepthScale] = useState(0);
  const [smoothness, setSmoothness] = useState(0.5);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [filterThreshold, setFilterThreshold] = useState(15);
  const [filterMinArea, setFilterMinArea] = useState(20);
  const [optimizeEnabled, setOptimizeEnabled] = useState(true);
  const [optimizeBad, setOptimizeBad] = useState(40);
  const [optimizeGood, setOptimizeGood] = useState(100);

  // 同步滤波/优化参数到后端（数据源头处理）
  useEffect(() => {
    backendBridge.setFootFilter('gait', { filterEnabled, filterThreshold, filterMinArea }).catch(e => console.warn('设置步道滤波失败:', e));
  }, [filterEnabled, filterThreshold, filterMinArea]);
  useEffect(() => {
    backendBridge.setFootFilter('gait', { optimizeEnabled, optimizeBad, optimizeGood }).catch(e => console.warn('设置步道优化失败:', e));
  }, [optimizeEnabled, optimizeBad, optimizeGood]);
  const [sensorData, setSensorData] = useState({});
  const sceneRef = useRef(null);

  // 粒子系统共用参数
  const [particleParams, setParticleParams] = useState(() => loadParams('gait'));
  const handleParamChange = useCallback((key, value) => {
    setParticleParams(prev => {
      const next = { ...prev, [key]: value };
      saveParams(next, 'gait');
      return next;
    });
  }, []);
  const handleParamReset = useCallback(() => {
    const defaults = resetParams('gait');
    setParticleParams(defaults);
  }, []);

  // 空间变换参数（步道独立）
  const [transformParams, setTransformParams] = useState(() => loadTransform('gait'));
  const handleTransformChange = useCallback((key, value) => {
    setTransformParams(prev => {
      const next = { ...prev, [key]: value };
      saveTransform('gait', next);
      return next;
    });
  }, []);
  const handleTransformReset = useCallback(() => {
    const defaults = resetTransform('gait');
    setTransformParams(defaults);
  }, []);

  /* 实时统计 */
  const [sensorStats, setSensorStats] = useState({
    totals: [0, 0, 0, 0],
    maxVals: [0, 0, 0, 0],
    activePoints: [0, 0, 0, 0],
    history: [],
    cadence: '—', stride: '—', speed: '—', symmetry: '—',
  });

  /* 步态实时检测器 */
  const stepDetectorRef = useRef({
    padWasActive: [false, false, false, false],
    stepEvents: [],    // { time, padIdx, peak, positionCm }
    lastStepTime: 0,
  });

  /* 噪音过滤 */
  const denoiseMatrix = useCallback((matrix, threshold = 10, minRegionSize = 15) => {
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (rows === 0 || cols === 0) return matrix;
    const result = matrix.map(row => [...row]);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (result[r][c] < threshold) result[r][c] = 0;
      }
    }

    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const regions = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (visited[r][c] || result[r][c] <= 0) continue;
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

    for (const region of regions) {
      if (region.length < minRegionSize) {
        for (const [r, c] of region) result[r][c] = 0;
      }
    }

    return result;
  }, []);

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

    // --- 步态事件检测 ---
    const det = stepDetectorRef.current;
    const now = Date.now();
    const PAD_ACTIVATE = 500;
    const PAD_DEACTIVATE = 200;
    const MIN_INTERVAL = 250; // ms，两步最小间隔

    SENSOR_KEYS.forEach((_, idx) => {
      const pressure = totals[idx];
      const wasActive = det.padWasActive[idx];
      const isActive = pressure > (wasActive ? PAD_DEACTIVATE : PAD_ACTIVATE);

      if (isActive && !wasActive && now - det.lastStepTime > MIN_INTERVAL) {
        // 计算COP行位置（行走方向）和列位置（横向，区分左右脚）
        const matrix = data[SENSOR_KEYS[idx]];
        let copRow = 32, copCol = 32;
        if (matrix && matrix.length > 0) {
          let sumW = 0, sumR = 0, sumC = 0;
          for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
              const v = matrix[r][c];
              if (v > 5) { sumW += v; sumR += r * v; sumC += c * v; }
            }
          }
          if (sumW > 0) { copRow = sumR / sumW; copCol = sumC / sumW; }
        }
        // 后端拼接: hstack([pad4,pad3,pad2,pad1]) + fliplr + rot90
        // pad4→rows 0-63, pad3→64-127, pad2→128-191, pad1→192-255
        // sensor idx 0=pad1, 1=pad2, 2=pad3, 3=pad4
        const absoluteRow = (3 - idx) * 64 + (63 - copRow);
        const positionCm = absoluteRow * 1.4;
        // copCol < 32 → 步道一侧, copCol >= 32 → 另一侧（用于区分左右脚）
        det.stepEvents.push({ time: now, padIdx: idx, peak: pressure, positionCm, copCol });
        det.lastStepTime = now;
        if (det.stepEvents.length > 30) det.stepEvents.shift();
      }

      // 更新当前步的峰值压力
      if (isActive && det.stepEvents.length > 0) {
        const last = det.stepEvents[det.stepEvents.length - 1];
        if (last.padIdx === idx) last.peak = Math.max(last.peak, pressure);
      }

      det.padWasActive[idx] = isActive;
    });

    // --- 计算综合指标 ---
    const steps = det.stepEvents;
    let cadence = '—', stride = '—', speed = '—', symmetry = '—';

    // 步频：最近若干步的频率 → steps/min
    if (steps.length >= 3) {
      const recent = steps.slice(-8);
      const elapsed = recent[recent.length - 1].time - recent[0].time;
      if (elapsed > 0) {
        cadence = String(Math.round(((recent.length - 1) / elapsed) * 60000));
      }
    }

    // 步幅：只取右脚（copCol >= 32 的一侧），相邻右脚步的位置差
    // 右脚→右脚 = 一个完整步态周期的步幅
    const rightSteps = steps.filter(s => s.copCol >= 32);
    if (rightSteps.length >= 2) {
      const recent = rightSteps.slice(-6);
      const dists = [];
      for (let i = 1; i < recent.length; i++) {
        const d = Math.abs(recent[i].positionCm - recent[i - 1].positionCm);
        if (d > 20) dists.push(d); // 忽略 <20cm 的非步态移动
      }
      if (dists.length > 0) {
        stride = (dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(1);
      }
    }

    // 速度：步幅(m) × 步频(steps/min) / 60
    if (cadence !== '—' && stride !== '—') {
      speed = ((parseFloat(stride) / 100) * (parseInt(cadence, 10) / 60)).toFixed(2);
    }

    // 对称性：左右脚峰值压力比
    const leftSteps = steps.filter(s => s.copCol < 32);
    if (rightSteps.length >= 2 && leftSteps.length >= 2) {
      const avgRight = rightSteps.slice(-4).reduce((a, s) => a + s.peak, 0) / Math.min(rightSteps.length, 4);
      const avgLeft = leftSteps.slice(-4).reduce((a, s) => a + s.peak, 0) / Math.min(leftSteps.length, 4);
      if (avgRight > 0 && avgLeft > 0) {
        symmetry = (Math.min(avgRight, avgLeft) / Math.max(avgRight, avgLeft)).toFixed(2);
      }
    }

    setSensorStats(prev => ({
      totals, maxVals, activePoints,
      history: [...prev.history, totals].slice(-60),
      cadence, stride, speed, symmetry,
    }));
  }, []);

  // ─── 挂载时激活步道模式，使采集前就能显示可视化 ───
  useEffect(() => {
    if (!isGlobalConnected) return;
    backendBridge.setActiveMode(5).catch(e => console.warn('步道模式激活失败:', e));
  }, [isGlobalConnected]);

  // ─── 后端数据监听 ───
  useEffect(() => {
    if (!isGlobalConnected) return;

    const footHandlers = {};
    ['foot1Data', 'foot2Data', 'foot3Data', 'foot4Data'].forEach((eventName, idx) => {
      const key = SENSOR_KEYS[idx];
      footHandlers[eventName] = (arr) => {
        // 将一维数组转为 64x64 矩阵
        const raw = [];
        for (let r = 0; r < 64; r++) raw.push(arr.slice(r * 64, (r + 1) * 64));
        // 转置矩阵，与 FootpadSerialService 的 transpose 保持一致
        const matrix = [];
        for (let c = 0; c < 64; c++) {
          const row = [];
          for (let r = 0; r < 64; r++) row.push(raw[r][c]);
          matrix.push(row);
        }
        // 滤波和优化已在后端数据源头处理，前端直接使用
        setSensorData(prev => {
          const newData = { ...prev, [key]: matrix };
          computeStats(newData);
          return newData;
        });
      };
      backendBridge.on(eventName, footHandlers[eventName]);
    });

    return () => {
      Object.entries(footHandlers).forEach(([event, handler]) => {
        backendBridge.off(event, handler);
      });
    };
  }, [isGlobalConnected, computeStats]);

  // ─── CSV 导出 ───
  const handleExportCsv = async () => {
    setCsvExporting(true);
    try {
      const resp = await backendBridge.exportCsv({ assessmentId: assessmentIdRef.current, sampleType: '5' });
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

  const fmtTime = (t) => { const s = Math.floor(t / 10); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  /* ─── 开始采集 ─── */
  const start = async () => {
    if (!isGlobalConnected) return;
    setPhase('recording'); setTimer(0);
    setAnalysisError('');
    // 重置步态检测器
    stepDetectorRef.current = { padWasActive: [false, false, false, false], stepEvents: [], lastStepTime: 0 };

    try {
      await backendBridge.setActiveMode(5); // 5=脚垫模式
      await backendBridge.startCol({
        name: patientInfo?.name || '未知',
        assessmentId: assessmentIdRef.current,
        date: new Date().toISOString().split('T')[0],
        colName: 'gait_assessment',
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
      const resp = await backendBridge.getGaitReport({
        timestamp: new Date().toISOString(),
        assessmentId: assessmentIdRef.current,
        collectName: 'gait_assessment',
        body_weight_kg: patientInfo?.weight || 60,
      });
      if (resp?.data?.render_data) {
        setPythonResult(resp.data.render_data);
        completeAssessment('gait', { completed: true, reportData: resp.data.render_data }, { pythonResult: resp.data.render_data }, assessmentIdRef.current);
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
    setShowComplete(false); setPhase('report'); setReportMode('static');
    completeAssessment('gait', { completed: true, reportData: pythonResult }, { pythonResult }, assessmentIdRef.current);
  };

  const handleGaitAiReportReady = useCallback((aiData) => {
    updateAssessmentAiReport('gait', aiData, assessmentIdRef.current);
  }, [updateAssessmentAiReport]);

  // 清理
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
            <button onClick={handleExportCsv} disabled={csvExporting}
              className="zeiss-btn-secondary text-xs py-2 px-4">
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
            <GaitReportContent
              patientInfo={patientInfo}
              pythonResult={pythonResult}
              onAiReportReady={handleGaitAiReportReady}
            />
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
          {/* 设备连接状态 */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)' }}>
            {SENSOR_KEYS.map((key, idx) => (
              <div key={key} className="flex items-center gap-1 px-1 py-0.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: isGlobalConnected ? PAD_COLORS[idx] : '#d1d5db' }} />
                <span className="text-[10px]" style={{ color: isGlobalConnected ? PAD_COLORS[idx] : 'var(--text-muted)' }}>{idx + 1}</span>
              </div>
            ))}
            <span style={{ color: 'var(--border-medium)', margin: '0 1px' }}>|</span>
            <span className="text-[10px]" style={{ color: isGlobalConnected ? 'var(--success)' : 'var(--text-muted)' }}>
              {isGlobalConnected ? '已连接' : '未连接'}
            </span>
          </div>
          <span className="text-sm font-semibold hidden md:inline" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || '---'}</span>
          <button onClick={() => navigate('/history')} className="zeiss-btn-ghost text-xs hidden lg:inline-flex">历史记录</button>
        </div>
      </header>

      {/* 进入评估指导弹窗 */}
      {showGuideDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center zeiss-overlay animate-fadeIn">
          <div className="zeiss-dialog p-8 flex flex-col items-center gap-5 min-w-[380px] max-w-[440px] animate-slideUp">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'var(--zeiss-blue-light)' }}>
              <svg className="w-8 h-8" fill="none" stroke="var(--zeiss-blue)" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-center" style={{ color: 'var(--text-primary)' }}>步态评估指导</h3>
            <div className="text-center px-2">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                请受试者<span className="font-semibold" style={{ color: 'var(--zeiss-blue)' }}>从脚印走向 LOGO 方向</span>，并且<span className="font-semibold" style={{ color: 'var(--zeiss-blue)' }}>走出步道</span>。
              </p>
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>确保受试者以自然步态匀速行走，采集过程中请勿中途停留。</p>
            </div>
            <button onClick={() => setShowGuideDialog(false)} className="zeiss-btn-primary w-full py-3 text-sm font-semibold mt-1">我已了解，开始评估</button>
          </div>
        </div>
      )}

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
              <button onClick={() => { setShowComplete(false); completeAssessment('gait', { completed: true, reportData: pythonResult }, { pythonResult }, assessmentIdRef.current); navigate('/dashboard'); }}
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
            sensorStats={sensorStats}
            timer={timer}
            fmtTime={fmtTime}
            isRecording={phase === 'recording'}
            isConnected={isGlobalConnected}
          />
        </div>

        {/* 右侧3D区域 */}
        <div className="flex-1 flex flex-col items-center justify-center relative min-w-0 overflow-hidden">
          <div className="relative w-full h-full m-3 rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #d4d0cc 0%, #e0dcd8 50%, #d8d4d0 100%)' }}>
            <GaitCanvas
              sensorData={sensorData}
              showHeatmap={showHeatmap}
              particleParams={particleParams}
              transformParams={transformParams}
              optimizeEnabled={optimizeEnabled}
              onSceneReady={(scene) => { sceneRef.current = scene; }}
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
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{filterThreshold}</span>
                        </div>
                        <input type="range" min={0} max={100} step={1} value={filterThreshold} onChange={e => setFilterThreshold(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted, #9ca3af)' }}>最小连通域</span>
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{filterMinArea}</span>
                        </div>
                        <input type="range" min={0} max={100} step={1} value={filterMinArea} onChange={e => setFilterMinArea(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
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
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{optimizeBad}</span>
                        </div>
                        <input type="range" min={0} max={200} step={1} value={optimizeBad} onChange={e => setOptimizeBad(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted, #9ca3af)' }}>正常阈值</span>
                          <span className="text-[10px] tabular-nums font-mono" style={{ color: 'var(--text-muted, #9ca3af)' }}>{optimizeGood}</span>
                        </div>
                        <input type="range" min={0} max={500} step={1} value={optimizeGood} onChange={e => setOptimizeGood(Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ background: 'var(--border-light, #e5e7eb)' }} />
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
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {analyzing ? '正在分析步态数据，请稍候...' : '正在生成报告，请稍候...'}
                </p>
              </div>
            )}
          </div>

          {/* 底部操作按钮 */}
          {phase !== 'processing' && (
            <div className="absolute bottom-6 z-20 flex flex-col items-center gap-3">
              {phase === 'idle' && isGlobalConnected && (
                <>
                  <button onClick={start} className="w-16 h-16 rounded-full border-4 flex items-center justify-center hover:scale-105 transition-transform" style={{ borderColor: 'var(--border-medium)' }}>
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
