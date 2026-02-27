import React, { useRef, useEffect } from 'react';

/**
 * PressureEvolutionChart - 动态压力演变渲染组件
 * 渲染左右脚各10帧裁剪后的热力图网格
 *
 * Props:
 *   evolutionData: {
 *     left: { frames: number[][][], titles: string[], bbox: number[], vmax: number },
 *     right: { ... }
 *   }
 */

// Jet LUT
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

function renderFrame(ctx, frameData, x, y, cellW, cellH, vmax) {
  if (!frameData || frameData.length === 0) return;
  const rows = frameData.length;
  const cols = frameData[0].length;
  const threshold = vmax * 0.02;

  const offCanvas = document.createElement('canvas');
  offCanvas.width = cols;
  offCanvas.height = rows;
  const offCtx = offCanvas.getContext('2d');
  const imgData = offCtx.createImageData(cols, rows);
  const pixels = imgData.data;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = frameData[r][c];
      const idx = (r * cols + c) * 4;
      if (val <= threshold) {
        pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 255;
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

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offCanvas, x, y, cellW, cellH);
}

export default function PressureEvolutionChart({ evolutionData, className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!evolutionData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const leftData = evolutionData.left;
    const rightData = evolutionData.right;
    const numCols = 10;
    const numRows = 2;
    const labelH = 24;
    const titleH = 18;
    const cellW = 70;
    const cellH = 90;
    const gap = 4;
    const labelW = 80;

    const totalW = labelW + numCols * (cellW + gap);
    const totalH = titleH + numRows * (cellH + labelH + gap) + 10;

    canvas.width = totalW;
    canvas.height = totalH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    // Title
    ctx.fillStyle = '#1A2332';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';

    const rows = [
      { data: leftData, label: 'Left Foot' },
      { data: rightData, label: 'Right Foot' },
    ];

    rows.forEach((row, rowIdx) => {
      const yBase = titleH + rowIdx * (cellH + labelH + gap);

      // Row label
      ctx.fillStyle = '#1A2332';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(row.label, labelW - 10, yBase + cellH / 2 + 4);

      if (!row.data || !row.data.frames) return;

      const frames = row.data.frames;
      const titles = row.data.titles || [];
      const vmax = row.data.vmax || 1;

      for (let col = 0; col < Math.min(frames.length, numCols); col++) {
        const x = labelW + col * (cellW + gap);
        const y = yBase;

        // Black background for cell
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, cellW, cellH);

        // Render heatmap frame
        renderFrame(ctx, frames[col], x, y, cellW, cellH, vmax);

        // Title below
        ctx.fillStyle = '#4B5563';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        const titleText = titles[col] || '';
        const titleLines = titleText.split('\n');
        titleLines.forEach((line, li) => {
          ctx.fillText(line, x + cellW / 2, y + cellH + 10 + li * 10);
        });

        // Highlight peak frame
        if (titleText.includes('Peak')) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(x, y, cellW, cellH);
        }
      }
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
