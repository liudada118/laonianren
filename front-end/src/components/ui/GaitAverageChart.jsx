import React, { useRef, useEffect } from 'react';

/**
 * GaitAverageChart - 步态平均热力图 + COP轨迹
 *
 * Props:
 *   gaitAvgData: {
 *     left: { heatmap: number[][], copTrajectories: number[][][], stepCount: number },
 *     right: { ... }
 *   }
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

function renderHeatmapToCanvas(heatmap, vmax) {
  const rows = heatmap.length;
  const cols = heatmap[0].length;
  const threshold = vmax * 0.02;

  const offCanvas = document.createElement('canvas');
  offCanvas.width = cols;
  offCanvas.height = rows;
  const offCtx = offCanvas.getContext('2d');
  const imgData = offCtx.createImageData(cols, rows);
  const pixels = imgData.data;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = heatmap[r][c];
      const idx = (r * cols + c) * 4;
      if (val <= threshold) {
        pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
      } else {
        const norm = Math.min(1, val / vmax);
        const lutIdx = Math.round(norm * 255) * 4;
        pixels[idx] = JET_LUT[lutIdx];
        pixels[idx + 1] = JET_LUT[lutIdx + 1];
        pixels[idx + 2] = JET_LUT[lutIdx + 2];
        pixels[idx + 3] = 255;
      }
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  return { canvas: offCanvas, rows, cols };
}

export default function GaitAverageChart({ gaitAvgData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!gaitAvgData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const leftData = gaitAvgData.left;
    const rightData = gaitAvgData.right;

    const sides = [
      { data: leftData, label: 'Left Foot Average', color: '#0066CC' },
      { data: rightData, label: 'Right Foot Average', color: '#D97706' },
    ].filter(s => s.data && s.data.heatmap);

    if (sides.length === 0) return;

    const padding = 20;
    const labelH = 30;
    const cellW = 200;
    const cellH = 300;
    const gap = 40;

    const totalW = padding * 2 + sides.length * cellW + (sides.length - 1) * gap;
    const totalH = padding + labelH + cellH + padding;

    canvas.width = totalW;
    canvas.height = totalH;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    sides.forEach((side, idx) => {
      const { data, label, color } = side;
      const heatmap = data.heatmap;
      const cops = data.copTrajectories || [];

      // 计算 vmax
      let vmax = 0;
      for (const row of heatmap) {
        for (const v of row) {
          if (v > vmax) vmax = v;
        }
      }
      if (vmax <= 0) vmax = 1;

      const { canvas: offCanvas, rows, cols } = renderHeatmapToCanvas(heatmap, vmax * 0.8);

      const x = padding + idx * (cellW + gap);
      const y = padding + labelH;

      // Label
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${label} (${data.stepCount} steps)`, x + cellW / 2, padding + labelH - 8);

      // Heatmap
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const scaleX = cellW / cols;
      const scaleY = cellH / rows;
      const scale = Math.min(scaleX, scaleY);
      const drawW = cols * scale;
      const drawH = rows * scale;
      const offX = x + (cellW - drawW) / 2;
      const offY = y + (cellH - drawH) / 2;

      ctx.drawImage(offCanvas, offX, offY, drawW, drawH);

      // COP trajectories
      const copColors = ['#FF4444', '#44FF44', '#4444FF', '#FF44FF', '#44FFFF', '#FFAA44'];
      cops.forEach((trail, trailIdx) => {
        if (!trail || trail.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = copColors[trailIdx % copColors.length];
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;

        for (let i = 0; i < trail.length; i++) {
          const px = trail[i][1] * scale + offX; // col -> x
          const py = trail[i][0] * scale + offY; // row -> y
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      });
    });
  }, [gaitAvgData]);

  if (!gaitAvgData) return null;

  return (
    <div className={`flex justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
}
