import React, { useRef, useEffect } from 'react';

/**
 * 颜色映射：蓝-青-绿-黄-橙-红（与 huisheng-prototype OneStep 配色一致）
 */
function getColor(val) {
  if (val <= 0) return [0, 0, 0];
  if (val < 0.2) {
    const t = val / 0.2;
    return [0, Math.round(100 + t * 155), Math.round(255 - t * 55)];
  } else if (val < 0.4) {
    const t = (val - 0.2) / 0.2;
    return [0, 255, Math.round(200 - t * 200)];
  } else if (val < 0.6) {
    const t = (val - 0.4) / 0.2;
    return [Math.round(t * 255), 255, 0];
  } else if (val < 0.8) {
    const t = (val - 0.6) / 0.2;
    return [255, Math.round(255 - t * 100), 0];
  } else {
    const t = (val - 0.8) / 0.2;
    return [255, Math.round(155 - t * 155), 0];
  }
}

/**
 * Canvas 热力图组件 - 用于渲染压力矩阵
 * @param {number[][]} matrix - 二维压力矩阵
 * @param {number} [vmax] - 可选的最大值（用于统一色标）
 * @param {string} [className] - 额外 CSS 类名
 */
export default function PressureHeatmap({ matrix, vmax, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !matrix || matrix.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rows = matrix.length;
    const cols = matrix[0].length;

    // 找最大值
    let maxVal = vmax || 0;
    if (!vmax) {
      for (const row of matrix) {
        for (const v of row) { if (v > maxVal) maxVal = v; }
      }
    }
    if (maxVal === 0) maxVal = 1;

    const scale = 4;
    canvas.width = cols * scale;
    canvas.height = rows * scale;

    // 临时 canvas 绘制原始像素
    const tmp = document.createElement('canvas');
    tmp.width = cols;
    tmp.height = rows;
    const tmpCtx = tmp.getContext('2d');
    const imgData = tmpCtx.createImageData(cols, rows);

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const val = matrix[i][j] / maxVal;
        const [r, g, b] = getColor(Math.min(val, 1));
        const idx = (i * cols + j) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = matrix[i][j] > 0 ? 255 : 0;
      }
    }
    tmpCtx.putImageData(imgData, 0, 0);

    // 黑色背景
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 高斯模糊 + 放大
    ctx.filter = 'blur(3px)';
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'blur(1px)';
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
  }, [matrix, vmax]);

  return (
    <canvas
      ref={canvasRef}
      className={`rounded ${className}`}
      style={{ width: '100%', height: 'auto', imageRendering: 'auto', background: '#000' }}
    />
  );
}
