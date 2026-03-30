/**
 * 站立评估算法模块 (JS版)
 * 迁移自 Python: OneStep_report.py + one_step_render_data.py
 *
 * 包含: 数据预处理、COP轨迹、足弓分析、样本熵、摇摆特征、COP时间序列
 * 替代: cv2.connectedComponents → BFS连通域, numpy → 纯JS数组运算
 *       scipy.spatial.ConvexHull → Graham扫描, scipy.spatial.distance → 手写欧氏距离
 */

const {
  reshape2D, rot90, fliplr, flipud,
  connectedComponentsWithStats,
  mean, std, sum: arrSum,
} = require('../shared/mathUtils');

// ============================================================
// 常量
// ============================================================

const GRID_SIZE = 64;
const HALF_SIZE = 32;
const SPACING_MM = 14;      // 每格 14mm (1.4cm)
const SPACING_CM = SPACING_MM / 10;
const CELL_AREA_MM2 = SPACING_MM ** 2;
const NOISE_THRESHOLD = 2;  // 去噪阈值 (>2 保留)

// ============================================================
// 1. 数据预处理
// ============================================================

/**
 * 移除小连通域 (替代 cv2.connectedComponents)
 * @param {number[][]} mat - 64x64矩阵
 * @param {number} minSize - 最小连通域面积
 * @param {number} connectivity - 连通性 (4 或 8)
 * @returns {number[][]} 去噪后的矩阵
 */
function removeSmallComponents(mat, minSize = 3, connectivity = 4) {
  const rows = mat.length, cols = mat[0].length;
  const binary = new Array(rows);
  for (let r = 0; r < rows; r++) {
    binary[r] = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      binary[r][c] = mat[r][c] > NOISE_THRESHOLD ? 1 : 0;
    }
  }

  const { numLabels, labels, stats } = connectedComponentsWithStats(binary, connectivity);

  const result = mat.map(row => [...row]);
  for (let label = 1; label < numLabels; label++) {
    if (stats[label].area < minSize) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (labels[r][c] === label) result[r][c] = 0;
        }
      }
    }
  }
  return result;
}

/**
 * 获取前N大连通域的合并外接框
 * @param {number[][]} binaryMat - 二值矩阵
 * @param {number} topN - 保留前N大
 * @param {number} minSize - 最小面积
 * @returns {{ top, bottom, left, right, totalPixels }|null}
 */
function largestBboxesMulti(binaryMat, topN = 3, minSize = 50) {
  const rows = binaryMat.length, cols = binaryMat[0].length;
  const { numLabels, labels, stats } = connectedComponentsWithStats(binaryMat, 8);

  if (numLabels <= 1) return null;

  // 筛选有效连通域
  const validLabels = [];
  for (let label = 1; label < numLabels; label++) {
    if (stats[label].area >= minSize) {
      validLabels.push({ label, area: stats[label].area });
    }
  }
  if (validLabels.length === 0) return null;

  // 按面积排序取前N
  validLabels.sort((a, b) => b.area - a.area);
  const topLabels = new Set(validLabels.slice(0, topN).map(v => v.label));

  let minR = rows, maxR = 0, minC = cols, maxC = 0, totalPixels = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (topLabels.has(labels[r][c])) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        totalPixels++;
      }
    }
  }

  return { top: minR, bottom: maxR, left: minC, right: maxC, totalPixels };
}

/**
 * 预处理原始数据 (迁移自 preprocess_origin_data)
 * @param {number[][]} dataArray - [N, 4096] 原始帧数据
 * @param {object} options - 预处理选项
 * @returns {number[][]} 预处理后的 [N, 4096] 数据
 */
function preprocessOriginData(dataArray, options = {}) {
  const {
    rotate90ccw = true,
    mirroredHorizon = true,
    mirroredVertical = true,
    applyDenoise = true,
    smallCompMinSize = 3,
    smallCompConnectivity = 4,
    margin = 0,
    multiComponentMode = true,
    multiComponentTopN = 3,
    multiComponentMinSize = 10,
  } = options;

  const processed = [];

  for (let idx = 0; idx < dataArray.length; idx++) {
    const frameData = dataArray[idx];
    let mat = reshape2D(frameData.length >= 4096 ? frameData.slice(0, 4096) : padTo4096(frameData), 64, 64);

    // 1) 几何操作
    if (rotate90ccw) mat = rot90(mat);
    if (mirroredHorizon) mat = fliplr(mat);
    if (mirroredVertical) mat = flipud(mat);

    if (applyDenoise) {
      // 2) 小连通域剔除
      mat = removeSmallComponents(mat, smallCompMinSize, smallCompConnectivity);

      // 3) 左右脚连通域裁剪
      const leftHalf = mat.map(row => row.slice(0, 32));
      const rightHalf = mat.map(row => row.slice(32));

      const leftBinary = leftHalf.map(row => row.map(v => v > 0 ? 1 : 0));
      const rightBinary = rightHalf.map(row => row.map(v => v > 0 ? 1 : 0));

      const leftBbox = largestBboxesMulti(leftBinary, multiComponentTopN, multiComponentMinSize);
      const rightBbox = largestBboxesMulti(rightBinary, multiComponentTopN, multiComponentMinSize);

      const keep = new Array(64);
      for (let r = 0; r < 64; r++) {
        keep[r] = new Uint8Array(64);
      }

      if (leftBbox) {
        const t = Math.max(leftBbox.top - margin, 0);
        const b = Math.min(leftBbox.bottom + margin, 63);
        const l = Math.max(leftBbox.left - margin, 0);
        const r = Math.min(leftBbox.right + margin, 31);
        for (let row = t; row <= b; row++) {
          for (let col = l; col <= r; col++) {
            keep[row][col] = 1;
          }
        }
      }

      if (rightBbox) {
        const t = Math.max(rightBbox.top - margin, 0);
        const b = Math.min(rightBbox.bottom + margin, 63);
        const l = Math.max(rightBbox.left - margin, 0) + 32;
        const r = Math.min(rightBbox.right + margin, 31) + 32;
        for (let row = t; row <= b; row++) {
          for (let col = l; col <= r; col++) {
            keep[row][col] = 1;
          }
        }
      }

      for (let r = 0; r < 64; r++) {
        for (let c = 0; c < 64; c++) {
          if (!keep[r][c]) mat[r][c] = 0;
        }
      }
    }

    // 展平为 4096
    const flat = [];
    for (let r = 0; r < 64; r++) {
      for (let c = 0; c < 64; c++) {
        flat.push(mat[r][c]);
      }
    }
    processed.push(flat);
  }

  return processed;
}

