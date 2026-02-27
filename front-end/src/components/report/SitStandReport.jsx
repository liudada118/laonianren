import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as echarts from 'echarts';

/* ─── 样式常量 ─── */
const C = {
  text: '#6B7B8D', grid: '#EDF0F4', blue: '#0066CC', green: '#059669',
  red: '#DC2626', amber: '#D97706', cyan: '#0891B2', purple: '#7C3AED',
};
const ttStyle = {
  backgroundColor: '#fff', borderColor: '#E5E9EF',
  textStyle: { color: '#1A2332', fontSize: 11 },
  extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,0.08);border-radius:8px;',
};

/* ─── EChart 封装 ─── */
function EChart({ option, height = 280 }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    chartRef.current.setOption(option, { notMerge: false });
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); };
  }, [option]);
  useEffect(() => () => { chartRef.current?.dispose(); chartRef.current = null; }, []);
  return <div ref={ref} style={{ width: '100%', height }} />;
}

/* ─── COP 轨迹 Canvas 渲染组件 ─── */
function COPTrajectoryCanvas({ imageData, title, height = 360 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imageData) return;

    if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, height);
        ctx.fillStyle = '#0A0E17';
        ctx.fillRect(0, 0, rect.width, height);

        const imgAspect = img.width / img.height;
        const canvasAspect = rect.width / height;
        let drawW, drawH, drawX, drawY;
        if (imgAspect > canvasAspect) {
          drawW = rect.width * 0.9;
          drawH = drawW / imgAspect;
          drawX = (rect.width - drawW) / 2;
          drawY = (height - drawH) / 2;
        } else {
          drawH = height * 0.9;
          drawW = drawH * imgAspect;
          drawX = (rect.width - drawW) / 2;
          drawY = (height - drawH) / 2;
        }
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
      };
      img.src = imageData;
    }
  }, [imageData, height]);

  return (
    <div ref={containerRef} className="w-full">
      {title && (
        <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>
          {title}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg"
        style={{ height, background: '#0A0E17' }}
      />
    </div>
  );
}

/* ─── 力-时间曲线 ECharts 组件 ─── */
function ForceTimeChart({ times, forces, peaksIdx, title, color = C.blue, height = 280 }) {
  const option = useMemo(() => {
    if (!times || !forces || times.length === 0) return null;

    let data;
    if (times.length > 1000) {
      data = lttbDownsample(times, forces, 1000);
    } else {
      data = times.map((t, i) => [t, forces[i]]);
    }

    const markLines = (peaksIdx || [])
      .filter(idx => idx < times.length)
      .map(idx => ({ xAxis: times[idx] }));

    return {
      animation: false,
      grid: { top: 40, bottom: 40, left: 60, right: 20 },
      tooltip: {
        trigger: 'axis',
        ...ttStyle,
        formatter: (params) => {
          const p = params[0];
          return `<div style="font-size:12px"><b>时间:</b> ${p.value[0].toFixed(2)}s<br/><b>压力:</b> ${p.value[1].toFixed(0)}</div>`;
        },
      },
      xAxis: {
        type: 'value',
        name: '时间 (s)',
        nameTextStyle: { color: C.text, fontSize: 11 },
        axisLabel: { color: C.text, fontSize: 10 },
        splitLine: { lineStyle: { color: C.grid } },
      },
      yAxis: {
        type: 'value',
        name: '压力值',
        nameTextStyle: { color: C.text, fontSize: 11 },
        axisLabel: { color: C.text, fontSize: 10 },
        splitLine: { lineStyle: { color: C.grid } },
      },
      series: [{
        type: 'line',
        data,
        smooth: true,
        symbol: 'none',
        lineStyle: { color, width: 1.5 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: color + '30' },
              { offset: 1, color: 'transparent' },
            ],
          },
        },
        markLine: markLines.length > 0 ? {
          data: markLines,
          lineStyle: { type: 'dashed', color: C.red, width: 1 },
          label: { show: false },
          symbol: 'none',
        } : undefined,
      }],
    };
  }, [times, forces, peaksIdx, color]);

  if (!option) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无数据</span>
      </div>
    );
  }

  return (
    <div>
      {title && (
        <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>
          {title}
        </div>
      )}
      <EChart option={option} height={height} />
    </div>
  );
}

