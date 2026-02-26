/**
 * 足底压力分析算法库
 * 基于汇盛 SDK 实现的前端版本
 * 包含：足弓分析、压力分布、COP分析等核心功能
 */

const PITCH_MM = 7.0;
const GRID_SIZE = 64;
const NOISE_THRESHOLD = 3;

// ==================== 工具函数 ====================

function rot90(matrix) {
  const n = matrix.length;
  const result = Array(n).fill(null).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[n - 1 - j][i] = matrix[i][j];
    }
  }
  return result;
}

function flipLR(matrix) {
  return matrix.map(row => [...row].reverse());
}

function flipUD(matrix) {
  return [...matrix].reverse();
}

export function parseFrameData(data) {
  if (data.length !== 4096) {
    return Array(64).fill(null).map(() => Array(64).fill(0));
  }
  const matrix = [];
  for (let i = 0; i < 64; i++) {
    matrix.push(data.slice(i * 64, (i + 1) * 64));
  }
  // 1) 逆时针旋转90度
  const rotated = rot90(matrix);
  // 2) 水平镜像
  const mirrored = flipLR(rotated);
  // 3) 垂直镜像（与Python mirrored_vertical=True 一致）
  const flipped = flipUD(mirrored);
  // 4) 去噪
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 64; j++) {
      if (flipped[i][j] <= NOISE_THRESHOLD) {
        flipped[i][j] = 0;
      }
    }
  }
  return flipped;
}

export function splitLeftRight(matrix) {
  const left = matrix.map(row => row.slice(0, 32).concat(Array(32).fill(0)));
  const right = matrix.map(row => Array(32).fill(0).concat(row.slice(32)));
  return { left, right };
}

export function calculateCOP(matrix, offsetY = 0) {
  let totalPressure = 0, sumX = 0, sumY = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      const p = matrix[i][j];
      if (p > 0) {
        totalPressure += p;
        sumX += i * p;
        sumY += (j + offsetY) * p;
      }
    }
  }
  if (totalPressure <= 0) return null;
  return { x: sumX / totalPressure, y: sumY / totalPressure };
}

export function getValidCoords(matrix) {
  const coords = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (matrix[i][j] > 0) coords.push([i, j]);
    }
  }
  return coords;
}

export function calculateTotalPressure(matrix) {
  let total = 0;
  for (const row of matrix) {
    for (const val of row) {
      if (val > 0) total += val;
    }
  }
  return total;
}

export function calculateContactArea(matrix) {
  let count = 0;
  for (const row of matrix) {
    for (const val of row) {
      if (val > 0) count++;
    }
  }
  return count * (PITCH_MM * PITCH_MM) / 100;
}

// ==================== 足弓分析 ====================

export function divideXRegions(coords) {
  if (coords.length === 0) return [[], [], [], []];
  const xValues = coords.map(c => c[0]);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const totalRange = xMax - xMin;
  if (totalRange <= 0) return [[], [], [], []];

  const ratios = [3, 4, 4, 4];
  const totalRatio = ratios.reduce((a, b) => a + b, 0);
  const boundaries = [xMin];
  let current = xMin;
  for (const ratio of ratios) {
    current += (ratio / totalRatio) * totalRange;
    boundaries.push(current);
  }

  const sections = [[], [], [], []];
  for (const coord of coords) {
    const x = coord[0];
    for (let i = 0; i < 4; i++) {
      if (x >= boundaries[i] && (x < boundaries[i + 1] || (i === 3 && x <= boundaries[i + 1]))) {
        sections[i].push(coord);
        break;
      }
    }
  }
  return sections;
}

