import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as echarts from 'echarts';
import { exportToPdf } from '../../lib/pdfExport';

/* ═══════════════════════════════════════════════════════════
   样式常量 & 工具
   ═══════════════════════════════════════════════════════════ */
const C = {
  text: '#6B7B8D', grid: '#EDF0F4', blue: '#0066CC', green: '#059669',
  red: '#DC2626', amber: '#D97706', cyan: '#0891B2', purple: '#7C3AED',
  teal: '#0D9488', indigo: '#4F46E5',
};

const ttStyle = {
  backgroundColor: '#fff', borderColor: '#E5E9EF',
  textStyle: { color: '#1A2332', fontSize: 11 },
  extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,0.08);border-radius:8px;',
};

/* ─── Jet Colormap (0~1 → [r,g,b]) ─── */
function jetColor(t) {
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.125)      { r = 0; g = 0; b = 0.5 + t * 4; }
  else if (t < 0.375) { r = 0; g = (t - 0.125) * 4; b = 1; }
  else if (t < 0.625) { r = (t - 0.375) * 4; g = 1; b = 1 - (t - 0.375) * 4; }
  else if (t < 0.875) { r = 1; g = 1 - (t - 0.625) * 4; b = 0; }
  else                 { r = 1 - (t - 0.875) * 4; g = 0; b = 0; }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/* ═══════════════════════════════════════════════════════════
   基础 UI 组件
   ═══════════════════════════════════════════════════════════ */

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

/* ─── Section 标题（与 StandingReport 风格统一） ─── */
function SectionHeader({ title, subtitle }) {
  return (
    <div className="flex items-baseline gap-3 mb-4 pb-2" style={{ borderBottom: '2px solid var(--zeiss-blue, #0066CC)' }}>
      <h3 className="text-base md:text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {subtitle && <span className="text-xs tracking-wide" style={{ color: 'var(--text-muted)' }}>{subtitle}</span>}
    </div>
  );
}

/* ─── 数据行 ─── */
function DataRow({ label, value, color, sub }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: 'var(--bg-hover, #f8f9fa)' }}>
      <span className="text-xs md:text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="text-right">
        <span className="text-sm md:text-base font-bold tabular-nums" style={{ color: color || 'var(--text-primary)' }}>{value}</span>
        {sub && <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ─── 指标卡片 ─── */
function MetricCard({ label, value, sub, color, icon }) {
  return (
    <div className="zeiss-card-inner p-3 md:p-4 text-center transition-all hover:shadow-sm">
      {icon && <div className="text-lg mb-1 opacity-60">{icon}</div>}
      <div className="text-xl md:text-2xl font-bold tabular-nums" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      <div className="text-[10px] md:text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Canvas 热力图组件 - 自适应宽度
   ═══════════════════════════════════════════════════════════ */
function HeatmapCanvas({ matrix, width, height }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !matrix || !matrix.length) return;

    const rect = container.getBoundingClientRect();
    const w = width || rect.width;
    const h = height || rect.width; // 默认正方形
    const dpr = window.devicePixelRatio || 1;
    const rows = matrix.length;
    const cols = matrix[0].length;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0A0E17';
    ctx.fillRect(0, 0, w, h);

    let maxVal = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (matrix[r][c] > maxVal) maxVal = matrix[r][c];
    if (maxVal === 0) return;

    const cellW = w / cols;
    const cellH = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = matrix[r][c] / maxVal;
        if (val > 0.01) {
          const [cr, cg, cb] = jetColor(val);
          ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
          ctx.fillRect(c * cellW, r * cellH, cellW + 0.5, cellH + 0.5);
        }
      }
    }
  }, [matrix, width, height]);

  if (!matrix || !matrix.length) {
    return (
      <div ref={containerRef} style={{ width: width || '100%', height: height || 60, background: '#0A0E17', borderRadius: 6 }}
        className="flex items-center justify-center">
        <span className="text-[9px]" style={{ color: '#555' }}>无数据</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: width || '100%' }}>
      <canvas ref={canvasRef} style={{ borderRadius: 6, display: 'block', width: '100%' }} />
    </div>
  );
}

