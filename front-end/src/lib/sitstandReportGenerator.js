/**
 * 起坐评估报告数据生成器
 * 将采集的坐垫/脚垫压力数据转换为报告组件所需的结构化数据
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
 * @returns {Object} 报告数据对象
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

  // 检测起坐周期（通过脚垫压力的波峰波谷）
  const cycles = detectCycles(footpadPressureHistory);
  const numCycles = Math.max(1, cycles.length);
  const avgDuration = totalDuration / numCycles;

  // 生成时间轴
  const times = seatPressureHistory.map((_, i) => parseFloat((i * interval).toFixed(2)));

  // 坐垫力-时间曲线数据
  const seatForceCurve = {
    times,
    values: seatPressureHistory.map(v => parseFloat(v.toFixed(1))),
  };

  // 脚垫力-时间曲线数据
  const footpadForceCurve = {
    times: footpadPressureHistory.map((_, i) => parseFloat((i * interval).toFixed(2))),
    values: footpadPressureHistory.map(v => parseFloat(v.toFixed(1))),
  };

  return {
    test_date: new Date().toLocaleString('zh-CN'),
    duration_stats: {
      total_duration: totalDuration,
      num_cycles: numCycles,
      avg_duration: avgDuration,
    },
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
    seat_force_curve: seatForceCurve,
    footpad_force_curve: footpadForceCurve,
    cycles,
    // 标记为实时生成的数据（没有预生成图片）
    _generated: true,
  };
}

/**
 * 检测起坐周期
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
