import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, roundRect, FONT } from './heatmapUtils';

/**
 * FootprintHeatmapChart - 足印叠加热力图 + FPA辅助线
 * 
 * 修复：使用 P95 百分位数做 vmax（而非全局最大值），避免极端值导致大部分区域看不见
 * 自适应矩阵宽高比
 */

export default function FootprintHeatmapChart({ heatmapData, width = 600, height, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!heatmapData || !heatmapData.heatmap || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const { heatmap, fpaLines = [], size } = heatmapData;
    const H = size[0];
    const W = size[1];

    // 收集所有非零值，用百分位数做 vmax
    const nonZeroVals = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (heatmap[r][c] > 0) nonZeroVals.push(heatmap[r][c]);
      }
    }
    if (nonZeroVals.length === 0) return;

    nonZeroVals.sort((a, b) => a - b);
    const p95Idx = Math.floor(nonZeroVals.length * 0.95);
    const vmax = nonZeroVals[p95Idx] || nonZeroVals[nonZeroVals.length - 1] || 1;
    // threshold: 只过滤非常小的噪声
    const threshold = vmax * 0.005;

    // 自适应高度：根据矩阵宽高比
    const padding = 24;
    const colorbarW = 18;
    const colorbarGap = 20;
    const cardW = width - padding * 2 - colorbarW - colorbarGap - 30;
    const aspectRatio = H / W;
    const cardH = height ? (height - padding * 2) : Math.round(cardW * aspectRatio);
    const totalH = height || (cardH + padding * 2);

    canvas.width = width;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, width, totalH);

    // Card
    roundRect(ctx, padding, padding, cardW, cardH, 6);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    roundRect(ctx, padding, padding, cardW, cardH, 6);
    ctx.stroke();

    // Render heatmap
    const { canvas: offCanvas } = renderMatrixToCanvas(heatmap, vmax, threshold, 'transparent');

    const innerPad = 6;
    const innerW = cardW - innerPad * 2;
    const innerH = cardH - innerPad * 2;
    const scaleX = innerW / W;
    const scaleY = innerH / H;
    const scale = Math.min(scaleX, scaleY);
    const drawW = W * scale;
    const drawH = H * scale;
    const offsetX = padding + innerPad + (innerW - drawW) / 2;
    const offsetY = padding + innerPad + (innerH - drawH) / 2;

    ctx.save();
    roundRect(ctx, padding + 1, padding + 1, cardW - 2, cardH - 2, 5);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offCanvas, offsetX, offsetY, drawW, drawH);

    // Draw FPA lines
    fpaLines.forEach(line => {
      const { heel, fore, angle, isRight } = line;
      // heel/fore 坐标是 [col, row] 在原始矩阵坐标系中
      const hx = heel[0] * scale + offsetX;
      const hy = heel[1] * scale + offsetY;
      const fx = fore[0] * scale + offsetX;
      const fy = fore[1] * scale + offsetY;

      const vecX = fx - hx;
      const vecY = fy - hy;
      const extRatio = 0.3;
      const plotFx = fx + vecX * extRatio;
      const plotFy = fy + vecY * extRatio;

      // Foot axis line - glow
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Colored line
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = isRight ? '#F59E0B' : '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Vertical reference (dashed)
      const footLen = Math.sqrt(vecX * vecX + vecY * vecY);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx, hy - footLen * 1.1);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Heel dot
      ctx.beginPath();
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // Angle badge
      const text = `${angle.toFixed(1)}°`;
      ctx.font = `bold 10px ${FONT}`;
      const metrics = ctx.measureText(text);
      const pillW = metrics.width + 10;
      const pillH = 16;
      const pillX = fx + (isRight ? 6 : -6 - pillW);
      const pillY = fy - pillH / 2;

      const pillColor = isRight ? 'rgba(245,158,11,0.9)' : 'rgba(59,130,246,0.9)';
      roundRect(ctx, pillX, pillY, pillW, pillH, 8);
      ctx.fillStyle = pillColor;
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2);
    });

    ctx.restore();

    // Colorbar
    const cbX = padding + cardW + colorbarGap;
    const cbY = padding + innerPad;
    const cbH = cardH - innerPad * 2;
    drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, vmax);
  }, [heatmapData, width, height]);

  if (!heatmapData || !heatmapData.heatmap) return null;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
    />
  );
}