export function calculateArchIndex(sections) {
  const forefoot = sections[0].length + sections[1].length;
  const midfoot = sections[2].length;
  const hindfoot = sections[3].length;
  const total = forefoot + midfoot + hindfoot;
  if (total === 0) return { index: 0, type: '无数据' };

  const archIndex = midfoot / total;
  let archType;
  if (archIndex < 0.20) archType = '高足弓';
  else if (archIndex < 0.21) archType = '正常偏高';
  else if (archIndex <= 0.26) archType = '正常足弓';
  else if (archIndex <= 0.27) archType = '正常偏扁';
  else archType = '扁平足';

  return { index: archIndex, type: archType };
}

function calculate2DAngle(A, B, C) {
  const caX = A[0] - C[0], caY = A[1] - C[1];
  const cbX = B[0] - C[0], cbY = B[1] - C[1];
  const dot = caX * cbX + caY * cbY;
  const lenCA = Math.sqrt(caX * caX + caY * caY);
  const lenCB = Math.sqrt(cbX * cbX + cbY * cbY);
  if (lenCA === 0 || lenCB === 0) return 0;
  const cosTheta = Math.max(-1, Math.min(1, dot / (lenCA * lenCB)));
  return Math.acos(cosTheta) * (180 / Math.PI);
}

export function calculateClarkeAngle(sections, isRight) {
  const aRegion = sections[3], bRegion = sections[2], cRegion = sections[1];
  if (aRegion.length === 0 || bRegion.length === 0 || cRegion.length === 0) {
    return { angle: null, type: null };
  }
  try {
    const aXValues = aRegion.map(c => c[0]);
    const aXMedian = [...aXValues].sort((a, b) => a - b)[Math.floor(aXValues.length / 2)];
    const aCandidates = aRegion.filter(c => c[0] === aXMedian);
    const aPoint = isRight
      ? aCandidates.reduce((min, c) => c[1] < min[1] ? c : min, aCandidates[0])
      : aCandidates.reduce((max, c) => c[1] > max[1] ? c : max, aCandidates[0]);

    const bSorted = [...bRegion].sort((a, b) => a[0] - b[0]);
    const bPoint = isRight
      ? bSorted.reduce((min, c) => c[1] < min[1] ? c : min, bSorted[0])
      : bSorted.reduce((max, c) => c[1] > max[1] ? c : max, bSorted[0]);

    const cXValues = cRegion.map(c => c[0]);
    const cXMedian = [...cXValues].sort((a, b) => a - b)[Math.floor(cXValues.length / 2)];
    const cCandidates = cRegion.filter(c => c[0] === cXMedian);
    const cPoint = isRight
      ? cCandidates.reduce((min, c) => c[1] < min[1] ? c : min, cCandidates[0])
      : cCandidates.reduce((max, c) => c[1] > max[1] ? c : max, cCandidates[0]);

    const clarkeAngle = calculate2DAngle(aPoint, bPoint, cPoint);
    let clarkeType;
    if (clarkeAngle < 42) clarkeType = '扁平足';
    else if (clarkeAngle <= 48) clarkeType = '正常足';
    else clarkeType = '高弓足';
    return { angle: clarkeAngle, type: clarkeType };
  } catch {
    return { angle: null, type: null };
  }
}

export function calculateStaheliRatio(sections, isRight) {
  const aRegion = sections[3], bRegion = sections[2];
  if (aRegion.length === 0 || bRegion.length === 0) return null;
  try {
    const aYValues = aRegion.map(c => c[1]);
    const heelWidth = Math.max(...aYValues) - Math.min(...aYValues);
    const bYValues = bRegion.map(c => c[1]);
    const midWidth = Math.max(...bYValues) - Math.min(...bYValues);
    if (heelWidth === 0) return null;
    return midWidth / heelWidth;
  } catch {
    return null;
  }
}

// ==================== 压力分布分析 ====================