function padTo4096(arr) {
  const result = new Array(4096).fill(0);
  for (let i = 0; i < Math.min(arr.length, 4096); i++) result[i] = arr[i];
  return result;
}

// ============================================================
// 2. 压力曲线和COP轨迹
// ============================================================

/**
 * 矢量化计算左右脚每帧非零点数
 */
function extractPressureCurves(dataArray, thr = 2) {
  const left = [], right = [];
  for (const frame of dataArray) {
    const mat = reshape2D(frame, 64, 64);
    let lCount = 0, rCount = 0;
    for (let r = 0; r < 64; r++) {
      for (let c = 0; c < 32; c++) {
        if (mat[r][c] > thr) lCount++;
      }
      for (let c = 32; c < 64; c++) {
        if (mat[r][c] > thr) rCount++;
      }
    }
    left.push(lCount);
    right.push(rCount);
  }
  return { left, right };
}

/**
 * 找压力峰值区间
 */
function findPressurePeakInterval(pressureCurve, thresholdRatio = 0.8) {
  const peakValue = Math.max(...pressureCurve);
  const peakIndex = pressureCurve.indexOf(peakValue);
  const threshold = peakValue * thresholdRatio;

  let leftIndex = peakIndex;
  while (leftIndex > 0 && pressureCurve[leftIndex] >= threshold) leftIndex--;
  let rightIndex = peakIndex;
  while (rightIndex < pressureCurve.length - 1 && pressureCurve[rightIndex] >= threshold) rightIndex++;

  if (leftIndex > 0) leftIndex++;
  if (rightIndex < pressureCurve.length - 1) rightIndex--;

  return { leftIndex, rightIndex };
}

/**
 * 计算COP (带偏移)
 */
function calculateCOPCorrected(pressureGrid, isRight) {
  let totalPressure = 0, weightedX = 0, weightedY = 0;
  const rows = pressureGrid.length, cols = pressureGrid[0].length;

  for (let x = 0; x < rows; x++) {
    for (let y = 0; y < cols; y++) {
      const p = pressureGrid[x][y];
      totalPressure += p;
      weightedX += p * x;
      weightedY += p * (isRight ? y + 32 : y);
    }
  }

  if (totalPressure <= 0) return null;
  return [weightedX / totalPressure, weightedY / totalPressure];
}

/**
 * 计算COP轨迹 (左右脚)
 */
function calculateCOPTrajectories(processedData, leftCurve, rightCurve, thresholdRatio) {
  const leftInterval = findPressurePeakInterval(leftCurve, thresholdRatio);
  const rightInterval = findPressurePeakInterval(rightCurve, thresholdRatio);

  const leftCop = [];
  for (let i = leftInterval.leftIndex; i <= leftInterval.rightIndex && i < processedData.length; i++) {
    const mat = reshape2D(processedData[i], 64, 64);
    const leftMatrix = mat.map(row => row.slice(0, 32));
    const cop = calculateCOPCorrected(leftMatrix, false);
    if (cop) leftCop.push(cop);
  }

  const rightCop = [];
  for (let i = rightInterval.leftIndex; i <= rightInterval.rightIndex && i < processedData.length; i++) {
    const mat = reshape2D(processedData[i], 64, 64);
    const rightMatrix = mat.map(row => row.slice(32));
    const cop = calculateCOPCorrected(rightMatrix, true);
    if (cop) rightCop.push(cop);
  }

  return { leftCop, rightCop };
}

// ============================================================
// 3. 足弓分析
// ============================================================

/**
 * 获取最大连通域点集 (多连通域版本)
 */
function largestComponentPointsMulti(binaryMat, thr = 1.0, topN = 5, minSize = 50) {
  const rows = binaryMat.length, cols = binaryMat[0].length;
  const binary = binaryMat.map(row => row.map(v => v > thr ? 1 : 0));
  const { numLabels, labels, stats } = connectedComponentsWithStats(binary, 8);

  if (numLabels <= 1) return [];

  const validLabels = [];
  for (let label = 1; label < numLabels; label++) {
    if (stats[label].area >= minSize) {
      validLabels.push({ label, area: stats[label].area });
    }
  }

  if (validLabels.length === 0) {
    // 降级到最大连通域
    let maxLabel = 1, maxArea = 0;
    for (let label = 1; label < numLabels; label++) {
      if (stats[label].area > maxArea) {
        maxArea = stats[label].area;
        maxLabel = label;
      }
    }
    const points = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (labels[r][c] === maxLabel) points.push([r, c]);
      }
    }
    return points;
  }

  validLabels.sort((a, b) => b.area - a.area);
  const topLabels = new Set(validLabels.slice(0, topN).map(v => v.label));

  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (topLabels.has(labels[r][c])) points.push([r, c]);
    }
  }
  return points;
}

/**
 * 检测单帧脚跟位置
 */
function detectHeelForFrame(frameData, isRight, thr = 2.0) {
  const mat = reshape2D(frameData, 64, 64);
  const half = isRight ? mat.map(row => row.slice(32)) : mat.map(row => row.slice(0, 32));

  // 检查是否有数据
  let hasData = false;
  for (let r = 0; r < 64 && !hasData; r++) {
    for (let c = 0; c < 32 && !hasData; c++) {
      if (half[r][c] > 0) hasData = true;
    }
  }
  if (!hasData) return null;

  const maxArea = largestComponentPointsMulti(half, thr, 3, 50);
  if (maxArea.length === 0) return null;

  // 右脚列坐标对齐到全局: +32
  const globalArea = isRight
    ? maxArea.map(([r, c]) => [r, c + 32])
    : maxArea;

  // 脚跟: x最大行的y中位数
  const xs = globalArea.map(p => p[0]);
  const maxX = Math.max(...xs);
  const ysOnMaxX = globalArea.filter(p => p[0] === maxX).map(p => p[1]);
  ysOnMaxX.sort((a, b) => a - b);
  const yMed = ysOnMaxX[Math.floor(ysOnMaxX.length / 2)];

  return { maxArea: globalArea, xHeel: maxX, yHeel: yMed };
}

