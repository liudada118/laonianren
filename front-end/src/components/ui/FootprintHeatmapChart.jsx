import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas, drawColorbar, roundRect, calcP95Vmax } from './heatmapUtils';

/**
 * FootprintHeatmapChart - 足印叠加热力图 + FPA辅助线
 * 使用双线性上采样插值 + P95 百分位数做 vmax
 */

export default function FootprintHeatmapChart({ heatmapData, width = 500, height, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!heatmapData || !heatmapData.heatmap || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const { heatmap, fpaLines = [], size } = heatmapData;
    const H = size[0];
    const W = size[1];

    const vmax = calcP95Vmax(heatmap);
    const threshold = vmax * 0.003;

    // 布局
    const padding = 16;
    const colorbarW = 22;
    const colorbarGap = 16;
    const cardW = width - padding * 2 - colorbarW - colorbarGap - 30;
    const aspectRatio = H / W;
    const cardH = height ? (height - padding * 2) : Math.max(300, Math.round(cardW * aspectRatio));
    const totalH = height || (cardH + padding * 2);

    canvas.width = width;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, width, totalH);

    // 白色卡片
    roundRect(ctx, padding, padding, cardW, cardH, 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;
    roundRect(ctx, padding, padding, cardW, cardH, 4);
    ctx.stroke();

    // 上采样渲染
    const innerPad = 4;
    const renderW = cardW - innerPad * 2;
    const renderH = cardH - innerPad * 2;

    const { canvas: offCanvas } = renderMatrixToCanvas(
      heatmap, vmax, threshold, 'transparent', renderW, renderH
    );

    // 保持宽高比
    const srcAspect = H / W;
    const dstAspect = renderH / renderW;
    let drawW, drawH;
    if (srcAspect > dstAspect) {
      drawH = renderH;
      drawW = renderH / srcAspect;
    } else {
      drawW = renderW;
      drawH = renderW * srcAspect;
    }
    const offsetX = padding + innerPad + (renderW - drawW) / 2;
    const offsetY = padding + innerPad + (renderH - drawH) / 2;

    ctx.save();
    roundRect(ctx, padding + 1, padding + 1, cardW - 2, cardH - 2, 3);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, offsetX, offsetY, drawW, drawH);

    // FPA 线
    const pixPerCol = drawW / W;
    const pixPerRow = drawH / H;

    fpaLines.forEach(line => {
      const { heel, fore, angle, isRight } = line;
      const hx = heel[0] * pixPerCol + offsetX;
      const hy = heel[1] * pixPerRow + offsetY;
      const fx = fore[0] * pixPerCol + offsetX;
      const fy = fore[1] * pixPerRow + offsetY;

      const vecX = fx - hx;
      const vecY = fy - hy;
      const plotFx = fx + vecX * 0.3;
      const plotFy = fy + vecY * 0.3;

      // 白色底线
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 彩色线
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = isRight ? '#F59E0B' : '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 垂直参考线
      const footLen = Math.sqrt(vecX * vecX + vecY * vecY);
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx, hy - footLen * 1.1);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // 跟点
      ctx.beginPath();
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // 角度标签
      const text = `${angle.toFixed(1)}°`;
      ctx.font = 'bold 10px sans-serif';
      const metrics = ctx.measureText(text);
      const pillW = metrics.width + 10;
      const pillH = 16;
      const pillX = fx + (isRight ? 6 : -6 - pillW);
      const pillY = fy - pillH / 2;

      roundRect(ctx, pillX, pillY, pillW, pillH, 8);
      ctx.fillStyle = isRight ? 'rgba(245,158,11,0.9)' : 'rgba(59,130,246,0.9)';
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2);
    });

    ctx.restore();

    // 色条
    const cbX = padding + cardW + colorbarGap;
    const cbY = padding + innerPad;
    const cbH = cardH - innerPad * 2;
    drawColorbar(ctx, cbX, cbY, colorbarW, cbH, 0, vmax);
  }, [heatmapData, width, height]);

  if (!heatmapData || !heatmapData.heatmap) return null;

  return (
    <canvas ref={canvasRef} className={className} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
  );
}
