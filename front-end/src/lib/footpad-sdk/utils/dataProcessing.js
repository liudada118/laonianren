/**
 * dataProcessing.js - 足底压力传感器数据处理工具（性能优化版）
 * 
 * 提供轻量级的数据上采样功能，
 * 将 64×64 的原始传感器数据平滑上采样到更高分辨率（如 128×128）。
 * 
 * @example
 * import { upscaleDataSmooth } from './dataProcessing';
 * const smoothData = upscaleDataSmooth(rawMatrix, 128);
 */

/**
 * 双线性插值
 * @param {number[][]} input - 输入矩阵
 * @param {number} x - X坐标（可为小数）
 * @param {number} y - Y坐标（可为小数）
 * @returns {number} 插值结果
 */
export function bilinearInterpolate(input, x, y) {
  const height = input.length;
  const width = input[0].length;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const xFrac = x - x0;
  const yFrac = y - y0;
  const v00 = input[y0][x0];
  const v10 = input[y0][x1];
  const v01 = input[y1][x0];
  const v11 = input[y1][x1];
  const v0 = v00 * (1 - xFrac) + v10 * xFrac;
  const v1 = v01 * (1 - xFrac) + v11 * xFrac;
  return v0 * (1 - yFrac) + v1 * yFrac;
}

/**
 * 轻量级3×3 box blur（单遍，直接在一维数组上操作）
 * @param {Float32Array} data - 一维数据
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @returns {Float32Array} 模糊后的数据
 */
function boxBlur3x3(data, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      const yMin = Math.max(0, y - 1), yMax = Math.min(h - 1, y + 1);
      const xMin = Math.max(0, x - 1), xMax = Math.min(w - 1, x + 1);
      for (let dy = yMin; dy <= yMax; dy++) {
        for (let dx = xMin; dx <= xMax; dx++) {
          sum += data[dy * w + dx];
          count++;
        }
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

/**
 * 平滑上采样（性能优化版）
 * 将输入矩阵（如 64×64）上采样到目标尺寸（如 128×128），
 * 使用双线性插值 + 单遍 box blur。
 * 
 * @param {number[][]} input - 输入二维矩阵（值范围 0-255）
 * @param {number} [targetSize=128] - 目标尺寸
 * @returns {Float32Array} 一维数组，长度为 targetSize × targetSize，值范围 0-255
 */
export function upscaleDataSmooth(input, targetSize = 128) {
  const srcHeight = input.length;
  const srcWidth = input[0].length;
  const output = new Float32Array(targetSize * targetSize);

  // Step 1: Bilinear interpolation upscale
  for (let y = 0; y < targetSize; y++) {
    const srcY = (y / targetSize) * (srcHeight - 1);
    for (let x = 0; x < targetSize; x++) {
      const srcX = (x / targetSize) * (srcWidth - 1);
      let val = bilinearInterpolate(input, srcX, srcY);
      output[y * targetSize + x] = Math.max(0, Math.min(val, 255));
    }
  }

  // Step 2: Single pass box blur for smoothing
  return boxBlur3x3(output, targetSize, targetSize);
}

/**
 * 高斯模糊（保留用于非实时场景）
 * @param {number[][]} input - 输入二维矩阵
 * @param {number} [kernelSize=5] - 核大小（奇数）
 * @param {number} [sigma=1.5] - 高斯标准差
 * @returns {number[][]} 模糊后的矩阵
 */
export function gaussianBlur(input, kernelSize = 5, sigma = 1.5) {
  const height = input.length;
  const width = input[0].length;
  const output = [];
  const kernel = [];
  const half = Math.floor(kernelSize / 2);
  let sum = 0;

  for (let y = -half; y <= half; y++) {
    const row = [];
    for (let x = -half; x <= half; x++) {
      const val = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      row.push(val);
      sum += val;
    }
    kernel.push(row);
  }

  for (let y = 0; y < kernelSize; y++) {
    for (let x = 0; x < kernelSize; x++) {
      kernel[y][x] /= sum;
    }
  }

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          let py = y + ky;
          let px = x + kx;
          if (py < 0) py = 0;
          if (py >= height) py = height - 1;
          if (px < 0) px = 0;
          if (px >= width) px = width - 1;
          val += input[py][px] * kernel[ky + half][kx + half];
        }
      }
      row.push(val);
    }
    output.push(row);
  }

  return output;
}
