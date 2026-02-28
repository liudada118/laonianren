import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, roundRect } from './heatmapUtils';

/**
 * PressureEvolutionChart - 动态压力演变
 * 2行×10列热力图网格，黑色背景，jet色谱
 * 使用双线性上采样插值保证清晰度
 */

export default function PressureEvolutionChart({ evolutionData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!evolutionData || !canvasRef.current) return;
    const canvas = canvasRef.current;

    const leftData = evolutionData.left;
    const rightData = evolutionData.right;

    const numCols = 10;
    // 每个 cell 渲染尺寸要大，保证清晰
    const cellW = 100;
    const cellH = 140;
    const cellGap = 6;
    const labelW = 90;
    const rowGap = 36;
    const titleH = 18;
    const colorbarW = 20;
    const colorbarMargin = 16;
    const padTop = 10;
    const padBottom = 10;

    const rows = [
      { data: leftData, label: 'Left Foot', color: '#3B82F6' },
      { data: rightData, label: 'Right Foot', color: '#F59E0B' },
    ];

    const totalW = labelW + numCols * (cellW + cellGap) - cellGap + colorbarMargin + colorbarW + 40;
    const totalH = padTop + rows.length * (cellH + titleH + rowGap) - rowGap + padBottom;

    canvas.width = totalW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // 整体背景
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, totalW, totalH);

    rows.forEach((row, rowIdx) => {
      const yBase = padTop + rowIdx * (cellH + titleH + rowGap);

      // 行标签
      ctx.fillStyle = row.color;
      ctx.beginPath();
      ctx.arc(16, yBase + cellH / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1F2937';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, 28, yBase + cellH / 2);

      if (!row.data || !row.data.frames) return;

      const frames = row.data.frames;
      const titles = row.data.titles || [];
      const vmax = row.data.vmax || 1;
      const threshold = vmax * 0.01;

      for (let col = 0; col < Math.min(frames.length, numCols); col++) {
        const x = labelW + col * (cellW + cellGap);
        const y = yBase;

        // 黑色背景 cell
        roundRect(ctx, x, y, cellW, cellH, 3);
        ctx.fillStyle = '#111122';
        ctx.fill();

        const frameData = frames[col];
        if (frameData && frameData.length > 0) {
          // 上采样渲染：目标尺寸 = cell 尺寸（减去 padding）
          const pad = 2;
          const renderW = cellW - pad * 2;
          const renderH = cellH - pad * 2;

          const { canvas: offCanvas, rows: oH, cols: oW } = renderMatrixToCanvas(
            frameData, vmax, threshold, '#000', renderW, renderH
          );

          // 保持宽高比居中
          const srcAspect = frameData.length / frameData[0].length;
          const dstAspect = renderH / renderW;
          let drawW, drawH;
          if (srcAspect > dstAspect) {
            drawH = renderH;
            drawW = renderH / srcAspect;
          } else {
            drawW = renderW;
            drawH = renderW * srcAspect;
          }
          const offX = x + pad + (renderW - drawW) / 2;
          const offY = y + pad + (renderH - drawH) / 2;

          ctx.save();
          roundRect(ctx, x + 1, y + 1, cellW - 2, cellH - 2, 2);
          ctx.clip();
          ctx.imageSmoothingEnabled = false; // 已经上采样了，不需要浏览器再模糊
          ctx.drawImage(offCanvas, offX, offY, drawW, drawH);
          ctx.restore();
        }

        // Peak 高亮
        const titleText = titles[col] || '';
        if (titleText.includes('Peak')) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2.5;
          roundRect(ctx, x, y, cellW, cellH, 3);
          ctx.stroke();

          ctx.fillStyle = '#EF4444';
          roundRect(ctx, x + cellW / 2 - 18, y - 8, 36, 14, 7);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('PEAK', x + cellW / 2, y - 1);
        }

        // 时间标签（截断浮点数）
        let displayTitle = titleText.replace(/(\d+)\.\d+(ms)/g, '$1$2').replace('Peak ', '');
        ctx.fillStyle = '#888';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(displayTitle, x + cellW / 2, y + cellH + 3);
      }

      // 色条
      const cbX = labelW + numCols * (cellW + cellGap) - cellGap + colorbarMargin;
      const cbY = yBase + 4;
      const cbH = cellH - 8;
      drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, vmax);
    });
  }, [evolutionData]);

  if (!evolutionData) return null;

  return (
    <div className={`overflow-x-auto ${className}`}>
      <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
    </div>
  );
}
