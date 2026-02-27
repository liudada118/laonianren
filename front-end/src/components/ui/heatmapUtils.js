/**
 * heatmapUtils.js - 共享热力图渲染工具
 * 
 * 注意：Canvas 不使用 DPR 缩放（避免与 CSS maxWidth:100% 冲突导致模糊）
 * 而是直接使用较大的逻辑像素尺寸来保证清晰度。
 */

/**
 * 标准 Jet 色谱 256 级 LUT（与 matplotlib jet 一致）
 */
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
    lut[idx]     = Math.round(Math.min(1, Math.max(0, r)) * 255);
    lut[idx + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    lut[idx + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    lut[idx + 3] = 255;
  }
  return lut;
}

export const JET_LUT = buildJetLUT();

/**
 * 将二维矩阵渲染为热力图 offscreen canvas (原始像素尺寸)
 * @param {number[][]} data - 二维矩阵
 * @param {number} vmax - 归一化最大值
 * @param {number} threshold - 低于此值的像素设为背景色
 * @param {string} bgColor - 'transparent' | '#000' | '#fff'
 */
export function renderMatrixToCanvas(data, vmax, threshold = 0, bgColor = 'transparent') {
  const rows = data.length;
  const cols = data[0].length;

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
        if (bgColor === 'transparent') {
          pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 0;
        } else if (bgColor === '#000') {
          pixels[idx] = 20; pixels[idx + 1] = 20; pixels[idx + 2] = 30; pixels[idx + 3] = 255;
        } else {
          pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 0;
        }
      } else {
        const norm = Math.min(1, val / vmax);
        const lutIdx = Math.round(norm * 255) * 4;
        pixels[idx]     = JET_LUT[lutIdx];
        pixels[idx + 1] = JET_LUT[lutIdx + 1];
        pixels[idx + 2] = JET_LUT[lutIdx + 2];
        pixels[idx + 3] = 255;
      }
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  return { canvas: offCanvas, rows, cols };
}

/**
 * 绘制垂直色条 (colorbar)
 */
export function drawColorbar(ctx, x, y, w, h, vmin, vmax) {
  for (let i = 0; i < h; i++) {
    const t = 1 - i / h;
    const lutIdx = Math.round(t * 255) * 4;
    ctx.fillStyle = `rgb(${JET_LUT[lutIdx]},${JET_LUT[lutIdx + 1]},${JET_LUT[lutIdx + 2]})`;
    ctx.fillRect(x, y + i, w, 1);
  }

  // Border
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);

  // Labels
  ctx.fillStyle = '#6B7B8D';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(vmax).toString(), x + w + 3, y + 4);
  ctx.fillText(Math.round(vmax / 2).toString(), x + w + 3, y + h / 2);
  ctx.fillText(Math.round(vmin).toString(), x + w + 3, y + h - 4);
}

/**
 * 绘制圆角矩形路径
 */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 系统字体 */
export const FONT = 'sans-serif';
