/**
 * 握力评估算法模块 (JS版)
 * 迁移自 Python: glove_render_data.py + get_glove_info_from_csv.py
 *
 * 输入: [N, 256] 传感器数据数组
 * 输出: 结构化报告数据 (与前端 GripReport.jsx 兼容)
 */

const {
  sum, mean, std, argmax, clip,
  normalizeQuaternion, quaternionToEuler,
} = require('../shared/mathUtils');

// ============================================================
// 常量定义 (来自 get_glove_info_from_csv.py)
// ============================================================

// 三段式分段线性模型参数（12点标定）
const ADC_BREAKPOINT_1 = 61.2;   // 第一转折点ADC值（对应50N）
const ADC_BREAKPOINT_2 = 75.0;   // 第二转折点/饱和ADC值（对应150N）
const ADC_OFFSET = 2.87;         // 起点偏移
const CALIBRATION_POINTS = 12;   // 标定点数

// 传感器面积参数
const SENSOR_WIDTH_MM = 4.0;
const SENSOR_HEIGHT_MM = 6.0;
const SENSOR_AREA_MM2 = SENSOR_WIDTH_MM * SENSOR_HEIGHT_MM;

// 峰值检测参数
const PEAK_FORCE_THRESHOLD_RATIO = 0.95;
const GRIP_START_THRESHOLD_RATIO = 0.1;

// 抖动检测参数
const SHAKE_ANGULAR_VELOCITY_THRESHOLD = 30.0;
const SHAKE_MIN_INTERVAL = 0.15;

// 手指区域映射 - 离散传感器索引 (1-based，与 LeftHand/RightHand 类一致)
// 注意：传感器并非连续排列，每个手指对应分散在不同位置的传感器
const PART_INDICES_LEFT = {
  thumb:         [19, 18, 17, 3, 2, 1, 243, 242, 241, 227, 226, 225],
  index_finger:  [22, 21, 20, 6, 5, 4, 246, 245, 244, 230, 229, 228],
  middle_finger: [25, 24, 23, 9, 8, 7, 249, 248, 247, 233, 232, 231],
  ring_finger:   [28, 27, 26, 12, 11, 10, 252, 251, 250, 236, 235, 234],
  little_finger: [31, 30, 29, 15, 14, 13, 255, 254, 253, 239, 238, 237],
  palm:          [
    207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196,
    191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177,
    175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161,
    159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145,
    143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129,
  ],
};

const PART_INDICES_RIGHT = {
  thumb:         [240, 239, 238, 256, 255, 254, 16, 15, 14, 32, 31, 30],
  index_finger:  [237, 236, 235, 253, 252, 251, 13, 12, 11, 29, 28, 27],
  middle_finger: [234, 233, 232, 250, 249, 248, 10, 9, 8, 26, 25, 24],
  ring_finger:   [231, 230, 229, 247, 246, 245, 7, 6, 5, 23, 22, 21],
  little_finger: [228, 227, 226, 244, 243, 242, 4, 3, 2, 20, 19, 18],
  palm:          [
    61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50,
    80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66,
    96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82,
    112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98,
    128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114,
  ],
};

const PART_KEYS = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm'];

const PART_NAMES = {
  thumb: 'Thumb',
  index_finger: 'Index',
  middle_finger: 'Middle',
  ring_finger: 'Ring',
  little_finger: 'Little',
  palm: 'Palm',
};

// ============================================================
// ADC 转力函数
// ============================================================

/**
 * 单点ADC值转力(N) - 三段式分段线性模型
 * @param {number} adc - ADC原始值
 * @returns {number} 力值(N)
 */
function adcToForceSinglePoint(adc) {
  if (adc <= ADC_OFFSET) return 0.0;
  let force;
  if (adc < ADC_BREAKPOINT_1) {
    force = (adc - 2.87) / 1.17;
  } else if (adc < ADC_BREAKPOINT_2) {
    force = (adc - 54.34) / 0.14;
  } else {
    force = 150.0; // 饱和
  }
  return parseFloat((force / CALIBRATION_POINTS).toFixed(4));
}

/**
 * 计算区域力值
 * @param {number[]} sensorData - 单帧256个传感器值
 * @param {number[]} indices - 传感器索引数组
 * @returns {number} 区域总力
 */
