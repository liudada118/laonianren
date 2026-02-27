/**
 * heatmapUtils.js - 共享热力图渲染工具
 * 提供高质量色谱、高 DPI Canvas 支持、Gaussian 模糊等
 */

/**
 * Turbo 色谱 (Google AI, 2019) - 比 Jet 更均匀、更美观
 * 256 级 RGBA lookup table
 */
function buildTurboLUT() {
  // Turbo colormap 关键控制点 (from Google AI turbo_colormap_data)
  const turboData = [
    [0.18995, 0.07176, 0.23217],
    [0.22500, 0.16354, 0.45096],
    [0.25107, 0.25237, 0.63374],
    [0.26816, 0.33825, 0.78420],
    [0.27628, 0.42118, 0.89123],
    [0.27543, 0.50115, 0.95190],
    [0.25862, 0.57958, 0.96837],
    [0.22335, 0.65886, 0.94170],
    [0.17394, 0.73551, 0.87622],
    [0.12348, 0.80569, 0.77163],
    [0.09267, 0.86554, 0.63228],
    [0.10885, 0.91116, 0.47838],
    [0.20595, 0.94135, 0.32276],
    [0.37130, 0.95694, 0.18977],
    [0.56015, 0.95680, 0.10820],
    [0.72974, 0.93702, 0.07719],
    [0.86222, 0.89001, 0.09525],
    [0.95218, 0.81553, 0.14660],
    [0.99451, 0.71250, 0.20332],
    [0.99314, 0.58470, 0.23160],
    [0.95580, 0.44853, 0.21329],
    [0.89305, 0.31966, 0.15238],
    [0.81610, 0.21044, 0.08615],
    [0.72837, 0.12736, 0.03564],
    [0.63323, 0.07118, 0.01065],
    [0.53749, 0.03755, 0.00529],
    [0.44939, 0.01355, 0.00170],
  ];

  const lut = new Uint8Array(256 * 4);
  const n = turboData.length;

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // Interpolate between control points
    const pos = t * (n - 1);
    const idx0 = Math.floor(pos);
    const idx1 = Math.min(idx0 + 1, n - 1);
    const frac = pos - idx0;

    const r = turboData[idx0][0] * (1 - frac) + turboData[idx1][0] * frac;
    const g = turboData[idx0][1] * (1 - frac) + turboData[idx1][1] * frac;
    const b = turboData[idx0][2] * (1 - frac) + turboData[idx1][2] * frac;

    const j = i * 4;
    lut[j] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    lut[j + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    lut[j + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    lut[j + 3] = 255;
  }
  return lut;
}

export const TURBO_LUT = buildTurboLUT();

/**
 * 创建高 DPI Canvas context
 */
export function setupHiDPICanvas(canvas, logicalW, logicalH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  canvas.style.width = logicalW + 'px';
  canvas.style.height = logicalH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

/**
 * 将二维矩阵渲染为热力图 offscreen canvas (原始像素尺寸)
 * @param {number[][]} data - 二维矩阵
 * @param {number} vmax - 归一化最大值
 * @param {number} threshold - 低于此值透明
 * @param {string} bgColor - 背景色 ('transparent' | '#000' | '#fff')
 * @returns {{ canvas: HTMLCanvasElement, rows: number, cols: number }}
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
          pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 255;
        } else {
          pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
        }
      } else {
        const norm = Math.min(1, val / vmax);
        // Apply gamma correction for better visual contrast
        const gamma = Math.pow(norm, 0.85);
        const lutIdx = Math.round(gamma * 255) * 4;
        pixels[idx] = TURBO_LUT[lutIdx];
        pixels[idx + 1] = TURBO_LUT[lutIdx + 1];
        pixels[idx + 2] = TURBO_LUT[lutIdx + 2];
        pixels[idx + 3] = 255;
      }
    }
  }
  offCtx.putImageData(imgData, 0, 0);
  return { canvas: offCanvas, rows, cols };
}

/**
 * 在 canvas 上绘制 Gaussian 模糊后的热力图
 */
export function drawSmoothedHeatmap(ctx, offCanvas, x, y, w, h) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offCanvas, x, y, w, h);
}

/**
 * 绘制色条 (colorbar)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - 色条左上角 x
 * @param {number} y - 色条左上角 y
 * @param {number} w - 色条宽度
 * @param {number} h - 色条高度
 * @param {number} vmin - 最小值
 * @param {number} vmax - 最大值
 * @param {boolean} vertical - 是否垂直方向
 */
export function drawColorbar(ctx, x, y, w, h, vmin, vmax, vertical = true) {
  const steps = vertical ? h : w;
  for (let i = 0; i < steps; i++) {
    const t = vertical ? (1 - i / steps) : (i / steps);
    const gamma = Math.pow(t, 0.85);
    const lutIdx = Math.round(gamma * 255) * 4;
    ctx.fillStyle = `rgb(${TURBO_LUT[lutIdx]},${TURBO_LUT[lutIdx + 1]},${TURBO_LUT[lutIdx + 2]})`;
    if (vertical) {
      ctx.fillRect(x, y + i, w, 1);
    } else {
      ctx.fillRect(x + i, y, 1, h);
    }
  }

  // Border
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);

  // Labels
  ctx.fillStyle = '#6B7B8D';
  ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  if (vertical) {
    ctx.fillText(vmax.toFixed(0), x + w + 4, y + 8);
    ctx.fillText((vmax / 2).toFixed(0), x + w + 4, y + h / 2 + 3);
    ctx.fillText(vmin.toFixed(0), x + w + 4, y + h);
  }
}

/**
 * 绘制圆角矩形
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

/** 系统字体栈 */
export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