/**
 * 将足迹按x方向分为4个区域 (3:4:4:4比例)
 */
function divideXRegions(halfMaxArea) {
  const xValues = halfMaxArea.map(p => p[0]);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const totalRange = maxX - minX;

  const ratios = [3, 4, 4, 4];
  const totalRatio = ratios.reduce((a, b) => a + b, 0);

  const boundaries = [];
  let current = minX;
  for (let i = 0; i < ratios.length; i++) {
    const end = i === ratios.length - 1 ? maxX : current + (ratios[i] / totalRatio) * totalRange;
    boundaries.push({ start: current, end });
    current = end;
  }

  const sectionCoords = [[], [], [], []];
  for (const coord of halfMaxArea) {
    const x = coord[0];
    for (let i = 0; i < boundaries.length; i++) {
      if (x >= boundaries[i].start && (x < boundaries[i].end || (i === 3 && x === boundaries[i].end))) {
        sectionCoords[i].push(coord);
        break;
      }
    }
  }

  return sectionCoords;
}

/**
 * 计算区域面积和足弓指数
 */
function calculateRegionAreas(sectionCoords) {
  const areas = sectionCoords.map(s => s.length);
  const areaA = areas[3]; // 后足
  const areaB = areas[2]; // 中足
  const areaC = areas[1]; // 前足
  const totalArea = areaA + areaB + areaC;
  const areaAI = totalArea > 0 ? areaB / totalArea : 0;

  let areaType;
  if (areaAI < 0.20) areaType = '高足弓(high arch)';
  else if (areaAI < 0.21) areaType = '正常偏高(slightly high)';
  else if (areaAI <= 0.26) areaType = '正常足弓(normal arch)';
  else if (areaAI <= 0.27) areaType = '正常偏扁(slightly flat)';
  else areaType = '扁平足(flat foot)';

  return { areaAI, areaType };
}

/**
 * 计算2D角度
 */
function calculate2DAngle(A, B, C) {
  const caX = A[0] - C[0], caY = A[1] - C[1];
  const cbX = B[0] - C[0], cbY = B[1] - C[1];
  const dot = caX * cbX + caY * cbY;
  const lenCA = Math.sqrt(caX * caX + caY * caY);
  const lenCB = Math.sqrt(cbX * cbX + cbY * cbY);
  if (lenCA === 0 || lenCB === 0) return null;
  const cosTheta = Math.max(-1, Math.min(1, dot / (lenCA * lenCB)));
  return Math.round(Math.acos(cosTheta) * 180 / Math.PI * 100) / 100;
}

/**
 * 获取B点 (中足内侧/外侧边缘点)
 */
function getBPoint(bRegion, isRight) {
  if (!bRegion || bRegion.length === 0) return null;

  const xGroups = {};
  for (const coord of bRegion) {
    const x = coord[0];
    if (!xGroups[x]) xGroups[x] = [];
    xGroups[x].push(coord);
  }

  const firstPoints = [];
  for (const x of Object.keys(xGroups).sort((a, b) => a - b)) {
    const group = xGroups[x].sort((a, b) => a[1] - b[1]);
    if (group.length > 0) {
      firstPoints.push(isRight ? group[0] : group[group.length - 1]);
    }
  }

  if (firstPoints.length === 0) return null;
  return isRight
    ? firstPoints.reduce((max, p) => p[1] > max[1] ? p : max, firstPoints[0])
    : firstPoints.reduce((min, p) => p[1] < min[1] ? p : min, firstPoints[0]);
}

/**
 * 计算Clarke角
 */
function calculateClarke(sectionCoords, isRight) {
  const aRegion = sectionCoords[3];
  if (!aRegion || aRegion.length === 0) return { angle: null, type: null };

  // A点: 后足x中位数行的内侧点
  const aXValues = aRegion.map(p => p[0]);
  aXValues.sort((a, b) => a - b);
  const aXMedian = aXValues[Math.floor(aXValues.length / 2)];
  const aCandidates = aRegion.filter(p => p[0] === aXMedian);
  const aPoint = isRight
    ? aCandidates.reduce((min, p) => p[1] < min[1] ? p : min, aCandidates[0])
    : aCandidates.reduce((max, p) => p[1] > max[1] ? p : max, aCandidates[0]);

  // B点
  const bRegion = sectionCoords[2];
  const bPoint = getBPoint(bRegion, isRight);
  if (!bPoint) return { angle: null, type: null };

  // C点: 前足x中位数行的内侧点
  const cRegion = sectionCoords[1];
  if (!cRegion || cRegion.length === 0) return { angle: null, type: null };
  const cXValues = cRegion.map(p => p[0]);
  cXValues.sort((a, b) => a - b);
  const cXMedian = cXValues[Math.floor(cXValues.length / 2)];
  const cCandidates = cRegion.filter(p => p[0] === cXMedian);
  const cPoint = isRight
    ? cCandidates.reduce((min, p) => p[1] < min[1] ? p : min, cCandidates[0])
    : cCandidates.reduce((max, p) => p[1] > max[1] ? p : max, cCandidates[0]);

  const angle = calculate2DAngle(aPoint, bPoint, cPoint);
  if (angle === null) return { angle: null, type: null };

  let type;
  if (angle < 42) type = '扁平足(flat foot)';
  else if (angle <= 48) type = '正常足(normal foot)';
  else type = '高弓足(high arch foot)';

  return { angle, type };
}

/**
 * 计算点到直线距离
 */
function calculateDistanceToLine(a, b, c) {
  const [x1, y1] = a, [x2, y2] = b, [xc, yc] = c;
  let A, B, C;
  if (x2 === x1) { A = 1; B = 0; C = -x1; }
  else { A = y2 - y1; B = -(x2 - x1); C = (x2 - x1) * y1 - (y2 - y1) * x1; }
  return Math.abs(A * xc + B * yc + C) / Math.sqrt(A * A + B * B);
}

/**
 * 获取垂线方程和垂足
 */
function getPerpendicularFootPoint(a, b, c) {
  const [x1, y1] = a, [x2, y2] = b, [xc, yc] = c;
  if (x1 === x2) return [x1, yc];
  if (y1 === y2) return [xc, y1];
  const kAB = (y2 - y1) / (x2 - x1);
  const bAB = y1 - kAB * x1;
  const kPerp = -1 / kAB;
  const xFoot = (kAB * xc - kPerp * xc + yc - bAB) / (kAB - kPerp);
  const yFoot = kAB * xFoot + bAB;
  return [xFoot, yFoot];
}

