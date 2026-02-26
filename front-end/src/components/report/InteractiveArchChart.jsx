import { useRef, useEffect, useState, useCallback } from 'react';

// 区域颜色（与 Python visualize_foot_regions 一致）
const REGION_COLORS = [
  'rgba(65, 105, 225, 0.7)',   // 趾部 - 蓝色
  'rgba(50, 205, 50, 0.7)',    // 前足 - 绿色
  'rgba(255, 165, 0, 0.7)',    // 中足 - 橙色
  'rgba(220, 20, 60, 0.7)',    // 后足 - 红色
];
const REGION_COLORS_HOVER = [
  'rgba(65, 105, 225, 0.95)',
  'rgba(50, 205, 50, 0.95)',
  'rgba(255, 165, 0, 0.95)',
  'rgba(220, 20, 60, 0.95)',
];
const REGION_NAMES = ['趾部', '前足', '中足', '后足'];
const SPACING_MM = 7;

/** 将 section_coords（可能是数组或对象）统一转为 number[][][] */
function normalizeSectionCoords(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => raw[k]);
  }
  return [[], [], [], []];
}

/** 计算坐标的边界 */
function getBounds(coords) {
  if (coords.length === 0) return { minR: 0, maxR: 0, minC: 0, maxC: 0 };
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const [r, c] of coords) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, maxR, minC, maxC };
}

const CANVAS_H = 420;

/**
 * 绘制单只脚的区域图（脚趾朝上）
 */
