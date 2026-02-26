/**
 * 压力数据处理器（极致性能优化版）
 * 
 * 对小矩阵（32×32）使用轻量模糊+双线性上采样
 * 对大矩阵（64×64）仅使用双线性上采样，跳过模糊
 */

/**
 * 平滑上采样管线
 * @param {number[][]} input - 原始压力矩阵（值范围 0-255）
 * @param {number} targetSize - 目标纹理尺寸（默认 256）
 * @returns {Float32Array} 上采样后的一维数组
 */
export function upscaleDataSmooth(input, targetSize = 256) {
  const srcH = input.length;
  const srcW = input[0].length;
  const output = new Float32Array(targetSize * targetSize);

  const scaleX = (srcW - 1) / targetSize;
  const scaleY = (srcH - 1) / targetSize;

  // 双线性插值上采样（直接从原始数据，不做预模糊以节省性能）
  for (let y = 0; y < targetSize; y++) {
    const srcY = y * scaleY;
    const y0 = Math.floor(srcY);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = srcY - y0;
    const yOff = y * targetSize;

    for (let x = 0; x < targetSize; x++) {
      const srcX = x * scaleX;
      const x0 = Math.floor(srcX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = srcX - x0;

      const v00 = input[y0][x0];
      const v10 = input[y0][x1];
      const v01 = input[y1][x0];
      const v11 = input[y1][x1];

      const val = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
      output[yOff + x] = Math.max(0, Math.min(val, 255));
    }
  }

  // 对小矩阵做一遍轻量 3×3 均值模糊（仅水平+垂直）
  if (srcW <= 32) {
    boxBlurInPlace(output, targetSize, targetSize);
  }

  return output;
}

/**
 * 快速 3×3 box blur（就地操作，单遍）
 */
function boxBlurInPlace(data, w, h) {
  const temp = new Float32Array(data.length);

  // 水平
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? data[off + x - 1] : data[off + x];
      const c = data[off + x];
      const r = x < w - 1 ? data[off + x + 1] : data[off + x];
      temp[off + x] = (l + c + r) / 3;
    }
  }

  // 垂直
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) {
      const t = y > 0 ? temp[(y - 1) * w + x] : temp[off + x];
      const c = temp[off + x];
      const b = y < h - 1 ? temp[(y + 1) * w + x] : temp[off + x];
      data[off + x] = (t + c + b) / 3;
    }
  }
}

/**
 * 高斯模糊（二维数组版，兼容旧接口）
 */
export function gaussianBlur(input, kernelSize = 5, sigma = 1.5) {
  const h = input.length;
  const w = input[0].length;
  const half = Math.floor(kernelSize / 2);

  // 生成一维核
  const kernel = [];
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  // 水平
  const temp = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const px = Math.max(0, Math.min(w - 1, x + k));
        val += input[y][px] * kernel[k + half];
      }
      row.push(val);
    }
    temp.push(row);
  }

  // 垂直
  const output = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const py = Math.max(0, Math.min(h - 1, y + k));
        val += temp[py][x] * kernel[k + half];
      }
      row.push(val);
    }
    output.push(row);
  }

  return output;
}

/**
 * 双线性插值
 */
export function bilinearInterpolate(input, x, y) {
  const h = input.length;
  const w = input[0].length;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  return (input[y0][x0] * (1 - fx) + input[y0][x1] * fx) * (1 - fy) +
         (input[y1][x0] * (1 - fx) + input[y1][x1] * fx) * fy;
}

/**
 * 将原始压力矩阵归一化到 0-1 范围
 */
export function normalizeMatrix(matrix) {
  return matrix.map(row => row.map(val => Math.min(val / 255.0, 1.0)));
}

/**
 * 计算矩阵统计信息
 */
export function matrixStats(matrix) {
  let max = 0;
  let min = 255;
  let sum = 0;
  let nonZeroCount = 0;
  let count = 0;

  for (const row of matrix) {
    for (const val of row) {
      if (val > max) max = val;
      if (val < min) min = val;
      sum += val;
      count++;
      if (val > 0) nonZeroCount++;
    }
  }

  return { max, min, mean: count > 0 ? sum / count : 0, nonZeroCount, totalPressure: sum };
}

/**
 * 计算压力中心（Center of Pressure, CoP）
 */
export function calculateCoP(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  let totalPressure = 0;
  let sumX = 0;
  let sumY = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = matrix[r][c];
      totalPressure += val;
      sumX += val * c;
      sumY += val * r;
    }
  }

  if (totalPressure === 0) return null;

  return {
    x: sumX / totalPressure / (cols - 1),
    y: sumY / totalPressure / (rows - 1),
  };
}
