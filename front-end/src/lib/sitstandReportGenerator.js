/**
 * 起坐评估报告数据生成器
 * 将采集的坐垫/脚垫压力数据转换为报告组件所需的结构化数据
 * 输出格式与后端 sit_stand_render_data.py 保持一致
 */

/**
 * 从采集的压力历史数据生成起坐评估报告
 *
 * @param {Array} seatPressureHistory - 坐垫压力历史 [number, ...]
 * @param {Array} footpadPressureHistory - 脚垫压力历史 [number, ...]
 * @param {Object} seatStats - 坐垫统计 { max, mean, totalPressure, contactArea }
 * @param {Object} footpadStats - 脚垫统计 { max, mean, totalPressure, contactArea }
 * @param {Object} seatCoP - 坐垫COP { x, y }
 * @param {Object} footpadCoP - 脚垫COP { x, y }
 * @param {number} timer - 采集时长（单位：0.1秒）
 * @returns {Object} 报告数据对象（与后端 generate_sit_stand_report 返回格式一致）
 */
export function generateSitStandReportData(
  seatPressureHistory = [],
  footpadPressureHistory = [],
  seatStats = null,
  footpadStats = null,
  seatCoP = null,
  footpadCoP = null,
  timer = 0
) {
  const totalDuration = timer / 10; // 转换为秒
  const interval = 0.1; // 100ms 采样间隔

  // ── 生成时间轴 ──
  const sitTimes = seatPressureHistory.map((_, i) => parseFloat((i * interval).toFixed(2)));
  const standTimes = footpadPressureHistory.map((_, i) => parseFloat((i * interval).toFixed(2)));
  const sitForce = seatPressureHistory.map(v => parseFloat(v.toFixed(1)));
  const standForce = footpadPressureHistory.map(v => parseFloat(v.toFixed(1)));

  // ── 峰值检测（与后端一致，增加最小间距过滤） ──
  const peaks = detectPeaks(standForce, 20);

  // ── 周期分析 ──
  const numCycles = Math.max(peaks.length - 1, 0);
  const avgDuration = numCycles > 0 ? totalDuration / numCycles : 0;

  // 周期时长明细
  const cycleDurations = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    const dur = standTimes[peaks[i + 1]] - standTimes[peaks[i]];
    cycleDurations.push(parseFloat(dur.toFixed(2)));
  }
  const minCycleDuration = cycleDurations.length > 0 ? Math.min(...cycleDurations) : 0;
  const maxCycleDuration = cycleDurations.length > 0 ? Math.max(...cycleDurations) : 0;

  // 各峰值力
  const cyclePeakForces = peaks.map(idx => standForce[idx]);

  // ── 压力统计 ──
  const footMax = standForce.length > 0 ? Math.max(...standForce) : 0;
  const footAvg = standForce.length > 0 ? standForce.reduce((a, b) => a + b, 0) / standForce.length : 0;
  const sitMax = sitForce.length > 0 ? Math.max(...sitForce) : 0;
  const sitAvg = sitForce.length > 0 ? sitForce.reduce((a, b) => a + b, 0) / sitForce.length : 0;

  // 最大变化率
  const footDiffs = [];
  for (let i = 1; i < standForce.length; i++) footDiffs.push(Math.abs(standForce[i] - standForce[i - 1]));
  const sitDiffs = [];
  for (let i = 1; i < sitForce.length; i++) sitDiffs.push(Math.abs(sitForce[i] - sitForce[i - 1]));
  const maxFootRate = footDiffs.length > 0 ? Math.max(...footDiffs) : 0;
  const maxSitRate = sitDiffs.length > 0 ? Math.max(...sitDiffs) : 0;

  // ── 旧格式兼容字段 ──
  const cycles = detectCycles(footpadPressureHistory);

  return {
    test_date: new Date().toLocaleString('zh-CN'),
    duration_stats: {
      total_duration: totalDuration,
      num_cycles: numCycles,
      avg_duration: parseFloat(avgDuration.toFixed(2)),
      cycle_durations: cycleDurations,
      min_cycle_duration: parseFloat(minCycleDuration.toFixed(2)),
      max_cycle_duration: parseFloat(maxCycleDuration.toFixed(2)),
    },
    stand_frames: footpadPressureHistory.length,
    sit_frames: seatPressureHistory.length,
    stand_peaks: peaks.length,
    pressure_stats: {
      foot_max: Math.round(footMax),
      foot_avg: Math.round(footAvg),
      sit_max: Math.round(sitMax),
      sit_avg: Math.round(sitAvg),
      max_foot_change_rate: parseFloat(maxFootRate.toFixed(1)),
      max_sit_change_rate: parseFloat(maxSitRate.toFixed(1)),
    },
    cycle_peak_forces: cyclePeakForces,
    seat_stats: seatStats ? {
      max_pressure: seatStats.max || 0,
      mean_pressure: seatStats.mean || 0,
      total_pressure: seatStats.totalPressure || 0,
      contact_area: seatStats.contactArea || 0,
    } : null,
    footpad_stats: footpadStats ? {
      max_pressure: footpadStats.max || 0,
      mean_pressure: footpadStats.mean || 0,
      total_pressure: footpadStats.totalPressure || 0,
      contact_area: footpadStats.contactArea || 0,
    } : null,
    seat_cop: seatCoP ? { x: seatCoP.x, y: seatCoP.y } : null,
    footpad_cop: footpadCoP ? { x: footpadCoP.x, y: footpadCoP.y } : null,
    // 力-时间曲线（与后端 force_curves 格式一致）
    seat_force_curve: { times: sitTimes, values: sitForce },
    footpad_force_curve: { times: standTimes, values: standForce },
    force_curves: {
      stand_times: standTimes,
      stand_force: standForce,
      sit_times: sitTimes,
      sit_force: sitForce,
      stand_peaks_idx: peaks,
    },
    images: {
      stand_evolution: [],
      stand_cop_left: null,
      stand_cop_right: null,
      sit_evolution: [],
      sit_cop: null,
    },
    cycles,
    _generated: true,
  };
}

/**
 * 峰值检测（与后端算法一致）
 * 使用阈值 + 最小间距过滤
 */
function detectPeaks(values, minDistance = 20) {
  if (values.length < 3) return [];

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const threshold = mean + 0.5 * std;

  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] >= threshold && values[i] >= values[i - 1] && values[i] >= values[i + 1]) {
      if (peaks.length === 0 || (i - peaks[peaks.length - 1]) >= minDistance) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

/**
 * 检测起坐周期（旧版兼容）
 * 通过脚垫压力的显著变化来检测
 */
function detectCycles(pressureHistory) {
  if (pressureHistory.length < 20) return [{ start: 0, end: pressureHistory.length - 1 }];

  const smoothed = smoothArray(pressureHistory, 5);
  const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
  const threshold = mean * 0.5;

  const cycles = [];
  let inCycle = false;
  let cycleStart = 0;

  for (let i = 1; i < smoothed.length; i++) {
    if (!inCycle && smoothed[i] > threshold && smoothed[i - 1] <= threshold) {
      inCycle = true;
      cycleStart = i;
    } else if (inCycle && smoothed[i] <= threshold && smoothed[i - 1] > threshold) {
      inCycle = false;
      cycles.push({ start: cycleStart, end: i });
    }
  }

  if (inCycle) {
    cycles.push({ start: cycleStart, end: smoothed.length - 1 });
  }

  return cycles.length > 0 ? cycles : [{ start: 0, end: pressureHistory.length - 1 }];
}

function smoothArray(arr, windowSize) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
      sum += arr[j];
      count++;
    }
    result.push(sum / count);
  }
  return result;
}