export function calculateRegionPressure(matrix, sections) {
  const areaPerPoint = (PITCH_MM * PITCH_MM) / 100;
  const forefootCount = sections[0].length + sections[1].length;
  const midfootCount = sections[2].length;
  const hindfootCount = sections[3].length;

  let forefootPressure = 0, midfootPressure = 0, hindfootPressure = 0;
  for (const coord of sections[0]) forefootPressure += matrix[coord[0]][coord[1]];
  for (const coord of sections[1]) forefootPressure += matrix[coord[0]][coord[1]];
  for (const coord of sections[2]) midfootPressure += matrix[coord[0]][coord[1]];
  for (const coord of sections[3]) hindfootPressure += matrix[coord[0]][coord[1]];

  const totalPressure = forefootPressure + midfootPressure + hindfootPressure;
  return {
    forefoot: { area: forefootCount * areaPerPoint, pressure: forefootPressure, percent: totalPressure > 0 ? (forefootPressure / totalPressure) * 100 : 0 },
    midfoot: { area: midfootCount * areaPerPoint, pressure: midfootPressure, percent: totalPressure > 0 ? (midfootPressure / totalPressure) * 100 : 0 },
    hindfoot: { area: hindfootCount * areaPerPoint, pressure: hindfootPressure, percent: totalPressure > 0 ? (hindfootPressure / totalPressure) * 100 : 0 }
  };
}

export function calculateFootDimensions(coords) {
  if (coords.length === 0) return { length: 0, width: 0 };
  const xValues = coords.map(c => c[0]);
  const yValues = coords.map(c => c[1]);
  return {
    length: (Math.max(...xValues) - Math.min(...xValues)) * PITCH_MM / 10,
    width: (Math.max(...yValues) - Math.min(...yValues)) * PITCH_MM / 10
  };
}

// ==================== COP分析 ====================

export function calculateCOPMetrics(trajectory, dt = 0.08) {
  if (trajectory.length < 3) return null;
  const x = trajectory.map(p => p.x * PITCH_MM);
  const y = trajectory.map(p => p.y * PITCH_MM);
  const n = trajectory.length;

  const centerX = x.reduce((a, b) => a + b, 0) / n;
  const centerY = y.reduce((a, b) => a + b, 0) / n;
  const rangeX = Math.max(...x) - Math.min(...x);
  const rangeY = Math.max(...y) - Math.min(...y);
  const stdX = Math.sqrt(x.reduce((sum, xi) => sum + Math.pow(xi - centerX, 2), 0) / n);
  const stdY = Math.sqrt(y.reduce((sum, yi) => sum + Math.pow(yi - centerY, 2), 0) / n);

  let pathLength = 0;
  for (let i = 1; i < n; i++) {
    pathLength += Math.sqrt(Math.pow(x[i] - x[i - 1], 2) + Math.pow(y[i] - y[i - 1], 2));
  }

  const velocities = [];
  for (let i = 1; i < n; i++) {
    const dist = Math.sqrt(Math.pow(x[i] - x[i - 1], 2) + Math.pow(y[i] - y[i - 1], 2));
    velocities.push(dist / dt);
  }
  const avgVelocity = velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : 0;
  const rmsVelocity = velocities.length > 0 ? Math.sqrt(velocities.reduce((sum, v) => sum + v * v, 0) / velocities.length) : 0;

  const displacements = trajectory.map(p =>
    Math.sqrt(Math.pow(p.x * PITCH_MM - centerX, 2) + Math.pow(p.y * PITCH_MM - centerY, 2))
  );
  const maxDisplacement = Math.max(...displacements);

  const centeredX = x.map(xi => xi - centerX);
  const centeredY = y.map(yi => yi - centerY);
  const covXX = centeredX.reduce((sum, xi) => sum + xi * xi, 0) / n;
  const covYY = centeredY.reduce((sum, yi) => sum + yi * yi, 0) / n;
  const covXY = centeredX.reduce((sum, xi, i) => sum + xi * centeredY[i], 0) / n;

  const trace = covXX + covYY;
  const det = covXX * covYY - covXY * covXY;
  const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det));
  const lambda1 = trace / 2 + discriminant;
  const lambda2 = trace / 2 - discriminant;

  const chiSquare = 5.991;
  const majorAxis = 2 * Math.sqrt(chiSquare * Math.max(lambda1, lambda2));
  const minorAxis = 2 * Math.sqrt(chiSquare * Math.min(lambda1, lambda2));
  const ellipseArea = Math.PI * majorAxis * minorAxis / 4;

  return { pathLength, ellipseArea, majorAxis, minorAxis, rangeX, rangeY, rmsVelocity, avgVelocity, maxDisplacement, stdX, stdY };
}