function calculatePartForce(sensorData, indices) {
  let totalForce = 0.0;
  for (const idx of indices) {
    const arrayIdx = idx - 1;
    if (arrayIdx >= 0 && arrayIdx < sensorData.length && sensorData[arrayIdx] > 0) {
      totalForce += adcToForceSinglePoint(sensorData[arrayIdx]);
    }
  }
  return totalForce;
}

// ============================================================
// 角速度计算
// ============================================================

/**
 * 滑动窗口计算角速度
 * @param {number[][]} quaternions - 四元数数组 [[w,x,y,z], ...]
 * @param {number[]} times - 时间数组
 * @param {number} windowSize - 窗口大小
 * @returns {number[]} 角速度数组 (deg/s)
 */
function calculateAngularVelocitySlidingWindow(quaternions, times, windowSize = 10) {
  const n = quaternions.length;
  const angularVelocities = new Float64Array(n);
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < n; i++) {
    const startIdx = Math.max(0, i - halfWindow);
    const endIdx = Math.min(n - 1, i + halfWindow);
    if (endIdx <= startIdx) continue;

    const qStart = quaternions[startIdx];
    const qEnd = quaternions[endIdx];
    const dt = times[endIdx] - times[startIdx];
    if (dt < 0.01) continue;

    let dot = Math.abs(
      qStart[0] * qEnd[0] + qStart[1] * qEnd[1] +
      qStart[2] * qEnd[2] + qStart[3] * qEnd[3]
    );
    dot = clip(dot, 0.0, 1.0);
    const angleRad = 2.0 * Math.acos(dot);
    angularVelocities[i] = (angleRad * 180 / Math.PI) / dt;
  }

  return Array.from(angularVelocities);
}

/**
 * 抖动检测
 * @param {number[]} angularVelocities - 角速度序列
 * @param {number[]} times - 时间序列
 * @param {number} threshold - 角速度阈值 (deg/s)
 * @param {number} minInterval - 最小间隔 (s)
 * @returns {{ count: number, shakeTimes: number[], shakeIndices: number[] }}
 */
function detectShakes(angularVelocities, times, threshold = 30.0, minInterval = 0.15) {
  if (angularVelocities.length < 3) return { count: 0, shakeTimes: [], shakeIndices: [] };

  const shakeTimes = [];
  const shakeIndices = [];
  let lastShakeTime = -minInterval * 2;

  for (let i = 1; i < angularVelocities.length - 1; i++) {
    if (angularVelocities[i] < threshold) continue;
    if (angularVelocities[i] <= angularVelocities[i - 1]) continue;
    if (angularVelocities[i] <= angularVelocities[i + 1]) continue;
    if (times[i] - lastShakeTime < minInterval) continue;

    shakeTimes.push(times[i]);
    shakeIndices.push(i);
    lastShakeTime = times[i];
  }

  return { count: shakeTimes.length, shakeTimes, shakeIndices };
}

// ============================================================
// 主入口：生成握力报告
// ============================================================

/**
 * 生成握力评估报告数据
 * @param {number[][]} sensorData - [N, 256] 传感器数据
 * @param {string} handType - '左手' 或 '右手'
 * @param {number[]|null} times - 时间戳数组 [N]，单位秒
 * @param {number[][]|null} imuData - IMU四元数数据 [N, 4]
 * @returns {object} 报告数据对象
 */
