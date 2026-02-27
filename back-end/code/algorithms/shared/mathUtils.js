/**
 * 共享数学工具库
 * 替代 numpy, scipy, cv2 中常用的数学和矩阵运算
 */

// ============================================================
// 基础统计函数
// ============================================================

function sum(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return sum(arr) / arr.length;
}

function std(arr) {
  if (!arr || arr.length === 0) return 0;
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / arr.length);
}

function argmax(arr) {
  let maxIdx = 0;
  let maxVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > maxVal) {
      maxVal = arr[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

function ptp(arr) {
  // peak-to-peak (range)
  let min = arr[0], max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return max - min;
}

function countNonZero(arr) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 0) c++;
  }
  return c;
}

function linspace(start, end, num) {
  if (num <= 1) return [start];
  const step = (end - start) / (num - 1);
  const result = new Array(num);
  for (let i = 0; i < num; i++) {
    result[i] = start + step * i;
  }
  return result;
}

function arange(n) {
  const result = new Array(n);
  for (let i = 0; i < n; i++) result[i] = i;
  return result;
}

function clip(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ============================================================
// 矩阵操作 (64x64 flat array ↔ 2D)
// ============================================================

/**
 * 将一维数组 reshape 为二维矩阵
 * @param {number[]} flat - 一维数组
 * @param {number} rows - 行数
 * @param {number} cols - 列数
 * @returns {number[][]} 二维矩阵
 */
function reshape2D(flat, rows, cols) {
  const mat = new Array(rows);
  for (let r = 0; r < rows; r++) {
    mat[r] = new Array(cols);
    const offset = r * cols;
    for (let c = 0; c < cols; c++) {
      mat[r][c] = flat[offset + c];
    }
  }
  return mat;
}

/**
 * 将二维矩阵展平为一维数组
 */
function flatten2D(mat) {
  const rows = mat.length;
  const cols = mat[0].length;
  const flat = new Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const offset = r * cols;
    for (let c = 0; c < cols; c++) {
      flat[offset + c] = mat[r][c];
    }
  }
  return flat;
}

/**
 * 逆时针旋转90度 (np.rot90(mat, k=1))
 */
function rot90(mat) {
  const rows = mat.length;
  const cols = mat[0].length;
  const result = new Array(cols);
  for (let c = 0; c < cols; c++) {
    result[c] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      result[c][r] = mat[r][cols - 1 - c];
    }
  }
  return result;
}

/**
 * 水平翻转 (np.fliplr)
 */
function fliplr(mat) {
  const rows = mat.length;
  const cols = mat[0].length;
  const result = new Array(rows);
  for (let r = 0; r < rows; r++) {
    result[r] = new Array(cols);
    for (let c = 0; c < cols; c++) {
      result[r][c] = mat[r][cols - 1 - c];
    }
  }
  return result;
}

/**
 * 垂直翻转 (np.flipud)
 */
function flipud(mat) {
  const rows = mat.length;
  const result = new Array(rows);
  for (let r = 0; r < rows; r++) {
    result[r] = mat[rows - 1 - r].slice();
  }
  return result;
}

/**
 * 矩阵求和
 */
function matSum(mat) {
  let s = 0;
  for (let r = 0; r < mat.length; r++) {
    for (let c = 0; c < mat[r].length; c++) {
      s += mat[r][c];
    }
  }
  return s;
}

/**
 * 矩阵最大值
 */
function matMax(mat) {
  let m = -Infinity;
  for (let r = 0; r < mat.length; r++) {
    for (let c = 0; c < mat[r].length; c++) {
      if (mat[r][c] > m) m = mat[r][c];
    }
  }
  return m;
}

/**
 * 矩阵非零元素计数
 */
function matCountNonZero(mat) {
  let c = 0;
  for (let r = 0; r < mat.length; r++) {
    for (let cc = 0; cc < mat[r].length; cc++) {
      if (mat[r][cc] > 0) c++;
    }
  }
  return c;
}

/**
 * 矩阵元素乘法 (element-wise multiply)
 */
function matMul(matA, matB) {
  const rows = matA.length;
  const cols = matA[0].length;
  const result = new Array(rows);
  for (let r = 0; r < rows; r++) {
    result[r] = new Array(cols);
    for (let c = 0; c < cols; c++) {
      result[r][c] = matA[r][c] * matB[r][c];
    }
  }
  return result;
}