/* ─── 周期时长柱状图 ─── */
function CycleDurationChart({ durations, height = 220 }) {
  const option = useMemo(() => {
    if (!durations || durations.length === 0) return null;
    const labels = durations.map((_, i) => `第${i + 1}周期`);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    return {
      animation: false,
      grid: { top: 30, bottom: 36, left: 50, right: 20 },
      tooltip: { ...ttStyle, trigger: 'axis', formatter: (p) => `${p[0].name}: ${p[0].value.toFixed(2)}s` },
      xAxis: { type: 'category', data: labels, axisLabel: { color: C.text, fontSize: 10, rotate: durations.length > 6 ? 30 : 0 } },
      yAxis: { type: 'value', name: '时长 (s)', nameTextStyle: { color: C.text, fontSize: 11 }, axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: 'bar',
        data: durations.map(v => ({
          value: v,
          itemStyle: { color: v <= avg ? C.green : C.amber, borderRadius: [4, 4, 0, 0] },
        })),
        barWidth: '50%',
        markLine: {
          data: [{ yAxis: avg, label: { formatter: `均值 ${avg.toFixed(2)}s`, fontSize: 10, color: C.red } }],
          lineStyle: { type: 'dashed', color: C.red, width: 1 },
          symbol: 'none',
        },
      }],
    };
  }, [durations]);

  if (!option) return null;
  return <EChart option={option} height={height} />;
}

/* ─── 各周期峰值力柱状图 ─── */
function CyclePeakForceChart({ peakForces, height = 220 }) {
  const option = useMemo(() => {
    if (!peakForces || peakForces.length === 0) return null;
    const labels = peakForces.map((_, i) => `峰值${i + 1}`);
    const avg = peakForces.reduce((a, b) => a + b, 0) / peakForces.length;
    return {
      animation: false,
      grid: { top: 30, bottom: 36, left: 60, right: 20 },
      tooltip: { ...ttStyle, trigger: 'axis', formatter: (p) => `${p[0].name}: ${p[0].value.toFixed(0)}` },
      xAxis: { type: 'category', data: labels, axisLabel: { color: C.text, fontSize: 10, rotate: peakForces.length > 6 ? 30 : 0 } },
      yAxis: { type: 'value', name: '峰值力', nameTextStyle: { color: C.text, fontSize: 11 }, axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: 'bar',
        data: peakForces.map(v => ({
          value: v,
          itemStyle: { color: C.cyan, borderRadius: [4, 4, 0, 0] },
        })),
        barWidth: '50%',
        markLine: {
          data: [{ yAxis: avg, label: { formatter: `均值 ${avg.toFixed(0)}`, fontSize: 10, color: C.purple } }],
          lineStyle: { type: 'dashed', color: C.purple, width: 1 },
          symbol: 'none',
        },
      }],
    };
  }, [peakForces]);

  if (!option) return null;
  return <EChart option={option} height={height} />;
}

