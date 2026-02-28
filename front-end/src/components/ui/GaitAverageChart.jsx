import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, roundRect, calcP95Vmax } from './heatmapUtils';

/**
 * GaitAverageChart - 步态平均热力图 + COP轨迹
 * 黑色背景，jet色谱，白色COP轨迹，使用双线性上采样插值
 */

export default function GaitAverageChart({ gaitAvgData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!gaitAvgData || !canvasRef.current) return;
    const canvas = canvasRef.current;

    const sides = [
      { data: gaitAvgData.left, label: 'Left Foot Average', color: '#3B82F6' },
      { data: gaitAvgData.right, label: 'Right Foot Average', color: '#F59E0B' },
    ].filter(s => s.data && s.data.heatmap);

    if (sides.length === 0) return;

    const padding = 20;
    const labelH = 28;
    const cellW = 240;
    const cellH = 360;
    const gap = 30;
    const colorbarW = 20;
    const colorbarGap = 12;

    const blockW = cellW + colorbarGap + colorbarW + 30;
    const totalW = padding * 2 + sides.length * blockW + (sides.length - 1) * gap;
    const totalH = padding + labelH + cellH + padding;

    canvas.width = totalW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, totalW, totalH);

    sides.forEach((side, idx) => {
      const { data, label, color } = side;
      const heatmap = data.heatmap;
      const cops = data.copTrajectories || [];
      const srcRows = heatmap.length;
      const srcCols = heatmap[0].length;

      const vmax = calcP95Vmax(heatmap);
      const threshold = vmax * 0.005;

      const baseX = padding + idx * (blockW + gap);
      const cardX = baseX;
      const cardY = padding + labelH;

      // 标签
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(baseX + 4, padding + labelH / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1F2937';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${label} (${data.stepCount} steps)`, baseX + 16, padding + labelH / 2);

      // 黑色背景卡片
      roundRect(ctx, cardX, cardY, cellW, cellH, 4);
      ctx.fillStyle = '#111122';
      ctx.fill();

      // 上采样渲染热力图
      const innerPad = 6;
      const renderW = cellW - innerPad * 2;
      const renderH = cellH - innerPad * 2;

      const { canvas: offCanvas, scaleX, scaleY } = renderMatrixToCanvas(
        heatmap, vmax, threshold, '#000', renderW, renderH
      );

      // 保持宽高比
      const srcAspect = srcRows / srcCols;
      const dstAspect = renderH / renderW;
      let drawW, drawH;
      if (srcAspect > dstAspect) {
        drawH = renderH;
        drawW = renderH / srcAspect;
      } else {
        drawW = renderW;
        drawH = renderW * srcAspect;
      }
      const offX = cardX + innerPad + (renderW - drawW) / 2;
      const offY = cardY + innerPad + (renderH - drawH) / 2;

      ctx.save();
      roundRect(ctx, cardX + 1, cardY + 1, cellW - 2, cellH - 2, 3);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offCanvas, offX, offY, drawW, drawH);

      // COP 轨迹（白色渐变线）
      const pixPerSrcCol = drawW / srcCols;
      const pixPerSrcRow = drawH / srcRows;

      cops.forEach((trail) => {
        if (!trail || trail.length < 2) return;

        // 白色描边（粗线做底）
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const px = trail[i][1] * pixPerSrcCol + offX;
          const py = trail[i][0] * pixPerSrcRow + offY;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 细线
        ctx.beginPath();
        for (let i = 0; i < trail.length; i++) {
          const px = trail[i][1] * pixPerSrcCol + offX;
          const py = trail[i][0] * pixPerSrcRow + offY;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = 'rgba(255,255,0,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 起止点
        if (trail.length > 0) {
          const sx = trail[0][1] * pixPerSrcCol + offX;
          const sy = trail[0][0] * pixPerSrcRow + offY;
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#00FFFF';
          ctx.fill();

          const ex = trail[trail.length - 1][1] * pixPerSrcCol + offX;
          const ey = trail[trail.length - 1][0] * pixPerSrcRow + offY;
          ctx.beginPath();
          ctx.arc(ex, ey, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#FF4444';
          ctx.fill();
        }
      });

      ctx.restore();

      // 色条
      const cbX = cardX + cellW + colorbarGap;
      const cbY = cardY + innerPad;
      const cbH = cellH - innerPad * 2;
      drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, vmax);
    });
  }, [gaitAvgData]);

  if (!gaitAvgData) return null;

  return (
    <div className={`flex justify-center ${className}`}>
      <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
    </div>
  );
}