/**
 * 找最近点
 */
function findClosestPointToFoot(region, lineA, lineB, pointC, isRight) {
  if (lineA[1] === lineB[1]) {
    const footPoint = [pointC[0], lineA[1]];
    const sameX = region.filter(p => p[0] === footPoint[0]);
    if (sameX.length > 0) {
      return isRight
        ? sameX.reduce((min, p) => p[1] < min[1] ? p : min, sameX[0])
        : sameX.reduce((max, p) => p[1] > max[1] ? p : max, sameX[0]);
    }
  }
  const footPoint = getPerpendicularFootPoint(lineA, lineB, pointC);
  let minDist = Infinity, closest = null;
  for (const p of region) {
    const d = Math.sqrt((p[0] - footPoint[0]) ** 2 + (p[1] - footPoint[1]) ** 2);
    if (d < minDist) { minDist = d; closest = p; }
  }
  return closest;
}

/**
 * 计算Staheli比值
 */
function calculateStaheli(sectionCoords, isRight) {
  const aRegion = sectionCoords[3];
  const bRegion = sectionCoords[2];
  const cRegion = sectionCoords[1];
  if (!aRegion?.length || !bRegion?.length || !cRegion?.length) return null;

  try {
    // A区域边缘点
    const sortedA = [...aRegion].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let aLeftPoint = sortedA[0];
    for (const a of sortedA) {
      if (isRight ? a[1] <= aLeftPoint[1] : a[1] >= aLeftPoint[1]) aLeftPoint = a;
    }

    const aXMin = Math.min(...aRegion.map(p => p[0]));
    const aXMax = Math.max(...aRegion.map(p => p[0]));
    const aXMid = Math.ceil((aXMin + aXMax) / 2);
    const aAtMid = aRegion.filter(p => p[0] === aXMid);
    if (aAtMid.length === 0) return null;
    const aMidPoint = isRight
      ? aAtMid.reduce((max, p) => p[1] > max[1] ? p : max, aAtMid[0])
      : aAtMid.reduce((min, p) => p[1] < min[1] ? p : min, aAtMid[0]);

    // C区域边缘点
    const cLeftPoint = isRight
      ? cRegion.reduce((min, p) => p[1] < min[1] ? p : min, cRegion[0])
      : cRegion.reduce((max, p) => p[1] > max[1] ? p : max, cRegion[0]);

    // B区域中间点
    const bXMin = Math.min(...bRegion.map(p => p[0]));
    const bXMax = Math.max(...bRegion.map(p => p[0]));
    const bXMid = Math.ceil((bXMin + bXMax) / 2);
    const bAtMid = bRegion.filter(p => p[0] === bXMid);
    if (bAtMid.length === 0) return null;
    const bMidPoint = isRight
      ? bAtMid.reduce((max, p) => p[1] > max[1] ? p : max, bAtMid[0])
      : bAtMid.reduce((min, p) => p[1] < min[1] ? p : min, bAtMid[0]);

    const distanceHeel = calculateDistanceToLine(aLeftPoint, cLeftPoint, aMidPoint);
    const bFeetPoint = findClosestPointToFoot(bRegion, aLeftPoint, cLeftPoint, bMidPoint, isRight);
    if (!bFeetPoint) return null;

    const distanceMiddle = Math.sqrt(
      (bMidPoint[0] - bFeetPoint[0]) ** 2 + (bMidPoint[1] - bFeetPoint[1]) ** 2
    );

    return distanceHeel > 0 ? distanceMiddle / distanceHeel : null;
  } catch (e) {
    return null;
  }
}

/**
 * 计算单帧足弓特征
 */
function calculateSingleFrameArchFeatures(frameData) {
  try {
    const leftResult = detectHeelForFrame(frameData, false);
    const rightResult = detectHeelForFrame(frameData, true);
    if (!leftResult || !rightResult) return null;

    const leftSectionCoords = divideXRegions(leftResult.maxArea);
    const rightSectionCoords = divideXRegions(rightResult.maxArea);

    const leftArea = calculateRegionAreas(leftSectionCoords);
    const rightArea = calculateRegionAreas(rightSectionCoords);

    const leftClarke = calculateClarke(leftSectionCoords, false);
    const rightClarke = calculateClarke(rightSectionCoords, true);

    const leftStaheli = calculateStaheli(leftSectionCoords, false);
    const rightStaheli = calculateStaheli(rightSectionCoords, true);

    return {
      left_foot: {
        area_index: leftArea.areaAI,
        area_type: leftArea.areaType,
        clarke_angle: leftClarke.angle,
        clarke_type: leftClarke.type,
        staheli_ratio: leftStaheli,
        section_coords: leftSectionCoords,
        max_area: leftResult.maxArea,
      },
      right_foot: {
        area_index: rightArea.areaAI,
        area_type: rightArea.areaType,
        clarke_angle: rightClarke.angle,
        clarke_type: rightClarke.type,
        staheli_ratio: rightStaheli,
        section_coords: rightSectionCoords,
        max_area: rightResult.maxArea,
      },
    };
  } catch (e) {
    return null;
  }
}

/**
 * 计算完整足弓特征 (多帧平均 + 峰值帧可视化)
 */
