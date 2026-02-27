import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, setupHiDPICanvas, roundRect, FONT_FAMILY } from './heatmapUtils';

/**
 * GaitAverageChart - 步态平均热力图 + COP轨迹 (优化版)
 * 带色条、圆角卡片、高 DPI、COP 轨迹渐变
 */

export default function GaitAverageChart({ gaitAvgData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!gaitAvgData || !canvasRef.current) return;

    const canvas = canvasRef.current;

    const sides = [
      { data: gaitAvgData.left, label: 'Left Foot', subLabel: 'Average', color: '#0066CC', dotColor: '#3B82F6' },
      { data: gaitAvgData.right, label: 'Right Foot', subLabel: 'Average', color: '#D97706', dotColor: '#F59E0B' },
    ].filter(s => s.data && s.data.heatmap);

    if (sides.length === 0) return;

    const padding = 24;
    const labelH = 36;
    const cellW = 220;
    const cellH = 320;
    const gap = 32;
    const colorbarW = 14;
    const colorbarGap = 16;

    const totalW = padding * 2 + sides.length * (cellW + colorbarGap + colorbarW + 20) + (sides.length - 1) * gap;
    const totalH = padding + labelH + cellH + padding + 10;

    const ctx = setupHiDPICanvas(canvas, totalW, totalH);

    // Background
    ctx.fillStyle = '#F9FAFB';
    ctx.fillRect(0, 0, totalW, totalH);

    sides.forEach((side, idx) => {
      const { data, label, subLabel, color, dotColor } = side;
      const heatmap = data.heatmap;
      const cops = data.copTrajectories || [];

      // Compute vmax
      let vmax = 0;
      for (const row of heatmap) {
        for (const v of row) {
          if (v > vmax) vmax = v;
        }
      }
      if (vmax <= 0) vmax = 1;

      const threshold = vmax * 0.02;
      const displayVmax = vmax * 0.85;
      const { canvas: offCanvas, rows, cols } = renderMatrixToCanvas(heatmap, displayVmax, threshold, 'transparent');

      const blockW = cellW + colorbarGap + colorbarW + 20;
      const baseX = padding + idx * (blockW + gap);
      const cardX = baseX;
      const cardY = padding + labelH;

      // Label
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(baseX + 2, padding + labelH / 2 - 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1F2937';
      ctx.font = `bold 13px ${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.fillText(label, baseX + 14, padding + labelH / 2 + 2);

      ctx.fillStyle = '#9CA3AF';
      ctx.font = `11px ${FONT_FAMILY}`;
      ctx.fillText(`${subLabel} (${data.stepCount} steps)`, baseX + 14 + ctx.measureText(label).width + 6, padding + labelH / 2 + 2);

      // Card shadow
      ctx.shadowColor = 'rgba(0,0,0,0.06)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      roundRect(ctx, cardX, cardY, cellW, cellH, 8);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // Card border
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      roundRect(ctx, cardX, cardY, cellW, cellH, 8);
      ctx.stroke();

      // Heatmap inside card
      const innerPad = 10;
      const innerW = cellW - innerPad * 2;
      const innerH = cellH - innerPad * 2;
      const scaleX = innerW / cols;
      const scaleY = innerH / rows;
      const scale = Math.min(scaleX, scaleY);
      const drawW = cols * scale;
      const drawH = rows * scale;
      const offX = cardX + innerPad + (innerW - drawW) / 2;
      const offY = cardY + innerPad + (innerH - drawH) / 2;

      ctx.save();
      roundRect(ctx, cardX + 2, cardY + 2, cellW - 4, cellH - 4, 7);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(offCanvas, offX, offY, drawW, drawH);
      ctx.restore();

      // COP trajectories with gradient
      cops.forEach((trail, trailIdx) => {
        if (!trail || trail.length < 2) return;

        ctx.save();
        roundRect(ctx, cardX + 2, cardY + 2, cellW - 4, cellH - 4, 7);
        ctx.clip();

        for (let i = 1; i < trail.length; i++) {
          const px0 = trail[i - 1][1] * scale + offX;
          const py0 = trail[i - 1][0] * scale + offY;
          const px1 = trail[i][1] * scale + offX;
          const py1 = trail[i][0] * scale + offY;

          const progress = i / trail.length;
          const alpha = 0.3 + progress * 0.5;

          ctx.beginPath();
          ctx.moveTo(px0, py0);
          ctx.lineTo(px1, py1);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }

        // Start/end markers
        if (trail.length > 0) {
          const startPx = trail[0][1] * scale + offX;
          const startPy = trail[0][0] * scale + offY;
          ctx.beginPath();
          ctx.arc(startPx, startPy, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#22D3EE';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();

          const endPx = trail[trail.length - 1][1] * scale + offX;
          const endPy = trail[trail.length - 1][0] * scale + offY;
          ctx.beginPath();
          ctx.arc(endPx, endPy, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#F43F5E';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.restore();
      });

      // Colorbar
      const cbX = cardX + cellW + colorbarGap;
      const cbY = cardY + innerPad;
      const cbH = cellH - innerPad * 2;
      drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, displayVmax);
    });
  }, [gaitAvgData]);

  if (!gaitAvgData) return null;

  return (
    <div className={`flex justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
}