function drawFoot(ctx, sections, offsetX, width, hoveredRegion, title) {
  const allCoords = sections.flat();
  if (allCoords.length === 0) return;

  const bounds = getBounds(allCoords);
  const padding = 24;
  const titleH = 28;
  const drawW = width - padding * 2;
  const drawH = CANVAS_H - padding * 2 - titleH;
  const dataRowSpan = bounds.maxR - bounds.minR || 1;
  const dataColSpan = bounds.maxC - bounds.minC || 1;
  const scale = Math.min(drawW / dataColSpan, drawH / dataRowSpan);
  const cx = offsetX + padding + (drawW - dataColSpan * scale) / 2;
  const cy = titleH + padding + (drawH - dataRowSpan * scale) / 2;

  // 标题
  ctx.fillStyle = '#333';
  ctx.font = 'bold 14px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, offsetX + width / 2, 20);

  // 绘制每个区域的点
  const cellSize = Math.max(scale * 0.9, 2);
  for (let i = 0; i < sections.length; i++) {
    const isHovered = hoveredRegion === i;
    ctx.fillStyle = isHovered ? REGION_COLORS_HOVER[i] : REGION_COLORS[i];
    for (const [r, c] of sections[i]) {
      const px = cx + (c - bounds.minC) * scale;
      const py = cy + (r - bounds.minR) * scale;
      ctx.fillRect(px - cellSize / 2, py - cellSize / 2, cellSize, cellSize);
    }
  }

  // 绘制区域分界线
  const ratios = [3, 4, 4, 4];
  const totalRatio = 15;
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
  ctx.setLineDash([6, 3]);
  ctx.lineWidth = 2;
  let cumRatio = 0;
  for (let i = 0; i < ratios.length - 1; i++) {
    cumRatio += ratios[i];
    const by = cy + (cumRatio / totalRatio) * dataRowSpan * scale;
    ctx.beginPath();
    ctx.moveTo(cx - 5, by);
    ctx.lineTo(cx + dataColSpan * scale + 5, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 区域标签（右侧）
  cumRatio = 0;
  ctx.font = '11px "Noto Sans SC", sans-serif';
  ctx.textAlign = 'left';
  const labelX = cx + dataColSpan * scale + 8;
  for (let i = 0; i < ratios.length; i++) {
    const startR = cumRatio;
    cumRatio += ratios[i];
    const midY = cy + ((startR + cumRatio) / 2 / totalRatio) * dataRowSpan * scale;
    const text = `${REGION_NAMES[i]}(${sections[i].length})`;
    ctx.fillStyle = REGION_COLORS[i].replace(/[\d.]+\)$/, '1)');
    ctx.fillText(text, labelX, midY + 4);
  }
}

export default function InteractiveArchChart({ leftSectionCoords, rightSectionCoords }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hoveredRegion, setHoveredRegion] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  const leftSections = normalizeSectionCoords(leftSectionCoords);
  const rightSections = normalizeSectionCoords(rightSectionCoords);

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
    drawFoot(ctx, leftSections, 0, halfW, hoveredRegion?.side === 'left' ? hoveredRegion.index : null, '左脚');
    drawFoot(ctx, rightSections, halfW, halfW, hoveredRegion?.side === 'right' ? hoveredRegion.index : null, '右脚');

    // 中间分隔线
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(halfW, 10);
    ctx.lineTo(halfW, CANVAS_H - 10);
    ctx.stroke();
  }, [leftSections, rightSections, hoveredRegion]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  /** 鼠标移动：检测悬停区域 */
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const halfW = rect.width / 2;
    const side = mx < halfW ? 'left' : 'right';
    const sections = side === 'left' ? leftSections : rightSections;
    const allCoords = sections.flat();
    if (allCoords.length === 0) { setHoveredRegion(null); setTooltip(null); return; }

    const bounds = getBounds(allCoords);
    const padding = 24;
    const titleH = 28;
    const oX = side === 'right' ? halfW : 0;
    const drawW = halfW - padding * 2;
    const drawH = CANVAS_H - padding * 2 - titleH;
    const dataRowSpan = bounds.maxR - bounds.minR || 1;
    const dataColSpan = bounds.maxC - bounds.minC || 1;
    const scale = Math.min(drawW / dataColSpan, drawH / dataRowSpan);
    const cx = oX + padding + (drawW - dataColSpan * scale) / 2;
    const cy = titleH + padding + (drawH - dataRowSpan * scale) / 2;

    const dataC = (mx - cx) / scale + bounds.minC;
    const dataR = (my - cy) / scale + bounds.minR;

    let bestDist = Infinity;
    let bestRegion = -1;
    for (let i = 0; i < sections.length; i++) {
      for (const [r, c] of sections[i]) {
        const d = (r - dataR) ** 2 + (c - dataC) ** 2;
        if (d < bestDist) { bestDist = d; bestRegion = i; }
      }
    }

    if (bestDist > 9) {
      setHoveredRegion(null);
      setTooltip(null);
      return;
    }

    setHoveredRegion({ side, index: bestRegion });

    const totalPoints = sections.reduce((s, r) => s + r.length, 0);
    const pts = sections[bestRegion].length;
    const areaCm2 = pts * SPACING_MM * SPACING_MM / 100;
    const areaPercent = totalPoints > 0 ? (pts / totalPoints) * 100 : 0;

    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      regionIndex: bestRegion,
      side,
      pointCount: pts,
      areaCm2: Math.round(areaCm2 * 10) / 10,
      areaPercent: Math.round(areaPercent * 10) / 10,
    });
  }, [leftSections, rightSections]);

  const handleMouseLeave = useCallback(() => {
    setHoveredRegion(null);
    setTooltip(null);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 bg-white/95 border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm"
          style={{
            left: Math.min(tooltip.x + 12, (containerRef.current?.clientWidth || 400) - 180),
            top: tooltip.y - 70,
          }}
        >
          <div className="font-semibold" style={{ color: REGION_COLORS[tooltip.regionIndex].replace(/[\d.]+\)$/, '1)') }}>
            {tooltip.side === 'left' ? '左脚' : '右脚'} · {REGION_NAMES[tooltip.regionIndex]}
          </div>
          <div className="text-gray-600 mt-1">
            面积: {tooltip.areaCm2} cm² ({tooltip.areaPercent}%)
          </div>
          <div className="text-gray-600">
            采样点: {tooltip.pointCount} 个
          </div>
        </div>
      )}
      <div className="flex items-center justify-center gap-4 mt-3">
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