function calculateCompleteArchFeatures(dataArray, leftCurve, rightCurve) {
  const totalCurve = leftCurve.map((l, i) => l + rightCurve[i]);
  const peakValue = Math.max(...totalCurve);
  const peakIndex = totalCurve.indexOf(peakValue);
  const peakFrameData = dataArray[peakIndex];

  if (dataArray.length > 1) {
    // 多帧: 统计指标取平均，可视化用峰值帧
    const peakResult = calculateSingleFrameArchFeatures(peakFrameData);
    if (!peakResult) return null;

    const allResults = [];
    for (const frame of dataArray) {
      const r = calculateSingleFrameArchFeatures(frame);
      if (r) allResults.push(r);
    }

    if (allResults.length === 0) return null;

    // 平均值
    const avgField = (results, foot, field) => {
      const vals = results.map(r => r[foot][field]).filter(v => v !== null && v !== undefined);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const areaTypeFunc = ai => {
      if (ai === null) return '无数据';
      if (ai < 0.21) return '高足弓(high arch)';
      if (ai <= 0.26) return '正常足弓(normal arch)';
      return '扁平足(flat foot)';
    };

    const clarkeTypeFunc = angle => {
      if (angle === null) return '无数据';
      if (angle < 42) return '扁平足(flat foot)';
      if (angle <= 48) return '正常足(normal foot)';
      return '高弓足(high arch foot)';
    };

    const leftAvgAI = avgField(allResults, 'left_foot', 'area_index');
    const rightAvgAI = avgField(allResults, 'right_foot', 'area_index');

    return {
      left_foot: {
        area_index: leftAvgAI,
        area_type: areaTypeFunc(leftAvgAI),
        clarke_angle: avgField(allResults, 'left_foot', 'clarke_angle'),
        clarke_type: clarkeTypeFunc(avgField(allResults, 'left_foot', 'clarke_angle')),
        staheli_ratio: avgField(allResults, 'left_foot', 'staheli_ratio'),
        section_coords: peakResult.left_foot.section_coords,
        max_area: peakResult.left_foot.max_area,
      },
      right_foot: {
        area_index: rightAvgAI,
        area_type: areaTypeFunc(rightAvgAI),
        clarke_angle: avgField(allResults, 'right_foot', 'clarke_angle'),
        clarke_type: clarkeTypeFunc(avgField(allResults, 'right_foot', 'clarke_angle')),
        staheli_ratio: avgField(allResults, 'right_foot', 'staheli_ratio'),
        section_coords: peakResult.right_foot.section_coords,
        max_area: peakResult.right_foot.max_area,
      },
      frame_count: allResults.length,
      is_multi_frame: true,
      peak_frame_data: peakFrameData,
      peak_frame_index: peakIndex,
      peak_total_pressure: peakValue,
    };
  } else {
    // 单帧
    const result = calculateSingleFrameArchFeatures(peakFrameData);
    if (!result) return null;
    result.frame_count = 1;
    result.is_multi_frame = false;
    result.peak_frame_data = peakFrameData;
    result.peak_frame_index = peakIndex;
    result.peak_total_pressure = peakValue;
    return result;
  }
}

// ============================================================
// 4. 样本熵 (Sample Entropy)
// ============================================================

/**
 * 计算样本熵
 * @param {number[]} timeSeries - 时间序列
 * @param {number} m - 嵌入维度
 * @param {number} r - 容差
 * @returns {number}
 */
function sampleEntropy(timeSeries, m = 2, r = 0.2) {
  const N = timeSeries.length;
  if (N <= m + 1) return 0;

  const mu = mean(timeSeries);
  const sigma = std(timeSeries);
  if (sigma === 0) return 0;
  const ts = timeSeries.map(v => (v - mu) / sigma);

  function getVectors(dim) {
    const vecs = [];
    for (let i = 0; i <= N - dim; i++) {
      vecs.push(ts.slice(i, i + dim));
    }
    return vecs;
  }

  const vecsM = getVectors(m);
  const nVecs = vecsM.length;

  // 计算 B (m维匹配数)
  let B = 0;
  for (let i = 0; i < nVecs; i++) {
    for (let j = 0; j < nVecs; j++) {
      if (i === j) continue;
      let maxDist = 0;
      for (let k = 0; k < m; k++) {
        const d = Math.abs(vecsM[i][k] - vecsM[j][k]);
        if (d > maxDist) maxDist = d;
      }
      if (maxDist <= r) B++;
    }
  }

  // 计算 A (m+1维匹配数)
  let A = 0;
  for (let i = 0; i < nVecs; i++) {
    for (let j = 0; j < nVecs; j++) {
      if (i === j) continue;
      let maxDist = 0;
      for (let k = 0; k < m; k++) {
        const d = Math.abs(vecsM[i][k] - vecsM[j][k]);
        if (d > maxDist) maxDist = d;
      }
      if (maxDist <= r) {
        if (i + m < N && j + m < N) {
          if (Math.abs(ts[i + m] - ts[j + m]) <= r) A++;
        }
      }
    }
  }

  const ratio = B > 0 ? A / B : 0;
  return ratio > 0 ? -Math.log(ratio) : 0;
}

// ============================================================
// 5. COP指标
// ============================================================

/**
 * 计算COP统计指标 (15项)
 */
function calculateCOPMetrics(copTrajectory, dt = 0.024) {
  if (!copTrajectory || copTrajectory.length === 0) return null;

  const x = copTrajectory.map(p => p[0]);
  const y = copTrajectory.map(p => p[1]);
  const n = x.length;

  const centerX = mean(x);
  const centerY = mean(y);
  const rangeX = Math.max(...x) - Math.min(...x);
  const rangeY = Math.max(...y) - Math.min(...y);

  // 置信椭圆面积
  let ellipseArea = 0;
  if (n > 2) {
    const cx = x.map(v => v - centerX);
    const cy = y.map(v => v - centerY);
    const covXX = mean(cx.map(v => v * v));
    const covYY = mean(cy.map(v => v * v));
    const covXY = mean(cx.map((v, i) => v * cy[i]));
    const trace = covXX + covYY;
    const det = covXX * covYY - covXY * covXY;
    const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
    const lambda1 = trace / 2 + disc;
    const lambda2 = trace / 2 - disc;
    ellipseArea = Math.PI * 5.991 * Math.sqrt(Math.max(0, lambda1 * lambda2));
  }

  // 速度
  let vx = [], vy = [], vTotal = [];
  if (n > 1) {
    for (let i = 1; i < n; i++) {
      vx.push((x[i] - x[i - 1]) / dt);
      vy.push((y[i] - y[i - 1]) / dt);
    }
    vTotal = vx.map((v, i) => Math.sqrt(v * v + vy[i] * vy[i]));
  }
  const rmsVx = vx.length > 0 ? Math.sqrt(mean(vx.map(v => v * v))) : 0;
  const rmsVy = vy.length > 0 ? Math.sqrt(mean(vy.map(v => v * v))) : 0;
  const rmsV = vTotal.length > 0 ? Math.sqrt(mean(vTotal.map(v => v * v))) : 0;

  // 加速度
  let ax = [], ay = [], aTotal = [];
  if (vx.length > 1) {
    for (let i = 1; i < vx.length; i++) {
      ax.push((vx[i] - vx[i - 1]) / dt);
      ay.push((vy[i] - vy[i - 1]) / dt);
    }
    aTotal = ax.map((v, i) => Math.sqrt(v * v + ay[i] * ay[i]));
  }
  const rmsAx = ax.length > 0 ? Math.sqrt(mean(ax.map(v => v * v))) : 0;
  const rmsAy = ay.length > 0 ? Math.sqrt(mean(ay.map(v => v * v))) : 0;
  const rmsA = aTotal.length > 0 ? Math.sqrt(mean(aTotal.map(v => v * v))) : 0;

  // 偏移距离
  const displacement = x.map((v, i) =>
    Math.sqrt((v - centerX) ** 2 + (y[i] - centerY) ** 2)
  );

  // 样本熵
  const minSamples = 30;
  const sampenX = n > minSamples ? sampleEntropy(x) : 0;
  const sampenY = n > minSamples ? sampleEntropy(y) : 0;
  const sampenDisp = n > minSamples ? sampleEntropy(displacement) : 0;
  const sampenVx = vx.length > minSamples ? sampleEntropy(vx) : 0;
  const sampenVy = vy.length > minSamples ? sampleEntropy(vy) : 0;
  const sampenV = vTotal.length > minSamples ? sampleEntropy(vTotal) : 0;

  return {
    '横向偏移（range）': rangeX,
    '纵向偏移（range）': rangeY,
    '置信椭圆面积': ellipseArea,
    '横向速度（RMS）': rmsVx,
    '纵向速度（RMS）': rmsVy,
    '合速度（RMS）': rmsV,
    '横向加速度（RMS）': rmsAx,
    '纵向加速度（RMS）': rmsAy,
    '合加速度（RMS）': rmsA,
    '横向偏移（SampEn）': sampenX,
    '纵向偏移（SampEn）': sampenY,
    '合偏移（SampEn）': sampenDisp,
    '横向速度（SampEn）': sampenVx,
    '纵向速度（SampEn）': sampenVy,
    '合速度（SampEn）': sampenV,
  };
}

// ============================================================
// 6. 摇摆特征
// ============================================================

/**
 * 计算摇摆特征
 */
function calculateSwayFeatures(copTrajectory, fps = 42, rRadius = 0.1, timeWindow = 0.5) {
  const n = copTrajectory.length;
  if (n < Math.floor(fps * 0.5)) return null;

  const centerX = mean(copTrajectory.map(p => p[0]));
  const centerY = mean(copTrajectory.map(p => p[1]));
  const centered = copTrajectory.map(p => [p[0] - centerX, p[1] - centerY]);

  const windowSize = Math.floor(fps * timeWindow);

  // 摇摆密度
  const densityCurve = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(n, i + Math.floor(windowSize / 2));
    let count = 0;
    for (let j = start; j < end; j++) {
      const d = Math.sqrt((centered[i][0] - centered[j][0]) ** 2 + (centered[i][1] - centered[j][1]) ** 2);
      if (d <= rRadius) count++;
    }
    densityCurve[i] = count;
  }

  // 摇摆长度
  const lengthCurve = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(n, i + Math.floor(windowSize / 2));
    const inRadius = [];
    for (let j = start; j < end; j++) {
      const d = Math.sqrt((centered[i][0] - centered[j][0]) ** 2 + (centered[i][1] - centered[j][1]) ** 2);
      if (d <= rRadius) inRadius.push(centered[j]);
    }
    let segLen = 0;
    for (let j = 1; j < inRadius.length; j++) {
      segLen += Math.sqrt((inRadius[j][0] - inRadius[j - 1][0]) ** 2 + (inRadius[j][1] - inRadius[j - 1][1]) ** 2);
    }
    lengthCurve[i] = segLen;
  }

  // 摇摆半径 (最小包围圆半径)
  const halfW = Math.floor(windowSize / 2);
  const radiusCurve = [];
  for (let i = halfW; i < n - halfW; i++) {
    const window = centered.slice(i - halfW, i + halfW);
    if (window.length >= 3) {
      radiusCurve.push(minEnclosingCircleRadius(window));
    } else {
      radiusCurve.push(0);
    }
  }

  return {
    '摇摆密度_峰值': Math.max(...densityCurve),
    '摇摆密度_均值': mean(Array.from(densityCurve)),
    '摇摆密度_标准差': std(Array.from(densityCurve)),
    '摇摆长度_峰值': Math.max(...lengthCurve),
    '摇摆长度_均值': mean(Array.from(lengthCurve)),
    '摇摆长度_标准差': std(Array.from(lengthCurve)),
    '摇摆半径_峰值': radiusCurve.length > 0 ? Math.max(...radiusCurve) : 0,
    '摇摆半径_均值': radiusCurve.length > 0 ? mean(radiusCurve) : 0,
    '摇摆半径_标准差': radiusCurve.length > 0 ? std(radiusCurve) : 0,
  };
}

