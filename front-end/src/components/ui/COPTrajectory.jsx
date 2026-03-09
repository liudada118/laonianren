import React, { useRef, useEffect } from 'react';

/**
 * spring 色图近似（matplotlib cm.spring）
 */
function springColor(t) {
  return [255, Math.round(255 * (1 - t)), Math.round(255 * t)];
}

/**
 * 热力图背景颜色映射
 */
function heatColor(val) {
  if (val <= 0) return [0, 0, 0];
  if (val < 0.2) { const t = val / 0.2; return [0, Math.round(100 + t * 155), Math.round(255 - t * 55)]; }
  if (val < 0.4) { const t = (val - 0.2) / 0.2; return [0, 255, Math.round(200 - t * 200)]; }
  if (val < 0.6) { const t = (val - 0.4) / 0.2; return [Math.round(t * 255), 255, 0]; }
  if (val < 0.8) { const t = (val - 0.6) / 0.2; return [255, Math.round(255 - t * 100), 0]; }
  const t = (val - 0.8) / 0.2; return [255, Math.round(155 - t * 155), 0];
}

/**
 * COP 轨迹 Canvas 组件
 * @param {object} data - { bg_matrix: number[][], cycles: [{xs, ys, color_t?}] }
 * @param {string} [className]
 */
export default function COPTrajectory({ data, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bg = data.bg_matrix || [];
    const rows = bg.length;
    const cols = rows > 0 ? bg[0].length : 0;
    if (rows === 0) return;

    const scale = 6;
    const W = cols * scale;
    const H = rows * scale;
    canvas.width = W;
    canvas.height = H;

    // 绘制背景热力图
    let maxVal = 0;
    for (const row of bg) for (const v of row) if (v > maxVal) maxVal = v;
    if (maxVal === 0) maxVal = 1;

    const tmp = document.createElement('canvas');
    tmp.width = cols;
    tmp.height = rows;
    const tmpCtx = tmp.getContext('2d');
    const imgData = tmpCtx.createImageData(cols, rows);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const val = bg[i][j] / maxVal;
        const [r, g, b] = heatColor(Math.min(val, 1));
        const idx = (i * cols + j) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = bg[i][j] > 0 ? Math.round(230 * Math.min(val, 1)) : 0;
      }
    }
    tmpCtx.putImageData(imgData, 0, 0);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.filter = 'blur(3px)';
    ctx.drawImage(tmp, 0, 0, W, H);
    ctx.filter = 'none';

    // 绘制 COP 轨迹
    const cycles = data.cycles || [];
    const numCycles = cycles.length;
    cycles.forEach((cycle, i) => {
      const t = cycle.color_t != null ? cycle.color_t : (numCycles > 1 ? i / (numCycles - 1) : 0);
      const [cr, cg, cb] = springColor(t);
      const color = `rgba(${cr},${cg},${cb},0.8)`;

      const xs = cycle.xs;
      const ys = cycle.ys;
      if (!xs || xs.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.moveTo(xs[0] * scale, ys[0] * scale);
      for (let k = 1; k < xs.length; k++) {
        if (isNaN(xs[k]) || isNaN(ys[k])) continue;
        ctx.lineTo(xs[k] * scale, ys[k] * scale);
      }
      ctx.stroke();

      // 起点标记
      if (!isNaN(xs[0]) && !isNaN(ys[0])) {
        ctx.beginPath();
        ctx.arc(xs[0] * scale, ys[0] * scale, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#00FF00';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      className={`rounded-lg ${className}`}
      style={{ width: '100%', maxHeight: 360, objectFit: 'contain', background: '#000' }}
    />
  );
}
