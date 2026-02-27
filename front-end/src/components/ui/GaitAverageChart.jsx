import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, roundRect, FONT } from './heatmapUtils';

/**
 * GaitAverageChart - 步态平均热力图 + COP轨迹
 * 
 * 不使用 DPR 缩放，直接大像素 Canvas
 */

export default function GaitAverageChart({ gaitAvgData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!gaitAvgData || !canvasRef.current) return;

    const canvas = canvasRef.current;

    const sides = [
      { data: gaitAvgData.left, label: 'Left Foot', color: '#3B82F6' },
      { data: gaitAvgData.right, label: 'Right Foot', color: '#F59E0B' },
    ].filter(s => s.data && s.data.heatmap);

    if (sides.length === 0) return;

    const padding = 24;
    const labelH = 32;
    const cellW = 200;
    const cellH = 300;
    const gap = 40;
    const colorbarW = 16;
    const colorbarGap = 12;

    const blockW = cellW + colorbarGap + colorbarW + 24;
    const totalW = padding * 2 + sides.length * blockW + (sides.length - 1) * gap;
    const totalH = padding + labelH + cellH + padding;

    canvas.width = totalW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, totalW, totalH);

    sides.forEach((side, idx) => {
      const { data, label, color } = side;
      const heatmap = data.heatmap;
      const cops = data.copTrajectories || [];

      // 使用 P95 百分位数做 vmax
      const nonZeroVals = [];
      for (const row of heatmap) {
        for (const v of row) {
          if (v > 0) nonZeroVals.push(v);
        }
      }
      if (nonZeroVals.length === 0) return;
      nonZeroVals.sort((a, b) => a - b);
      const p95Idx = Math.floor(nonZeroVals.length * 0.95);
      const vmax = nonZeroVals[p95Idx] || nonZeroVals[nonZeroVals.length - 1] || 1;
      const threshold = vmax * 0.005;

      const rows = heatmap.length;
      const cols = heatmap[0].length;
      const { canvas: offCanvas } = renderMatrixToCanvas(heatmap, vmax, threshold, 'transparent');

      const baseX = padding + idx * (blockW + gap);
      const cardX = baseX;
      const cardY = padding + labelH;

      // Label
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(baseX + 4, padding + labelH / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1F2937';
      ctx.font = `bold 13px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, baseX + 16, padding + labelH / 2);

      ctx.fillStyle = '#9CA3AF';
      ctx.font = `11px ${FONT}`;
      const labelEnd = baseX + 16 + ctx.measureText(label).width + 6;
      ctx.fillText(`(${data.stepCount} steps)`, labelEnd, padding + labelH / 2);

      // Card
      roundRect(ctx, cardX, cardY, cellW, cellH, 6);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      roundRect(ctx, cardX, cardY, cellW, cellH, 6);
      ctx.stroke();

      // Heatmap
      const innerPad = 8;
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
      roundRect(ctx, cardX + 1, cardY + 1, cellW - 2, cellH - 2, 5);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(offCanvas, offX, offY, drawW, drawH);

      // COP trajectories
      cops.forEach((trail) => {
        if (!trail || trail.length < 2) return;

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
          const sx = trail[0][1] * scale + offX;
          const sy = trail[0][0] * scale + offY;
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#22D3EE';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();

          const ex = trail[trail.length - 1][1] * scale + offX;
          const ey = trail[trail.length - 1][0] * scale + offY;
          ctx.beginPath();
          ctx.arc(ex, ey, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#F43F5E';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });

      ctx.restore();

      // Colorbar
      const cbX = cardX + cellW + colorbarGap;
      const cbY = cardY + innerPad;
      const cbH = cellH - innerPad * 2;
      drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, vmax);
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