/**
 * 创建全零矩阵
 */
function zeros2D(rows, cols) {
  const mat = new Array(rows);
  for (let r = 0; r < rows; r++) {
    mat[r] = new Float64Array(cols);
  }
  return mat;
}

/**
 * 矩阵切片 (子矩阵)
 */
function matSlice(mat, rowStart, rowEnd, colStart, colEnd) {
  const result = [];
  for (let r = rowStart; r < rowEnd; r++) {
    const row = [];
    for (let c = colStart; c < colEnd; c++) {
      row.push(mat[r][c]);
    }
    result.push(row);
  }
  return result;
}

// ============================================================
// 连通域分析 (替代 cv2.connectedComponentsWithStats)
// ============================================================

/**
 * BFS连通域标记 (替代 cv2.connectedComponentsWithStats)
 * @param {number[][]} binaryMat - 二值矩阵 (0/1)
 * @param {number} connectivity - 连通性 4 或 8
 * @returns {{ numLabels, labels, stats, centroids }}
 *   stats[i] = { x, y, w, h, area } (外接框和面积)
 *   centroids[i] = [cx, cy]
 */
function connectedComponentsWithStats(binaryMat, connectivity = 8) {
  const rows = binaryMat.length;
  const cols = binaryMat[0].length;
  const labels = new Array(rows);
  for (let r = 0; r < rows; r++) {
    labels[r] = new Int32Array(cols); // 0 = background
  }

  const dirs4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const dirs8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const dirs = connectivity === 8 ? dirs8 : dirs4;

  let currentLabel = 0;
  const statsMap = []; // index 0 = background
  const centroidsMap = [];

  // Background stats placeholder
  statsMap.push({ x: 0, y: 0, w: 0, h: 0, area: 0 });
  centroidsMap.push([0, 0]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (binaryMat[r][c] > 0 && labels[r][c] === 0) {
        currentLabel++;
        // BFS
        const queue = [[r, c]];
        labels[r][c] = currentLabel;
        let minR = r, maxR = r, minC = c, maxC = c;
        let sumR = 0, sumC = 0, area = 0;

        while (queue.length > 0) {
          const [cr, cc] = queue.shift();
          area++;
          sumR += cr;
          sumC += cc;
          if (cr < minR) minR = cr;
          if (cr > maxR) maxR = cr;
          if (cc < minC) minC = cc;
          if (cc > maxC) maxC = cc;

          for (const [dr, dc] of dirs) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
                binaryMat[nr][nc] > 0 && labels[nr][nc] === 0) {
              labels[nr][nc] = currentLabel;
              queue.push([nr, nc]);
            }
          }
        }

        statsMap.push({
          x: minC,
          y: minR,
          w: maxC - minC + 1,
          h: maxR - minR + 1,
          area: area,
        });
        centroidsMap.push([sumC / area, sumR / area]);
      }
    }
  }

  return {
    numLabels: currentLabel + 1, // 包含背景
    labels,
    stats: statsMap,
    centroids: centroidsMap,
  };
}

/**
 * 移除小连通域 (替代 Python 中的去噪逻辑)
 * @param {number[][]} mat - 压力矩阵
 * @param {number} minSize - 最小连通域面积
 * @param {number} connectivity - 连通性
 * @returns {number[][]} 去噪后的矩阵
 */
function removeSmallComponents(mat, minSize = 3, connectivity = 4) {
  const rows = mat.length;
  const cols = mat[0].length;
  const binary = new Array(rows);
  for (let r = 0; r < rows; r++) {
    binary[r] = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      binary[r][c] = mat[r][c] > 0 ? 1 : 0;
    }
  }

  const { numLabels, labels, stats } = connectedComponentsWithStats(binary, connectivity);

  // 复制矩阵
  const result = new Array(rows);
  for (let r = 0; r < rows; r++) {
    result[r] = mat[r].slice ? mat[r].slice() : Array.from(mat[r]);
  }

  // 移除小连通域
  for (let label = 1; label < numLabels; label++) {
    if (stats[label].area < minSize) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (labels[r][c] === label) {
            result[r][c] = 0;
          }
        }
      }
    }
  }

  return result;
}

