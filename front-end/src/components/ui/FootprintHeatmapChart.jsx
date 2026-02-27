import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, setupHiDPICanvas, roundRect, FONT_FAMILY } from './heatmapUtils';

/**
 * FootprintHeatmapChart - 足印叠加热力图 + FPA辅助线 (优化版)
 * 带色条、圆角卡片、高 DPI、更精致的 FPA 线
 */

export default function FootprintHeatmapChart({ heatmapData, width = 560, height = 660, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!heatmapData || !heatmapData.heatmap || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const { heatmap, fpaLines = [], size } = heatmapData;
    const H = size[0];
    const W = size[1];

    // Compute vmax
    let vmax = 0;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (heatmap[r][c] > vmax) vmax = heatmap[r][c];
      }
    }
    if (vmax <= 0) vmax = 1;

    const displayVmax = vmax * 0.8;
    const threshold = vmax * 0.02;

    const padding = 20;
    const colorbarW = 16;
    const colorbarGap = 20;
    const cardW = width - padding * 2 - colorbarW - colorbarGap - 20;
    const cardH = height - padding * 2;

    const ctx = setupHiDPICanvas(canvas, width, height);

    // Background
    ctx.fillStyle = '#F9FAFB';
    ctx.fillRect(0, 0, width, height);

    // Card
    ctx.shadowColor = 'rgba(0,0,0,0.06)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    roundRect(ctx, padding, padding, cardW, cardH, 8);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    roundRect(ctx, padding, padding, cardW, cardH, 8);
    ctx.stroke();

    // Render heatmap
    const { canvas: offCanvas } = renderMatrixToCanvas(heatmap, displayVmax, threshold, 'transparent');

    const innerPad = 8;
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
    roundRect(ctx, padding + 2, padding + 2, cardW - 4, cardH - 4, 7);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offCanvas, offsetX, offsetY, drawW, drawH);

    // Draw FPA lines
    fpaLines.forEach(line => {
      const { heel, fore, angle, isRight } = line;
      const hx = heel[0] * scale + offsetX;
      const hy = heel[1] * scale + offsetY;
      const fx = fore[0] * scale + offsetX;
      const fy = fore[1] * scale + offsetY;

      const vecX = fx - hx;
      const vecY = fy - hy;
      const extRatio = 0.3;
      const plotFx = fx + vecX * extRatio;
      const plotFy = fy + vecY * extRatio;

      // Foot axis line - glow effect
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = isRight ? '#F59E0B' : '#3B82F6';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Vertical reference line (dashed)
      const footLen = Math.sqrt(vecX * vecX + vecY * vecY);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx, hy - footLen * 1.1);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // Heel dot
      ctx.beginPath();
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // Angle label - pill badge
      const text = `${angle.toFixed(1)}°`;
      ctx.font = `bold 9px ${FONT_FAMILY}`;
      const metrics = ctx.measureText(text);
      const pillW = metrics.width + 10;
      const pillH = 16;
      const pillX = fx + (isRight ? 6 : -6 - pillW);
      const pillY = fy - pillH / 2;

      // Pill background
      const isOut = angle > 0;
      const pillColor = isOut ? 'rgba(245,158,11,0.85)' : 'rgba(59,130,246,0.85)';
      roundRect(ctx, pillX, pillY, pillW, pillH, 8);
      ctx.fillStyle = pillColor;
      ctx.fill();

      // Pill text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold 9px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2 + 3);
    });

    ctx.restore();

    // Colorbar
    const cbX = padding + cardW + colorbarGap;
    const cbY = padding + innerPad;
    const cbH = cardH - innerPad * 2;
    drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, displayVmax);

    // Title label
    ctx.fillStyle = '#6B7B8D';
    ctx.font = `10px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('Pressure (N)', cbX + colorbarW / 2, cbY - 6);
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
