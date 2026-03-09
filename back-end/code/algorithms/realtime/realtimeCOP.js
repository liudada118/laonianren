/**
 * 实时COP计算模块 (JS版)
 * 迁移自 Python: real_time_and_replay_cop_speed_2.py
 *
 * 替代: cv2.connectedComponentsWithStats → BFS连通域
 *       numpy矩阵运算 → 纯JS数组运算
 */

const {
  reshape2D, rot90, fliplr,
  connectedComponentsWithStats,
} = require('../shared/mathUtils');

// ============================================================
// 常量
// ============================================================

const PITCH_MM = 14.0; // 传感器间距 (mm)
const NOISE_THRESHOLD = 3;    // 噪声阈值
const MIN_COMPONENT_AREA = 5; // 最小连通域面积

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 解析单帧数据: reshape → 旋转 → 翻转 → 去噪
 * @param {number[]|null} data - 4096长度的一维数组
 * @returns {number[][]|null} 64x64矩阵 或 null
 */
function parseFrame(data) {
  if (!data || data.length !== 4096) return null;

  // reshape 为 64x64
  let frame = reshape2D(data, 64, 64);

  // fliplr + rot90 (与Python一致)
  frame = rot90(fliplr(frame));

  // 噪声阈值
  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 64; c++) {
      if (frame[r][c] <= NOISE_THRESHOLD) frame[r][c] = 0;
    }
  }

  // 连通域去噪
  const binary = new Array(64);
  for (let r = 0; r < 64; r++) {
    binary[r] = new Uint8Array(64);
    for (let c = 0; c < 64; c++) {
      binary[r][c] = frame[r][c] > 0 ? 1 : 0;
    }
  }

  const { numLabels, labels, stats } = connectedComponentsWithStats(binary, 8);

  for (let label = 1; label < numLabels; label++) {
    if (stats[label].area <= MIN_COMPONENT_AREA) {
      for (let r = 0; r < 64; r++) {
        for (let c = 0; c < 64; c++) {
          if (labels[r][c] === label) frame[r][c] = 0;
        }
      }
    }
  }

  return frame;
}

/**
 * 计算COP位置
 * @param {number[][]} frame - 64x64矩阵
 * @returns {[number, number]|null} [cx, cy] 或 null
 */
function calcCOPPos(frame) {
  if (!frame) return null;
  let total = 0, sumX = 0, sumY = 0;
  for (let r = 0; r < frame.length; r++) {
    for (let c = 0; c < frame[r].length; c++) {
      const v = frame[r][c];
      total += v;
      sumX += c * v;
      sumY += r * v;
    }
  }
  if (total <= 10) return null;
  return [sumX / total, sumY / total];
}

/**
 * 动态寻找左右脚中心 (K-means式聚类)
 * @param {number[][]} frame - 64x64矩阵
 * @returns {[number, number]} [leftCenter, rightCenter]
 */
function getCentersDynamic(frame) {
  const defaultL = 16.0, defaultR = 48.0;
  if (!frame) return [defaultL, defaultR];

  // 找最大值
  let maxVal = 0;
  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 64; c++) {
      if (frame[r][c] > maxVal) maxVal = frame[r][c];
    }
  }
  if (maxVal <= 5) return [defaultL, defaultR];

  // 连通域质心
  const binary = new Array(64);
  for (let r = 0; r < 64; r++) {
    binary[r] = new Uint8Array(64);
    for (let c = 0; c < 64; c++) {
      binary[r][c] = frame[r][c] > 5 ? 1 : 0;
    }
  }

  const { numLabels, labels, centroids } = connectedComponentsWithStats(binary, 8);
  const cols = [];
  for (let i = 1; i < numLabels; i++) {
    cols.push(centroids[i][0]); // x坐标
  }

  if (cols.length === 0) return [defaultL, defaultR];

  // K-means式聚类 (3轮迭代)
  let centers = [Math.min(...cols), Math.max(...cols)];
  for (let iter = 0; iter < 3; iter++) {
    const g0 = cols.filter(x => Math.abs(x - centers[0]) < Math.abs(x - centers[1]));
    const g1 = cols.filter(x => Math.abs(x - centers[0]) >= Math.abs(x - centers[1]));
    if (g0.length > 0) centers[0] = g0.reduce((a, b) => a + b, 0) / g0.length;
    if (g1.length > 0) centers[1] = g1.reduce((a, b) => a + b, 0) / g1.length;
  }

  centers.sort((a, b) => a - b);
  if (Math.abs(centers[1] - centers[0]) < 10) return [defaultL, defaultR];
  return centers;
}