/* ─── Jet Colorbar 图例 ─── */
function JetColorbar({ width = '100%', height = 12 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.parentElement.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = jetColor(x / w);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, height);
    }
  }, [height]);
  return (
    <div style={{ width }}>
      <canvas ref={canvasRef} style={{ borderRadius: 4, display: 'block' }} />
      <div className="flex justify-between mt-0.5">
        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>低压力</span>
        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>高压力</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Canvas COP 轨迹渲染组件
   ═══════════════════════════════════════════════════════════ */
function COPTrajectoryCanvas({ copData, title, height = 320 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const cycleColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !copData) return;

    const bgMatrix = copData.bg_matrix;
    const trajectories = copData.trajectories || [];
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = height;

    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0A0E17';
    ctx.fillRect(0, 0, cw, ch);

    if (bgMatrix && bgMatrix.length > 0) {
      const rows = bgMatrix.length;
      const cols = bgMatrix[0].length;
      let maxVal = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (bgMatrix[r][c] > maxVal) maxVal = bgMatrix[r][c];

      if (maxVal > 0) {
        const matAspect = cols / rows;
        const canvasAspect = cw / ch;
        let drawW, drawH, drawX, drawY;
        if (matAspect > canvasAspect) { drawW = cw * 0.85; drawH = drawW / matAspect; }
        else { drawH = ch * 0.85; drawW = drawH * matAspect; }
        drawX = (cw - drawW) / 2;
        drawY = (ch - drawH) / 2;

        const cellW = drawW / cols;
        const cellH = drawH / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const val = bgMatrix[r][c] / maxVal;
            if (val > 0.01) {
              const [cr, cg, cb] = jetColor(val);
              ctx.fillStyle = `rgba(${cr},${cg},${cb},0.45)`;
              ctx.fillRect(drawX + c * cellW, drawY + r * cellH, cellW + 0.5, cellH + 0.5);
            }
          }
        }

        if (trajectories.length > 0) {
          const matRows = bgMatrix.length;
          const matCols = bgMatrix[0].length;
          trajectories.forEach((traj, idx) => {
            if (!traj || traj.length < 2) return;
            const color = cycleColors[idx % cycleColors.length];
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            let started = false;
            traj.forEach(([x, y]) => {
              const px = drawX + (x / matCols) * drawW;
              const py = drawY + (y / matRows) * drawH;
              if (!started) { ctx.moveTo(px, py); started = true; }
              else ctx.lineTo(px, py);
            });
            ctx.stroke();

            // 起点
            const [sx, sy] = traj[0];
            const spx = drawX + (sx / matCols) * drawW;
            const spy = drawY + (sy / matRows) * drawH;
            ctx.beginPath();
            ctx.arc(spx, spy, 5, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // 终点三角
            if (traj.length > 1) {
              const [ex, ey] = traj[traj.length - 1];
              const epx = drawX + (ex / matCols) * drawW;
              const epy = drawY + (ey / matRows) * drawH;
              ctx.beginPath();
              ctx.arc(epx, epy, 4, 0, Math.PI * 2);
              ctx.fillStyle = '#fff';
              ctx.fill();
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          });

          // 图例
          if (trajectories.length > 1) {
            const legendX = 12;
            let legendY = ch - 12 - trajectories.length * 18;
            ctx.font = '11px -apple-system, sans-serif';
            trajectories.forEach((_, idx) => {
              const color = cycleColors[idx % cycleColors.length];
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(legendX + 5, legendY + 5, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#ccc';
              ctx.fillText(`周期 ${idx + 1}`, legendX + 14, legendY + 9);
              legendY += 18;
            });
          }
        }
      }
    }
  }, [copData, height]);

  return (
    <div ref={containerRef} className="w-full">
      {copData ? (
        <canvas ref={canvasRef} className="w-full rounded-lg" style={{ height, background: '#0A0E17' }} />
      ) : (
        <div className="flex items-center justify-center rounded-lg" style={{ height, background: '#0A0E17' }}>
          <span className="text-sm" style={{ color: '#555' }}>暂无数据</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ECharts 图表组件
   ═══════════════════════════════════════════════════════════ */

/* ─── LTTB 降采样 ─── */
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
    for (let j = nextStart; j < nextEnd && j < n; j++) { avgX += times[j]; avgY += values[j]; count++; }
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

/* ─── 力-时间曲线 ─── */
function ForceTimeChart({ times, forces, peaksIdx = [], title, color = C.green, height = 260 }) {
  const option = useMemo(() => {
    if (!times?.length || !forces?.length) return {};
    const data = lttbDownsample(times, forces, 800);
    const markLines = peaksIdx
      .filter(idx => idx < times.length)
      .map(idx => ({ xAxis: times[idx], lineStyle: { color: C.red + '60', width: 1, type: 'dashed' }, label: { show: false } }));
    return {
      tooltip: { trigger: 'axis', ...ttStyle, formatter: (p) => `<b>${p[0]?.value?.[0]?.toFixed(2)}s</b><br/>力: ${p[0]?.value?.[1]?.toFixed(1)} N` },
      grid: { top: 35, bottom: 35, left: 55, right: 20 },
      title: title ? { text: title, left: 0, top: 0, textStyle: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #6B7B8D)' } } : undefined,
      xAxis: { type: 'value', name: '时间 (s)', nameLocation: 'center', nameGap: 22, nameTextStyle: { color: C.text, fontSize: 11 }, axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'value', name: '力 (N)', nameTextStyle: { color: C.text, fontSize: 11 }, axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: 'line', data, showSymbol: false, smooth: true,
        lineStyle: { color, width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + '25' }, { offset: 1, color: color + '05' }]) },
        markLine: markLines.length > 0 ? { data: markLines, symbol: 'none', animation: false } : undefined,
      }],
    };
  }, [times, forces, peaksIdx, title, color]);
  return <EChart option={option} height={height} />;
}

/* ─── 足底+坐垫合并力-时间曲线 ─── */
function CombinedForceTimeChart({ standTimes, standForce, standPeaksIdx = [], sitTimes, sitForce, height = 320 }) {
  const hasStand = standTimes?.length > 0 && standForce?.length > 0;
  const hasSit = sitTimes?.length > 0 && sitForce?.length > 0;

  const option = useMemo(() => {
    if (!hasStand && !hasSit) return {};
    const series = [];
    const markLines = standPeaksIdx
      .filter(idx => idx < (standTimes?.length || 0))
      .map(idx => ({ xAxis: standTimes[idx], lineStyle: { color: C.red + '60', width: 1, type: 'dashed' }, label: { show: false } }));

    if (hasStand) {
      const data = lttbDownsample(standTimes, standForce, 800);
      series.push({
        name: '\u8db3\u5e95\u538b\u529b',
        type: 'line', data, showSymbol: false, smooth: true,
        lineStyle: { color: C.green, width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: C.green + '18' }, { offset: 1, color: C.green + '03' }]) },
        markLine: markLines.length > 0 ? { data: markLines, symbol: 'none', animation: false } : undefined,
      });
    }
    if (hasSit) {
      const data = lttbDownsample(sitTimes, sitForce, 800);
      series.push({
        name: '\u5750\u57ab\u538b\u529b',
        type: 'line', data, showSymbol: false, smooth: true,
        lineStyle: { color: C.amber, width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: C.amber + '18' }, { offset: 1, color: C.amber + '03' }]) },
      });
    }

    return {
      tooltip: {
        trigger: 'axis', ...ttStyle,
        formatter: (params) => {
          if (!params?.length) return '';
          let html = `<b>${params[0]?.value?.[0]?.toFixed(2)}s</b>`;
          params.forEach(p => {
            const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px;"></span>`;
            html += `<br/>${dot}${p.seriesName}: ${p.value?.[1]?.toFixed(1)} N`;
          });
          return html;
        },
      },
      legend: {
        data: series.map(s => s.name),
        top: 0, right: 0,
        textStyle: { color: C.text, fontSize: 11 },
        itemWidth: 16, itemHeight: 3,
      },
      grid: { top: 35, bottom: 35, left: 55, right: 20 },
      xAxis: { type: 'value', name: '\u65f6\u95f4 (s)', nameLocation: 'center', nameGap: 22, nameTextStyle: { color: C.text, fontSize: 11 }, axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'value', name: '\u529b (N)', nameTextStyle: { color: C.text, fontSize: 11 }, axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series,
    };
  }, [standTimes, standForce, standPeaksIdx, sitTimes, sitForce, hasStand, hasSit]);

  if (!hasStand && !hasSit) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无力曲线数据</span>
      </div>
    );
  }
  return <EChart option={option} height={height} />;
}