/**
 * 最小包围圆半径 (简化版 - 用最大距离近似)
 */
function minEnclosingCircleRadius(points) {
  if (points.length < 2) return 0;
  let maxDist = 0;
  const cx = mean(points.map(p => p[0]));
  const cy = mean(points.map(p => p[1]));
  for (const p of points) {
    const d = Math.sqrt((p[0] - cx) ** 2 + (p[1] - cy) ** 2);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

// ============================================================
// 7. COP时间序列指标
// ============================================================

/**
 * 计算COP时间序列指标 (15项)
 */
function calculateCOPTimeSeries(leftCop, rightCop, additionalData, dt = 0.024) {
  const copTrajectory = leftCop.length >= rightCop.length ? leftCop : rightCop;

  if (!copTrajectory || copTrajectory.length === 0) {
    return _emptyCOPTimeSeries();
  }

  const x = copTrajectory.map(p => p[0]);
  const y = copTrajectory.map(p => p[1]);
  const n = x.length;
  const timePoints = Array.from({ length: n }, (_, i) => i * dt);

  // 速度
  let velocitySeries = [0];
  if (n > 1) {
    for (let i = 1; i < n; i++) {
      const vx = (x[i] - x[i - 1]) / dt;
      const vy = (y[i] - y[i - 1]) / dt;
      velocitySeries.push(Math.sqrt(vx * vx + vy * vy) * SPACING_MM);
    }
  }

  const centerX = mean(x);
  const centerY = mean(y);

  // 路径长度
  let pathLength = 0;
  if (n > 1) {
    for (let i = 1; i < n; i++) {
      pathLength += Math.sqrt((x[i] - x[i - 1]) ** 2 + (y[i] - y[i - 1]) ** 2);
    }
  }
  pathLength *= SPACING_MM;

  // 接触面积 (凸包面积)
  let contactArea = 0;
  if (n >= 3) {
    contactArea = convexHullArea(copTrajectory) * CELL_AREA_MM2;
  }

  const deltaX = (Math.max(...x) - Math.min(...x)) * SPACING_MM;
  const deltaY = (Math.max(...y) - Math.min(...y)) * SPACING_MM;

  // 椭圆主轴
  let majorAxis = deltaX, minorAxis = deltaY;
  if (n > 2) {
    const cx = x.map(v => v - centerX);
    const cy = y.map(v => v - centerY);
    const covXX = mean(cx.map(v => v * v));
    const covYY = mean(cy.map(v => v * v));
    const covXY = mean(cx.map((v, i) => v * cy[i]));
    const trace = covXX + covYY;
    const det = covXX * covYY - covXY * covXY;
    const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
    const lambda1 = Math.max(0, trace / 2 + disc);
    const lambda2 = Math.max(0, trace / 2 - disc);
    majorAxis = Math.round(2 * Math.sqrt(lambda1) * SPACING_CM * 100) / 100;
    minorAxis = Math.round(2 * Math.sqrt(lambda2) * SPACING_CM * 100) / 100;
  }

  const displacement = x.map((v, i) =>
    Math.sqrt((v - centerX) ** 2 + (y[i] - centerY) ** 2) * SPACING_CM
  );

  return {
    time_series: velocitySeries,
    time_points: timePoints,
    velocity_series: velocitySeries,
    path_length: pathLength,
    contact_area: contactArea,
    ls_ratio: minorAxis > 0 ? majorAxis / minorAxis : 0,
    eccentricity: majorAxis > 0 ? Math.sqrt(Math.max(0, 1 - (minorAxis / majorAxis) ** 2)) : 0,
    major_axis: majorAxis,
    minor_axis: minorAxis,
    delta_x: deltaX,
    delta_y: deltaY,
    max_displacement: Math.max(...displacement),
    min_displacement: Math.min(...displacement),
    avg_velocity: mean(velocitySeries),
    rms_displacement: Math.sqrt(mean(displacement.map(d => d * d))),
    std_x: std(x) * SPACING_MM,
    std_y: std(y) * SPACING_MM,
  };
}

function _emptyCOPTimeSeries() {
  return {
    time_series: null, time_points: [], velocity_series: [],
    path_length: 0, contact_area: 0, ls_ratio: 0, eccentricity: 0,
    delta_x: 0, delta_y: 0, major_axis: 0, minor_axis: 0,
    max_displacement: 0, min_displacement: 0, avg_velocity: 0,
    rms_displacement: 0, std_x: 0, std_y: 0,
  };
}

/**
 * 凸包面积 (Graham扫描 + Shoelace公式)
 */
function convexHullArea(points) {
  if (points.length < 3) return 0;

  // Graham扫描
  const pts = points.map(p => [...p]);
  // 找最低点
  let lowest = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] < pts[lowest][1] || (pts[i][1] === pts[lowest][1] && pts[i][0] < pts[lowest][0])) {
      lowest = i;
    }
  }
  [pts[0], pts[lowest]] = [pts[lowest], pts[0]];
  const pivot = pts[0];

  pts.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0]);
    const angleB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0]);
    if (Math.abs(angleA - angleB) < 1e-10) {
      const distA = (a[0] - pivot[0]) ** 2 + (a[1] - pivot[1]) ** 2;
      const distB = (b[0] - pivot[0]) ** 2 + (b[1] - pivot[1]) ** 2;
      return distA - distB;
    }
    return angleA - angleB;
  });

  const stack = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      const second = stack[stack.length - 2];
      const cross = (top[0] - second[0]) * (pts[i][1] - second[1]) -
                    (top[1] - second[1]) * (pts[i][0] - second[0]);
      if (cross <= 0) stack.pop();
      else break;
    }
    stack.push(pts[i]);
  }

  // Shoelace公式
  let area = 0;
  const hull = stack;
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    area += hull[i][0] * hull[j][1];
    area -= hull[j][0] * hull[i][1];
  }
  return Math.abs(area) / 2;
}

