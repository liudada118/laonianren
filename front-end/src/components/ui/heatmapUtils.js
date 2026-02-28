/**
 * heatmapUtils.js - 共享热力图渲染工具
 *
 * 核心：双线性上采样插值 + Jet 色谱 + Canvas 渲染
 * 解决原始矩阵像素太少（如 30×15）放大后模糊的问题
 */

/* ─── Jet 色谱 LUT (256级，与 matplotlib jet 一致) ─── */
function buildJetLUT() {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r, g, b;
    if (t < 0.125)      { r = 0; g = 0; b = 0.5 + t * 4; }
    else if (t < 0.375) { r = 0; g = (t - 0.125) * 4; b = 1; }
    else if (t < 0.625) { r = (t - 0.375) * 4; g = 1; b = 1 - (t - 0.375) * 4; }
    else if (t < 0.875) { r = 1; g = 1 - (t - 0.625) * 4; b = 0; }
    else                 { r = 1 - (t - 0.875) * 2; g = 0; b = 0; }
    const idx = i * 4;
    lut[idx]     = Math.round(Math.min(1, Math.max(0, r)) * 255);
    lut[idx + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    lut[idx + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
    lut[idx + 3] = 255;
  }
  return lut;
}
export const JET_LUT = buildJetLUT();

/* ─── 双线性上采样插值 ─── */
/**
 * 将小矩阵通过双线性插值放大到目标尺寸
 * 效果等同于 matplotlib imshow(interpolation='bilinear')
 *
 * @param {number[][]} data - 原始二维矩阵 (rows × cols)
 * @param {number} targetH - 目标高度
 * @param {number} targetW - 目标宽度
 * @returns {Float32Array} - 一维数组 targetH × targetW
 */
export function bilinearUpsample(data, targetH, targetW) {
  const srcH = data.length;
  const srcW = data[0].length;
  const out = new Float32Array(targetH * targetW);

  for (let ty = 0; ty < targetH; ty++) {
    // 映射到源坐标
    const sy = (ty + 0.5) * srcH / targetH - 0.5;
    const sy0 = Math.max(0, Math.floor(sy));
    const sy1 = Math.min(srcH - 1, sy0 + 1);
    const fy = sy - sy0;

    for (let tx = 0; tx < targetW; tx++) {
      const sx = (tx + 0.5) * srcW / targetW - 0.5;
      const sx0 = Math.max(0, Math.floor(sx));
      const sx1 = Math.min(srcW - 1, sx0 + 1);
      const fx = sx - sx0;

      // 双线性插值
      const v00 = data[sy0][sx0];
      const v01 = data[sy0][sx1];
      const v10 = data[sy1][sx0];
      const v11 = data[sy1][sx1];

      const v = v00 * (1 - fx) * (1 - fy)
              + v01 * fx * (1 - fy)
              + v10 * (1 - fx) * fy
              + v11 * fx * fy;

      out[ty * targetW + tx] = v;
    }
  }
  return out;
}

/* ─── 渲染矩阵到 Canvas（带上采样） ─── */
/**
 * @param {number[][]} data - 原始二维矩阵
 * @param {number} vmax - 归一化最大值
 * @param {number} threshold - 低于此值设为背景
 * @param {string} bgColor - 'transparent' | '#000' | '#fff'
 * @param {number} targetW - 目标渲染宽度（像素），null 则自动计算
 * @param {number} targetH - 目标渲染高度（像素），null 则自动计算
 */
export function renderMatrixToCanvas(data, vmax, threshold = 0, bgColor = 'transparent', targetW = null, targetH = null) {
  const srcRows = data.length;
  const srcCols = data[0].length;

  // 自动计算目标尺寸：至少放大到每个原始像素对应 8 个渲染像素
  const scale = 8;
  const outW = targetW || srcCols * scale;
  const outH = targetH || srcRows * scale;

  // 双线性上采样
  const upsampled = bilinearUpsample(data, outH, outW);

  const offCanvas = document.createElement('canvas');
  offCanvas.width = outW;
  offCanvas.height = outH;
  const offCtx = offCanvas.getContext('2d');
  const imgData = offCtx.createImageData(outW, outH);
  const pixels = imgData.data;

  for (let i = 0; i < outH * outW; i++) {
    const val = upsampled[i];
    const idx = i * 4;
    if (val <= threshold) {
      if (bgColor === '#000') {
        pixels[idx] = 15; pixels[idx + 1] = 15; pixels[idx + 2] = 25; pixels[idx + 3] = 255;
      } else if (bgColor === '#fff') {
        pixels[idx] = 255; pixels[idx + 1] = 255; pixels[idx + 2] = 255; pixels[idx + 3] = 255;
      } else {
        pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 0;
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
  offCtx.putImageData(imgData, 0, 0);
  return { canvas: offCanvas, rows: outH, cols: outW, scaleX: outW / srcCols, scaleY: outH / srcRows };
}

/* ─── 绘制垂直色条 ─── */
export function drawColorbar(ctx, x, y, w, h, vmin, vmax) {
  for (let i = 0; i < h; i++) {
    const t = 1 - i / h;
    const lutIdx = Math.round(t * 255) * 4;
    ctx.fillStyle = `rgb(${JET_LUT[lutIdx]},${JET_LUT[lutIdx + 1]},${JET_LUT[lutIdx + 2]})`;
    ctx.fillRect(x, y + i, w, 1);
  }
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = '#333';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.round(vmax).toString(), x + w + 4, y + 6);
  ctx.fillText(Math.round(vmax / 2).toString(), x + w + 4, y + h / 2);
  ctx.fillText(Math.round(vmin).toString(), x + w + 4, y + h - 4);
}

/* ─── 圆角矩形 ─── */
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

/* ─── P95 百分位数计算 vmax ─── */
export function calcP95Vmax(data) {
  const vals = [];
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[0].length; c++) {
      if (data[r][c] > 0) vals.push(data[r][c]);
    }
  }
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.95)] || vals[vals.length - 1] || 1;
}
