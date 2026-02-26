/**
 * mockFootprintData.js - 步道足底压力假数据生成器
 * 
 * 生成逼真的足底压力数据，模拟行人在步道上行走。
 * 包含完整的足底解剖结构：脚跟、足弓、跖骨头、脚趾。
 * 
 * @example
 * import { generateWalkwayData, generateAnimatedWalkwayData } from './mockFootprintData';
 * 
 * // 静态足印
 * const data = generateWalkwayData();
 * // data.sensor1, data.sensor2, data.sensor3, data.sensor4
 * 
 * // 动态步态动画
 * let frame = 0;
 * setInterval(() => {
 *   const data = generateAnimatedWalkwayData(frame++, 120);
 *   scene.updateAllSensorData(data);
 * }, 33);
 */

const SIZE = 64;

function gaussianBlob(matrix, cx, cy, sigmaX, sigmaY, intensity, angle = 0) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const r = Math.ceil(Math.max(sigmaX, sigmaY) * 3);
  const minR = Math.max(0, Math.floor(cy - r));
  const maxR = Math.min(SIZE - 1, Math.ceil(cy + r));
  const minC = Math.max(0, Math.floor(cx - r));
  const maxC = Math.min(SIZE - 1, Math.ceil(cx + r));

  for (let row = minR; row <= maxR; row++) {
    for (let col = minC; col <= maxC; col++) {
      const dx = col - cx;
      const dy = row - cy;
      const rx = dx * cosA + dy * sinA;
      const ry = -dx * sinA + dy * cosA;
      const exponent = (rx * rx) / (2 * sigmaX * sigmaX) + (ry * ry) / (2 * sigmaY * sigmaY);
      const val = intensity * Math.exp(-exponent);
      matrix[row][col] = Math.min(255, matrix[row][col] + val);
    }
  }
}

function generateFootprint(cx, cy, isLeftFoot, footAngle, pressureMultiplier = 1.0) {
  const matrix = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  const cosA = Math.cos(footAngle);
  const sinA = Math.sin(footAngle);
  const mirror = isLeftFoot ? -1 : 1;

  const tx = (lx, ly) => {
    const mlx = lx * mirror;
    return [cx + mlx * cosA - ly * sinA, cy + mlx * sinA + ly * cosA];
  };

  // 脚跟
  const [heelX, heelY] = tx(0, 10);
  gaussianBlob(matrix, heelX, heelY, 6.5, 7.5, 180 * pressureMultiplier, footAngle);
  const [heelInX, heelInY] = tx(-2, 10);
  gaussianBlob(matrix, heelInX, heelInY, 4, 5, 60 * pressureMultiplier, footAngle);

  // 足弓
  const [archX, archY] = tx(2 * mirror, 22);
  gaussianBlob(matrix, archX, archY, 3, 6, 25 * pressureMultiplier, footAngle);
  const [latArchX, latArchY] = tx(5, 20);
  gaussianBlob(matrix, latArchX, latArchY, 3, 5, 45 * pressureMultiplier, footAngle);

  // 跖骨头
  const [met1X, met1Y] = tx(-6, 38);
  gaussianBlob(matrix, met1X, met1Y, 4.5, 4, 200 * pressureMultiplier, footAngle);
  const [met2X, met2Y] = tx(-2, 40);
  gaussianBlob(matrix, met2X, met2Y, 3.5, 3.5, 160 * pressureMultiplier, footAngle);
  const [met3X, met3Y] = tx(2, 40);
  gaussianBlob(matrix, met3X, met3Y, 3.5, 3.5, 140 * pressureMultiplier, footAngle);
  const [met4X, met4Y] = tx(5, 39);
  gaussianBlob(matrix, met4X, met4Y, 3, 3, 110 * pressureMultiplier, footAngle);
  const [met5X, met5Y] = tx(8, 37);
  gaussianBlob(matrix, met5X, met5Y, 3, 3, 80 * pressureMultiplier, footAngle);

  // 脚趾
  const [toe1X, toe1Y] = tx(-7, 48);
  gaussianBlob(matrix, toe1X, toe1Y, 3, 4, 130 * pressureMultiplier, footAngle);
  const [toe2X, toe2Y] = tx(-3, 50);
  gaussianBlob(matrix, toe2X, toe2Y, 2, 3, 70 * pressureMultiplier, footAngle);
  const [toe3X, toe3Y] = tx(1, 50);
  gaussianBlob(matrix, toe3X, toe3Y, 2, 2.5, 50 * pressureMultiplier, footAngle);
  const [toe4X, toe4Y] = tx(4, 49);
  gaussianBlob(matrix, toe4X, toe4Y, 1.8, 2, 35 * pressureMultiplier, footAngle);
  const [toe5X, toe5Y] = tx(7, 47);
  gaussianBlob(matrix, toe5X, toe5Y, 1.5, 2, 25 * pressureMultiplier, footAngle);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      matrix[r][c] = Math.min(255, Math.max(0, Math.round(matrix[r][c])));
    }
  }
  return matrix;
}

/**
 * 生成4个步道足印的静态数据
 * @returns {Object} { sensor1: number[][], sensor2: number[][], sensor3: number[][], sensor4: number[][] }
 */
export function generateWalkwayData() {
  return {
    sensor1: generateFootprint(32, 28, false, -0.08, 1.0),
    sensor2: generateFootprint(32, 30, true, 0.06, 0.95),
    sensor3: generateFootprint(33, 26, false, -0.1, 0.85),
    sensor4: generateFootprint(31, 32, true, 0.05, 0.75),
  };
}

/**
 * 生成动态步态循环数据
 * @param {number} frame - 当前帧号
 * @param {number} [totalFrames=120] - 一个完整步态周期的总帧数
 * @returns {Object} { sensor1: number[][], sensor2: number[][], sensor3: number[][], sensor4: number[][] }
 */
export function generateAnimatedWalkwayData(frame, totalFrames = 120) {
  const t = (frame % totalFrames) / totalFrames;
  const phases = [0, 0.25, 0.5, 0.75];
  const result = {};
  const keys = ['sensor1', 'sensor2', 'sensor3', 'sensor4'];

  keys.forEach((key, idx) => {
    const phase = (t + phases[idx]) % 1.0;
    const isLeft = idx % 2 === 1;

    if (phase >= 0.8) {
      result[key] = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    } else {
      let pressureMult, cy, angle;
      if (phase < 0.1) {
        pressureMult = 0.5 + phase * 5;
        cy = 24;
        angle = isLeft ? 0.08 : -0.08;
      } else if (phase < 0.4) {
        pressureMult = 1.0;
        cy = 28 + (phase - 0.1) * 10;
        angle = isLeft ? 0.06 : -0.06;
      } else if (phase < 0.6) {
        pressureMult = 0.95 - (phase - 0.4) * 0.3;
        cy = 31;
        angle = isLeft ? 0.05 : -0.1;
      } else {
        pressureMult = Math.max(0.1, 0.65 - (phase - 0.6) * 2.5);
        cy = 30;
        angle = isLeft ? 0.04 : -0.12;
      }
      result[key] = generateFootprint(32 + (isLeft ? -1 : 1), cy, isLeft, angle, pressureMult);
    }
  });

  return result;
}

export { generateFootprint };