// ============================================================
// 8. 辅助计算
// ============================================================

/**
 * 计算合并区域面积
 */
function calculateMergedRegionAreas(sectionCoords, spacingMm = SPACING_MM) {
  const qianzu = sectionCoords[0].length + sectionCoords[1].length;
  const zhongzu = sectionCoords[2].length;
  const houzu = sectionCoords[3].length;
  const counts = [qianzu, zhongzu, houzu];
  const areaPerPoint = spacingMm * spacingMm;
  const areaMm2 = counts.map(c => c * areaPerPoint);
  const areaCm2 = areaMm2.map(a => a / 100);
  const totalMm2 = areaMm2.reduce((a, b) => a + b, 0);

  return {
    region_names: ['前足', '中足', '后足'],
    counts,
    area_mm2: areaMm2,
    area_cm2: areaCm2,
    total_area_mm2: totalMm2,
    total_area_cm2: totalMm2 / 100,
    percent: areaMm2.map(a => totalMm2 > 0 ? a / totalMm2 : 0),
  };
}

/**
 * 计算COP位置
 */
function calculateCOP(matrix, offsetY = 0) {
  let totalP = 0;
  const rows = matrix.length, cols = matrix[0].length;
  let sumX = 0, sumY = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      totalP += matrix[r][c];
      sumX += r * matrix[r][c];
      sumY += (c + offsetY) * matrix[r][c];
    }
  }
  if (totalP <= 0) return null;
  return [sumX / totalP, sumY / totalP];
}

/**
 * 计算左右脚中心和距离
 */