/* ─── 周期时长柱状图 ─── */
function CycleDurationChart({ durations, avgDuration, height = 200 }) {
  const option = useMemo(() => {
    if (!durations?.length) return {};
    const labels = durations.map((_, i) => `周期${i + 1}`);
    return {
      tooltip: { trigger: 'axis', ...ttStyle },
      grid: { top: 30, bottom: 30, left: 50, right: 15, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { color: C.text, fontSize: 10 }, axisLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'value', name: '秒', axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: 'bar', barWidth: '50%',
        data: durations.map(d => ({
          value: d,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: C.cyan },
              { offset: 1, color: C.cyan + '30' },
            ]),
            borderRadius: [4, 4, 0, 0],
          },
        })),
        label: { show: true, position: 'top', formatter: '{c}s', fontSize: 10, fontWeight: 600, color: C.text },
        markLine: avgDuration ? {
          data: [{ yAxis: avgDuration, lineStyle: { color: C.amber, type: 'dashed', width: 1.5 }, label: { formatter: `均值 ${avgDuration.toFixed(2)}s`, fontSize: 10, color: C.amber } }],
          symbol: 'none',
        } : undefined,
      }],
    };
  }, [durations, avgDuration]);
  return <EChart option={option} height={height} />;
}

/* ─── 峰值力柱状图 ─── */
function CyclePeakForceChart({ peakForces, height = 200 }) {
  const option = useMemo(() => {
    if (!peakForces?.length) return {};
    const labels = peakForces.map((_, i) => `峰值${i + 1}`);
    return {
      tooltip: { trigger: 'axis', ...ttStyle },
      grid: { top: 30, bottom: 30, left: 55, right: 15, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { color: C.text, fontSize: 10 }, axisLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'value', name: '力 (N)', axisLabel: { color: C.text, fontSize: 10 }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: 'bar', barWidth: '50%',
        data: peakForces.map(f => ({
          value: f,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: C.purple },
              { offset: 1, color: C.purple + '30' },
            ]),
            borderRadius: [4, 4, 0, 0],
          },
        })),
        label: { show: true, position: 'top', formatter: (p) => `${Number(p.value).toFixed(1)} N`, fontSize: 9, color: C.text },
      }],
    };
  }, [peakForces]);
  return <EChart option={option} height={height} />;
}