/**
 * 分割左右脚
 * @param {number[][]} frame - 64x64矩阵
 * @param {number} cl - 左脚中心x
 * @param {number} cr - 右脚中心x
 * @returns {{ maskL: number[][], maskR: number[][] }}
 */
function getFootSplit(frame, cl, cr) {
  const maskL = new Array(64);
  const maskR = new Array(64);
  for (let r = 0; r < 64; r++) {
    maskL[r] = new Uint8Array(64);
    maskR[r] = new Uint8Array(64);
  }

  // 找最大值
  let maxVal = 0;
  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 64; c++) {
      if (frame[r][c] > maxVal) maxVal = frame[r][c];
    }
  }
  if (maxVal <= 0) return { maskL, maskR };

  // 连通域
  const binary = new Array(64);
  for (let r = 0; r < 64; r++) {
    binary[r] = new Uint8Array(64);
    for (let c = 0; c < 64; c++) {
      binary[r][c] = frame[r][c] > 0 ? 1 : 0;
    }
  }

  const { numLabels, labels, centroids } = connectedComponentsWithStats(binary, 8);

  for (let i = 1; i < numLabels; i++) {
    const col = centroids[i][0];
    const isLeft = Math.abs(col - cl) <= Math.abs(col - cr);
    for (let r = 0; r < 64; r++) {
      for (let c = 0; c < 64; c++) {
        if (labels[r][c] === i) {
          if (isLeft) maskL[r][c] = 1;
          else maskR[r][c] = 1;
        }
      }
    }
  }

  return { maskL, maskR };
}

/**
 * 矩阵元素乘法 (frame * mask)
 */
function applyMask(frame, mask) {
  const result = new Array(64);
  for (let r = 0; r < 64; r++) {
    result[r] = new Float64Array(64);
    for (let c = 0; c < 64; c++) {
      result[r][c] = frame[r][c] * mask[r][c];
    }
  }
  return result;
}

/**
 * 计算COP速度 (cm/s)
 */
function calcSpeed(posCurr, posPrev, fps) {
  if (!posCurr || !posPrev) return 0.0;
  const dx = posCurr[0] - posPrev[0];
  const dy = posCurr[1] - posPrev[1];
  const distPix = Math.sqrt(dx * dx + dy * dy);
  return distPix * PITCH_MM * fps; // mm/s → 实际上返回的是mm/s
}

/**
 * 计算帧的总压力和面积
 */
function frameStats(frame) {
  let pressure = 0;
  let area = 0;
  for (let r = 0; r < frame.length; r++) {
    for (let c = 0; c < frame[r].length; c++) {
      pressure += frame[r][c];
      if (frame[r][c] > 0) area++;
    }
  }
  return {
    pressure,
    area: area * (PITCH_MM * PITCH_MM) / 100.0, // cm²
  };
}

// ============================================================
// 公开API: 实时处理单帧
// ============================================================

/**
 * 实时处理单帧数据
 * @param {number[]} dataCurrent - 当前帧 4096 数组
 * @param {number[]|null} dataPrev - 上一帧 4096 数组
 * @param {number} fps - 帧率
 * @returns {object|null} { left: {pressure, area, cop_speed}, right: {...} }
 */
function processFrameRealtime(dataCurrent, dataPrev = null, fps = 20.0) {
  const frameCurr = parseFrame(dataCurrent);
  if (!frameCurr) return null;

  const framePrev = parseFrame(dataPrev);

  // 确定左右脚中心
  const [cl, cr] = getCentersDynamic(frameCurr);

  // 分割当前帧
  const { maskL: maskLCurr, maskR: maskRCurr } = getFootSplit(frameCurr, cl, cr);
  const frameLCurr = applyMask(frameCurr, maskLCurr);
  const frameRCurr = applyMask(frameCurr, maskRCurr);

  const copLCurr = calcCOPPos(frameLCurr);
  const copRCurr = calcCOPPos(frameRCurr);

  // 处理上一帧
  let copLPrev = null, copRPrev = null;
  if (framePrev) {
    const [clP, crP] = getCentersDynamic(framePrev);
    const { maskL: maskLPrev, maskR: maskRPrev } = getFootSplit(framePrev, clP, crP);
    copLPrev = calcCOPPos(applyMask(framePrev, maskLPrev));
    copRPrev = calcCOPPos(applyMask(framePrev, maskRPrev));
  }

  // 计算指标
  const leftStats = frameStats(frameLCurr);
  const rightStats = frameStats(frameRCurr);

  return {
    left: {
      pressure: leftStats.pressure,
      area: leftStats.area,
      cop_speed: calcSpeed(copLCurr, copLPrev, fps),
    },
    right: {
      pressure: rightStats.pressure,
      area: rightStats.area,
      cop_speed: calcSpeed(copRCurr, copRPrev, fps),
    },
  };
}

