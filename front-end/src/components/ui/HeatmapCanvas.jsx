import React, { useRef, useEffect, useMemo } from 'react';

/**
 * HeatmapCanvas - 通用 Canvas 热力图渲染组件
 * 将二维数值矩阵渲染为 jet 色谱热力图
 *
 * Props:
 *   data: number[][] - 二维矩阵数据
 *   vmax: number - 最大值 (用于归一化)
 *   width: number - Canvas 宽度 (px)
 *   height: number - Canvas 高度 (px)
 *   maskThreshold: number - 低于此比例的值透明 (默认 0.02)
 *   smooth: boolean - 是否启用双线性插值平滑 (默认 true)
 *   className: string
 */

// Jet 色谱 lookup table (256 entries)
function buildJetLUT() {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r, g, b;
    if (t < 0.125) {
      r = 0; g = 0; b = 0.5 + t * 4;
    } else if (t < 0.375) {
      r = 0; g = (t - 0.125) * 4; b = 1;
    } else if (t < 0.625) {
      r = (t - 0.375) * 4; g = 1; b = 1 - (t - 0.375) * 4;
    } else if (t < 0.875) {
      r = 1; g = 1 - (t - 0.625) * 4; b = 0;
    } else {
      r = 1 - (t - 0.875) * 2; g = 0; b = 0;
    }
    const idx = i * 4;
    lut[idx] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    lut[idx + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    lut[idx + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    lut[idx + 3] = 255;
  }
  return lut;
}

const JET_LUT = buildJetLUT();

export default function HeatmapCanvas({
  data,
  vmax,
  width = 400,
  height = 300,
  maskThreshold = 0.02,
  smooth = true,
  className = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || data.length === 0 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rows = data.length;
    const cols = data[0].length;

    // 计算 vmax
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

    // 创建原始尺寸的 ImageData
    const offCanvas = document.createElement('canvas');
    offCanvas.width = cols;
    offCanvas.height = rows;
    const offCtx = offCanvas.getContext('2d');
    const imgData = offCtx.createImageData(cols, rows);
    const pixels = imgData.data;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = data[r][c];
        const idx = (r * cols + c) * 4;
        if (val <= threshold) {
          pixels[idx] = 0;
          pixels[idx + 1] = 0;
          pixels[idx + 2] = 0;
          pixels[idx + 3] = 0;
        } else {
          const norm = Math.min(1, val / maxVal);
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
    ctx.clearRect(0, 0, width, height);

    if (smooth) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    } else {
      ctx.imageSmoothingEnabled = false;
    }

    // 保持宽高比
    const scaleX = width / cols;
    const scaleY = height / rows;
    const scale = Math.min(scaleX, scaleY);
    const drawW = cols * scale;
    const drawH = rows * scale;
    const offsetX = (width - drawW) / 2;
    const offsetY = (height - drawH) / 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(offCanvas, offsetX, offsetY, drawW, drawH);
  }, [data, vmax, width, height, maskThreshold, smooth]);

  if (!data || data.length === 0) return null;

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