function generateGripReport(sensorData, handType, times = null, imuData = null) {
  // 数据验证
  if (!sensorData || sensorData.length === 0) {
    throw new Error('sensorData is empty');
  }

  const n = sensorData.length;

  // 确保每帧256个值
  const arr = sensorData.map(frame => {
    if (frame.length < 256) {
      const padded = new Array(256).fill(0);
      for (let i = 0; i < frame.length; i++) padded[i] = frame[i];
      return padded;
    }
    return frame.length > 256 ? frame.slice(0, 256) : frame;
  });

  // 时间轴
  let t;
  if (times && times.length === n) {
    t = times;
  } else {
    t = new Array(n);
    for (let i = 0; i < n; i++) t[i] = i * 0.01;
  }

  // ---- 1. 计算各区域力-时间序列 (使用离散索引映射) ----
  const partIndices = handType === '左手' ? PART_INDICES_LEFT : PART_INDICES_RIGHT;
  const forceTimeSeries = {};
  for (const key of PART_KEYS) {
    const indices = partIndices[key];
    forceTimeSeries[key] = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const idx of indices) {
        const arrayIdx = idx - 1; // 1-based 转 0-based
        if (arrayIdx >= 0 && arrayIdx < 256) s += arr[i][arrayIdx];
      }
      forceTimeSeries[key][i] = s;
    }
  }

  // 总力序列
  const totalForceSeries = new Float64Array(n);
  for (const key of PART_KEYS) {
    for (let i = 0; i < n; i++) {
      totalForceSeries[i] += forceTimeSeries[key][i];
    }
  }
  forceTimeSeries.total = totalForceSeries;

  // ---- 2. 峰值检测 ----
  const peakIdx = argmax(Array.from(totalForceSeries));
  const peakForce = n > 0 ? totalForceSeries[peakIdx] : 0;
  const peakTime = n > 0 ? t[peakIdx] : 0;

  // ---- 3. 握力开始时间 ----
  const threshold = peakForce * GRIP_START_THRESHOLD_RATIO;
  let gripStartTime = t[0];
  for (let i = 0; i < n; i++) {
    if (totalForceSeries[i] >= threshold) {
      gripStartTime = t[i];
      break;
    }
  }

  // ---- 4. IMU: 欧拉角和角速度 ----
  let eulerRoll = new Float64Array(n);
  let eulerPitch = new Float64Array(n);
  let eulerYaw = new Float64Array(n);
  let angularVelocity = new Float64Array(n);

  if (imuData && imuData.length === n && imuData[0] && imuData[0].length >= 4) {
    // 归一化四元数
    const quaternions = imuData.map(q => normalizeQuaternion(q.slice(0, 4)));

    // 计算欧拉角
    for (let i = 0; i < n; i++) {
      const euler = quaternionToEuler(quaternions[i]);
      eulerRoll[i] = euler.roll;
      eulerPitch[i] = euler.pitch;
      eulerYaw[i] = euler.yaw;
    }

    // 计算角速度 (简单帧间差分)
    for (let i = 1; i < n; i++) {
      const dt = Math.max(1e-3, t[i] - t[i - 1]);
      let dot = Math.abs(
        quaternions[i - 1][0] * quaternions[i][0] +
        quaternions[i - 1][1] * quaternions[i][1] +
        quaternions[i - 1][2] * quaternions[i][2] +
        quaternions[i - 1][3] * quaternions[i][3]
      );
      dot = Math.min(1.0, Math.max(0.0, dot));
      const angle = 2.0 * Math.acos(dot);
      angularVelocity[i] = (angle * 180 / Math.PI) / dt;
    }
  }

  // ---- 5. 抖动检测 ----
  const shakeResult = detectShakes(
    Array.from(angularVelocity), t,
    SHAKE_ANGULAR_VELOCITY_THRESHOLD,
    SHAKE_MIN_INTERVAL
  );

  // ---- 6. 峰值帧分析 (手指区域，使用离散索引) ----
  const peakFrame = arr[peakIdx];
  const fingers = [];
  let totalForce = 0;
  let totalArea = 0;

  for (const key of PART_KEYS) {
    const indices = partIndices[key];
    let force = 0;
    let nonzero = 0;
    let adcSum = 0;
    for (const idx of indices) {
      const arrayIdx = idx - 1; // 1-based 转 0-based
      if (arrayIdx >= 0 && arrayIdx < 256) {
        const val = peakFrame[arrayIdx];
        force += val;
        if (val > 0) {
          nonzero++;
          adcSum += val;
        }
      }
    }
    const area = nonzero * SENSOR_AREA_MM2;
    const adc = nonzero > 0 ? Math.round(adcSum / nonzero) : 0;

    totalForce += force;
    totalArea += area;

    fingers.push({
      name: PART_NAMES[key],
      key: key,
      force: Math.round(force * 100) / 100,
      area: Math.round(area),
      adc: adc,
      points: `${nonzero}/${indices.length}`,
    });
  }

  // ---- 7. 降采样输出 ----
  const step = Math.max(1, Math.floor(n / 500));
  const sampledT = [];
  const sampledForce = {};
  for (const key of [...PART_KEYS, 'total']) {
    sampledForce[key] = [];
  }

  for (let i = 0; i < n; i += step) {
    sampledT.push(parseFloat(t[i].toFixed(3)));
    for (const key of PART_KEYS) {
      sampledForce[key].push(parseFloat(forceTimeSeries[key][i].toFixed(2)));
    }
    sampledForce.total.push(parseFloat(totalForceSeries[i].toFixed(2)));
  }

  const sampledEulerRoll = [];
  const sampledEulerPitch = [];
  const sampledEulerYaw = [];
  const sampledAngVel = [];
  for (let i = 0; i < n; i += step) {
    sampledEulerRoll.push(parseFloat(eulerRoll[i].toFixed(2)));
    sampledEulerPitch.push(parseFloat(eulerPitch[i].toFixed(2)));
    sampledEulerYaw.push(parseFloat(eulerYaw[i].toFixed(2)));
    sampledAngVel.push(parseFloat(angularVelocity[i].toFixed(2)));
  }

  // ---- 8. 组装结果 ----
  return {
    handType: handType,
    hand: handType,
    totalFrames: n,
    timeRange: `${t[0].toFixed(3)}s ~ ${t[n - 1].toFixed(3)}s`,
    peakInfo: {
      peak_force: parseFloat(peakForce.toFixed(2)),
      peak_time: parseFloat(peakTime.toFixed(3)),
    },
    timeAnalysis: [
      { label: 'Grip Start', value: `${gripStartTime.toFixed(3)} s` },
      { label: 'Peak Time', value: `${peakTime.toFixed(3)} s` },
      { label: 'Time To Peak', value: `${(peakTime - gripStartTime).toFixed(3)} s` },
      { label: 'Peak Force', value: `${peakForce.toFixed(2)} N` },
      { label: 'Shake Threshold', value: `${SHAKE_ANGULAR_VELOCITY_THRESHOLD.toFixed(1)} deg/s` },
      { label: 'Shake Count', value: `${shakeResult.count}` },
      { label: 'Avg Angular Velocity', value: `${mean(Array.from(angularVelocity)).toFixed(2)} deg/s` },
      { label: 'Max Angular Velocity', value: `${Math.max(...angularVelocity).toFixed(2)} deg/s` },
    ],
    fingers: fingers,
    totalForce: parseFloat(totalForce.toFixed(2)),
    totalArea: Math.round(totalArea),
    times: sampledT,
    forceTimeSeries: sampledForce,
    eulerData: {
      roll: sampledEulerRoll,
      pitch: sampledEulerPitch,
      yaw: sampledEulerYaw,
    },
    angularVelocity: sampledAngVel,
  };
}