// ============================================================
// 2x2矩阵特征值 (替代 np.linalg.eigvalsh)
// ============================================================

/**
 * 计算2x2对称矩阵的特征值
 * 用于置信椭圆计算
 * @param {number} a - mat[0][0]
 * @param {number} b - mat[0][1] = mat[1][0]
 * @param {number} d - mat[1][1]
 * @returns {number[]} [lambda1, lambda2] 降序排列
 */
function eigvalsh2x2(a, b, d) {
  const trace = a + d;
  const det = a * d - b * b;
  const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + discriminant;
  const lambda2 = trace / 2 - discriminant;
  return [lambda1, lambda2];
}

// ============================================================
// 协方差矩阵
// ============================================================

/**
 * 计算二维点集的2x2协方差矩阵
 * @param {number[][]} points - [[x1,y1], [x2,y2], ...]
 * @returns {{ cov00, cov01, cov11 }}
 */
function covariance2D(points) {
  const n = points.length;
  if (n < 2) return { cov00: 0, cov01: 0, cov11: 0 };

  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    mx += points[i][0];
    my += points[i][1];
  }
  mx /= n;
  my /= n;

  let cov00 = 0, cov01 = 0, cov11 = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i][0] - mx;
    const dy = points[i][1] - my;
    cov00 += dx * dx;
    cov01 += dx * dy;
    cov11 += dy * dy;
  }
  const denom = n - 1;
  return {
    cov00: cov00 / denom,
    cov01: cov01 / denom,
    cov11: cov11 / denom,
  };
}

// ============================================================
// 样本熵 (Sample Entropy)
// ============================================================

/**
 * 计算样本熵 (替代 Python 中的 sample_entropy)
 * @param {number[]} timeSeries - 时间序列
 * @param {number} m - 嵌入维度
 * @param {number} r - 容差 (标准差的倍数)
 * @returns {number} 样本熵值
 */
function sampleEntropy(timeSeries, m = 2, r = 0.2) {
  const N = timeSeries.length;
  if (N <= m + 1) return 0;

  // 标准化
  const mu = mean(timeSeries);
  const sigma = std(timeSeries);
  if (sigma < 1e-10) return 0;

  const ts = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    ts[i] = (timeSeries[i] - mu) / sigma;
  }

  // 计算 m 维向量的匹配数
  const nVecs = N - m;
  let B = 0; // m维匹配数
  let A = 0; // m+1维匹配数

  for (let i = 0; i < nVecs; i++) {
    for (let j = i + 1; j < nVecs; j++) {
      // 检查 m 维匹配
      let maxDist = 0;
      for (let k = 0; k < m; k++) {
        const d = Math.abs(ts[i + k] - ts[j + k]);
        if (d > maxDist) maxDist = d;
      }
      if (maxDist <= r) {
        B++;
        // 检查 m+1 维匹配
        if (Math.abs(ts[i + m] - ts[j + m]) <= r) {
          A++;
        }
      }
    }
  }

  if (B === 0) return 0;
  const ratio = A / B;
  return ratio > 0 ? -Math.log(ratio) : 0;
}

// ============================================================
// 最小外接圆 (替代 cv2.minEnclosingCircle)
// ============================================================

/**
 * Welzl算法计算最小外接圆
 * @param {number[][]} points - [[x,y], ...]
 * @returns {{ center: [number, number], radius: number }}
 */
