import { useRef, useEffect, useState, useCallback } from 'react';

const REGION_COLORS = [
  'rgba(255, 107, 107, 0.75)',  // S1 红
  'rgba(78, 205, 196, 0.75)',   // S2 青
  'rgba(69, 183, 209, 0.75)',   // S3 蓝
  'rgba(249, 166, 2, 0.75)',    // S4 橙
  'rgba(59, 178, 115, 0.75)',   // S5 绿
  'rgba(155, 89, 182, 0.75)',   // S6 紫
];
const REGION_COLORS_HOVER = [
  'rgba(255, 107, 107, 1)',
  'rgba(78, 205, 196, 1)',
  'rgba(69, 183, 209, 1)',
  'rgba(249, 166, 2, 1)',
  'rgba(59, 178, 115, 1)',
  'rgba(155, 89, 182, 1)',
];
const REGION_NAMES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const SPACING_MM = 7;

/**
 * 将 {S1: [[x,y],...], S2: ...} 格式转为 [coords[], coords[], ...] 数组
 */
function normalizeSections(raw) {
  if (!raw || typeof raw !== 'object') return [[], [], [], [], [], []];
  return REGION_NAMES.map(name => {
    const pts = raw[name];
    return Array.isArray(pts) ? pts : [];
  });
}

function getTightBounds(allCoords) {
  if (allCoords.length === 0) return { minR: 0, maxR: 0, minC: 0, maxC: 0 };
  const coordSet = new Set(allCoords.map(([r, c]) => `${r},${c}`));
  const visited = new Set();
  const components = [];
  for (const [r, c] of allCoords) {
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    const queue = [[r, c]];
    visited.add(key);
    const component = [];
    while (queue.length > 0) {
      const [cr, cc] = queue.shift();
      component.push([cr, cc]);
      for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const nr = cr + dr, nc = cc + dc;
        const nk = `${nr},${nc}`;
        if (coordSet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push([nr, nc]);
        }
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length);
  const main = components[0] || allCoords;
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const [r, c] of main) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, maxR, minC, maxC };
}

function drawFoot(ctx, sections, offsetX, width, canvasH, hoveredRegion, title, tightBounds) {
  const allCoords = sections.flat();
  if (allCoords.length === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '12px "Noto Sans SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据', offsetX + width / 2, canvasH / 2);
    return;
  }

  const bounds = tightBounds || getTightBounds(allCoords);
  const rowSpan = bounds.maxR - bounds.minR + 1;
  const colSpan = bounds.maxC - bounds.minC + 1;

  const padX = 4, padY = 4, titleH = 22, labelW = 44;
  const drawW = width - padX * 2 - labelW;
  const drawH = canvasH - titleH - padY * 2;

  const scale = Math.min(drawW / colSpan, drawH / rowSpan);
  const footW = colSpan * scale;
  const footH = rowSpan * scale;
  const cx = offsetX + padX + (drawW - footW) / 2;
  const cy = titleH + padY + (drawH - footH) / 2;

  // 标题
  ctx.fillStyle = 'var(--text-primary, #333)';
  ctx.font = 'bold 13px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, offsetX + width / 2, 16);

  // 绘制散点
  const cellSize = Math.max(scale * 0.88, 2);
  for (let i = 0; i < sections.length; i++) {
    const isHovered = hoveredRegion === i;
    ctx.fillStyle = isHovered ? REGION_COLORS_HOVER[i] : REGION_COLORS[i];
    for (const [r, c] of sections[i]) {
      if (r < bounds.minR || r > bounds.maxR || c < bounds.minC || c > bounds.maxC) continue;
      const px = cx + (c - bounds.minC) * scale;
      const py = cy + (r - bounds.minR) * scale;
      ctx.fillRect(px - cellSize / 2, py - cellSize / 2, cellSize, cellSize);
    }
  }

  // 分界线 — 5:5:9:5 比例（沿行方向即脚趾→脚跟，画横线）
  const ratios = [5, 5, 9, 5];
  const totalRatio = 24;
  ctx.strokeStyle = 'rgba(231, 76, 60, 0.6)';
  ctx.setLineDash([6, 3]);
  ctx.lineWidth = 1.5;
  let cumRatio = 0;
  for (let i = 0; i < ratios.length - 1; i++) {
    cumRatio += ratios[i];
    const by = cy + (cumRatio / totalRatio) * footH;
    ctx.beginPath();
    ctx.moveTo(cx - 3, by);
    ctx.lineTo(cx + footW + 3, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 区域标签（右侧）
  ctx.font = '10px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'left';
  const labelX = cx + footW + 6;
  const labelSpacing = Math.min(footH / 6, 18);
  const labelStartY = cy + (footH - labelSpacing * 5) / 2;
  for (let i = 0; i < REGION_NAMES.length; i++) {
    const midY = labelStartY + i * labelSpacing;
    ctx.fillStyle = REGION_COLORS[i].replace(/[\d.]+\)$/, '1)');
    ctx.fillText(`${REGION_NAMES[i]}(${sections[i].length})`, labelX, midY + 4);
  }
}

