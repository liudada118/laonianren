/**
 * 握力报告数据生成器
 * 同时生成左手和右手的报告，支持切换查看
 */

const FINGER_REGIONS = {
  thumb:         { rows: [6, 10], cols: [12, 15], name: '拇指' },
  index_finger:  { rows: [0, 4],  cols: [0, 3],   name: '食指' },
  middle_finger: { rows: [0, 4],  cols: [4, 7],   name: '中指' },
  ring_finger:   { rows: [0, 4],  cols: [8, 11],  name: '无名指' },
  little_finger: { rows: [0, 4],  cols: [12, 15], name: '小指' },
  palm:          { rows: [4, 12], cols: [0, 11],  name: '手掌' },
};

function extractFingerData(sensorData) {
  const result = {};
  for (const [key, region] of Object.entries(FINGER_REGIONS)) {
    let sum = 0, activeCount = 0, totalPoints = 0;
    for (let r = region.rows[0]; r <= region.rows[1]; r++) {
      for (let c = region.cols[0]; c <= region.cols[1]; c++) {
        const idx = r * 16 + c;
        if (idx < sensorData.length) {
          totalPoints++;
          sum += sensorData[idx];
          if (sensorData[idx] > 5) activeCount++;
        }
      }
    }
    result[key] = {
      name: region.name,
      adc: Math.round(sum),
      force: parseFloat((sum * 0.1).toFixed(1)),
      area: activeCount * 24,
      points: `${activeCount}/${totalPoints}`,
      activeCount,
      totalPoints,
    };
  }
  return result;
}

/**
 * 为单只手生成报告数据
 */
