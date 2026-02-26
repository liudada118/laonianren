import { useRef, useEffect, useState, useCallback } from 'react';

const CANVAS_H = 420;

/** COP 轨迹专用颜色：亮红 → 白色 */
function copLineColor(t) {
  const r = 255;
  const g = Math.round(45 + t * (255 - 45));
  const b = Math.round(85 + t * (255 - 85));
  return `rgb(${r},${g},${b})`;
}

function heatColor(v, max) {
  if (v <= 0) return 'rgba(0,0,0,0)';
  const t = Math.min(v / max, 1);
  if (t < 0.25) { const s = t / 0.25; return `rgba(0,0,${Math.round(255*s)},0.3)`; }
  if (t < 0.5) { const s = (t-0.25)/0.25; return `rgba(0,${Math.round(255*s)},${Math.round(255*(1-s))},0.35)`; }
  if (t < 0.75) { const s = (t-0.5)/0.25; return `rgba(${Math.round(255*s)},255,0,0.4)`; }
  const s = (t-0.75)/0.25; return `rgba(255,${Math.round(255*(1-s))},0,0.45)`;
}

/** 找到足印的实际边界 */
function getFootBounds(peakData, colStart, colEnd, copPts) {
  let minR = 64, maxR = 0, minC = colEnd, maxC = colStart;
  for (let r = 0; r < 64; r++) {
    for (let c = colStart; c < colEnd; c++) {
      if ((peakData[r * 64 + c] || 0) > 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (copPts) {
    for (const pt of copPts) {
      const cr = pt[0], cc = pt[1];
      if (cr < minR) minR = Math.floor(cr);
      if (cr > maxR) maxR = Math.ceil(cr);
      if (cc < minC) minC = Math.floor(cc);
      if (cc > maxC) maxC = Math.ceil(cc);
    }
  }
  const pad = 2;
  return {
    minR: Math.max(0, minR - pad),
    maxR: Math.min(63, maxR + pad),
    minC: Math.max(colStart, minC - pad),
    maxC: Math.min(colEnd - 1, maxC + pad),
  };
}

/** 将 section_coords 统一转为数组 */
function normalizeSectionCoords(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => raw[k]);
  }
  return [[], [], [], []];
}

/**
 * 绘制单只脚: 热力图足印 + COP轨迹
 */
function drawFootCOP(ctx, copPts, peakData, colStart, colEnd, offsetX, width, hoveredIdx, title, sectionCoords) {
  const padding = 24;
  const titleH = 28;
  const drawW = width - padding * 2;
  const drawH = CANVAS_H - padding * 2 - titleH;

  // 标题
  ctx.fillStyle = '#333';
  ctx.font = 'bold 14px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, offsetX + width / 2, 20);

  // 计算足印边界
  let bounds;
  if (sectionCoords && sectionCoords.flat().length > 0) {
    const allCoords = sectionCoords.flat();
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const [r, c] of allCoords) {
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
    bounds = { minR, maxR, minC, maxC };
  } else if (peakData && peakData.length === 4096) {
    bounds = getFootBounds(peakData, colStart, colEnd, copPts);
  } else {
    bounds = { minR: 0, maxR: 63, minC: colStart, maxC: colEnd - 1 };
  }

  const rowSpan = bounds.maxR - bounds.minR || 1;
  const colSpan = bounds.maxC - bounds.minC || 1;
  const scale = Math.min(drawW / colSpan, drawH / rowSpan);
  const footW = colSpan * scale;
  const footH = rowSpan * scale;
  const footX = offsetX + padding + (drawW - footW) / 2;
  const footY = titleH + padding + (drawH - footH) / 2;

  // 网格
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 0.5;
  const gridStep = Math.max(4, Math.round(rowSpan / 8));
  for (let r = bounds.minR; r <= bounds.maxR; r += gridStep) {
    const gy = footY + (r - bounds.minR) * scale;
    ctx.beginPath(); ctx.moveTo(footX, gy); ctx.lineTo(footX + footW, gy); ctx.stroke();
  }
  for (let c = bounds.minC; c <= bounds.maxC; c += gridStep) {
    const gx = footX + (c - bounds.minC) * scale;
    ctx.beginPath(); ctx.moveTo(gx, footY); ctx.lineTo(gx, footY + footH); ctx.stroke();
  }

  // 热力图足印
  if (peakData && peakData.length === 4096) {
    let maxVal = 0;
    for (let r = bounds.minR; r <= bounds.maxR; r++) {
      for (let c = bounds.minC; c <= bounds.maxC; c++) {
        const v = peakData[r * 64 + c] || 0;
        if (v > maxVal) maxVal = v;
      }
    }
    if (maxVal > 0) {
      for (let r = bounds.minR; r <= bounds.maxR; r++) {
        for (let c = bounds.minC; c <= bounds.maxC; c++) {
          const v = peakData[r * 64 + c] || 0;
          if (v <= 0) continue;
          ctx.fillStyle = heatColor(v, maxVal);
          const px = footX + (c - bounds.minC) * scale;
          const py = footY + (r - bounds.minR) * scale;
          ctx.fillRect(px, py, scale + 0.5, scale + 0.5);
        }
      }
    }
  }

  // COP 轨迹
  if (copPts.length === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '12px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无轨迹数据', offsetX + width / 2, CANVAS_H / 2);
    return;
  }

  const toCanvas = (copX, copY) => ({
    px: footX + (copY - bounds.minC) * scale,
    py: footY + (copX - bounds.minR) * scale,
  });

  // COP 渐变轨迹线
  const n = copPts.length;
  if (n >= 2) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 描边（深色底层）
    ctx.lineWidth = 4;
    for (let i = 0; i < n - 1; i++) {
      const from = toCanvas(copPts[i][0], copPts[i][1]);
      const to = toCanvas(copPts[i + 1][0], copPts[i + 1][1]);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(from.px, from.py);
      ctx.lineTo(to.px, to.py);
      ctx.stroke();
    }
    // 渐变色线
    ctx.lineWidth = 2.5;
    for (let i = 0; i < n - 1; i++) {
      const from = toCanvas(copPts[i][0], copPts[i][1]);
      const to = toCanvas(copPts[i + 1][0], copPts[i + 1][1]);
      const t = i / (n - 1);
      ctx.strokeStyle = copLineColor(t);
      ctx.beginPath();
      ctx.moveTo(from.px, from.py);
      ctx.lineTo(to.px, to.py);
      ctx.stroke();
    }
  }

  // 高亮悬停点
  if (hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < n) {
    const { px, py } = toCanvas(copPts[hoveredIdx][0], copPts[hoveredIdx][1]);
    const t = n > 1 ? hoveredIdx / (n - 1) : 0;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fillStyle = copLineColor(t);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

export default function InteractiveCOPChart({ leftCopRaw, rightCopRaw, peakFrameData, leftSectionCoords, rightSectionCoords }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  const leftPanelCop = leftCopRaw || [];
  const rightPanelCop = rightCopRaw || [];
  const leftSC = leftSectionCoords ? normalizeSectionCoords(leftSectionCoords) : undefined;
  const rightSC = rightSectionCoords ? normalizeSectionCoords(rightSectionCoords) : undefined;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${CANVAS_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, CANVAS_H);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, rect.width, CANVAS_H);

    const halfW = rect.width / 2;
    drawFootCOP(ctx, leftPanelCop, peakFrameData, 0, 32, 0, halfW,
      hoveredPoint?.side === 'left' ? hoveredPoint.idx : null, '左脚 COP', leftSC);
    drawFootCOP(ctx, rightPanelCop, peakFrameData, 32, 64, halfW, halfW,
      hoveredPoint?.side === 'right' ? hoveredPoint.idx : null, '右脚 COP', rightSC);

    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(halfW, 10); ctx.lineTo(halfW, CANVAS_H - 10); ctx.stroke();
  }, [leftPanelCop, rightPanelCop, hoveredPoint, peakFrameData, leftSC, rightSC]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const halfW = rect.width / 2;
    const side = mx < halfW ? 'left' : 'right';
    const pts = side === 'left' ? leftPanelCop : rightPanelCop;
    if (pts.length === 0) { setHoveredPoint(null); setTooltip(null); return; }

    const colStart = side === 'left' ? 0 : 32;
    const colEnd = side === 'left' ? 32 : 64;
    const sc = side === 'left' ? leftSC : rightSC;
    let bounds;
    if (sc && sc.flat().length > 0) {
      const allCoords = sc.flat();
      let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
      for (const [r, c] of allCoords) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
      bounds = { minR, maxR, minC, maxC };
    } else if (peakFrameData && peakFrameData.length === 4096) {
      bounds = getFootBounds(peakFrameData, colStart, colEnd, pts);
    } else {
      bounds = { minR: 0, maxR: 63, minC: colStart, maxC: colEnd - 1 };
    }
    const rowSpan = bounds.maxR - bounds.minR || 1;
    const colSpan = bounds.maxC - bounds.minC || 1;

    const padding = 24; const titleH = 28;
    const oX = side === 'right' ? halfW : 0;
    const drawW = halfW - padding * 2;
    const drawH = CANVAS_H - padding * 2 - titleH;
    const scale = Math.min(drawW / colSpan, drawH / rowSpan);
    const footW = colSpan * scale;
    const footH = rowSpan * scale;
    const footX = oX + padding + (drawW - footW) / 2;
    const footY = titleH + padding + (drawH - footH) / 2;

    let bestDist = Infinity; let bestIdx = -1;
    for (let i = 0; i < pts.length; i++) {
      const px = footX + (pts[i][1] - bounds.minC) * scale;
      const py = footY + (pts[i][0] - bounds.minR) * scale;
      const d = (mx - px) ** 2 + (my - py) ** 2;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestDist > 400) { setHoveredPoint(null); setTooltip(null); return; }

    setHoveredPoint({ side, idx: bestIdx });
    setTooltip({
      x: e.clientX - rect.left, y: e.clientY - rect.top, side,
      frameIndex: bestIdx, totalFrames: pts.length,
      copX: Math.round(pts[bestIdx][0] * 7 * 10) / 10,
      copY: Math.round(pts[bestIdx][1] * 7 * 10) / 10,
    });
  }, [leftPanelCop, rightPanelCop, peakFrameData, leftSC, rightSC]);

  const handleMouseLeave = useCallback(() => { setHoveredPoint(null); setTooltip(null); }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas ref={canvasRef} className="w-full rounded-lg cursor-crosshair"
        onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
      {tooltip && (
        <div className="absolute pointer-events-none z-10 bg-white/95 border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm"
          style={{ left: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth || 400) - 200), top: tooltip.y - 80 }}>
          <div className="font-semibold text-gray-800">
            {tooltip.side === 'left' ? '左脚' : '右脚'} · 帧 {tooltip.frameIndex + 1}/{tooltip.totalFrames}
          </div>
          <div className="text-gray-600 mt-1">COP X: {tooltip.copX} mm</div>
          <div className="text-gray-600">COP Y: {tooltip.copY} mm</div>
        </div>
      )}
      <div className="flex items-center justify-center gap-2 mt-3">
        <span className="text-xs text-gray-500">起始</span>
        <div className="w-32 h-3 rounded" style={{
          background: `linear-gradient(to right, ${copLineColor(0)}, ${copLineColor(0.25)}, ${copLineColor(0.5)}, ${copLineColor(0.75)}, ${copLineColor(1)})`
        }} />
        <span className="text-xs text-gray-500">结束</span>
      </div>
    </div>
  );
}
