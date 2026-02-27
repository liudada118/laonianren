import React, { useRef, useEffect } from 'react';
import { renderMatrixToCanvas } from './heatmapUtils';

/**
 * HeatmapCanvas - 通用 Canvas 热力图渲染组件
 * 直接大像素 Canvas，不使用 DPR 缩放
 */

export default function HeatmapCanvas({
  data,
  vmax,
  width = 400,
  height = 300,
  maskThreshold = 0.02,
  smooth = true,
  bgColor = 'transparent',
  className = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || data.length === 0 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rows = data.length;
    const cols = data[0].length;

    let maxVal = vmax;
    if (!maxVal || maxVal <= 0) {
      maxVal = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (data[r][c] > maxVal) maxVal = data[r][c];
        }
      }
    }
    if (maxVal <= 0) maxVal = 1;

    const threshold = maxVal * maskThreshold;
    const { canvas: offCanvas } = renderMatrixToCanvas(data, maxVal, threshold, bgColor);

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const scaleX = width / cols;
    const scaleY = height / rows;
    const scale = Math.min(scaleX, scaleY);
    const drawW = cols * scale;
    const drawH = rows * scale;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, width, height);

    if (smooth) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    } else {
      ctx.imageSmoothingEnabled = false;
    }

    ctx.drawImage(offCanvas, offsetX, offsetY, drawW, drawH);
  }, [data, vmax, width, height, maskThreshold, smooth, bgColor]);

  if (!data || data.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
    />
  );
}