function calculateFeetCentersAndDistances(processedData, leftCurve, rightCurve) {
  const totalPoints = leftCurve.map((l, i) => l + rightCurve[i]);
  const frameIndex = totalPoints.indexOf(Math.max(...totalPoints));
  const mat = reshape2D(processedData[frameIndex], 64, 64);

  const leftMatrix = mat.map(row => row.slice(0, 32));
  const rightMatrix = mat.map(row => row.slice(32));

  const leftCop = calculateCOP(leftMatrix, 0);
  const rightCop = calculateCOP(rightMatrix, 32);
  const bothCop = calculateCOP(mat, 0);

  const eucDist = (p1, p2) => {
    if (!p1 || !p2) return null;
    return Math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2);
  };

  const distLeft = eucDist(leftCop, bothCop);
  const distRight = eucDist(rightCop, bothCop);
  const leftForward = leftCop && rightCop ? leftCop[0] - rightCop[0] : null;

  return {
    frame_index: frameIndex,
    left_cop: leftCop,
    right_cop: rightCop,
    both_cop: bothCop,
    left_forward: leftForward !== null ? leftForward * SPACING_CM : null,
    dist_left_to_both: distLeft !== null ? distLeft * SPACING_CM : null,
    dist_right_to_both: distRight !== null ? distRight * SPACING_CM : null,
  };
}

/**
 * 计算区域压力分布
 */
function calculateRegionPressures(sectionCoords, matrix) {
  const regionPressures = sectionCoords.map(section =>
    section.reduce((sum, [x, y]) => sum + (matrix[x]?.[y] || 0), 0)
  );
  const total = regionPressures.reduce((a, b) => a + b, 0);
  const qianzu = regionPressures[0] + regionPressures[1];
  const zhongzu = regionPressures[2];
  const houzu = regionPressures[3];

  if (total === 0) return { '前足': 0, '中足': 0, '后足': 0 };
  return {
    '前足': qianzu / total,
    '中足': zhongzu / total,
    '后足': houzu / total,
  };
}

// ============================================================
// 9. 主入口函数
// ============================================================

/**
 * 生成站立评估报告 (总入口)
 * @param {number[][]} dataArray - [N, 4096] 足底压力数据
 * @param {number} fps - 采样率
 * @param {number} thresholdRatio - COP计算阈值比例
 * @returns {object} 完整分析结果
 */
function generateStandingReport(dataArray, fps = 42, thresholdRatio = 0.8) {
  // 1. 预处理
  const processedData = preprocessOriginData(dataArray, {
    rotate90ccw: true,
    mirroredHorizon: true,
    mirroredVertical: true,
    applyDenoise: true,
    smallCompMinSize: 3,
    smallCompConnectivity: 4,
    margin: 0,
    multiComponentMode: true,
    multiComponentTopN: 3,
    multiComponentMinSize: 10,
  });

  // 2. 压力曲线
  const { left: leftCurve, right: rightCurve } = extractPressureCurves(dataArray);

  // 3. COP轨迹
  // 注意: 使用预处理后的数据（与Python一致，preprocess_data_array）
  const processedForCOP = preprocessOriginData(dataArray, {
    rotate90ccw: true,
    mirroredHorizon: true,
    mirroredVertical: false,
    applyDenoise: false,
  });
  const { leftCop, rightCop } = calculateCOPTrajectories(processedForCOP, leftCurve, rightCurve, thresholdRatio);

  // 4. 足弓特征
  const archResults = calculateCompleteArchFeatures(dataArray, leftCurve, rightCurve);
  if (!archResults) return null;

  const peakIndex = archResults.peak_frame_index || 0;
  const peakFrameData = archResults.peak_frame_data;

  // 5. COP统计与摇摆
  const leftCopMetrics = calculateCOPMetrics(leftCop);
  const rightCopMetrics = calculateCOPMetrics(rightCop);
  const leftSwayFeatures = calculateSwayFeatures(leftCop, fps);
  const rightSwayFeatures = calculateSwayFeatures(rightCop, fps);

  // 6. 面积与压力
  const leftSectionCoords = archResults.left_foot.section_coords;
  const rightSectionCoords = archResults.right_foot.section_coords;

  const leftAreaInfo = calculateMergedRegionAreas(leftSectionCoords);
  const rightAreaInfo = calculateMergedRegionAreas(rightSectionCoords);

  const copResults = calculateFeetCentersAndDistances(processedForCOP, leftCurve, rightCurve);

  // 尺寸
  const leftMaxArea = archResults.left_foot.max_area;
  const rightMaxArea = archResults.right_foot.max_area;

  const leftXCoords = leftMaxArea.map(p => p[0]);
  const leftYCoords = leftMaxArea.map(p => p[1]);
  const leftLength = (Math.max(...leftXCoords) - Math.min(...leftXCoords) + 1) * 1.4 + 1.5;
  const leftWidth = (Math.max(...leftYCoords) - Math.min(...leftYCoords) + 1) * 1.4 + 1.5;

  const rightXCoords = rightMaxArea.map(p => p[0]);
  const rightYCoords = rightMaxArea.map(p => p[1]);
  const rightLength = (Math.max(...rightXCoords) - Math.min(...rightXCoords) + 1) * 1.4 + 1.5;
  const rightWidth = (Math.max(...rightYCoords) - Math.min(...rightYCoords) + 1) * 1.4 + 1.5;

  // 压力分布
  const matrix = reshape2D(peakFrameData, 64, 64);
  const leftPressure = calculateRegionPressures(leftSectionCoords, matrix);
  const rightPressure = calculateRegionPressures(rightSectionCoords, matrix);

  const additionalData = {
    left_length: leftLength,
    right_length: rightLength,
    left_width: leftWidth,
    right_width: rightWidth,
    left_area: leftAreaInfo,
    right_area: rightAreaInfo,
    left_pressure: leftPressure,
    right_pressure: rightPressure,
    cop_results: copResults,
  };

  return {
    left_cop_metrics: leftCopMetrics,
    right_cop_metrics: rightCopMetrics,
    left_sway_features: leftSwayFeatures,
    right_sway_features: rightSwayFeatures,
    arch_features: archResults,
    additional_data: additionalData,
    cop_time_series: calculateCOPTimeSeries(leftCop, rightCop, additionalData),
  };
}

module.exports = {
  generateStandingReport,
  // 导出子函数供单独调用
  preprocessOriginData,
  extractPressureCurves,
  calculateCOPTrajectories,
  calculateCompleteArchFeatures,
  calculateCOPMetrics,
  calculateSwayFeatures,
  calculateCOPTimeSeries,
  calculateMergedRegionAreas,
  calculateRegionPressures,
  calculateFeetCentersAndDistances,
  sampleEntropy,
};