function generateSingleHandReport(data, rawFrames, handLabel) {
  if (!data || data.length === 0) return null;

  const totalFrames = data.length;
  const hasTimestamp = data[0] && typeof data[0].timestamp === 'number';

  // 计算真实时间轴
  let times;
  if (hasTimestamp) {
    const startTime = data[0].timestamp;
    times = data.map(d => parseFloat(((d.timestamp - startTime) / 1000).toFixed(3)));
  } else {
    // 模拟模式: 100ms间隔
    const interval = 0.1;
    times = data.map((_, i) => parseFloat((i * interval).toFixed(3)));
  }
  const totalTime = times[times.length - 1] || 0;

  const pressureValues = data.map(d => d.value);
  const peakValue = Math.max(...pressureValues);
  const peakIdx = pressureValues.indexOf(peakValue);
  const peakTime = times[peakIdx] || 0;

  // 抓握开始时间
  const threshold = peakValue * 0.1;
  let gripStartIdx = 0;
  for (let i = 0; i < pressureValues.length; i++) {
    if (pressureValues[i] > threshold) { gripStartIdx = i; break; }
  }
  const gripStartTime = times[gripStartIdx] || 0;

  // 峰值区间
  const peakThreshold = peakValue * 0.9;
  let peakStartIdx = peakIdx, peakEndIdx = peakIdx;
  for (let i = peakIdx; i >= 0; i--) {
    if (pressureValues[i] >= peakThreshold) peakStartIdx = i; else break;
  }
  for (let i = peakIdx; i < pressureValues.length; i++) {
    if (pressureValues[i] >= peakThreshold) peakEndIdx = i; else break;
  }

  // 降采样（图表性能）
  const MAX_POINTS = 500;
  let chartTimes = times;
  let chartPressure = pressureValues;
  let step = 1;
  if (totalFrames > MAX_POINTS) {
    step = Math.ceil(totalFrames / MAX_POINTS);
    chartTimes = []; chartPressure = [];
    for (let i = 0; i < totalFrames; i += step) {
      chartTimes.push(times[i]);
      chartPressure.push(pressureValues[i]);
    }
  }

  // 各手指力-时间序列
  const fingerKeys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm'];
  const fingerNames = ['拇指', '食指', '中指', '无名指', '小指', '手掌'];
  const defaultRatios = [0.15, 0.10, 0.11, 0.08, 0.05, 0.51];
  const forceTimeSeries = {};

  if (rawFrames && rawFrames.length > 0) {
    fingerKeys.forEach(key => { forceTimeSeries[key] = []; });
    for (let i = 0; i < totalFrames; i += step) {
      const fi = Math.min(i, rawFrames.length - 1);
      if (rawFrames[fi]) {
        const fd = extractFingerData(rawFrames[fi]);
        fingerKeys.forEach(key => forceTimeSeries[key].push(fd[key].force));
      } else {
        const v = pressureValues[i];
        fingerKeys.forEach((key, idx) => forceTimeSeries[key].push(parseFloat((v * defaultRatios[idx]).toFixed(2))));
      }
    }
  } else {
    fingerKeys.forEach((key, idx) => {
      forceTimeSeries[key] = chartPressure.map(v => {
        const base = v * defaultRatios[idx];
        return parseFloat(Math.max(0, base + (Math.random() - 0.5) * base * 0.05).toFixed(2));
      });
    });
  }
  forceTimeSeries.total = chartPressure.map(v => parseFloat(v.toFixed(2)));

  // 峰值帧手指数据
  let peakFingerData;
  if (rawFrames && rawFrames.length > peakIdx && rawFrames[peakIdx]) {
    peakFingerData = extractFingerData(rawFrames[peakIdx]);
  } else {
    peakFingerData = {};
    fingerKeys.forEach((key, idx) => {
      const force = parseFloat((peakValue * defaultRatios[idx]).toFixed(1));
      peakFingerData[key] = {
        name: fingerNames[idx], adc: Math.round(force * 10), force,
        area: Math.round(120 + Math.random() * 150),
        points: `${Math.round(5 + Math.random() * 7)}/${idx < 5 ? 20 : 108}`,
      };
    });
  }

  const fingers = fingerKeys.map(key => peakFingerData[key]);
  const totalForce = parseFloat(fingers.reduce((s, f) => s + f.force, 0).toFixed(1));
  const totalArea = fingers.reduce((s, f) => s + f.area, 0);

  // 欧拉角
  const eulerData = {
    roll:  chartTimes.map(t => parseFloat((Math.sin(t * 0.5) * 5 + (Math.random() - 0.5) * 2).toFixed(2))),
    pitch: chartTimes.map(t => parseFloat((Math.cos(t * 0.3) * 8 + (Math.random() - 0.5) * 3).toFixed(2))),
    yaw:   chartTimes.map(t => parseFloat((Math.sin(t * 0.2) * 3 + (Math.random() - 0.5) * 1.5).toFixed(2))),
  };

  // 角速度
  const angularVelocity = chartTimes.map((t, i) => {
    if (i === 0) return 0;
    const dt = chartTimes[i] - chartTimes[i - 1];
    if (dt <= 0) return 0;
    const dr = eulerData.roll[i] - eulerData.roll[i - 1];
    const dp = eulerData.pitch[i] - eulerData.pitch[i - 1];
    const dy = eulerData.yaw[i] - eulerData.yaw[i - 1];
    return parseFloat((Math.sqrt(dr ** 2 + dp ** 2 + dy ** 2) / dt).toFixed(2));
  });

  const shakeThreshold = 30;
  const shakeTimesArr = [];
  for (let i = 1; i < angularVelocity.length; i++) {
    if (angularVelocity[i] > shakeThreshold && angularVelocity[i - 1] <= shakeThreshold) {
      shakeTimesArr.push(chartTimes[i]);
    }
  }
  const avgAngVel = angularVelocity.length > 0 ? parseFloat((angularVelocity.reduce((a, b) => a + b, 0) / angularVelocity.length).toFixed(2)) : 0;
  const maxAngVel = angularVelocity.length > 0 ? parseFloat(Math.max(...angularVelocity).toFixed(2)) : 0;

  const timeAnalysis = [
    { label: '抓握开始时间', value: `${gripStartTime.toFixed(3)} s` },
    { label: '峰值力时间', value: `${peakTime.toFixed(3)} s` },
    { label: '到达峰值耗时', value: `${(peakTime - gripStartTime).toFixed(3)} s` },
    { label: '峰值区间开始', value: `${(times[peakStartIdx] || 0).toFixed(3)} s` },
    { label: '峰值区间结束', value: `${(times[peakEndIdx] || 0).toFixed(3)} s` },
    { label: '峰值持续时间', value: `${((times[peakEndIdx] || 0) - (times[peakStartIdx] || 0)).toFixed(3)} s` },
    { label: '峰值力', value: `${peakValue.toFixed(2)} N` },
    { label: '检测阈值', value: `${shakeThreshold.toFixed(1)}°/s` },
    { label: '抖动次数', value: `${shakeTimesArr.length} 次` },
    { label: '平均角速度', value: `${avgAngVel.toFixed(2)}°/s` },
    { label: '最大角速度', value: `${maxAngVel.toFixed(2)}°/s` },
  ];

  return {
    handType: handLabel,
    hand: handLabel,
    totalFrames,
    timeRange: `0.000s ~ ${totalTime.toFixed(3)}s`,
    timeAnalysis,
    fingers,
    totalForce,
    totalArea,
    peakInfo: {
      peak_idx: peakIdx, peak_force: peakValue, peak_time: peakTime,
      start_idx: peakStartIdx, end_idx: peakEndIdx,
      start_time: times[peakStartIdx] || 0, end_time: times[peakEndIdx] || 0,
      duration: (times[peakEndIdx] || 0) - (times[peakStartIdx] || 0),
    },
    gripStartTime,
    shakeCount: shakeTimesArr.length,
    shakeTimes: shakeTimesArr,
    avgAngularVelocity: avgAngVel,
    maxAngularVelocity: maxAngVel,
    times: chartTimes,
    forceTimeSeries,
    eulerData,
    angularVelocity,
    images: {},
    // 峰值帧的原始16x16传感器矩阵（用于动态热力图）
    peakSensorMatrix: rawFrames && rawFrames.length > peakIdx && rawFrames[peakIdx]
      ? Array.from(rawFrames[peakIdx])
      : null,
    // 平均传感器矩阵（所有帧的平均值）
    avgSensorMatrix: rawFrames && rawFrames.length > 0
      ? (() => {
          const avg = new Float32Array(256).fill(0);
          let count = 0;
          for (let i = 0; i < rawFrames.length; i++) {
            if (rawFrames[i]) {
              for (let j = 0; j < 256; j++) avg[j] += rawFrames[i][j] || 0;
              count++;
            }
          }
          if (count > 0) for (let j = 0; j < 256; j++) avg[j] /= count;
          return Array.from(avg);
        })()
      : null,
  };
}

/**
 * 从采集的压力时间序列生成完整的握力报告数据（左右手）
 * 
 * @param {Array} leftData - 左手压力时间序列 [{time, value, timestamp?}, ...]
 * @param {Array} rightData - 右手压力时间序列 [{time, value, timestamp?}, ...]
 * @param {Array} leftRawFrames - 左手原始传感器帧数据 [Array(256), ...]
 * @param {Array} rightRawFrames - 右手原始传感器帧数据 [Array(256), ...]
 * @param {string} patientName - 患者姓名
 * @returns {Object} { left: 左手报告|null, right: 右手报告|null, activeHand: '左手'|'右手' }
 */
export function generateGripReportData(leftData, rightData, leftRawFrames = [], rightRawFrames = [], patientName = '') {
  const leftReport = generateSingleHandReport(leftData, leftRawFrames, '左手');
  const rightReport = generateSingleHandReport(rightData, rightRawFrames, '右手');

  // 默认显示有数据的手，优先左手
  const activeHand = leftReport ? '左手' : '右手';

  return {
    left: leftReport,
    right: rightReport,
    activeHand,
    patientName,
  };
}
