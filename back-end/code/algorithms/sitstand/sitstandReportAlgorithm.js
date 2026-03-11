/**
 * 起坐评估算法模块 (JS版)
 * 迁移自 Python: sit_stand_render_data.py + generate_sit_stand_pdf_v3.py
 *
 * 输入: 脚垫数据 [N, 4096] + 坐垫数据 [M, 1024]
 * 输出: 结构化报告数据 (周期统计、力曲线、COP轨迹)
 */

const {
  mean, std, sum, argmax, findPeaks,
  reshape2D, calcCOP, downsampleIndices,
  removeSmallComponents,
} = require('../shared/mathUtils');

// ============================================================
// 常量
// ============================================================

const STAND_FPS = 12.5;  // 脚垫采样率
const SIT_FPS = 12.5;    // 坐垫采样率
const STAND_DT = 1.0 / STAND_FPS;
const SIT_DT = 1.0 / SIT_FPS;

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 确保帧数据为指定长度
 */
function padFrame(frame, targetLen) {
  if (!frame) return new Array(targetLen).fill(0);
  if (frame.length >= targetLen) return frame.slice(0, targetLen);
  const padded = new Array(targetLen).fill(0);
  for (let i = 0; i < frame.length; i++) padded[i] = frame[i];
  return padded;
}

/**
 * 计算总力序列 (ADC 原始值求和，用于峰值检测)
 */
function computeForceSeries(frames, frameSize) {
  const n = frames.length;
  const force = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const f = frames[i];
    const len = Math.min(f.length, frameSize);
    for (let j = 0; j < len; j++) s += f[j];
    force[i] = s;
  }
  return Array.from(force);
}

/**
 * 足底 ADC→牛顿 转换 (逐像素)
 * 规则: ADC < 150 → ADC / 12.7 N; ADC >= 150 → 12.0 N; ADC == 0 → 0
 */
function computeForceNewtonFoot(frames, frameSize) {
  const n = frames.length;
  const force = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const f = frames[i];
    const len = Math.min(f.length, frameSize);
    for (let j = 0; j < len; j++) {
      const v = f[j];
      if (v > 0) s += v < 150 ? v / 12.7 : 12.0;
    }
    force[i] = s;
  }
  return Array.from(force);
}

/**
 * 坐垫 ADC→牛顿 转换
 * 规则: ADC总和 / 26.18 = 牛顿
 */
function computeForceNewtonSit(frames, frameSize) {
  const n = frames.length;
  const force = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const f = frames[i];
    const len = Math.min(f.length, frameSize);
    for (let j = 0; j < len; j++) s += f[j];
    force[i] = s / 26.18;
  }
  return Array.from(force);
}

/**
 * 峰值检测 (起坐周期)
 */
function detectCyclePeaks(forceSeries) {
  if (forceSeries.length < 3) return [];

  const m = mean(forceSeries);
  const s = std(forceSeries);
  const threshold = m + 0.5 * s;

  const peaks = [];
  for (let i = 1; i < forceSeries.length - 1; i++) {
    if (forceSeries[i] >= threshold &&
        forceSeries[i] >= forceSeries[i - 1] &&
        forceSeries[i] >= forceSeries[i + 1]) {
      // 确保与上一个峰值有足够间距 (至少10帧)
      if (peaks.length === 0 || (i - peaks[peaks.length - 1]) >= 10) {
        peaks.push(i);
      } else if (forceSeries[i] > forceSeries[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
    }
  }
  return peaks;
}

/**
 * 计算COP轨迹
 * @param {number[][]} frames - 帧数据数组
 * @param {number} rows - 矩阵行数
 * @param {number} cols - 矩阵列数
 * @returns {number[][]} COP轨迹 [[x, y], ...]
 */
function computeCOPTrajectory(frames, rows, cols) {
  const trajectory = [];
  for (let i = 0; i < frames.length; i++) {
    const mat = reshape2D(padFrame(frames[i], rows * cols), rows, cols);
    const cop = calcCOP(mat);
    if (cop) {
      trajectory.push(cop);
    }
  }
  return trajectory;
}

/**
 * 左右脚分割 (简单方法：按矩阵左右半分)
 */
function splitLeftRight(mat64) {
  const leftCop = { sumX: 0, sumY: 0, total: 0 };
  const rightCop = { sumX: 0, sumY: 0, total: 0 };

  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 32; c++) {
      const v = mat64[r][c];
      leftCop.total += v;
      leftCop.sumX += c * v;
      leftCop.sumY += r * v;
    }
    for (let c = 32; c < 64; c++) {
      const v = mat64[r][c];
      rightCop.total += v;
      rightCop.sumX += c * v;
      rightCop.sumY += r * v;
    }
  }

  const left = leftCop.total > 10
    ? [leftCop.sumX / leftCop.total, leftCop.sumY / leftCop.total]
    : null;
  const right = rightCop.total > 10
    ? [rightCop.sumX / rightCop.total, rightCop.sumY / rightCop.total]
    : null;

  return { left, right };
}

