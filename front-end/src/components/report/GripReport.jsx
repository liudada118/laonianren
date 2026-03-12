import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import HandPressureMap from './HandPressureMap';
import { exportToPdf } from '../../lib/pdfExport';

/* ─── ECharts 图表封装 (蔡司风格) ─── */
function EChart({ option, height = 280 }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = echarts.init(ref.current);
    chartRef.current.setOption(option);
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chartRef.current?.dispose(); };
  }, [option]);
  return <div ref={ref} style={{ width: '100%', height }} />;
}

/* ─── 目录项（删除了最后的"力占比分析"重复项）─── */
const SECTIONS = [
  { id: 'overview', label: '基本信息' },
  { id: 'pressure', label: '手部压力分布' },
  { id: 'force-curve', label: '力-时间曲线' },
  { id: 'force-stack', label: '力分布堆叠图' },
  { id: 'force-bar', label: '各部位力分布' },
  { id: 'euler', label: '手部姿态' },
  { id: 'angular', label: '抖动检测' },
  { id: 'time-analysis', label: '时间分析' },
  { id: 'peak-data', label: '峰值帧数据' },
];

/* ─── 默认空 fingers 数据（防止 undefined 崩溃）─── */
const DEFAULT_FINGERS = [
  { name: '拇指', force: 0, area: 0, points: 0, adc: 0 },
  { name: '食指', force: 0, area: 0, points: 0, adc: 0 },
  { name: '中指', force: 0, area: 0, points: 0, adc: 0 },
  { name: '无名指', force: 0, area: 0, points: 0, adc: 0 },
  { name: '小指', force: 0, area: 0, points: 0, adc: 0 },
  { name: '手掌', force: 0, area: 0, points: 0, adc: 0 },
];

/* ─── mm² → cm² 转换辅助函数 ─── */
function mm2ToCm2(mm2Val) {
  if (typeof mm2Val !== 'number' || isNaN(mm2Val)) return '0';
  return parseFloat((mm2Val / 100).toFixed(2));
}

/* ─── 解析 timeRange 为简洁的总时长 ─── */
function formatDuration(timeRange) {
  if (!timeRange || timeRange === '-') return '-';
  // 格式如 "0.000s ~ 17.500s"
  const match = timeRange.match(/([\d.]+)\s*s?\s*[~\-–]\s*([\d.]+)\s*s?/);
  if (match) {
    const start = parseFloat(match[1]);
    const end = parseFloat(match[2]);
    const duration = end - start;
    if (duration >= 1) {
      return `${parseFloat(duration.toFixed(1))} 秒`;
    }
    return `${parseFloat(duration.toFixed(3))} 秒`;
  }
  // 如果已经是简洁格式，直接返回
  return timeRange;
}