/* ─── 对称性仪表盘 ─── */
function SymmetryGauge({ ratio, leftTotal, rightTotal, height = 180 }) {
  const option = useMemo(() => {
    const r = ratio || 0;
    const gaugeColor = r >= 80 ? C.green : r >= 60 ? C.amber : C.red;
    return {
      series: [{
        type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100,
        radius: '90%', center: ['50%', '55%'],
        progress: { show: true, width: 14, roundCap: true, itemStyle: { color: gaugeColor } },
        axisLine: { lineStyle: { width: 14, color: [[1, C.grid]] } },
        axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        title: { show: true, offsetCenter: [0, '35%'], fontSize: 11, color: C.text, formatter: '对称性' },
        detail: { valueAnimation: true, formatter: `${r.toFixed(1)}%`, fontSize: 20, fontWeight: 'bold', color: gaugeColor, offsetCenter: [0, '5%'] },
        data: [{ value: r }],
      }],
    };
  }, [ratio]);

  return (
    <div>
      <EChart option={option} height={height} />
      {(leftTotal != null && rightTotal != null) && (
        <div className="flex justify-center gap-6 -mt-3">
          <div className="text-center">
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>左脚总力</div>
            <div className="text-xs font-bold" style={{ color: C.blue }}>{Number(leftTotal).toFixed(1)} N</div>
          </div>
          <div className="text-center">
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>右脚总力</div>
            <div className="text-xs font-bold" style={{ color: C.red }}>{Number(rightTotal).toFixed(1)} N</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── 左右脚占比条形图 ─── */
function SymmetryBar({ leftTotal, rightTotal }) {
  const total = (leftTotal || 0) + (rightTotal || 0);
  if (total === 0) return null;
  const leftPct = ((leftTotal / total) * 100).toFixed(1);
  const rightPct = ((rightTotal / total) * 100).toFixed(1);
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] w-8 text-right" style={{ color: C.blue }}>左</span>
        <div className="flex-1 h-5 rounded-full overflow-hidden flex" style={{ background: C.grid }}>
          <div className="h-full flex items-center justify-center text-[10px] font-bold text-white transition-all"
            style={{ width: `${leftPct}%`, background: C.blue, minWidth: 30 }}>{leftPct}%</div>
          <div className="h-full flex items-center justify-center text-[10px] font-bold text-white transition-all"
            style={{ width: `${rightPct}%`, background: C.red, minWidth: 30 }}>{rightPct}%</div>
        </div>
        <span className="text-[10px] w-8" style={{ color: C.red }}>右</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   报告目录
   ═══════════════════════════════════════════════════════════ */
const SECTIONS = [
  { id: 'overview',    label: '基本信息',     icon: '📋' },
  { id: 'metrics',     label: '核心指标',     icon: '📊' },
  { id: 'cycle',       label: '周期分析',     icon: '🔄' },
  { id: 'symmetry',    label: '对称性分析',   icon: '⚖️' },
  { id: 'force',       label: '力-时间曲线',  icon: '📈' },
  { id: 'stand-evo',   label: '站立压力演变', icon: '🦶' },
  { id: 'stand-cop',   label: '站立COP轨迹', icon: '🎯' },
  { id: 'sit-evo',     label: '坐姿压力演变', icon: '🪑' },
  { id: 'sit-cop',     label: '坐姿COP轨迹', icon: '🎯' },
  { id: 'pressure',    label: '压力统计',     icon: '📉' },
  { id: 'conclusion',  label: '综合评估',     icon: '✅' },
];

/* ═══════════════════════════════════════════════════════════
   主报告组件
   ═══════════════════════════════════════════════════════════ */
export default function SitStandReport({ patientInfo, reportData: propsReportData, onClose }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(!propsReportData);
  const contentRef = useRef(null);
  // 缓存报告生成时间，避免每次渲染时重新生成时间导致持续增加
  const fallbackDate = useMemo(() => new Date().toLocaleString('zh-CN'), []);

  useEffect(() => {
    if (propsReportData) { setReportData(propsReportData); setLoading(false); return; }
    // 无 props 传入的报告数据时，直接显示无数据提示
    setReportData(null);
    setLoading(false);
  }, [propsReportData]);

  /* ─── 滚动监听自动高亮导航 ─── */
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleScroll = () => {
      const sections = SECTIONS.map(s => document.getElementById(`ss-${s.id}`)).filter(Boolean);
      for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].getBoundingClientRect().top <= 200) { setActiveSection(SECTIONS[i].id); break; }
      }
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id) => {
    document.getElementById(`ss-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      <div className="text-center">
        <p className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>暂无报告数据</p>
        <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>请先完成起坐评估采集</p>
        {onClose && <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--zeiss-blue)', color: '#fff' }}>返回</button>}
      </div>
    </div>
  );

  /* ═══ 数据解析 ═══ */
  const heatmapData = d.heatmap_data || {};
  const copDataObj = d.cop_data || {};
  const images = d.images || {};
  const forceCurves = d.force_curves || {};

  const standEvolutionData = heatmapData.stand_evolution || [];
  const sitEvolutionData = heatmapData.sit_evolution || [];
  const standCopLeftData = copDataObj.stand_left || null;
  const standCopRightData = copDataObj.stand_right || null;
  const sitCopData = copDataObj.sit || null;

  const standTimes = forceCurves.stand_times || d.footpad_force_curve?.times || [];
  const standForce = forceCurves.stand_force || d.footpad_force_curve?.values || [];
  const sitTimes = forceCurves.sit_times || d.seat_force_curve?.times || [];
  const sitForce = forceCurves.sit_force || d.seat_force_curve?.values || [];
  const standPeaksIdx = forceCurves.stand_peaks_idx || [];

  const durationStats = d.duration_stats || {};
  const cycleDurations = durationStats.cycle_durations || [];
  const symmetry = d.symmetry || {};
  const symmetryRatio = symmetry.left_right_ratio ?? null;
  const leftTotal = symmetry.left_avg_force ?? symmetry.left_total ?? null;
  const rightTotal = symmetry.right_avg_force ?? symmetry.right_total ?? null;
  const pressureStats = d.pressure_stats || {};
  const cyclePeakForces = d.cycle_peak_forces || [];

  const hasStandEvoMatrix = standEvolutionData.length > 0 && standEvolutionData[0]?.matrix;
  const hasSitEvoMatrix = sitEvolutionData.length > 0 && sitEvolutionData[0]?.matrix;

  const evoLabels = ['0%', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
  const sitEvoLabels = ['Start', '10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', 'End'];

  const totalDur = durationStats.total_duration || 0;
  const evalLevel = totalDur > 0 && totalDur < 12 ? { text: '优秀', color: C.green, bg: '#05966915' }
    : totalDur <= 15 ? { text: '正常', color: C.cyan, bg: '#0891B215' }
    : totalDur <= 20 ? { text: '偏慢', color: C.amber, bg: '#D9770615' }
    : { text: '异常', color: C.red, bg: '#DC262615' };

  const samplingRate = standTimes.length >= 2
    ? Math.round(standTimes.length / (standTimes[standTimes.length - 1] - standTimes[0]))
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* ═══ 报告头部 ═══ */}
      <div className="shrink-0 px-4 md:px-6 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
        <h2 className="text-sm md:text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          {patientInfo?.name || d.username || '---'} 的五次起坐评估报告
        </h2>
        <div className="flex items-center gap-2 md:gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {patientInfo?.gender && <span>性别：{patientInfo.gender}</span>}
          {patientInfo?.age && <span>年龄：{patientInfo.age}</span>}
          <span>{d.test_date || fallbackDate}</span>
          <PdfBtnSitStand containerRef={contentRef} fileName={`${patientInfo?.name || '报告'}_起坐评估`} />
          {onClose && (
            <button onClick={onClose} className="ml-2 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* ═══ 左侧导航 ═══ */}
        <nav className="w-44 md:w-52 shrink-0 py-4 overflow-y-auto hidden md:block"
          style={{ borderRight: '1px solid var(--border-light)', background: 'var(--bg-secondary)' }}>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest px-4 mb-3" style={{ color: 'var(--text-muted)' }}>
            报告目录
          </h3>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => scrollToSection(s.id)}
              className="w-full text-left px-4 py-2.5 text-xs md:text-sm flex items-center gap-2 transition-all"
              style={{
                borderLeft: `3px solid ${activeSection === s.id ? 'var(--zeiss-blue, #0066CC)' : 'transparent'}`,
                background: activeSection === s.id ? 'var(--zeiss-blue-light, #0066CC10)' : 'transparent',
                color: activeSection === s.id ? 'var(--zeiss-blue, #0066CC)' : 'var(--text-tertiary)',
                fontWeight: activeSection === s.id ? 600 : 400,
              }}>
              {s.label}
            </button>
          ))}
        </nav>

        {/* ═══ 右侧内容 ═══ */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth" style={{ background: 'var(--bg-primary)' }}>
          <div className="max-w-[1100px] mx-auto space-y-8">

            {/* ═══════════ 1. 基本信息 ═══════════ */}
            <section id="ss-overview">
              <SectionHeader title="基本信息" subtitle="Basic Information" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="zeiss-card-inner p-4">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>姓名</div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{patientInfo?.name || d.username || '---'}</div>
                </div>
                <div className="zeiss-card-inner p-4">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>测试类型</div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>五次起坐测试</div>
                </div>
                <div className="zeiss-card-inner p-4">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>测试时间</div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{d.test_date || fallbackDate}</div>
                </div>
                <div className="zeiss-card-inner p-4">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>评估等级</div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: evalLevel.bg, color: evalLevel.color }}>
                      {evalLevel.text}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* ═══════════ 2. 核心指标 ═══════════ */}
            <section id="ss-metrics">
              <SectionHeader title="核心指标" subtitle="Key Metrics" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="总时长" value={`${totalDur.toFixed(1)}s`} color={C.blue}
                  sub={totalDur <= 15 ? '正常 (<15s)' : totalDur <= 20 ? '偏慢 (15-20s)' : '异常 (>20s)'} />
                <MetricCard label="完成周期数" value={`${durationStats.num_cycles || '--'}`} color={C.green}
                  sub="次" />
                <MetricCard label="平均周期时长" value={`${durationStats.avg_duration?.toFixed(2) || '--'}s`} color={C.cyan} />
                <MetricCard label="检测峰值数" value={`${d.stand_peaks || standPeaksIdx.length || '--'}`} color={C.purple} />
              </div>
              {samplingRate && (
                <div className="mt-2 text-right">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>采样率: {samplingRate} Hz</span>
                </div>
              )}
            </section>

            {/* ═══════════ 3. 周期分析 ═══════════ */}
            <section id="ss-cycle">
              <SectionHeader title="周期分析" subtitle="Cycle Analysis" />
              {cycleDurations.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* 左：周期时长指标 + 柱状图 */}
                  <div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <MetricCard label="最快周期" value={`${Math.min(...cycleDurations).toFixed(2)}s`} color={C.green} />
                      <MetricCard label="最慢周期" value={`${Math.max(...cycleDurations).toFixed(2)}s`} color={C.amber} />
                      <MetricCard label="标准差"
                        value={`${(Math.sqrt(cycleDurations.reduce((s, v) => s + (v - durationStats.avg_duration) ** 2, 0) / cycleDurations.length)).toFixed(2)}s`}
                        color={C.purple} sub="越小越稳定" />
                    </div>
                    <div className="zeiss-card p-4">
                      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>各周期时长</div>
                      <CycleDurationChart durations={cycleDurations} avgDuration={durationStats.avg_duration} height={200} />
                    </div>
                  </div>
                  {/* 右：峰值力柱状图 */}
                  <div>
                    {cyclePeakForces.length > 0 && (
                      <div className="zeiss-card p-4 h-full">
                        <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>各峰值力分布</div>
                        <CyclePeakForceChart peakForces={cyclePeakForces} height={280} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="zeiss-card p-6">
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard label="总时长" value={`${totalDur.toFixed(1)}s`} color={C.blue} />
                    <MetricCard label="周期数" value={`${durationStats.num_cycles || '--'}`} color={C.green} />
                  </div>
                </div>
              )}
            </section>

            {/* ═══════════ 4. 对称性分析 ═══════════ */}
            <section id="ss-symmetry">
              <SectionHeader title="对称性分析" subtitle="Symmetry Analysis" />
              {symmetryRatio != null ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="zeiss-card p-4">
                    <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>左右脚对称性指数</div>
                    <SymmetryGauge ratio={symmetryRatio} leftTotal={leftTotal} rightTotal={rightTotal} height={180} />
                    <SymmetryBar leftTotal={leftTotal} rightTotal={rightTotal} />
                    <div className="text-[10px] text-center mt-2" style={{ color: 'var(--text-muted)' }}>
                      对称性 = min(左,右) / max(左,右) × 100%
                    </div>
                  </div>
                  <div className="zeiss-card p-4">
                    <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>对称性评估</div>
                    <div className="space-y-2">
                      <DataRow label="对称性比值"
                        value={`${symmetryRatio.toFixed(1)}%`}
                        color={symmetryRatio >= 80 ? C.green : symmetryRatio >= 60 ? C.amber : C.red} />
                      <DataRow label="左脚占比"
                        value={leftTotal && rightTotal ? `${((leftTotal / (leftTotal + rightTotal)) * 100).toFixed(1)}%` : '--'}
                        color={C.blue} />
                      <DataRow label="右脚占比"
                        value={leftTotal && rightTotal ? `${((rightTotal / (leftTotal + rightTotal)) * 100).toFixed(1)}%` : '--'}
                        color={C.red} />
                    </div>
                    <div className="mt-3 p-3 rounded-lg text-xs leading-relaxed"
                      style={{
                        background: symmetryRatio >= 80 ? '#05966910' : symmetryRatio >= 60 ? '#D9770610' : '#DC262610',
                        color: 'var(--text-secondary)',
                      }}>
                      {symmetryRatio >= 80
                        ? '左右脚受力分布较为均衡，对称性良好，表明站立时重心控制稳定。'
                        : symmetryRatio >= 60
                        ? '左右脚受力存在一定差异，建议关注站立时的重心偏移情况。'
                        : '左右脚受力明显不对称，可能存在单侧肌力不足或代偿性站姿，建议进一步评估。'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="zeiss-card p-6 flex items-center justify-center" style={{ minHeight: 120 }}>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无对称性数据</span>
                </div>
              )}
            </section>

            {/* ═══════════ 5. 力-时间曲线 ═══════════ */}
            <section id="ss-force">
              <SectionHeader title="力-时间曲线" subtitle="Force-Time Curve" />
              <div className="zeiss-card p-4">
                <CombinedForceTimeChart
                  standTimes={standTimes} standForce={standForce} standPeaksIdx={standPeaksIdx}
                  sitTimes={sitTimes} sitForce={sitForce}
                  height={320}
                />
              </div>
            </section>

            {/* ═══════════ 6. 站立足底压力演变 ═══════════ */}
            <section id="ss-stand-evo">
              <SectionHeader title="站立足底压力演变" subtitle="Standing Pressure Evolution" />
              <div className="zeiss-card p-4">
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  站立过程中左右脚足底压力分布随时间的变化（第一个完整周期，0%~100%）
                </p>
                {hasStandEvoMatrix ? (
                  <>
                    {/* 时间标签 */}
                    <div className="flex gap-0.5 mb-2 pl-14">
                      {evoLabels.map((label, i) => (
                        <div key={i} className="flex-1 text-center text-[9px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                      ))}
                    </div>
                    {/* 左脚 */}
                    <div className="flex items-center gap-1 mb-2">
                      <div className="w-14 text-right text-xs font-semibold shrink-0 pr-1" style={{ color: C.blue }}>左脚</div>
                      <div className="flex gap-0.5 flex-1">
                        {standEvolutionData
                          .filter(h => h.label === 0)
                          .sort((a, b) => a.sublabel - b.sublabel)
                          .map((h, i) => (
                            <div key={i} className="flex-1 aspect-square">
                              <HeatmapCanvas matrix={h.matrix} />
                            </div>
                          ))}
                      </div>
                    </div>
                    {/* 右脚 */}
                    <div className="flex items-center gap-1">
                      <div className="w-14 text-right text-xs font-semibold shrink-0 pr-1" style={{ color: C.green }}>右脚</div>
                      <div className="flex gap-0.5 flex-1">
                        {standEvolutionData
                          .filter(h => h.label === 1)
                          .sort((a, b) => a.sublabel - b.sublabel)
                          .map((h, i) => (
                            <div key={i} className="flex-1 aspect-square">
                              <HeatmapCanvas matrix={h.matrix} />
                            </div>
                          ))}
                      </div>
                    </div>
                    {/* Colorbar */}
                    <div className="mt-3 pl-14">
                      <JetColorbar />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-12">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无站立演变数据</span>
                  </div>
                )}
              </div>
            </section>

            {/* ═══════════ 7. 站立COP轨迹 ═══════════ */}
            <section id="ss-stand-cop">
              <SectionHeader title="站立COP轨迹" subtitle="Standing COP Trajectory" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="zeiss-card p-4">
                  <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>左脚 COP 轨迹</div>
                  {standCopLeftData ? (
                    <COPTrajectoryCanvas copData={standCopLeftData} height={320} />
                  ) : (
                    <div className="flex items-center justify-center rounded-lg" style={{ height: 320, background: '#0A0E17' }}>
                      <span className="text-sm" style={{ color: '#555' }}>暂无左脚COP数据</span>
                    </div>
                  )}
                </div>
                <div className="zeiss-card p-4">
                  <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>右脚 COP 轨迹</div>
                  {standCopRightData ? (
                    <COPTrajectoryCanvas copData={standCopRightData} height={320} />
                  ) : (
                    <div className="flex items-center justify-center rounded-lg" style={{ height: 320, background: '#0A0E17' }}>
                      <span className="text-sm" style={{ color: '#555' }}>暂无右脚COP数据</span>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* ═══════════ 8. 坐姿压力演变 ═══════════ */}
            <section id="ss-sit-evo">
              <SectionHeader title="坐姿压力演变" subtitle="Sitting Pressure Evolution" />
              <div className="zeiss-card p-4">
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  坐姿过程中坐垫压力分布随时间的变化（Start ~ End）
                </p>
                {hasSitEvoMatrix ? (
                  <>
                    <div className="flex gap-0.5 mb-2">
                      {sitEvoLabels.map((label, i) => (
                        <div key={i} className="flex-1 text-center text-[9px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</div>
                      ))}
                    </div>
                    <div className="flex gap-0.5">
                      {sitEvolutionData
                        .sort((a, b) => a.label - b.label)
                        .map((h, i) => (
                          <div key={i} className="flex-1 aspect-square">
                            <HeatmapCanvas matrix={h.matrix} />
                          </div>
                        ))}
                    </div>
                    <div className="mt-3">
                      <JetColorbar />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-12">
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无坐姿演变数据</span>
                  </div>
                )}
              </div>
            </section>

            {/* ═══════════ 9. 坐姿COP轨迹 ═══════════ */}
            <section id="ss-sit-cop">
              <SectionHeader title="坐姿COP轨迹" subtitle="Sitting COP Trajectory" />
              <div className="zeiss-card p-4">
                <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>坐姿 COP 轨迹</div>
                {sitCopData ? (
                  <COPTrajectoryCanvas copData={sitCopData} height={380} />
                ) : (
                  <div className="flex items-center justify-center rounded-lg" style={{ height: 380, background: '#0A0E17' }}>
                    <span className="text-sm" style={{ color: '#555' }}>暂无坐姿COP数据</span>
                  </div>
                )}
              </div>
            </section>

            {/* ═══════════ 10. 压力统计 ═══════════ */}
            <section id="ss-pressure">
              <SectionHeader title="压力统计" subtitle="Pressure Statistics" />
              {(pressureStats.foot_max || pressureStats.sit_max) ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="zeiss-card p-4">
                    <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>脚垫力统计</div>
                    <div className="space-y-2">
                      <DataRow label="最大总力" value={pressureStats.foot_max != null ? `${Number(pressureStats.foot_max).toFixed(1)} N` : '--'} color={C.red} />
                      <DataRow label="平均总力" value={pressureStats.foot_avg != null ? `${Number(pressureStats.foot_avg).toFixed(1)} N` : '--'} color={C.blue} />
                      {pressureStats.max_foot_change_rate != null && (
                        <DataRow label="最大变化率" value={`${Number(pressureStats.max_foot_change_rate).toFixed(1)} N`} color={C.amber} sub="/帧" />
                      )}
                    </div>
                  </div>
                  <div className="zeiss-card p-4">
                    <div className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>坐垫力统计</div>
                    <div className="space-y-2">
                      <DataRow label="最大总力" value={pressureStats.sit_max != null ? `${Number(pressureStats.sit_max).toFixed(1)} N` : '--'} color={C.red} />
                      <DataRow label="平均总力" value={pressureStats.sit_avg != null ? `${Number(pressureStats.sit_avg).toFixed(1)} N` : '--'} color={C.blue} />
                      {pressureStats.max_sit_change_rate != null && (
                        <DataRow label="最大变化率" value={`${Number(pressureStats.max_sit_change_rate).toFixed(1)} N`} color={C.amber} sub="/帧" />
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="zeiss-card p-6 flex items-center justify-center" style={{ minHeight: 120 }}>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无压力统计数据</span>
                </div>
              )}
            </section>

            {/* ═══════════ 11. 综合评估 ═══════════ */}
            <section id="ss-conclusion">
              <SectionHeader title="综合评估" subtitle="Comprehensive Assessment" />
              <div className="zeiss-card p-5">
                {/* 评估等级标签 */}
                <div className="flex items-center gap-3 mb-5 pb-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <div className="px-4 py-2 rounded-lg text-sm font-bold"
                    style={{ background: evalLevel.bg, color: evalLevel.color }}>
                    评估等级: {evalLevel.text}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    依据 EWGSOP2 标准（五次起坐测试 &lt;15s 为正常）
                  </div>
                </div>

                <div className="space-y-3">
                  {/* 测试概况 */}
                  <div className="p-4 rounded-lg" style={{ background: 'var(--bg-hover, #f8f9fa)' }}>
                    <h5 className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>测试概况</h5>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      受试者完成五次起坐测试，总时长 <b>{totalDur.toFixed(1)}</b> 秒，
                      共检测到 <b>{d.stand_peaks || standPeaksIdx.length || '--'}</b> 个力峰值，
                      <b>{durationStats.num_cycles || '--'}</b> 个完整周期，
                      平均周期时长 <b>{durationStats.avg_duration?.toFixed(2) || '--'}</b> 秒。
                      {cycleDurations.length > 0 && (
                        <>最快周期 <b>{Math.min(...cycleDurations).toFixed(2)}s</b>，最慢周期 <b>{Math.max(...cycleDurations).toFixed(2)}s</b>。</>
                      )}
                    </p>
                  </div>

                  {/* 对称性评估 */}
                  {symmetryRatio != null && (
                    <div className="p-4 rounded-lg" style={{ background: 'var(--bg-hover, #f8f9fa)' }}>
                      <h5 className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>对称性评估</h5>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        左右脚对称性指数为{' '}
                        <b style={{ color: symmetryRatio >= 80 ? C.green : symmetryRatio >= 60 ? C.amber : C.red }}>
                          {symmetryRatio.toFixed(1)}%
                        </b>
                        {leftTotal != null && rightTotal != null && (
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

                  {/* 临床建议 */}
                  <div className="p-4 rounded-lg" style={{ background: 'var(--bg-hover, #f8f9fa)' }}>
                    <h5 className="text-xs font-bold mb-2" style={{ color: 'var(--text-primary)' }}>临床建议</h5>
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
      </div>
    </div>
  );
}

function PdfBtnSitStand({ containerRef, fileName }) {
  const [exporting, setExporting] = React.useState(false);
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportToPdf(containerRef?.current, fileName, { title: '起坐评估报告' });
    } finally {
      setExporting(false);
    }
  };
  return (
    <button onClick={handleExport} disabled={exporting}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
      style={{
        color: exporting ? 'var(--text-muted)' : '#DC2626',
        background: exporting ? 'var(--bg-tertiary)' : '#FEF2F2',
        border: '1px solid #FCA5A530',
        cursor: exporting ? 'wait' : 'pointer',
      }}>
      {exporting ? (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
      {exporting ? '导出中...' : '导出 PDF'}
    </button>
  );
}