// ============================================================
// 公开API: 批量回放处理
// ============================================================

/**
 * 批量处理回放数据
 * @param {number[][]} matrix2d - [N, 4096] 数据矩阵
 * @param {number} fps - 帧率
 * @returns {object} { left: {pressure[], area[], cop_speed[], array[]}, right: {...} }
 */
function processPlaybackBatch(matrix2d, fps = 20.0) {
  const result = {
    left: { pressure: [], area: [], cop_speed: [], array: [] },
    right: { pressure: [], area: [], cop_speed: [], array: [] },
  };

  if (!matrix2d || matrix2d.length === 0) return result;

  // 1. 解析和去噪所有帧
  const cleanedFrames = [];
  for (let i = 0; i < matrix2d.length; i++) {
    const frame = parseFrame(matrix2d[i]);
    cleanedFrames.push(frame);
  }

  // 2. 全局中心计算 (K-means聚类)
  const allCentroids = [];
  for (const f of cleanedFrames) {
    if (!f) continue;
    const binary = new Array(64);
    for (let r = 0; r < 64; r++) {
      binary[r] = new Uint8Array(64);
      for (let c = 0; c < 64; c++) {
        binary[r][c] = f[r][c] > 0 ? 1 : 0;
      }
    }
    const { numLabels, centroids } = connectedComponentsWithStats(binary, 8);
    for (let k = 1; k < numLabels; k++) {
      allCentroids.push(centroids[k][0]);
    }
  }

  let cL = 16.0, cR = 48.0;
  if (allCentroids.length > 0) {
    let centers = [Math.min(...allCentroids), Math.max(...allCentroids)];
    for (let iter = 0; iter < 10; iter++) {
      const g0 = allCentroids.filter(x => Math.abs(x - centers[0]) < Math.abs(x - centers[1]));
      const g1 = allCentroids.filter(x => Math.abs(x - centers[0]) >= Math.abs(x - centers[1]));
      const nc = [...centers];
      if (g0.length > 0) nc[0] = g0.reduce((a, b) => a + b, 0) / g0.length;
      if (g1.length > 0) nc[1] = g1.reduce((a, b) => a + b, 0) / g1.length;
      if (Math.abs(nc[0] - centers[0]) < 0.1 && Math.abs(nc[1] - centers[1]) < 0.1) break;
      centers = nc;
    }
    centers.sort((a, b) => a - b);
    cL = centers[0];
    cR = centers[1];
  }

  // 3. 逐帧处理
  let prevCopL = null, prevCopR = null;

  for (const f of cleanedFrames) {
    if (!f) {
      result.left.pressure.push(0);
      result.left.area.push(0);
      result.left.cop_speed.push(0);
      result.left.array.push([]);
      result.right.pressure.push(0);
      result.right.area.push(0);
      result.right.cop_speed.push(0);
      result.right.array.push([]);
      continue;
    }

    const { maskL, maskR } = getFootSplit(f, cL, cR);
    const fL = applyMask(f, maskL);
    const fR = applyMask(f, maskR);

    // Left
    const lStats = frameStats(fL);
    result.left.pressure.push(lStats.pressure);
    result.left.area.push(lStats.area);
    result.left.array.push(fL);

    const copL = calcCOPPos(fL);
    result.left.cop_speed.push(calcSpeed(copL, prevCopL, fps));
    if (copL) prevCopL = copL;

    // Right
    const rStats = frameStats(fR);
    result.right.pressure.push(rStats.pressure);
    result.right.area.push(rStats.area);
    result.right.array.push(fR);

    const copR = calcCOPPos(fR);
    result.right.cop_speed.push(calcSpeed(copR, prevCopR, fps));
    if (copR) prevCopR = copR;
  }

  return result;
}

module.exports = {
  processFrameRealtime,
  processPlaybackBatch,
  // 导出内部函数供测试
  parseFrame,
  getCentersDynamic,
  getFootSplit,
  calcCOPPos,
};