function minEnclosingCircle(points) {
  if (points.length === 0) return { center: [0, 0], radius: 0 };
  if (points.length === 1) return { center: [points[0][0], points[0][1]], radius: 0 };

  // 随机打乱
  const pts = points.map(p => [p[0], p[1]]);
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }

  function circleFrom1(p) {
    return { center: [p[0], p[1]], radius: 0 };
  }

  function circleFrom2(p1, p2) {
    const cx = (p1[0] + p2[0]) / 2;
    const cy = (p1[1] + p2[1]) / 2;
    const r = Math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2) / 2;
    return { center: [cx, cy], radius: r };
  }

  function circleFrom3(p1, p2, p3) {
    const ax = p1[0], ay = p1[1];
    const bx = p2[0], by = p2[1];
    const cx = p3[0], cy = p3[1];
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return circleFrom2(p1, p3);
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
    const r = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);
    return { center: [ux, uy], radius: r };
  }

  function isInCircle(circle, p) {
    const dx = circle.center[0] - p[0];
    const dy = circle.center[1] - p[1];
    return Math.sqrt(dx * dx + dy * dy) <= circle.radius + 1e-7;
  }

  function welzl(P, R, n) {
    if (n === 0 || R.length === 3) {
      if (R.length === 0) return { center: [0, 0], radius: 0 };
      if (R.length === 1) return circleFrom1(R[0]);
      if (R.length === 2) return circleFrom2(R[0], R[1]);
      return circleFrom3(R[0], R[1], R[2]);
    }
    const p = P[n - 1];
    const D = welzl(P, R, n - 1);
    if (isInCircle(D, p)) return D;
    return welzl(P, [...R, p], n - 1);
  }

  return welzl(pts, [], pts.length);
}

// ============================================================
// 峰值检测 (替代 scipy.signal.find_peaks)
// ============================================================

/**
 * 简单峰值检测
 * @param {number[]} data - 数据序列
 * @param {object} options - { height, distance, threshold }
 * @returns {number[]} 峰值索引数组
 */
function findPeaks(data, options = {}) {
  const { height = -Infinity, distance = 1 } = options;
  const peaks = [];

  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] > data[i - 1] && data[i] >= data[i + 1] && data[i] >= height) {
      if (peaks.length === 0 || (i - peaks[peaks.length - 1]) >= distance) {
        peaks.push(i);
      } else if (data[i] > data[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
    }
  }

  return peaks;
}

// ============================================================
// COP (压力中心) 计算
// ============================================================

/**
 * 计算压力矩阵的COP位置
 * @param {number[][]} mat - 压力矩阵
 * @returns {[number, number]|null} [cx, cy] 或 null
 */
function calcCOP(mat) {
  const rows = mat.length;
  const cols = mat[0].length;
  let total = 0, sumX = 0, sumY = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = mat[r][c];
      total += v;
      sumX += c * v;
      sumY += r * v;
    }
  }

  if (total <= 10) return null;
  return [sumX / total, sumY / total];
}

// ============================================================
// 降采样
// ============================================================

/**
 * 生成降采样索引
 * @param {number} n - 总帧数
 * @param {number} maxPoints - 最大采样点数
 * @returns {number[]} 采样索引数组
 */
function downsampleIndices(n, maxPoints = 200) {
  if (n <= maxPoints) return arange(n);
  const indices = new Array(maxPoints);
  for (let i = 0; i < maxPoints; i++) {
    indices[i] = Math.round((i / (maxPoints - 1)) * (n - 1));
  }
  return indices;
}

// ============================================================
// 四元数与欧拉角
// ============================================================

/**
 * 归一化四元数
 * @param {number[]} q - [w, x, y, z]
 * @returns {number[]} 归一化后的四元数
 */
function normalizeQuaternion(q) {
  const norm = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (norm < 1e-8) return [1, 0, 0, 0];
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}

/**
 * 四元数转欧拉角 (度)
 * @param {number[]} q - [w, x, y, z]
 * @returns {{ roll: number, pitch: number, yaw: number }}
 */
function quaternionToEuler(q) {
  const [w, x, y, z] = q;
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr, cosr) * (180 / Math.PI);

  let sinp = 2 * (w * y - z * x);
  sinp = clip(sinp, -1.0, 1.0);
  const pitch = Math.asin(sinp) * (180 / Math.PI);

  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny, cosy) * (180 / Math.PI);

  return { roll, pitch, yaw };
}

module.exports = {
  // 基础统计
  sum, mean, std, argmax, ptp, countNonZero, linspace, arange, clip,
  // 矩阵操作
  reshape2D, flatten2D, rot90, fliplr, flipud,
  matSum, matMax, matCountNonZero, matMul, zeros2D, matSlice,
  // 连通域分析
  connectedComponentsWithStats, removeSmallComponents,
  // 线性代数
  eigvalsh2x2, covariance2D,
  // 信号处理
  sampleEntropy, findPeaks,
  // 几何
  minEnclosingCircle, calcCOP,
  // 工具
  downsampleIndices,
  // 四元数
  normalizeQuaternion, quaternionToEuler,
};