// ==================== 完整报告生成 ====================

export function generateFootReport(frames) {
  if (frames.length === 0) return null;

  let maxPressureFrame = 0, maxPressure = 0;
  const processedFrames = [];
  const copTrajectory = [];

  for (let i = 0; i < frames.length; i++) {
    const matrix = parseFrameData(frames[i]);
    processedFrames.push(matrix);
    const pressure = calculateTotalPressure(matrix);
    if (pressure > maxPressure) {
      maxPressure = pressure;
      maxPressureFrame = i;
    }
    const cop = calculateCOP(matrix);
    if (cop) copTrajectory.push(cop);
  }

  const mainMatrix = processedFrames[maxPressureFrame];
  const { left: leftMatrix, right: rightMatrix } = splitLeftRight(mainMatrix);

  // 左脚分析
  const leftCoords = getValidCoords(leftMatrix);
  const leftSections = divideXRegions(leftCoords);
  const leftArchResult = calculateArchIndex(leftSections);
  const leftClarke = calculateClarkeAngle(leftSections, false);
  const leftStaheli = calculateStaheliRatio(leftSections, false);
  const leftRegionPressure = calculateRegionPressure(leftMatrix, leftSections);
  const leftDimensions = calculateFootDimensions(leftCoords);

  // 右脚分析
  const rightCoords = getValidCoords(rightMatrix);
  const rightSections = divideXRegions(rightCoords);
  const rightArchResult = calculateArchIndex(rightSections);
  const rightClarke = calculateClarkeAngle(rightSections, true);
  const rightStaheli = calculateStaheliRatio(rightSections, true);
  const rightRegionPressure = calculateRegionPressure(rightMatrix, rightSections);
  const rightDimensions = calculateFootDimensions(rightCoords);

  const leftPressure = calculateTotalPressure(leftMatrix);
  const rightPressure = calculateTotalPressure(rightMatrix);
  const totalPressure = leftPressure + rightPressure;

  const copMetrics = calculateCOPMetrics(copTrajectory);

  // 计算分脚COP轨迹
  const leftCopTrajectory = [];
  const rightCopTrajectory = [];
  for (let i = 0; i < processedFrames.length; i++) {
    const { left: lm, right: rm } = splitLeftRight(processedFrames[i]);
    const lCop = calculateCOP(lm);
    const rCop = calculateCOP(rm, 32);
    if (lCop) leftCopTrajectory.push([lCop.x, lCop.y]);
    if (rCop) rightCopTrajectory.push([rCop.x, rCop.y]);
  }

  // 峰值帧平铺数据（用于COP热力图底图）
  const peakFrameFlat = frames[maxPressureFrame] ? [...frames[maxPressureFrame]] : [];

  return {
    left: {
      footData: { matrix: leftMatrix, coords: leftCoords, pressure: leftPressure, area: calculateContactArea(leftMatrix), cop: calculateCOP(leftMatrix) },
      archAnalysis: { archIndex: leftArchResult.index, archType: leftArchResult.type, clarkeAngle: leftClarke.angle, clarkeType: leftClarke.type, staheliRatio: leftStaheli },
      regionPressure: leftRegionPressure,
      sectionCoords: leftSections,
      length: leftDimensions.length,
      width: leftDimensions.width
    },
    right: {
      footData: { matrix: rightMatrix, coords: rightCoords, pressure: rightPressure, area: calculateContactArea(rightMatrix), cop: calculateCOP(rightMatrix) },
      archAnalysis: { archIndex: rightArchResult.index, archType: rightArchResult.type, clarkeAngle: rightClarke.angle, clarkeType: rightClarke.type, staheliRatio: rightStaheli },
      regionPressure: rightRegionPressure,
      sectionCoords: rightSections,
      length: rightDimensions.length,
      width: rightDimensions.width
    },
    bilateral: {
      leftPressureRatio: totalPressure > 0 ? (leftPressure / totalPressure) * 100 : 50,
      rightPressureRatio: totalPressure > 0 ? (rightPressure / totalPressure) * 100 : 50,
      forefootRatio: 1,
      copMetrics,
      copTrajectory,
      leftCopTrajectory,
      rightCopTrajectory,
      peakFrameFlat
    }
  };
}

