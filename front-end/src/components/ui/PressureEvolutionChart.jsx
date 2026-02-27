import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, roundRect, FONT } from './heatmapUtils';

/**
 * PressureEvolutionChart - 动态压力演变渲染组件
 * 左右脚各10帧裁剪后的热力图网格
 * 
 * 不使用 DPR 缩放，直接用大像素 Canvas 保证清晰度
 */

export default function PressureEvolutionChart({ evolutionData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!evolutionData || !canvasRef.current) return;
    const canvas = canvasRef.current;

    const leftData = evolutionData.left;
    const rightData = evolutionData.right;

    const numCols = 10;
    const cellW = 80;
    const cellH = 110;
    const cellGap = 8;
    const labelW = 80;
    const rowGap = 40;
    const titleH = 22;
    const colorbarW = 16;
    const colorbarMargin = 16;
    const padTop = 16;
    const padBottom = 12;

    const rows = [
      { data: leftData, label: 'Left Foot', color: '#3B82F6' },
      { data: rightData, label: 'Right Foot', color: '#F59E0B' },
    ];

    const totalW = labelW + numCols * (cellW + cellGap) - cellGap + colorbarMargin + colorbarW + 40;
    const totalH = padTop + rows.length * (cellH + titleH + rowGap) - rowGap + padBottom;

    canvas.width = totalW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, totalW, totalH);

    rows.forEach((row, rowIdx) => {
      const yBase = padTop + rowIdx * (cellH + titleH + rowGap);

      // Row label
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(14, yBase + cellH / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1F2937';
      ctx.font = `bold 13px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, 26, yBase + cellH / 2);

      if (!row.data || !row.data.frames) return;

      const frames = row.data.frames;
      const titles = row.data.titles || [];
      const vmax = row.data.vmax || 1;
      const threshold = vmax * 0.02;

      for (let col = 0; col < Math.min(frames.length, numCols); col++) {
        const x = labelW + col * (cellW + cellGap);
        const y = yBase;

        // Card background (dark)
        roundRect(ctx, x, y, cellW, cellH, 4);
        ctx.fillStyle = '#1A1A2E';
        ctx.fill();

        // Render heatmap frame
        const frameData = frames[col];
        if (frameData && frameData.length > 0) {
          const { canvas: offCanvas, rows: fRows, cols: fCols } = renderMatrixToCanvas(
            frameData, vmax, threshold, '#000'
          );

          const pad = 3;
          const innerW = cellW - pad * 2;
          const innerH = cellH - pad * 2;
          const scaleX = innerW / fCols;
          const scaleY = innerH / fRows;
          const scale = Math.min(scaleX, scaleY);
          const drawW = fCols * scale;
          const drawH = fRows * scale;
          const offX = x + pad + (innerW - drawW) / 2;
          const offY = y + pad + (innerH - drawH) / 2;

          ctx.save();
          roundRect(ctx, x + 1, y + 1, cellW - 2, cellH - 2, 3);
          ctx.clip();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(offCanvas, offX, offY, drawW, drawH);
          ctx.restore();
        }

        // Peak highlight
        const titleText = titles[col] || '';
        if (titleText.includes('Peak')) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2.5;
          roundRect(ctx, x, y, cellW, cellH, 4);
          ctx.stroke();

          // Peak badge
          ctx.fillStyle = '#EF4444';
          roundRect(ctx, x + cellW / 2 - 18, y - 8, 36, 14, 7);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = `bold 9px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('PEAK', x + cellW / 2, y - 1);
        }

        // Title below cell - 截断时间显示，只保留整数ms
        let displayTitle = titleText;
        // 处理类似 "12.987012987ms" 的情况，截断为整数
        displayTitle = displayTitle.replace(/(\d+)\.\d+(ms)/g, '$1$2');
        // 处理 "Start 0ms" / "End 701ms" / "Peak 64ms"
        displayTitle = displayTitle.replace('Peak ', '');

        ctx.fillStyle = '#9CA3AF';
        ctx.font = `10px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(displayTitle, x + cellW / 2, y + cellH + 4);
      }

      // Colorbar
      const cbX = labelW + numCols * (cellW + cellGap) - cellGap + colorbarMargin;
      const cbY = yBase + 4;
      const cbH = cellH - 8;
      drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, vmax);
    });
  }, [evolutionData]);

  if (!evolutionData) return null;

  return (
    <div className={`overflow-x-auto ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
}