/* ─── 主报告组件 ─── */
export default function GripReport({ patientName, onClose, onSwitchDynamic, reportData: propsReportData }) {
  const [activeHand, setActiveHand] = useState('left');
  const [activeSection, setActiveSection] = useState('overview');
  const [rawReport, setRawReport] = useState(null);
  const [loading, setLoading] = useState(!propsReportData);
  const contentRef = useRef(null);

  // 加载数据
  useEffect(() => {
    if (propsReportData) {
      setRawReport(propsReportData);
      // 设置默认显示的手
      if (propsReportData.activeHand === '右手') {
        setActiveHand('right');
      } else {
        setActiveHand(propsReportData.left ? 'left' : 'right');
      }
      setLoading(false);
      return;
    }
    // 无 props 传入的报告数据时，直接显示无数据提示
    setRawReport(null);
    setLoading(false);
  }, [propsReportData]);

  // 解析当前手的数据，并确保关键字段有默认值
  const data = useMemo(() => {
    if (!rawReport) return null;
    let handData;
    // 新格式: { left: {...}, right: {...}, activeHand }
    if (rawReport.left || rawReport.right) {
      handData = activeHand === 'left' ? rawReport.left : rawReport.right;
    } else {
      // 旧格式: 直接就是单手数据
      handData = rawReport;
    }
    // 如果选中的手没有数据，返回 null（会显示"数据加载失败"页面）
    if (!handData) return null;
    // 确保关键字段有默认值，防止 undefined 崩溃
    return {
      ...handData,
      fingers: handData.fingers || DEFAULT_FINGERS,
      totalForce: handData.totalForce ?? 0,
      totalArea: handData.totalArea ?? 0,
      totalFrames: handData.totalFrames ?? '-',
      timeRange: handData.timeRange ?? '-',
      times: handData.times || [],
      forceTimeSeries: handData.forceTimeSeries || {},
      eulerData: handData.eulerData || {},
      angularVelocity: handData.angularVelocity || [],
      timeAnalysis: handData.timeAnalysis || [],
    };
  }, [rawReport, activeHand]);

  // 是否有两只手的数据
  const hasLeft = rawReport?.left != null;
  const hasRight = rawReport?.right != null;
  const hasBothHands = hasLeft && hasRight;

  const colors = ['#0066CC', '#0891B2', '#059669', '#D97706', '#9333EA', '#DC2626'];
  const fingerNames = ['拇指', '食指', '中指', '无名指', '小指', '手掌'];
  const fingerKeys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm'];

  const scrollToSection = (id) => {
    const el = document.getElementById(`grip-${id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveSection(id); }
  };

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleScroll = () => {
      const sections = SECTIONS.map(s => document.getElementById(`grip-${s.id}`)).filter(Boolean);
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].getBoundingClientRect().top <= 200) { setActiveSection(SECTIONS[i].id); break; }
      }
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // ─── 蔡司风格图表配色 ───
  const chartTextColor = '#6B7B8D';
  const gridLineColor = '#EDF0F4';
  const tooltipStyle = { backgroundColor: '#FFFFFF', borderColor: '#E5E9EF', textStyle: { color: '#1A2332' }, extraCssText: 'box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 8px;' };
  const baseGrid = { top: 50, bottom: 35, left: 55, right: 20 };

  // ─── ECharts 配置 ───
  const forceTimeOption = useMemo(() => {
    if (!data?.times?.length) return {};
    const step = Math.max(1, Math.floor(data.times.length / 300));
    const sampledTimes = data.times.filter((_, i) => i % step === 0);
    return {
      tooltip: { trigger: 'axis', confine: true, ...tooltipStyle, valueFormatter: (v) => `${parseFloat(Number(v).toFixed(2))}N` },
      legend: { data: [...fingerNames, '总力'], top: 5, textStyle: { fontSize: 11, color: chartTextColor } },
      grid: baseGrid,
      xAxis: { type: 'category', data: sampledTimes.map(t => typeof t === 'number' ? t.toFixed(1) : t), name: '时间(s)', nameTextStyle: { color: chartTextColor }, boundaryGap: false, axisLabel: { color: chartTextColor }, axisLine: { lineStyle: { color: gridLineColor } }, splitLine: { show: false } },
      yAxis: { type: 'value', name: '力(N)', nameTextStyle: { color: chartTextColor }, splitLine: { lineStyle: { color: gridLineColor } }, axisLabel: { color: chartTextColor, formatter: (v) => parseFloat(Number(v).toFixed(2)) } },
      series: [
        ...fingerKeys.map((key, i) => ({
          name: fingerNames[i], type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 1.5 },
          data: (data.forceTimeSeries[key] || []).filter((_, j) => j % step === 0).map(v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v), itemStyle: { color: colors[i] }
        })),
        { name: '总力', type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2.5, type: 'dashed', color: '#1A2332' },
          data: (data.forceTimeSeries.total || []).filter((_, j) => j % step === 0).map(v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v) }
      ]
    };
  }, [data]);

  const stackOption = useMemo(() => {
    if (!data?.times?.length) return {};
    const step = Math.max(1, Math.floor(data.times.length / 300));
    const sampledTimes = data.times.filter((_, i) => i % step === 0);
    return {
      tooltip: { trigger: 'axis', confine: true, ...tooltipStyle, valueFormatter: (v) => `${parseFloat(Number(v).toFixed(2))}N` },
      legend: { data: fingerNames, top: 5, textStyle: { fontSize: 11, color: chartTextColor } },
      grid: baseGrid,
      xAxis: { type: 'category', data: sampledTimes.map(t => typeof t === 'number' ? t.toFixed(1) : t), name: '时间(s)', nameTextStyle: { color: chartTextColor }, boundaryGap: false, axisLabel: { color: chartTextColor }, axisLine: { lineStyle: { color: gridLineColor } }, splitLine: { show: false } },
      yAxis: { type: 'value', name: '力(N)', nameTextStyle: { color: chartTextColor }, splitLine: { lineStyle: { color: gridLineColor } }, axisLabel: { color: chartTextColor, formatter: (v) => parseFloat(Number(v).toFixed(2)) } },
      series: fingerKeys.map((key, i) => ({
        name: fingerNames[i], type: 'line', stack: 'total', areaStyle: { opacity: 0.35 },
        smooth: true, symbol: 'none', lineStyle: { width: 1 },
        data: (data.forceTimeSeries[key] || []).filter((_, j) => j % step === 0).map(v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v), itemStyle: { color: colors[i] }
      }))
    };
  }, [data]);

  const barOption = useMemo(() => {
    if (!data?.fingers?.length) return {};
    return {
      tooltip: { ...tooltipStyle, valueFormatter: (v) => `${parseFloat(Number(v).toFixed(2))}N` },
      grid: { top: 30, bottom: 35, left: 55, right: 20 },
      xAxis: { type: 'category', data: data.fingers.map(f => f.name), axisLabel: { fontSize: 11, color: chartTextColor }, axisLine: { lineStyle: { color: gridLineColor } } },
      yAxis: { type: 'value', name: '力(N)', nameTextStyle: { color: chartTextColor }, splitLine: { lineStyle: { color: gridLineColor } }, axisLabel: { color: chartTextColor, formatter: (v) => parseFloat(Number(v).toFixed(2)) } },
      series: [{
        type: 'bar', barWidth: '45%', itemStyle: { borderRadius: [6, 6, 0, 0] },
        data: data.fingers.map((f, i) => ({ value: typeof f.force === 'number' ? parseFloat(f.force.toFixed(2)) : f.force, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: colors[i] }, { offset: 1, color: colors[i] + '30' }]) } })),
        label: { show: true, position: 'top', formatter: (params) => `${parseFloat(Number(params.value).toFixed(2))}N`, fontSize: 11, fontWeight: 'bold', color: chartTextColor }
      }]
    };
  }, [data]);

  const eulerOption = useMemo(() => {
    if (!data?.times?.length) return {};
    const step = Math.max(1, Math.floor(data.times.length / 300));
    const sampledTimes = data.times.filter((_, i) => i % step === 0);
    return {
      tooltip: { trigger: 'axis', confine: true, ...tooltipStyle, valueFormatter: (v) => `${parseFloat(Number(v).toFixed(2))}°` },
      legend: { data: ['横滚(Roll)', '俯仰(Pitch)', '偏航(Yaw)'], top: 5, textStyle: { fontSize: 11, color: chartTextColor } },
      grid: baseGrid,
      xAxis: { type: 'category', data: sampledTimes.map(t => typeof t === 'number' ? t.toFixed(1) : t), name: '时间(s)', nameTextStyle: { color: chartTextColor }, boundaryGap: false, axisLabel: { color: chartTextColor }, axisLine: { lineStyle: { color: gridLineColor } }, splitLine: { show: false } },
      yAxis: { type: 'value', name: '角度(°)', nameTextStyle: { color: chartTextColor }, splitLine: { lineStyle: { color: gridLineColor } }, axisLabel: { color: chartTextColor, formatter: (v) => parseFloat(Number(v).toFixed(2)) } },
      series: [
        { name: '横滚(Roll)', type: 'line', smooth: true, symbol: 'none', data: (data.eulerData?.roll || []).filter((_, i) => i % step === 0).map(v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v), itemStyle: { color: '#DC2626' }, lineStyle: { width: 2 } },
        { name: '俯仰(Pitch)', type: 'line', smooth: true, symbol: 'none', data: (data.eulerData?.pitch || []).filter((_, i) => i % step === 0).map(v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v), itemStyle: { color: '#0066CC' }, lineStyle: { width: 2 } },
        { name: '偏航(Yaw)', type: 'line', smooth: true, symbol: 'none', data: (data.eulerData?.yaw || []).filter((_, i) => i % step === 0).map(v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v), itemStyle: { color: '#059669' }, lineStyle: { width: 2 } },
      ]
    };
  }, [data]);

  const angVelOption = useMemo(() => {
    if (!data?.times?.length) return {};
    const step = Math.max(1, Math.floor(data.times.length / 300));
    const sampledTimes = data.times.filter((_, i) => i % step === 0);
    return {
      tooltip: { trigger: 'axis', confine: true, ...tooltipStyle, valueFormatter: (v) => `${parseFloat(Number(v).toFixed(2))}°/s` },
      legend: { data: ['角速度', '检测阈值'], top: 5, textStyle: { fontSize: 11, color: chartTextColor } },
      grid: baseGrid,
      xAxis: { type: 'category', data: sampledTimes.map(t => typeof t === 'number' ? t.toFixed(1) : t), name: '时间(s)', nameTextStyle: { color: chartTextColor }, boundaryGap: false, axisLabel: { color: chartTextColor }, axisLine: { lineStyle: { color: gridLineColor } }, splitLine: { show: false } },
      yAxis: { type: 'value', name: '角速度(°/s)', nameTextStyle: { color: chartTextColor }, splitLine: { lineStyle: { color: gridLineColor } }, axisLabel: { color: chartTextColor, formatter: (v) => parseFloat(Number(v).toFixed(2)) } },
      series: [
        { name: '角速度', type: 'line', smooth: true, symbol: 'none', data: (data.angularVelocity || []).filter((_, i) => i % step === 0).map(v => typeof v === 'number' ? parseFloat(v.toFixed(2)) : v), itemStyle: { color: '#9333EA' }, areaStyle: { opacity: 0.08 }, lineStyle: { width: 2 } },
        { name: '检测阈值', type: 'line', symbol: 'none', lineStyle: { type: 'dashed', color: '#DC2626', width: 1.5 }, data: sampledTimes.map(() => 30) }
      ]
    };
  }, [data]);

  const pieOption = useMemo(() => {
    if (!data?.fingers?.length) return {};
    return {
      tooltip: { formatter: (params) => `${params.name}: ${parseFloat(Number(params.value).toFixed(2))}N (${params.percent}%)`, ...tooltipStyle },
      legend: { orient: 'vertical', right: 15, top: 'center', textStyle: { fontSize: 11, color: chartTextColor } },
      series: [{
        type: 'pie', radius: ['35%', '68%'], center: ['40%', '50%'],
        itemStyle: { borderRadius: 6, borderColor: '#FFFFFF', borderWidth: 3 },
        data: data.fingers.map((f, i) => ({ value: typeof f.force === 'number' ? parseFloat(f.force.toFixed(2)) : f.force, name: f.name, itemStyle: { color: colors[i] } }))
      }]
    };
  }, [data]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
          <p style={{ color: 'var(--text-muted)' }}>正在加载报告数据...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="text-center">
          <p className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>暂无报告数据</p>
          <p style={{ color: 'var(--text-muted)' }}>请先完成握力评估采集</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg text-white" style={{ background: 'var(--zeiss-blue)' }}>返回</button>
        </div>
      </div>
    );
  }

  const handLabel = activeHand === 'left' ? '左手' : '右手';

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      {/* 顶部栏 */}
      <div className="px-6 py-3 flex items-center justify-between shrink-0"
        style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{patientName || '---'} 的握力评估报告</h2>
          {/* 左右手切换Tab */}
          {(hasLeft || hasRight) && (
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
              <button
                onClick={() => hasLeft && setActiveHand('left')}
                disabled={!hasLeft}
                className="px-4 py-1.5 text-sm font-medium transition-all"
                style={{
                  background: activeHand === 'left' ? 'var(--zeiss-blue)' : 'var(--bg-secondary)',
                  color: activeHand === 'left' ? '#FFFFFF' : hasLeft ? 'var(--text-tertiary)' : 'var(--text-muted)',
                  opacity: hasLeft ? 1 : 0.5,
                  cursor: hasLeft ? 'pointer' : 'not-allowed',
                }}>
                左手
              </button>
              <button
                onClick={() => hasRight && setActiveHand('right')}
                disabled={!hasRight}
                className="px-4 py-1.5 text-sm font-medium transition-all"
                style={{
                  background: activeHand === 'right' ? 'var(--zeiss-blue)' : 'var(--bg-secondary)',
                  color: activeHand === 'right' ? '#FFFFFF' : hasRight ? 'var(--text-tertiary)' : 'var(--text-muted)',
                  opacity: hasRight ? 1 : 0.5,
                  cursor: hasRight ? 'pointer' : 'not-allowed',
                  borderLeft: '1px solid var(--border-light)',
                }}>
                右手
              </button>
            </div>
          )}
          {onSwitchDynamic && (
            <button onClick={onSwitchDynamic}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors px-3 py-1.5 rounded-lg"
              style={{ color: 'var(--zeiss-blue)', background: 'var(--zeiss-blue-light)', border: '1px solid rgba(0,102,204,0.15)' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              切换动态报告
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <PdfBtn containerRef={contentRef} fileName={`${patientName || '报告'}_握力评估_${handLabel}`} />
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 侧边目录 */}
        <nav className="w-52 shrink-0 py-4 overflow-y-auto" style={{ borderRight: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest px-4 mb-3" style={{ color: 'var(--text-muted)' }}>报告目录</h3>
          {SECTIONS.map((s) => (
            <button key={s.id} onClick={() => scrollToSection(s.id)}
              className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 transition-all"
              style={{
                borderLeft: `3px solid ${activeSection === s.id ? 'var(--zeiss-blue)' : 'transparent'}`,
                background: activeSection === s.id ? 'var(--zeiss-blue-light)' : 'transparent',
                color: activeSection === s.id ? 'var(--zeiss-blue)' : 'var(--text-tertiary)',
                fontWeight: activeSection === s.id ? 600 : 400,
              }}>
              {s.label}
            </button>
          ))}
        </nav>

        {/* 滚动内容 */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6 scroll-smooth" style={{ background: 'var(--bg-primary)' }}>
          <div className="max-w-[1100px] mx-auto space-y-8">

            {/* 基本信息：总帧数移到不显眼位置，时间范围改为总时长 */}
            <section id="grip-overview">
              <SectionHeader title="基本信息" />
              <div className="zeiss-card p-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { l: '测试手类型', v: data.handType || handLabel },
                    { l: '采集时长', v: formatDuration(data.timeRange) },
                    { l: '峰值力', v: data.peakInfo ? `${parseFloat((data.peakInfo.peak_force ?? 0).toFixed(2))}N` : '-' }
                  ].map((item, i) => (
                    <div key={i} className="zeiss-card-inner p-3 text-center">
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                      <div className="text-sm font-bold" style={{ color: 'var(--zeiss-blue)' }}>{item.v}</div>
                    </div>
                  ))}
                </div>
                {/* 总帧数以小字显示在底部 */}
                <div className="mt-2 text-right pr-1">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>总帧数: {data.totalFrames}</span>
                </div>
              </div>
            </section>

            {/* 手部压力分布：面积单位 mm² → cm² */}
            <section id="grip-pressure">
              <SectionHeader title="手部压力分布" />
              <div className="flex gap-4">
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <HandPressureMap fingers={data.fingers} totalForce={data.totalForce} hand={data.hand || handLabel} sensorMatrix={data.peakSensorMatrix || data.avgSensorMatrix} />
                </div>
                <div className="w-[360px] space-y-2">
                  {(data.fingers || []).map((f, i) => (
                    <div key={i} className="zeiss-card p-3 flex items-center gap-3 transition-colors hover:shadow-md">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs"
                        style={{ backgroundColor: colors[i] + '15', color: colors[i], border: `1px solid ${colors[i]}30` }}>
                        {f.name?.[0] || '-'}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>{f.name || '-'}</div>
                        <div className="flex gap-3 text-[11px]">
                          <span><span style={{ color: 'var(--text-muted)' }}>力: </span><span style={{ color: 'var(--text-secondary)' }}>{typeof f.force === 'number' ? parseFloat(f.force.toFixed(2)) : (f.force ?? 0)}N</span></span>
                          <span><span style={{ color: 'var(--text-muted)' }}>面积: </span><span style={{ color: 'var(--text-secondary)' }}>{mm2ToCm2(f.area)}cm²</span></span>
                          <span><span style={{ color: 'var(--text-muted)' }}>点数: </span><span style={{ color: 'var(--text-secondary)' }}>{f.points ?? 0}</span></span>
                        </div>
                      </div>
                      <div className="text-lg font-bold" style={{ color: colors[i] }}>{data.totalForce > 0 ? parseFloat(((f.force ?? 0) / data.totalForce * 100).toFixed(1)) : 0}%</div>
                    </div>
                  ))}
                  <div className="zeiss-card p-3 flex justify-between items-center" style={{ background: 'var(--zeiss-blue-light)', borderColor: 'rgba(0,102,204,0.15)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>合计</span>
                    <div className="flex gap-5 text-sm">
                      <span style={{ color: 'var(--text-tertiary)' }}>总力: <b style={{ color: 'var(--zeiss-blue)' }}>{typeof data.totalForce === 'number' ? parseFloat(data.totalForce.toFixed(2)) : data.totalForce}N</b></span>
                      <span style={{ color: 'var(--text-tertiary)' }}>总面积: <b style={{ color: '#0891B2' }}>{mm2ToCm2(data.totalArea)}cm²</b></span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 力-时间曲线（图表先于数据表格）*/}
            <section id="grip-force-curve">
              <SectionHeader title={`${handLabel} - 力-时间曲线`} />
              <div className="zeiss-card p-4"><EChart option={forceTimeOption} height={320} /></div>
            </section>

            {/* 力分布堆叠图 */}
            <section id="grip-force-stack">
              <SectionHeader title={`${handLabel} - 各部位力分布（堆叠图）`} />
              <div className="zeiss-card p-4"><EChart option={stackOption} height={320} /></div>
            </section>

            {/* 各部位力分布（柱状图 + 饼图）*/}
            <section id="grip-force-bar">
              <SectionHeader title={`${handLabel} - 峰值帧各部位力分布`} />
              <div className="grid grid-cols-2 gap-4">
                <div className="zeiss-card p-4"><EChart option={barOption} height={280} /></div>
                <div className="zeiss-card p-4"><EChart option={pieOption} height={280} /></div>
              </div>
            </section>

            {/* 手部姿态 */}
            <section id="grip-euler">
              <SectionHeader title={`${handLabel} - 手部姿态（欧拉角）`} />
              <div className="zeiss-card p-4"><EChart option={eulerOption} height={320} /></div>
            </section>

            {/* 抖动检测 */}
            <section id="grip-angular">
              <SectionHeader title={`${handLabel} - 角速度曲线（抖动检测）`} />
              <div className="zeiss-card p-4"><EChart option={angVelOption} height={320} /></div>
            </section>

            {/* 时间分析（数据表格移到图表后面）*/}
            <section id="grip-time-analysis">
              <SectionHeader title="时间与抖动分析" />
              <div className="zeiss-card overflow-hidden">
                <div className="grid grid-cols-4 gap-px" style={{ background: 'var(--border-light)' }}>
                  {(data.timeAnalysis || []).map((row, i) => (
                    <div key={i} className="p-3 text-center transition-colors" style={{ background: 'var(--bg-secondary)' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>{row.label}</div>
                      <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{row.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 峰值帧数据（数据表格移到图表后面，面积单位 mm² → cm²）*/}
            <section id="grip-peak-data">
              <SectionHeader title="峰值帧各部位数据" />
              <div className="zeiss-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--zeiss-blue-light)' }}>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-tertiary)' }}>部位</th>
                      <th className="px-4 py-3 text-center font-medium" style={{ color: 'var(--text-tertiary)' }}>ADC</th>
                      <th className="px-4 py-3 text-center font-medium" style={{ color: 'var(--text-tertiary)' }}>力 (N)</th>
                      <th className="px-4 py-3 text-center font-medium" style={{ color: 'var(--text-tertiary)' }}>面积 (cm²)</th>
                      <th className="px-4 py-3 text-center font-medium" style={{ color: 'var(--text-tertiary)' }}>点数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.fingers || []).map((f, i) => (
                      <tr key={i} className="transition-colors" style={{ borderTop: '1px solid var(--border-light)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td className="px-4 py-2.5 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[i] }}/>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{f.name || '-'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center" style={{ color: 'var(--text-tertiary)' }}>{f.adc ?? '-'}</td>
                        <td className="px-4 py-2.5 text-center font-semibold" style={{ color: 'var(--text-primary)' }}>{typeof f.force === 'number' ? parseFloat(f.force.toFixed(2)) : (f.force ?? '-')}</td>
                        <td className="px-4 py-2.5 text-center" style={{ color: 'var(--text-tertiary)' }}>{mm2ToCm2(f.area)}</td>
                        <td className="px-4 py-2.5 text-center" style={{ color: 'var(--text-tertiary)' }}>{f.points ?? '-'}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--border-medium)', background: 'var(--bg-tertiary)' }}>
                      <td className="px-4 py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>合计</td>
                      <td className="px-4 py-2.5 text-center" style={{ color: 'var(--text-muted)' }}>-</td>
                      <td className="px-4 py-2.5 text-center font-bold" style={{ color: 'var(--zeiss-blue)' }}>{typeof data.totalForce === 'number' ? parseFloat(data.totalForce.toFixed(2)) : data.totalForce}</td>
                      <td className="px-4 py-2.5 text-center font-bold" style={{ color: '#0891B2' }}>{mm2ToCm2(data.totalArea)}</td>
                      <td className="px-4 py-2.5 text-center" style={{ color: 'var(--text-muted)' }}>-</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div className="h-8" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── 辅助组件 ─── */
function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1 h-6 rounded-full" style={{ background: 'linear-gradient(to bottom, var(--zeiss-blue), #0891B2)' }} />
      <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    </div>
  );
}

function PdfBtn({ containerRef, fileName }) {
  const [exporting, setExporting] = React.useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportToPdf(containerRef?.current, fileName, { title: '握力评估报告' });
    } finally {
      setExporting(false);
    }
  };
  return (
    <button onClick={handleExport} disabled={exporting}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
      style={{
        color: exporting ? 'var(--text-muted)' : '#DC2626',
        background: exporting ? 'var(--bg-tertiary)' : '#FEF2F2',
        border: '1px solid #FCA5A530',
        cursor: exporting ? 'wait' : 'pointer',
      }}>
      {exporting ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
      {exporting ? '导出中...' : '导出 PDF'}
    </button>
  );
}
