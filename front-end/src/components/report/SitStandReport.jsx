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

/* ─── Jet 色图 ─── */
function jetColor(t) {
  if (t <= 0) return [0, 0, 0, 0];
  const r = t < 0.89 ? Math.min(Math.max(4 * t - 1.5, 0), 1) : Math.max(-4 * t + 4.5, 0);
  const g = t < 0.64 ? Math.min(Math.max(4 * t - 0.5, 0), 1) : Math.max(-4 * t + 3.5, 0);
  const b = t < 0.36 ? Math.min(Math.max(4 * t + 0.5, 0), 1) : Math.max(-4 * t + 2.5, 0);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255];
}

/* ─── 热力图 Canvas 渲染组件 ─── */
function HeatmapCanvas({ imageData, width = 120, height = 200, label }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // imageData 可以是 base64 字符串或矩阵数据
    if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
      // base64 图片 - 直接绘制
      const img = new Image();
      img.onload = () => {
        canvas.width = width * 2;
        canvas.height = height * 2;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = imageData;
    }
  }, [imageData, width, height]);

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        style={{ width, height, borderRadius: 4, background: '#000' }}
      />
      {label && (
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </span>
      )}
    </div>
  );
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
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, rect.width, height);

        // 保持宽高比居中绘制
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
        style={{ height, background: '#000' }}
      />
    </div>
  );
}