// ============================================================
// 辅助方法：拆分报告数据供前端各组件使用
// ============================================================

function getOverview(result) {
  return {
    handType: result.handType,
    totalFrames: result.totalFrames,
    timeRange: result.timeRange,
    peakForce: parseFloat((result.peakInfo?.peak_force ?? 0).toFixed(2)),
    peakTime: parseFloat((result.peakInfo?.peak_time ?? 0).toFixed(3)),
    totalForce: parseFloat((result.totalForce ?? 0).toFixed(2)),
    totalArea: result.totalArea,
    fingers: result.fingers,
  };
}

function getTimeAnalysis(result) {
  return result.timeAnalysis || [];
}

function getFingerData(result) {
  return result.fingers || [];
}

function getForceTimeSeries(result) {
  return {
    times: result.times || [],
    series: result.forceTimeSeries || {},
  };
}

function getEulerData(result) {
  return {
    times: result.times || [],
    euler: result.eulerData || { roll: [], pitch: [], yaw: [] },
  };
}

function getAngularVelocityData(result) {
  return {
    times: result.times || [],
    angularVelocity: result.angularVelocity || [],
  };
}

module.exports = {
  generateGripReport,
  getOverview,
  getTimeAnalysis,
  getFingerData,
  getForceTimeSeries,
  getEulerData,
  getAngularVelocityData,
  // 导出底层函数供测试
  adcToForceSinglePoint,
  calculatePartForce,
  detectShakes,
};