// ==================== 实时处理 ====================

export function processFrameRealtime(currentData, prevData = null, fps = 20) {
  const currentMatrix = parseFrameData(currentData);
  const prevMatrix = prevData ? parseFrameData(prevData) : null;
  const { left: leftMatrix, right: rightMatrix } = splitLeftRight(currentMatrix);

  const leftCOP = calculateCOP(leftMatrix);
  const rightCOP = calculateCOP(rightMatrix, 32);
  const totalCOP = calculateCOP(currentMatrix);

  let leftSpeed = 0, rightSpeed = 0;
  if (prevMatrix) {
    const { left: prevLeftMatrix, right: prevRightMatrix } = splitLeftRight(prevMatrix);
    const prevLeftCOP = calculateCOP(prevLeftMatrix);
    const prevRightCOP = calculateCOP(prevRightMatrix, 32);
    if (leftCOP && prevLeftCOP) {
      leftSpeed = Math.sqrt(Math.pow((leftCOP.x - prevLeftCOP.x) * PITCH_MM, 2) + Math.pow((leftCOP.y - prevLeftCOP.y) * PITCH_MM, 2)) * fps;
    }
    if (rightCOP && prevRightCOP) {
      rightSpeed = Math.sqrt(Math.pow((rightCOP.x - prevRightCOP.x) * PITCH_MM, 2) + Math.pow((rightCOP.y - prevRightCOP.y) * PITCH_MM, 2)) * fps;
    }
  }

  return {
    left: { pressure: calculateTotalPressure(leftMatrix), area: calculateContactArea(leftMatrix), copSpeed: leftSpeed },
    right: { pressure: calculateTotalPressure(rightMatrix), area: calculateContactArea(rightMatrix), copSpeed: rightSpeed },
    total: { pressure: calculateTotalPressure(currentMatrix), area: calculateContactArea(currentMatrix) },
    cop: totalCOP
  };
}

// ==================== 热力图数据 ====================

export function generateHeatmapColors(matrix) {
  let maxVal = 0;
  for (const row of matrix) {
    for (const val of row) {
      if (val > maxVal) maxVal = val;
    }
  }
  if (maxVal === 0) maxVal = 1;

  const colorMap = (value) => {
    const t = Math.min(1, Math.max(0, value));
    if (t < 0.25) return [0, Math.round((t / 0.25) * 255), 255];
    if (t < 0.5) return [0, 255, Math.round((1 - (t - 0.25) / 0.25) * 255)];
    if (t < 0.75) return [Math.round(((t - 0.5) / 0.25) * 255), 255, 0];
    return [255, Math.round((1 - (t - 0.75) / 0.25) * 255), 0];
  };

  const result = [];
  for (let i = 0; i < matrix.length; i++) {
    const row = [];
    for (let j = 0; j < matrix[i].length; j++) {
      if (matrix[i][j] > 0) {
        row.push(colorMap(matrix[i][j] / maxVal));
      } else {
        row.push(null);
      }
    }
    result.push(row);
  }
  return result;
}