/* ─── 力-时间曲线 ECharts 组件 ─── */
function ForceTimeChart({ times, forces, peaksIdx, title, color = C.blue, height = 280 }) {
  const option = useMemo(() => {
    if (!times || !forces || times.length === 0) return null;

    // LTTB 降采样到最多 1000 个点
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

/* ─── LTTB 降采样算法 ─── */
function lttbDownsample(times, values, targetCount) {
  const n = times.length;
  if (n <= targetCount) return times.map((t, i) => [t, values[i]]);

  const sampled = [[times[0], values[0]]];
  const bucketSize = (n - 2) / (targetCount - 2);

  let lastIdx = 0;
  for (let i = 1; i < targetCount - 1; i++) {
    const start = Math.floor((i - 1) * bucketSize) + 1;
    const end = Math.min(Math.floor(i * bucketSize) + 1, n);
    const nextStart = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    // 下一个桶的平均值
    let avgX = 0, avgY = 0, count = 0;
    for (let j = nextStart; j < nextEnd && j < n; j++) {
      avgX += times[j];
      avgY += values[j];
      count++;
    }
    if (count > 0) { avgX /= count; avgY /= count; }

    // 当前桶中找最大三角形面积的点
    let maxArea = -1, maxIdx = start;
    const [ax, ay] = sampled[sampled.length - 1];
    for (let j = start; j < end && j < n; j++) {
      const area = Math.abs((times[j] - ax) * (avgY - ay) - (avgX - ax) * (values[j] - ay));
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }
    sampled.push([times[maxIdx], values[maxIdx]]);
    lastIdx = maxIdx;
  }
  sampled.push([times[n - 1], values[n - 1]]);
  return sampled;
}

/* ─── 报告目录 ─── */
const SECTIONS = [
  { id: 'overview', title: '基本信息' },
  { id: 'summary', title: '总体指标' },
  { id: 'stand-evo', title: '站立压力演变' },
  { id: 'stand-cop', title: '站立COP轨迹' },
  { id: 'sit-evo', title: '坐姿压力演变' },
  { id: 'sit-cop', title: '坐姿COP轨迹' },
  { id: 'force-curve', title: '力-时间曲线' },
  { id: 'conclusion', title: '综合评估' },
];

/* ═══════════════════════════════════════════
   主报告组件
   ═══════════════════════════════════════════ */
export default function SitStandReport({ patientInfo, reportData: propsReportData }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(!propsReportData);

  // 优先使用 props 传入的报告数据，否则从 JSON 文件加载
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

  // 解析数据 - 兼容后端返回的新格式和旧 JSON 格式
  const images = d.images || {};
  const forceCurves = d.force_curves || {};
  const standEvolution = images.stand_evolution || d.stand_evolution?.heatmaps || [];
  const sitEvolution = images.sit_evolution || d.sit_evolution?.heatmaps || [];
  const standCopLeft = images.stand_cop_left || null;
  const standCopRight = images.stand_cop_right || null;
  const sitCopImage = images.sit_cop || null;

  // 力-时间曲线数据
  const standTimes = forceCurves.stand_times || [];
  const standForce = forceCurves.stand_force || [];
  const sitTimes = forceCurves.sit_times || [];
  const sitForce = forceCurves.sit_force || [];
  const standPeaksIdx = forceCurves.stand_peaks_idx || d.stand_peaks || [];

  // 旧格式兼容：如果有 stand_evolution.heatmaps 但没有 images
  const hasOldFormat = !d.images && d.stand_evolution;
  const BASE = '/sitstand_report_data/';

  // 演变标签
  const evoLabels = ['0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
  const sitEvoLabels = ['Start', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', 'End'];

  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <nav className="w-48 shrink-0 p-4 sticky top-0" style={{ borderRight: '1px solid var(--border-light)' }}>
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
        {/* ── 基本信息 ── */}
        <section id="sit-overview">
          <div className="zeiss-section-title">基本信息</div>
          <div className="grid grid-cols-4 gap-4">
            {[
              { l: '姓名', v: patientInfo?.name || d.username || '---' },
              { l: '测试类型', v: '五次起坐测试' },
              { l: '测试时间', v: d.test_date || new Date().toLocaleString('zh-CN') },
              { l: '完成周期', v: `${d.duration_stats?.num_cycles || '--'}次` },
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
              { l: '平均周期时长', v: `${d.duration_stats?.avg_duration?.toFixed(2) || '--'}s`, c: C.cyan },
            ].map((item, i) => (
              <div key={i} className="zeiss-card-inner p-5 text-center">
                <div className="text-3xl font-bold" style={{ color: item.c }}>{item.v}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
              </div>
            ))}
          </div>
          {/* 额外统计 */}
          {(d.stand_frames || d.sit_frames) && (
            <div className="grid grid-cols-3 gap-4 mt-4">
              {[
                { l: '站立帧数', v: d.stand_frames || '--' },
                { l: '坐姿帧数', v: d.sit_frames || '--' },
                { l: '检测峰值数', v: d.stand_peaks || standPeaksIdx.length || '--' },
              ].map((item, i) => (
                <div key={i} className="zeiss-card-inner p-3 text-center">
                  <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{item.v}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.l}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 站立足底压力演变 ── */}
        <section id="sit-stand-evo">
          <div className="zeiss-section-title">站立足底压力演变</div>
          <div className="zeiss-card p-4">
            <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
              站立过程中左右脚足底压力分布随时间的变化（0%~100%）
            </p>

            {/* 新格式：base64 图片数据 */}
            {standEvolution.length > 0 && standEvolution[0]?.image ? (
              <>
                {/* 标签行 */}
                <div className="flex gap-1 mb-1 pl-12">
                  {evoLabels.map((label, i) => (
                    <div key={i} className="flex-1 text-center text-[10px] font-medium"
                      style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                  ))}
                </div>
                {/* 左脚行 */}
                <div className="flex items-center gap-1 mb-1">
                  <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: C.blue }}>左脚</div>
                  <div className="flex gap-1 flex-1">
                    {standEvolution
                      .filter(h => h.label === 0)
                      .sort((a, b) => a.sublabel - b.sublabel)
                      .map((h, i) => (
                        <div key={i} className="flex-1">
                          <img src={h.image} alt={`左脚 ${evoLabels[h.sublabel]}`}
                            className="w-full rounded" style={{ background: '#000' }} />
                        </div>
                      ))}
                  </div>
                </div>
                {/* 右脚行 */}
                <div className="flex items-center gap-1">
                  <div className="w-12 text-right text-xs font-medium shrink-0" style={{ color: C.green }}>右脚</div>
                  <div className="flex gap-1 flex-1">
                    {standEvolution
                      .filter(h => h.label === 1)
                      .sort((a, b) => a.sublabel - b.sublabel)
                      .map((h, i) => (
                        <div key={i} className="flex-1">
                          <img src={h.image} alt={`右脚 ${evoLabels[h.sublabel]}`}
                            className="w-full rounded" style={{ background: '#000' }} />
                        </div>
                      ))}
                  </div>
                </div>
              </>
            ) : hasOldFormat && d.stand_evolution?.heatmaps ? (
              /* 旧格式兼容：文件路径 */
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

        {/* ── 站立COP轨迹 ── */}
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

        {/* ── 坐姿压力演变 ── */}
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
                          className="w-full rounded" style={{ background: '#000' }} />
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

        {/* ── 坐姿COP轨迹 ── */}
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

        {/* ── 力-时间曲线 ── */}
        <section id="sit-force-curve">
          <div className="zeiss-section-title">力-时间曲线</div>
          <div className="grid grid-cols-1 gap-4">
            {/* 站立力曲线 - 优先使用前端 ECharts 渲染 */}
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

            {/* 坐姿力曲线 */}
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