/**
 * 生成演变热力图数据 (替代matplotlib base64图片)
 * 返回关键帧的压力矩阵，前端用Canvas/ECharts渲染
 */
function generateEvolutionData(frames, rows, cols, numSamples = 11) {
  const n = frames.length;
  if (n === 0) return [];

  const indices = downsampleIndices(n, numSamples);
  return indices.map((idx, i) => {
    const mat = reshape2D(padFrame(frames[idx], rows * cols), rows, cols);
    return {
      label: i,
      progress: Math.round((i / (numSamples - 1)) * 100),
      matrix: mat,
      frameIndex: idx,
    };
  });
}

// ============================================================
// 主入口：生成起坐报告
// ============================================================

/**
 * 生成起坐评估报告数据
 * @param {number[][]} standData - 脚垫压力数据 [N, 4096]
 * @param {number[][]} sitData - 坐垫压力数据 [M, 1024]
 * @param {string} username - 用户名
 * @returns {object} 报告数据
 */
function generateSitStandReport(standData, sitData, username = '用户') {
  // 数据验证和填充
  const standFrames = (standData || []).map(f => padFrame(f, 4096));
  const sitFrames = (sitData || []).map(f => padFrame(f, 1024));

  const nStand = standFrames.length;
  const nSit = sitFrames.length;

  // 空数据保护
  if (nStand === 0 && nSit === 0) {
    return _emptyReport(username);
  }

  // ---- 1. 力-时间序列 ----
  const standForce = computeForceSeries(standFrames, 4096);  // ADC用于峰值检测
  const sitForce = computeForceSeries(sitFrames, 1024);      // ADC用于峰值检测
  // 牛顿值用于显示
  const standForceN = computeForceNewtonFoot(standFrames, 4096);
  const sitForceN = computeForceNewtonSit(sitFrames, 1024);

  const standTimes = standForce.map((_, i) => Math.round(i * STAND_DT * 1000) / 1000);
  const sitTimes = sitForce.map((_, i) => Math.round(i * SIT_DT * 1000) / 1000);

  // ---- 2. 峰值检测 (起坐周期) ----
  const peaksIdx = detectCyclePeaks(standForce);
  // 用户坐着开始、坐着结束，一个完整周期 = 站-坐-站（峰到峰）
  // N个站立峰 → N-1个周期
  const numCycles = Math.max(0, peaksIdx.length - 1);

  // ---- 3. 周期统计（峰到峰） ----
  const totalDuration = peaksIdx.length >= 2
    ? Math.round((standTimes[peaksIdx[peaksIdx.length - 1]] - standTimes[peaksIdx[0]]) * 100) / 100
    : 0;
  const avgDuration = numCycles > 0
    ? Math.round((totalDuration / numCycles) * 100) / 100
    : 0;

  // ---- 4. COP轨迹 ----
  const standCopTrajectory = computeCOPTrajectory(standFrames, 64, 64);
  const sitCopTrajectory = computeCOPTrajectory(sitFrames, 32, 32);

  // 站立COP分左右脚
  const leftCopTrajectory = [];
  const rightCopTrajectory = [];
  for (let i = 0; i < standFrames.length; i++) {
    const mat = reshape2D(standFrames[i], 64, 64);
    const { left, right } = splitLeftRight(mat);
    if (left) leftCopTrajectory.push(left);
    if (right) rightCopTrajectory.push(right);
  }

  // ---- 5. 演变热力图数据 ----
  const standEvolution = generateEvolutionData(standFrames, 64, 64, 11);
  const sitEvolution = generateEvolutionData(sitFrames, 32, 32, 11);

  // ---- 6. 降采样力曲线 ----
  const standSampleIdx = downsampleIndices(nStand, 300);
  const sitSampleIdx = downsampleIndices(nSit, 300);

  // ---- 6.5 各周期时长和峰值力（峰到峰，N-1个） ----
  const cycleDurations = [];
  const cyclePeakForces = [];
  if (peaksIdx.length >= 2) {
    for (let i = 0; i < peaksIdx.length - 1; i++) {
      // 周期时长 = 从当前峰到下一个峰
      const dur = standTimes[peaksIdx[i + 1]] - standTimes[peaksIdx[i]];
      cycleDurations.push(Math.round(dur * 100) / 100);
      // 周期内最大力值
      let maxForce = 0;
      for (let j = peaksIdx[i]; j <= peaksIdx[i + 1]; j++) {
        if (standForceN[j] > maxForce) maxForce = standForceN[j];
      }
      cyclePeakForces.push(Math.round(maxForce * 10) / 10);
    }
  }

  // ---- 7. 组装结果 ----
  return {
    duration_stats: {
      total_duration: totalDuration,
      num_cycles: numCycles,
      avg_duration: avgDuration,
      cycle_durations: cycleDurations,
    },
    stand_frames: nStand,
    sit_frames: nSit,
    stand_peaks: numCycles,
    username: username,
    // 演变数据 (前端用Canvas渲染，替代Python的base64图片)
    evolution: {
      stand: standEvolution,
      sit: sitEvolution,
    },
    // COP轨迹数据 (前端用Canvas/ECharts渲染)
    cop: {
      stand_full: downsampleIndices(standCopTrajectory.length, 200).map(i => standCopTrajectory[i]),
      stand_left: downsampleIndices(leftCopTrajectory.length, 200).map(i => leftCopTrajectory[i]),
      stand_right: downsampleIndices(rightCopTrajectory.length, 200).map(i => rightCopTrajectory[i]),
      sit: downsampleIndices(sitCopTrajectory.length, 200).map(i => sitCopTrajectory[i]),
    },
    // 力曲线数据
    force_curves: {
      stand_times: standSampleIdx.map(i => standTimes[i]),
      stand_force: standSampleIdx.map(i => standForceN[i]),
      sit_times: sitSampleIdx.map(i => sitTimes[i]),
      sit_force: sitSampleIdx.map(i => sitForceN[i]),
      stand_peaks_idx: peaksIdx,
      // 峰值对应的时间点 (方便前端标注)
      stand_peaks_times: peaksIdx.map(i => standTimes[i]),
    },
    cycle_peak_forces: cyclePeakForces,
  };
}

