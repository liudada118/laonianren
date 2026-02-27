import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, setupHiDPICanvas, roundRect, FONT_FAMILY } from './heatmapUtils';

/**
 * PressureEvolutionChart - 动态压力演变渲染组件 (优化版)
 * 渲染左右脚各10帧裁剪后的热力图网格，带色条、圆角、高 DPI
 */

export default function PressureEvolutionChart({ evolutionData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!evolutionData || !canvasRef.current) return;
    const canvas = canvasRef.current;

    const leftData = evolutionData.left;
    const rightData = evolutionData.right;

    const numCols = 10;
    const cellW = 72;
    const cellH = 96;
    const gap = 6;
    const labelW = 90;
    const rowGap = 32;
    const titleH = 20;
    const colorbarW = 14;
    const colorbarGap = 40;
    const paddingTop = 12;
    const paddingBottom = 8;

    const rows = [
      { data: leftData, label: 'Left Foot', color: '#0066CC' },
      { data: rightData, label: 'Right Foot', color: '#D97706' },
    ];

    const totalW = labelW + numCols * (cellW + gap) + colorbarGap + colorbarW + 30;
    const totalH = paddingTop + rows.length * (cellH + titleH + rowGap) - rowGap + paddingBottom;

    const ctx = setupHiDPICanvas(canvas, totalW, totalH);

    // Background
    ctx.fillStyle = '#F9FAFB';
    ctx.fillRect(0, 0, totalW, totalH);

    rows.forEach((row, rowIdx) => {
      const yBase = paddingTop + rowIdx * (cellH + titleH + rowGap);

      // Row label with colored dot
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(12, yBase + cellH / 2, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1F2937';
      ctx.font = `600 12px ${FONT_FAMILY}`;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, 22, yBase + cellH / 2 + 4);

      if (!row.data || !row.data.frames) return;

      const frames = row.data.frames;
      const titles = row.data.titles || [];
      const vmax = row.data.vmax || 1;
      const threshold = vmax * 0.02;

      for (let col = 0; col < Math.min(frames.length, numCols); col++) {
        const x = labelW + col * (cellW + gap);
        const y = yBase;

        // Card shadow
        ctx.shadowColor = 'rgba(0,0,0,0.08)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;

        // Rounded card background (dark)
        roundRect(ctx, x, y, cellW, cellH, 4);
        ctx.fillStyle = '#1A1A2E';
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Render heatmap frame
        const frameData = frames[col];
        if (frameData && frameData.length > 0) {
          const { canvas: offCanvas, rows: fRows, cols: fCols } = renderMatrixToCanvas(
            frameData, vmax, threshold, '#000'
          );

          // Fit inside cell with 2px padding
          const pad = 2;
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

        // Highlight peak frame
        const titleText = titles[col] || '';
        if (titleText.includes('Peak')) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          roundRect(ctx, x, y, cellW, cellH, 4);
          ctx.stroke();

          // Peak badge
          ctx.fillStyle = '#EF4444';
          roundRect(ctx, x + cellW / 2 - 16, y - 6, 32, 12, 6);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = `bold 7px ${FONT_FAMILY}`;
          ctx.textAlign = 'center';
          ctx.fillText('PEAK', x + cellW / 2, y + 2);
        }

        // Title below
        ctx.fillStyle = '#6B7B8D';
        ctx.font = `10px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        const titleLines = titleText.replace('Peak ', '').split('\n');
        titleLines.forEach((line, li) => {
          ctx.fillText(line, x + cellW / 2, y + cellH + 12 + li * 11);
        });
      }

      // Colorbar
      const cbX = labelW + numCols * (cellW + gap) + 16;
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
