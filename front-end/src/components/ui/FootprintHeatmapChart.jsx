import React, { useRef, useEffect } from 'react';

/**
 * FootprintHeatmapChart - 足印叠加热力图 + FPA辅助线
 *
 * Props:
 *   heatmapData: {
 *     heatmap: number[][],  // H x W 矩阵
 *     fpaLines: [{ heel: [x,y], fore: [x,y], angle: float, isRight: bool }],
 *     size: [H, W],
 *   }
 *   width: number - 渲染宽度
 *   height: number - 渲染高度
 */

function buildJetLUT() {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r, g, b;
    if (t < 0.125) { r = 0; g = 0; b = 0.5 + t * 4; }
    else if (t < 0.375) { r = 0; g = (t - 0.125) * 4; b = 1; }
    else if (t < 0.625) { r = (t - 0.375) * 4; g = 1; b = 1 - (t - 0.375) * 4; }
    else if (t < 0.875) { r = 1; g = 1 - (t - 0.625) * 4; b = 0; }
    else { r = 1 - (t - 0.875) * 2; g = 0; b = 0; }
    const idx = i * 4;
    lut[idx] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    lut[idx + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    lut[idx + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    lut[idx + 3] = 255;
  }
  return lut;
}
const JET_LUT = buildJetLUT();

export default function FootprintHeatmapChart({ heatmapData, width = 500, height = 600, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!heatmapData || !heatmapData.heatmap || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { heatmap, fpaLines = [], size } = heatmapData;

    const H = size[0];
    const W = size[1];

    // 计算 vmax
    let vmax = 0;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (heatmap[r][c] > vmax) vmax = heatmap[r][c];
      }
    }
    if (vmax <= 0) vmax = 1;
    const displayVmax = vmax * 0.8; // 稍微压低上限让颜色更饱满
    const threshold = vmax * 0.02;

    // 创建原始尺寸热力图
    const offCanvas = document.createElement('canvas');
    offCanvas.width = W;
    offCanvas.height = H;
    const offCtx = offCanvas.getContext('2d');
    const imgData = offCtx.createImageData(W, H);
    const pixels = imgData.data;

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const val = heatmap[r][c];
        const idx = (r * W + c) * 4;
        if (val <= threshold) {
          pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
        } else {
          const norm = Math.min(1, val / displayVmax);
          const lutIdx = Math.round(norm * 255) * 4;
          pixels[idx] = JET_LUT[lutIdx];
          pixels[idx + 1] = JET_LUT[lutIdx + 1];
          pixels[idx + 2] = JET_LUT[lutIdx + 2];
          pixels[idx + 3] = 255;
        }
      }
    }
    offCtx.putImageData(imgData, 0, 0);

    // 缩放到目标尺寸
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 保持宽高比
    const scaleX = width / W;
    const scaleY = height / H;
    const scale = Math.min(scaleX, scaleY);
    const drawW = W * scale;
    const drawH = H * scale;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offCanvas, offsetX, offsetY, drawW, drawH);

    // 绘制 FPA 线
    fpaLines.forEach(line => {
      const { heel, fore, angle, isRight } = line;
      // heel/fore 坐标是 [x, y] 在原始矩阵坐标系中
      const hx = heel[0] * scale + offsetX;
      const hy = heel[1] * scale + offsetY;
      const fx = fore[0] * scale + offsetX;
      const fy = fore[1] * scale + offsetY;

      // 延长线
      const vecX = fx - hx;
      const vecY = fy - hy;
      const extRatio = 0.3;
      const plotFx = fx + vecX * extRatio;
      const plotFy = fy + vecY * extRatio;

      // 足轴线 (白底 + 黑线)
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(plotFx, plotFy);
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 垂直参考线 (虚线)
      const footLen = Math.sqrt(vecX * vecX + vecY * vecY);
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx, hy - footLen * 1.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      // 角度标签
      const isOut = angle > 0;
      const textColor = isOut ? '#FBBF24' : '#22D3EE';
      const bgColor = 'rgba(48,48,48,0.7)';
      const text = `${angle.toFixed(1)}°`;
      const textOffsetX = isRight ? 8 : -8;
      const textAlign = isRight ? 'left' : 'right';

      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = textAlign;
      const metrics = ctx.measureText(text);
      const textW = metrics.width + 6;
      const textH = 14;
      const textX = fx + textOffsetX;
      const textY = fy;

      // Background
      ctx.fillStyle = bgColor;
      const bgX = textAlign === 'left' ? textX - 3 : textX - textW + 3;
      ctx.fillRect(bgX, textY - textH + 2, textW, textH);

      // Text
      ctx.fillStyle = textColor;
      ctx.fillText(text, textX, textY);
    });
  }, [heatmapData, width, height]);

  if (!heatmapData || !heatmapData.heatmap) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
    />
  );
}