export default function GaitRegionChart({ leftRegionCoords, rightRegionCoords }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hoveredRegion, setHoveredRegion] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  const leftSections = normalizeSections(leftRegionCoords);
  const rightSections = normalizeSections(rightRegionCoords);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const halfW = rect.width / 2;

    const leftAll = leftSections.flat();
    const rightAll = rightSections.flat();
    const leftBounds = getTightBounds(leftAll);
    const rightBounds = getTightBounds(rightAll);

    const leftRowSpan = leftAll.length > 0 ? leftBounds.maxR - leftBounds.minR + 1 : 0;
    const rightRowSpan = rightAll.length > 0 ? rightBounds.maxR - rightBounds.minR + 1 : 0;
    const leftColSpan = leftAll.length > 0 ? leftBounds.maxC - leftBounds.minC + 1 : 0;
    const rightColSpan = rightAll.length > 0 ? rightBounds.maxC - rightBounds.minC + 1 : 0;
    const maxRowSpan = Math.max(leftRowSpan, rightRowSpan) || 1;
    const maxColSpan = Math.max(leftColSpan, rightColSpan) || 1;

    const padX = 4, titleH = 22, padY = 4, labelW = 44;
    const drawW = halfW - padX * 2 - labelW;
    const scaleByW = drawW / maxColSpan;
    const neededH = titleH + padY * 2 + maxRowSpan * scaleByW;
    const canvasH = Math.min(Math.max(neededH, 280), 460);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${canvasH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, canvasH);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, rect.width, canvasH);

    drawFoot(ctx, leftSections, 0, halfW, canvasH,
      hoveredRegion?.side === 'left' ? hoveredRegion.index : null, '左足', leftBounds);
    drawFoot(ctx, rightSections, halfW, halfW, canvasH,
      hoveredRegion?.side === 'right' ? hoveredRegion.index : null, '右足', rightBounds);

    // 中间分隔线
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(halfW, 10);
    ctx.lineTo(halfW, canvasH - 10);
    ctx.stroke();
  }, [leftSections, rightSections, hoveredRegion]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const mx = e.clientX - canvasRect.left;
    const my = e.clientY - canvasRect.top;
    const halfW = canvasRect.width / 2;
    const side = mx < halfW ? 'left' : 'right';
    const sections = side === 'left' ? leftSections : rightSections;
    const allCoords = sections.flat();
    if (allCoords.length === 0) { setHoveredRegion(null); setTooltip(null); return; }

    const bounds = getTightBounds(allCoords);
    const rowSpan = bounds.maxR - bounds.minR + 1;
    const colSpan = bounds.maxC - bounds.minC + 1;

    const padX = 4, titleH = 22, padY = 4, labelW = 44;
    const oX = side === 'right' ? halfW : 0;
    const drawW = halfW - padX * 2 - labelW;
    const drawH = canvasRect.height - titleH - padY * 2;
    const scale = Math.min(drawW / colSpan, drawH / rowSpan);
    const footW = colSpan * scale;
    const footH = rowSpan * scale;
    const cx = oX + padX + (drawW - footW) / 2;
    const cy = titleH + padY + (drawH - footH) / 2;

    const dataC = (mx - cx) / scale + bounds.minC;
    const dataR = (my - cy) / scale + bounds.minR;

    let bestDist = Infinity, bestRegion = -1;
    for (let i = 0; i < sections.length; i++) {
      for (const [r, c] of sections[i]) {
        const d = (r - dataR) ** 2 + (c - dataC) ** 2;
        if (d < bestDist) { bestDist = d; bestRegion = i; }
      }
    }

    if (bestDist > 9) { setHoveredRegion(null); setTooltip(null); return; }

    setHoveredRegion({ side, index: bestRegion });
    const totalPoints = sections.reduce((s, r) => s + r.length, 0);
    const pts = sections[bestRegion].length;
    const areaCm2 = pts * SPACING_MM * SPACING_MM / 100;
    const areaPercent = totalPoints > 0 ? (pts / totalPoints) * 100 : 0;
    setTooltip({
      x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top,
      regionIndex: bestRegion, side, pointCount: pts,
      areaCm2: Math.round(areaCm2 * 10) / 10, areaPercent: Math.round(areaPercent * 10) / 10,
    });
  }, [leftSections, rightSections]);

  const handleMouseLeave = useCallback(() => { setHoveredRegion(null); setTooltip(null); }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas ref={canvasRef} className="w-full rounded-lg cursor-crosshair"
        onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
      {tooltip && (
        <div className="absolute pointer-events-none z-10 bg-white/95 border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm"
          style={{ left: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth || 400) - 180), top: tooltip.y - 70 }}>
          <div className="font-semibold" style={{ color: REGION_COLORS[tooltip.regionIndex].replace(/[\d.]+\)$/, '1)') }}>
            {tooltip.side === 'left' ? '左足' : '右足'} · {REGION_NAMES[tooltip.regionIndex]}
          </div>
          <div className="text-gray-600 mt-1">面积: {tooltip.areaCm2} cm² ({tooltip.areaPercent}%)</div>
          <div className="text-gray-600">采样点: {tooltip.pointCount} 个</div>
        </div>
      )}
      <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
        {REGION_NAMES.map((name, i) => (
          <div key={name} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: REGION_COLORS[i] }} />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}