/**
 * 空报告模板
 */
function _emptyReport(username) {
  return {
    duration_stats: { total_duration: 0, num_cycles: 0, avg_duration: 0 },
    stand_frames: 0,
    sit_frames: 0,
    stand_peaks: 0,
    username: username,
    evolution: { stand: [], sit: [] },
    cop: { stand_full: [], stand_left: [], stand_right: [], sit: [] },
    force_curves: {
      stand_times: [], stand_force: [],
      sit_times: [], sit_force: [],
      stand_peaks_idx: [], stand_peaks_times: [],
    },
  };
}

// ============================================================
// 拆分方法 (对应前端各渲染区域)
// ============================================================

function getDurationStats(result) {
  return {
    total_duration: result.duration_stats.total_duration,
    num_cycles: result.duration_stats.num_cycles,
    avg_duration: result.duration_stats.avg_duration,
    stand_frames: result.stand_frames,
    sit_frames: result.sit_frames,
    stand_peaks: result.stand_peaks,
    username: result.username,
  };
}

function getStandEvolution(result) {
  return result.evolution?.stand || [];
}

function getSitEvolution(result) {
  return result.evolution?.sit || [];
}

function getCOPData(result) {
  return result.cop || {};
}

function getForceCurveData(result) {
  return result.force_curves || {};
}

module.exports = {
  generateSitStandReport,
  getDurationStats,
  getStandEvolution,
  getSitEvolution,
  getCOPData,
  getForceCurveData,
};