/* ─── 左右脚对称性环形图 ─── */
function SymmetryGauge({ ratio, leftTotal, rightTotal, height = 180 }) {
  const option = useMemo(() => {
    const r = ratio || 0;
    const gaugeColor = r >= 80 ? C.green : r >= 60 ? C.amber : C.red;
    const label = r >= 80 ? '良好' : r >= 60 ? '一般' : '较差';
    return {
      animation: false,
      series: [{
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        radius: '90%',
        center: ['50%', '55%'],
        pointer: { show: false },
        progress: { show: true, width: 14, roundCap: true, itemStyle: { color: gaugeColor } },
        axisLine: { lineStyle: { width: 14, color: [[1, '#EDF0F4']] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: false,
          formatter: `${r.toFixed(1)}%\n${label}`,
          fontSize: 16,
          fontWeight: 'bold',
          color: gaugeColor,
          offsetCenter: [0, '10%'],
          lineHeight: 22,
        },
        data: [{ value: r }],
      }],
    };
  }, [ratio]);

  return (
    <div>
      <EChart option={option} height={height} />
      {(leftTotal != null && rightTotal != null) && (
        <div className="flex justify-center gap-6 -mt-2">
          <div className="text-center">
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>左脚总力</div>
            <div className="text-xs font-bold" style={{ color: C.blue }}>{Number(leftTotal).toLocaleString()}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>右脚总力</div>
            <div className="text-xs font-bold" style={{ color: C.green }}>{Number(rightTotal).toLocaleString()}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── LTTB 降采样算法 ─── */
function lttbDownsample(times, values, targetCount) {
  const n = times.length;
  if (n <= targetCount) return times.map((t, i) => [t, values[i]]);

  const sampled = [[times[0], values[0]]];
  const bucketSize = (n - 2) / (targetCount - 2);

  for (let i = 1; i < targetCount - 1; i++) {
    const start = Math.floor((i - 1) * bucketSize) + 1;
    const end = Math.min(Math.floor(i * bucketSize) + 1, n);
    const nextStart = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    let avgX = 0, avgY = 0, count = 0;
    for (let j = nextStart; j < nextEnd && j < n; j++) {
      avgX += times[j]; avgY += values[j]; count++;
    }
    if (count > 0) { avgX /= count; avgY /= count; }

    let maxArea = -1, maxIdx = start;
    const [ax, ay] = sampled[sampled.length - 1];
    for (let j = start; j < end && j < n; j++) {
      const area = Math.abs((times[j] - ax) * (avgY - ay) - (avgX - ax) * (values[j] - ay));
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }
    sampled.push([times[maxIdx], values[maxIdx]]);
  }
  sampled.push([times[n - 1], values[n - 1]]);
  return sampled;
}

/* ─── 指标卡片 ─── */
function MetricCard({ label, value, sub, color, icon }) {
  return (
    <div className="zeiss-card-inner p-4 text-center">
      {icon && <div className="text-lg mb-1">{icon}</div>}
      <div className="text-2xl font-bold" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  );
}

/* ─── 报告目录 ─── */
const SECTIONS = [
  { id: 'overview', title: '基本信息' },
  { id: 'summary', title: '总体指标' },
  { id: 'cycle-detail', title: '周期分析' },
  { id: 'symmetry', title: '对称性分析' },
  { id: 'stand-evo', title: '站立压力演变' },
  { id: 'stand-cop', title: '站立COP轨迹' },
  { id: 'sit-evo', title: '坐姿压力演变' },
  { id: 'sit-cop', title: '坐姿COP轨迹' },
  { id: 'force-curve', title: '力-时间曲线' },
  { id: 'pressure-stats', title: '压力统计' },
  { id: 'conclusion', title: '综合评估' },
];

/* ═══════════════════════════════════════════
   主报告组件
   ═══════════════════════════════════════════ */
export default function SitStandReport({ patientInfo, reportData: propsReportData }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(!propsReportData);

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

  const d = reportData;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mx-auto mb-3"
          style={{ borderColor: 'var(--zeiss-blue)', borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载报告数据...</p>
      </div>
    </div>
  );

  if (!d) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>报告数据加载失败</p>
    </div>
  );

  // ===== 数据解析 - 兼容后端API和前端生成两种格式 =====
  const images = d.images || {};
  const forceCurves = d.force_curves || {};

  // 热力图和COP图
  const standEvolution = images.stand_evolution || [];
  const sitEvolution = images.sit_evolution || [];
  const standCopLeft = images.stand_cop_left || null;
  const standCopRight = images.stand_cop_right || null;
  const sitCopImage = images.sit_cop || null;

  // 力-时间曲线数据 - 兼容两种格式
  const standTimes = forceCurves.stand_times || d.footpad_force_curve?.times || [];
  const standForce = forceCurves.stand_force || d.footpad_force_curve?.values || [];
  const sitTimes = forceCurves.sit_times || d.seat_force_curve?.times || [];
  const sitForce = forceCurves.sit_force || d.seat_force_curve?.values || [];
  const standPeaksIdx = forceCurves.stand_peaks_idx || [];

  // 周期分析数据
  const durationStats = d.duration_stats || {};
  const cycleDurations = durationStats.cycle_durations || [];
  const minCycleDuration = durationStats.min_cycle_duration || (cycleDurations.length > 0 ? Math.min(...cycleDurations) : null);
  const maxCycleDuration = durationStats.max_cycle_duration || (cycleDurations.length > 0 ? Math.max(...cycleDurations) : null);

  // 对称性数据
  const symmetry = d.symmetry || {};
  const symmetryRatio = symmetry.left_right_ratio || null;
  const leftTotal = symmetry.left_total || null;
  const rightTotal = symmetry.right_total || null;

  // 压力统计
  const pressureStats = d.pressure_stats || {};
  const seatStats = d.seat_stats || {};
  const footpadStats = d.footpad_stats || {};

  // 各周期峰值力
  const cyclePeakForces = d.cycle_peak_forces || [];

  // 旧格式兼容
  const hasOldFormat = !d.images && d.stand_evolution;
  const BASE = '/sitstand_report_data/';

  // 演变标签
  const evoLabels = ['0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
  const sitEvoLabels = ['Start', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', 'End'];

  // 评估等级
  const totalDur = durationStats.total_duration || 0;
  const evalLevel = totalDur > 0 && totalDur < 12 ? { text: '优秀', color: C.green }
    : totalDur <= 15 ? { text: '正常', color: C.cyan }
    : totalDur <= 20 ? { text: '偏慢', color: C.amber }
    : { text: '异常', color: C.red };

  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <nav className="w-48 shrink-0 p-4 sticky top-0 overflow-y-auto" style={{ borderRight: '1px solid var(--border-light)' }}>
        <h3 className="text-xs font-semibold mb-4 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          报告目录
        </h3>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => scrollToSection(s.id)}
            className={`zeiss-nav-item mb-1 ${activeSection === s.id ? 'active' : ''}`}>
            {s.title}
          </button>
        ))}
      </nav>

      {/* 右侧内容 */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ══════ 1. 基本信息 ══════ */}
        <section id="sit-overview">
          <div className="zeiss-section-title">基本信息</div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { l: '姓名', v: patientInfo?.name || d.username || '---' },
              { l: '测试类型', v: '五次起坐测试' },
              { l: '测试时间', v: d.test_date || new Date().toLocaleString('zh-CN') },
              { l: '评估等级', v: evalLevel.text, c: evalLevel.color },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-4">
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                <div className="text-sm font-semibold" style={{ color: item.c || 'var(--text-primary)' }}>{item.v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ══════ 2. 总体指标 ══════ */}
        <section id="sit-summary">
          <div className="zeiss-section-title">总体指标</div>
          <div className="grid grid-cols-4 gap-4">
            <MetricCard label="总时长" value={`${totalDur.toFixed(1)}s`} color={C.blue}
              sub={totalDur <= 15 ? '正常范围 (<15s)' : '偏慢 (>15s)'} />
            <MetricCard label="完成周期数" value={`${durationStats.num_cycles || '--'}次`} color={C.green} />
            <MetricCard label="平均周期时长" value={`${durationStats.avg_duration?.toFixed(2) || '--'}s`} color={C.cyan} />
            <MetricCard label="检测峰值数" value={`${d.stand_peaks || standPeaksIdx.length || '--'}`} color={C.purple} />
          </div>
          {/* 帧数信息 */}
          <div className="grid grid-cols-3 gap-4 mt-3">
            <div className="zeiss-card-inner p-3 text-center">
              <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{d.stand_frames || '--'}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>站立帧数</div>
            </div>
            <div className="zeiss-card-inner p-3 text-center">
              <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{d.sit_frames || '--'}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>坐姿帧数</div>
            </div>
            <div className="zeiss-card-inner p-3 text-center">
              <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {standTimes.length >= 2 ? `${(1000 / ((standTimes[standTimes.length - 1] - standTimes[0]) / standTimes.length * 1000)).toFixed(0)} Hz` : '--'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>采样率</div>
            </div>
          </div>
        </section>

        {/* ══════ 3. 周期分析 ══════ */}
        <section id="sit-cycle-detail">
          <div className="zeiss-section-title">周期分析</div>
          {cycleDurations.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <MetricCard label="最快周期" value={`${minCycleDuration?.toFixed(2) || '--'}s`} color={C.green} />
                <MetricCard label="最慢周期" value={`${maxCycleDuration?.toFixed(2) || '--'}s`} color={C.amber} />
                <MetricCard label="周期时长标准差"
                  value={`${(Math.sqrt(cycleDurations.reduce((s, v) => s + (v - durationStats.avg_duration) ** 2, 0) / cycleDurations.length)).toFixed(2)}s`}
                  color={C.purple}
                  sub="越小越稳定" />
              </div>
              <div className="zeiss-card p-4">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>各周期时长分布</div>
                <CycleDurationChart durations={cycleDurations} height={220} />
              </div>
            </>
          ) : (
            <div className="zeiss-card p-4">
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>周期信息</div>
              <div className="grid grid-cols-2 gap-4">
                <MetricCard label="总时长" value={`${totalDur.toFixed(1)}s`} color={C.blue} />
                <MetricCard label="周期数" value={`${durationStats.num_cycles || '--'}`} color={C.green} />
              </div>
              {d.cycles && d.cycles.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>检测到的周期区间</div>
                  <div className="flex flex-wrap gap-2">
                    {d.cycles.map((c, i) => (
                      <span key={i} className="text-[10px] px-2 py-1 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                        周期{i + 1}: 帧{c.start}~{c.end}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 各周期峰值力 */}
          {cyclePeakForces.length > 0 && (
            <div className="zeiss-card p-4 mt-4">
              <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>各峰值力分布</div>
              <CyclePeakForceChart peakForces={cyclePeakForces} height={220} />
            </div>
          )}
        </section>

        {/* ══════ 4. 对称性分析 ══════ */}
        <section id="sit-symmetry">
          <div className="zeiss-section-title">对称性分析</div>
          {symmetryRatio != null ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="zeiss-card p-4">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>左右脚对称性指数</div>
                <SymmetryGauge ratio={symmetryRatio} leftTotal={leftTotal} rightTotal={rightTotal} height={180} />
                <div className="text-[10px] text-center mt-1" style={{ color: 'var(--text-muted)' }}>
                  对称性 = min(左,右) / max(左,右) × 100%
                </div>
              </div>
              <div className="zeiss-card p-4">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>对称性评估</div>
                <div className="space-y-3 mt-4">
                  <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>对称性比值</span>
                    <span className="text-sm font-bold" style={{ color: symmetryRatio >= 80 ? C.green : symmetryRatio >= 60 ? C.amber : C.red }}>
                      {symmetryRatio.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>左脚占比</span>
                    <span className="text-sm font-bold" style={{ color: C.blue }}>
                      {leftTotal && rightTotal ? ((leftTotal / (leftTotal + rightTotal)) * 100).toFixed(1) : '--'}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>右脚占比</span>
                    <span className="text-sm font-bold" style={{ color: C.green }}>
                      {leftTotal && rightTotal ? ((rightTotal / (leftTotal + rightTotal)) * 100).toFixed(1) : '--'}%
                    </span>
                  </div>
                  <div className="p-3 rounded-lg text-xs leading-relaxed" style={{ background: symmetryRatio >= 80 ? '#05966910' : symmetryRatio >= 60 ? '#D9770610' : '#DC262610', color: 'var(--text-secondary)' }}>
                    {symmetryRatio >= 80
                      ? '左右脚受力分布较为均衡，对称性良好，表明站立时重心控制稳定。'
                      : symmetryRatio >= 60
                      ? '左右脚受力存在一定差异，建议关注站立时的重心偏移情况。'
                      : '左右脚受力明显不对称，可能存在单侧肌力不足或代偿性站姿，建议进一步评估。'}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="zeiss-card p-6 flex items-center justify-center" style={{ minHeight: 120 }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无对称性数据（需后端算法支持）</span>
            </div>
          )}
        </section>

        {/* ══════ 5. 站立足底压力演变 ══════ */}
        <section id="sit-stand-evo">
          <div className="zeiss-section-title">站立足底压力演变</div>
          <div className="zeiss-card p-4">
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              站立过程中左右脚足底压力分布随时间的变化（0%~100%）
            </p>

            {standEvolution.length > 0 && standEvolution[0]?.image ? (
              <>
                <div className="flex gap-1 mb-1 pl-12">
                  {evoLabels.map((label, i) => (
                    <div key={i} className="flex-1 text-center text-[10px] font-medium"
                      style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                  ))}
                </div>
                <div className="flex items-center gap-1 mb-1">
                  <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: C.blue }}>左脚</div>
                  <div className="flex gap-1 flex-1">
                    {standEvolution
                      .filter(h => h.label === 0)
                      .sort((a, b) => a.sublabel - b.sublabel)
                      .map((h, i) => (
                        <div key={i} className="flex-1">
                          <img src={h.image} alt={`左脚 ${evoLabels[h.sublabel]}`}
                            className="w-full rounded" style={{ background: '#0A0E17' }} />
                        </div>
                      ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: C.green }}>右脚</div>
                  <div className="flex gap-1 flex-1">
                    {standEvolution
                      .filter(h => h.label === 1)
                      .sort((a, b) => a.sublabel - b.sublabel)
                      .map((h, i) => (
                        <div key={i} className="flex-1">
                          <img src={h.image} alt={`右脚 ${evoLabels[h.sublabel]}`}
                            className="w-full rounded" style={{ background: '#0A0E17' }} />
                        </div>
                      ))}
                  </div>
                </div>
              </>
            ) : hasOldFormat && d.stand_evolution?.heatmaps ? (
              <>
                <div className="flex gap-1 mb-1 pl-12">
                  {(d.stand_evolution?.labels || evoLabels).map((label, i) => (
                    <div key={i} className="flex-1 text-center text-[10px] font-medium"
                      style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                  ))}
                </div>
                <div className="flex items-center gap-1 mb-1">
                  <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: C.blue }}>左脚</div>
                  <div className="flex gap-1 flex-1">
                    {d.stand_evolution.heatmaps
                      .filter(h => h.foot === 'left')
                      .sort((a, b) => a.col - b.col)
                      .map((h, i) => (
                        <div key={i} className="flex-1">
                          <img src={`${BASE}${h.file}`} alt={`左脚 ${d.stand_evolution.labels[h.col]}`}
                            className="w-full rounded" style={{ background: '#f8f9fa' }} />
                        </div>
                      ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: C.green }}>右脚</div>
                  <div className="flex gap-1 flex-1">
                    {d.stand_evolution.heatmaps
                      .filter(h => h.foot === 'right')
                      .sort((a, b) => a.col - b.col)
                      .map((h, i) => (
                        <div key={i} className="flex-1">
                          <img src={`${BASE}${h.file}`} alt={`右脚 ${d.stand_evolution.labels[h.col]}`}
                            className="w-full rounded" style={{ background: '#f8f9fa' }} />
                        </div>
                      ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-12">
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无站立演变数据</span>
              </div>
            )}
          </div>
        </section>

        {/* ══════ 6. 站立COP轨迹 ══════ */}
        <section id="sit-stand-cop">
          <div className="zeiss-section-title">站立COP轨迹</div>
          <div className="grid grid-cols-2 gap-4">
            {standCopLeft ? (
              <div className="zeiss-card p-4">
                <COPTrajectoryCanvas imageData={standCopLeft} title="左脚 COP 轨迹" height={360} />
              </div>
            ) : hasOldFormat && d.stand_cop?.left_image ? (
              <div className="zeiss-card p-4 text-center">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>左脚 COP 轨迹</div>
                <img src={`${BASE}${d.stand_cop.left_image}`} alt="左脚COP"
                  className="mx-auto rounded-lg" style={{ maxHeight: 360, objectFit: 'contain' }} />
              </div>
            ) : (
              <div className="zeiss-card p-4 flex items-center justify-center" style={{ minHeight: 200 }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无左脚COP数据</span>
              </div>
            )}

            {standCopRight ? (
              <div className="zeiss-card p-4">
                <COPTrajectoryCanvas imageData={standCopRight} title="右脚 COP 轨迹" height={360} />
              </div>
            ) : hasOldFormat && d.stand_cop?.right_image ? (
              <div className="zeiss-card p-4 text-center">
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>右脚 COP 轨迹</div>
                <img src={`${BASE}${d.stand_cop.right_image}`} alt="右脚COP"
                  className="mx-auto rounded-lg" style={{ maxHeight: 360, objectFit: 'contain' }} />
              </div>
            ) : (
              <div className="zeiss-card p-4 flex items-center justify-center" style={{ minHeight: 200 }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无右脚COP数据</span>
              </div>
            )}
          </div>
        </section>

        {/* ══════ 7. 坐姿压力演变 ══════ */}
        <section id="sit-sit-evo">
          <div className="zeiss-section-title">坐姿压力演变</div>
          <div className="zeiss-card p-4">
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              坐姿过程中坐垫压力分布随时间的变化（Start~End）
            </p>

            {sitEvolution.length > 0 && sitEvolution[0]?.image ? (
              <>
                <div className="flex gap-1 mb-1">
                  {sitEvoLabels.map((label, i) => (
                    <div key={i} className="flex-1 text-center text-[10px] font-medium"
                      style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                  ))}
                </div>
                <div className="flex gap-1">
                  {sitEvolution
                    .sort((a, b) => a.label - b.label)
                    .map((h, i) => (
                      <div key={i} className="flex-1">
                        <img src={h.image} alt={`坐姿 ${sitEvoLabels[h.label]}`}
                          className="w-full rounded" style={{ background: '#0A0E17' }} />
                      </div>
                    ))}
                </div>
              </>
            ) : hasOldFormat && d.sit_evolution?.heatmaps ? (
              <>
                <div className="flex gap-1 mb-1">
                  {(d.sit_evolution?.labels || sitEvoLabels).map((label, i) => (
                    <div key={i} className="flex-1 text-center text-[10px] font-medium"
                      style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                  ))}
                </div>
                <div className="flex gap-1">
                  {d.sit_evolution.heatmaps
                    .sort((a, b) => a.col - b.col)
                    .map((h, i) => (
                      <div key={i} className="flex-1">
                        <img src={`${BASE}${h.file}`} alt={`坐姿 ${d.sit_evolution.labels[h.col]}`}
                          className="w-full rounded" style={{ background: '#f8f9fa' }} />
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-12">
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无坐姿演变数据</span>
              </div>
            )}
          </div>
        </section>

        {/* ══════ 8. 坐姿COP轨迹 ══════ */}
        <section id="sit-sit-cop">
          <div className="zeiss-section-title">坐姿COP轨迹</div>
          {sitCopImage ? (
            <div className="zeiss-card p-4">
              <COPTrajectoryCanvas imageData={sitCopImage} title="坐姿 COP 轨迹" height={400} />
            </div>
          ) : hasOldFormat && d.sit_cop?.image ? (
            <div className="zeiss-card p-4 text-center">
              <img src={`${BASE}${d.sit_cop.image}`} alt="坐姿COP"
                className="mx-auto rounded-lg" style={{ maxHeight: 400, objectFit: 'contain' }} />
            </div>
          ) : (
            <div className="zeiss-card p-4 flex items-center justify-center" style={{ minHeight: 200 }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无坐姿COP数据</span>
            </div>
          )}
        </section>

        {/* ══════ 9. 力-时间曲线 ══════ */}
        <section id="sit-force-curve">
          <div className="zeiss-section-title">力-时间曲线</div>
          <div className="grid grid-cols-1 gap-4">
            <div className="zeiss-card p-4">
              {standTimes.length > 0 && standForce.length > 0 ? (
                <ForceTimeChart
                  times={standTimes}
                  forces={standForce}
                  peaksIdx={standPeaksIdx}
                  title="站立脚垫 - 总力随时间变化"
                  color={C.green}
                  height={280}
                />
              ) : hasOldFormat && d.force_curves?.stand_curve ? (
                <>
                  <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>
                    站立脚垫 - 总力随时间变化
                  </div>
                  <img src={`${BASE}${d.force_curves.stand_curve}`} alt="站立力曲线"
                    className="w-full rounded-lg" />
                </>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无站立力曲线数据</span>
                </div>
              )}
            </div>

            <div className="zeiss-card p-4">
              {sitTimes.length > 0 && sitForce.length > 0 ? (
                <ForceTimeChart
                  times={sitTimes}
                  forces={sitForce}
                  title="坐姿坐垫 - 总力随时间变化"
                  color={C.blue}
                  height={280}
                />
              ) : hasOldFormat && d.force_curves?.sit_curve ? (
                <>
                  <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>
                    坐姿坐垫 - 总力随时间变化
                  </div>
                  <img src={`${BASE}${d.force_curves.sit_curve}`} alt="坐姿力曲线"
                    className="w-full rounded-lg" />
                </>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无坐姿力曲线数据</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ══════ 10. 压力统计 ══════ */}
        <section id="sit-pressure-stats">
          <div className="zeiss-section-title">压力统计</div>
          {(pressureStats.foot_max || pressureStats.sit_max || seatStats.max_pressure || footpadStats.max_pressure) ? (
            <div className="grid grid-cols-2 gap-4">
              {/* 脚垫压力 */}
              <div className="zeiss-card p-4">
                <div className="text-xs font-medium mb-3" style={{ color: 'var(--text-tertiary)' }}>脚垫压力统计</div>
                <div className="space-y-2">
                  {[
                    { l: '最大总压力', v: pressureStats.foot_max || footpadStats.max_pressure || '--', c: C.red },
                    { l: '平均总压力', v: pressureStats.foot_avg || footpadStats.mean_pressure || '--', c: C.blue },
                    ...(pressureStats.max_foot_change_rate ? [{ l: '最大变化率', v: pressureStats.max_foot_change_rate, c: C.amber }] : []),
                    ...(footpadStats.total_pressure ? [{ l: '累计总压力', v: footpadStats.total_pressure, c: C.cyan }] : []),
                    ...(footpadStats.contact_area ? [{ l: '接触面积', v: footpadStats.contact_area, c: C.green }] : []),
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.l}</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: item.c }}>
                        {typeof item.v === 'number' ? item.v.toLocaleString() : item.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 坐垫压力 */}
              <div className="zeiss-card p-4">
                <div className="text-xs font-medium mb-3" style={{ color: 'var(--text-tertiary)' }}>坐垫压力统计</div>
                <div className="space-y-2">
                  {[
                    { l: '最大总压力', v: pressureStats.sit_max || seatStats.max_pressure || '--', c: C.red },
                    { l: '平均总压力', v: pressureStats.sit_avg || seatStats.mean_pressure || '--', c: C.blue },
                    ...(pressureStats.max_sit_change_rate ? [{ l: '最大变化率', v: pressureStats.max_sit_change_rate, c: C.amber }] : []),
                    ...(seatStats.total_pressure ? [{ l: '累计总压力', v: seatStats.total_pressure, c: C.cyan }] : []),
                    ...(seatStats.contact_area ? [{ l: '接触面积', v: seatStats.contact_area, c: C.green }] : []),
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.l}</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: item.c }}>
                        {typeof item.v === 'number' ? item.v.toLocaleString() : item.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="zeiss-card p-6 flex items-center justify-center" style={{ minHeight: 120 }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无压力统计数据</span>
            </div>
          )}
        </section>

        {/* ══════ 11. 综合评估 ══════ */}
        <section id="sit-conclusion">
          <div className="zeiss-section-title">综合评估</div>
          <div className="zeiss-card p-5">
            {/* 评估等级标签 */}
            <div className="flex items-center gap-3 mb-4">
              <div className="px-4 py-2 rounded-lg text-sm font-bold"
                style={{ background: evalLevel.color + '15', color: evalLevel.color }}>
                评估等级: {evalLevel.text}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                依据 EWGSOP2 标准 (五次起坐测试 &lt;15s 为正常)
              </div>
            </div>

            {/* 评估结论 */}
            <div className="space-y-3">
              <div className="p-4 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                <h5 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>测试概况</h5>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  受试者完成五次起坐测试，总时长 <b>{totalDur.toFixed(1)}</b> 秒，
                  共检测到 <b>{d.stand_peaks || standPeaksIdx.length || '--'}</b> 个力峰值，
                  <b>{durationStats.num_cycles || '--'}</b> 个完整周期，
                  平均周期时长 <b>{durationStats.avg_duration?.toFixed(2) || '--'}</b> 秒。
                  {cycleDurations.length > 0 && (
                    <>最快周期 <b>{minCycleDuration?.toFixed(2)}s</b>，最慢周期 <b>{maxCycleDuration?.toFixed(2)}s</b>。</>
                  )}
                </p>
              </div>

              {symmetryRatio != null && (
                <div className="p-4 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                  <h5 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>对称性评估</h5>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    左右脚对称性指数为 <b style={{ color: symmetryRatio >= 80 ? C.green : symmetryRatio >= 60 ? C.amber : C.red }}>
                      {symmetryRatio.toFixed(1)}%
                    </b>
                    {leftTotal && rightTotal && (
                      <>（左脚总力 {Number(leftTotal).toLocaleString()}，右脚总力 {Number(rightTotal).toLocaleString()}）</>
                    )}。
                    {symmetryRatio >= 80
                      ? '左右脚受力分布均衡，对称性良好。'
                      : symmetryRatio >= 60
                      ? '左右脚受力存在一定差异，建议关注重心偏移。'
                      : '左右脚受力明显不对称，建议进一步评估是否存在单侧肌力不足。'}
                  </p>
                </div>
              )}

              <div className="p-4 rounded-lg" style={{ background: 'var(--bg-hover)' }}>
                <h5 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>临床建议</h5>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  根据国际肌少症工作组 (EWGSOP2) 标准，五次起坐测试时间
                  {totalDur <= 15 ? (
                    <><b style={{ color: C.green }}>小于15秒</b>，该受试者下肢肌力处于正常范围。建议定期复查以监测变化趋势。</>
                  ) : totalDur <= 20 ? (
                    <><b style={{ color: C.amber }}>在15~20秒之间</b>，提示下肢肌力可能存在轻度下降。建议加强下肢力量训练，并在3个月后复查。</>
                  ) : (
                    <><b style={{ color: C.red }}>大于20秒</b>，提示下肢肌力明显下降，存在肌少症风险。建议进行详细的肌肉质量评估（如DXA或BIA），并制定个性化的运动康复方案。</>
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
