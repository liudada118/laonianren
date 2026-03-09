/**
 * 步态评估算法模块 (JS版)
 * 迁移自 Python: gait_render_data.py
 *
 * 输入: 四路足底序列（每帧 4096）
 * 输出: 前端报告页可直接渲染的结构化结果
 */

const { mean, std, sum, downsampleIndices } = require('../shared/mathUtils');

// ============================================================
// 内部工具函数
// ============================================================

function toFlat4096(frame) {
  if (!frame) return new Float64Array(4096);
  const arr = new Float64Array(4096);
  const len = Math.min(frame.length, 4096);
  for (let i = 0; i < len; i++) arr[i] = frame[i];
  return arr;
}

function safeMean(values) {
  if (!values || values.length === 0) return 0.0;
  return mean(values);
}

function safeStd(values) {
  if (!values || values.length === 0) return 0.0;
  return std(values);
}

/**
 * 步数检测：通过力序列的阈值过零计数
 */
function stepCount(forceSeries, threshold) {
  if (!forceSeries || forceSeries.length === 0) return 0;
  let count = 0;
  let prev = forceSeries[0] > threshold;
  for (let i = 1; i < forceSeries.length; i++) {
    const cur = forceSeries[i] > threshold;
    if (cur && !prev) count++;
    prev = cur;
  }
  return Math.max(1, count);
}

/**
 * 计算COP位置 (64x64矩阵)
 */
function copXY(mat64) {
  let total = 0;
  let sumX = 0, sumY = 0;
  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 64; c++) {
      const v = mat64[r * 64 + c];
      total += v;
      sumX += c * v;
      sumY += r * v;
    }
  }
  if (total <= 0) return [31.5, 31.5];
  return [sumX / total, sumY / total];
}

/**
 * 构建分区特征
 */
function buildPartitionFeatures(partitionMatrix, fps, forceScale) {
  const nFrames = partitionMatrix.length;
  const nZones = partitionMatrix[0].length;
  const out = [];

  for (let z = 0; z < nZones; z++) {
    const vals = new Float64Array(nFrames);
    for (let i = 0; i < nFrames; i++) vals[i] = partitionMatrix[i][z];

    let peak = -Infinity;
    let peakIdx = 0;
    let s = 0;
    let contactCount = 0;

    for (let i = 0; i < nFrames; i++) {
      if (vals[i] > peak) { peak = vals[i]; peakIdx = i; }
      s += vals[i];
    }
    peak *= forceScale;
    const impulse = s * forceScale / Math.max(1.0, fps);
    const loadRate = peak / Math.max(1e-6, nFrames / Math.max(1.0, fps));
    const peakTimePct = (peakIdx / Math.max(1, nFrames - 1)) * 100.0;

    const peakThreshold = peak * 0.1 / forceScale; // 回到原始尺度
    for (let i = 0; i < nFrames; i++) {
      if (vals[i] > peakThreshold) contactCount++;
    }
    const contactPct = (contactCount / Math.max(1, nFrames)) * 100.0;

    out.push({
      '压力峰值': Math.round(peak * 100) / 100,
      '冲量': Math.round(impulse * 100) / 100,
      '负载率': Math.round(loadRate * 100) / 100,
      '峰值时间_百分比': Math.round(peakTimePct * 100) / 100,
      '接触时间_百分比': Math.round(contactPct * 100) / 100,
    });
  }
  return out;
}

/**
 * 构建分区曲线
 */
function buildPartitionCurves(partitionMatrix, indices, forceScale) {
  const nZones = partitionMatrix[0].length;
  const curves = [];
  for (let z = 0; z < nZones; z++) {
    const data = indices.map(i =>
      Math.round(partitionMatrix[i][z] * forceScale * 100) / 100
    );
    curves.push({ name: `S${z + 1}`, data });
  }
  return curves;
}

/**
 * 步态相位指标
 */
function phaseMetrics(stepTimeS, baseCopSpeed, baseArea, baseForce, phases) {
  const out = {};
  for (const [name, ratio] of phases) {
    out[name] = {
      '时长ms': Math.round(stepTimeS * 1000.0 * ratio * 100) / 100,
      '平均COP速度(mm/s)': Math.round(baseCopSpeed * (0.8 + ratio) * 100) / 100,
      '最大面积cm2': Math.round(baseArea * (0.9 + ratio * 0.6) * 100) / 100,
      '最大负荷': Math.round(baseForce * (0.9 + ratio * 0.6) * 100) / 100,
    };
  }
  return out;
}

// ============================================================
// 主入口：生成步态报告
// ============================================================

/**
 * 生成步态评估报告数据
 * @param {number[][]} d1 - 脚垫1数据 [N, 4096]
 * @param {number[][]} d2 - 脚垫2数据 [N, 4096]
 * @param {number[][]} d3 - 脚垫3数据 [N, 4096]
 * @param {number[][]} d4 - 脚垫4数据 [N, 4096]
 * @param {object} options - { bodyWeightKg: 80 }
 * @returns {object} 报告数据
 */
function generateGaitReport(d1, d2, d3, d4, options = {}) {
  const { bodyWeightKg = 80 } = options;

  const n = Math.min(
    (d1 || []).length,
    (d2 || []).length,
    (d3 || []).length,
    (d4 || []).length
  );

  // 空数据返回默认结构
  if (n <= 0) {
    return {
      gaitParams: {},
      balance: { left: {}, right: {} },
      timeSeries: { left: { time: [] }, right: { time: [] } },
      partitionFeatures: { left: [], right: [] },
      fpaPerStep: { left: [], right: [] },
      partitionCurves: { left: [], right: [] },
      supportPhases: { left: {}, right: {} },
      cyclePhases: { left: {}, right: {} },
      images: {},
    };
  }

  const fps = 77.0;
  const dt = 1.0 / fps;
  const forceScale = 0.02;
  const areaScaleCm2 = 0.49;

  // 初始化数据数组
  const leftForce = [], rightForce = [];
  const leftArea = [], rightArea = [];
  const leftForefoot = [], leftHeel = [];
  const rightForefoot = [], rightHeel = [];
  const leftCop = [], rightCop = [];
  const leftFrames = [], rightFrames = [];

  // 逐帧处理
  for (let i = 0; i < n; i++) {
    const f1 = toFlat4096(d1[i]);
    const f2 = toFlat4096(d2[i]);
    const f3 = toFlat4096(d3[i]);
    const f4 = toFlat4096(d4[i]);

    // 左脚 = pad1 + pad2, 右脚 = pad3 + pad4
    const leftFlat = new Float64Array(4096);
    const rightFlat = new Float64Array(4096);
    for (let j = 0; j < 4096; j++) {
      leftFlat[j] = f1[j] + f2[j];
      rightFlat[j] = f3[j] + f4[j];
    }
    leftFrames.push(leftFlat);
    rightFrames.push(rightFlat);

    // 力和面积
    let lf = 0, rf = 0, la = 0, ra = 0;
    for (let j = 0; j < 4096; j++) {
      lf += leftFlat[j];
      rf += rightFlat[j];
      if (leftFlat[j] > 0) la++;
      if (rightFlat[j] > 0) ra++;
    }
    leftForce.push(lf * forceScale);
    rightForce.push(rf * forceScale);
    leftArea.push(la * areaScaleCm2);
    rightArea.push(ra * areaScaleCm2);

    // 前足/足跟 (上半/下半)
    let lfFore = 0, lfHeel = 0, rfFore = 0, rfHeel = 0;
    for (let r = 0; r < 32; r++) {
      for (let c = 0; c < 64; c++) {
        lfFore += leftFlat[r * 64 + c];
        rfFore += rightFlat[r * 64 + c];
      }
    }
    for (let r = 32; r < 64; r++) {
      for (let c = 0; c < 64; c++) {
        lfHeel += leftFlat[r * 64 + c];
        rfHeel += rightFlat[r * 64 + c];
      }
    }
    leftForefoot.push(lfFore * forceScale);
    leftHeel.push(lfHeel * forceScale);
    rightForefoot.push(rfFore * forceScale);
    rightHeel.push(rfHeel * forceScale);

    // COP
    leftCop.push(copXY(leftFlat));
    rightCop.push(copXY(rightFlat));
  }

  // 步数检测
  const thresholdLeft = Math.max(5.0, safeMean(leftForce) * 0.25);
  const thresholdRight = Math.max(5.0, safeMean(rightForce) * 0.25);
  const leftSteps = stepCount(leftForce, thresholdLeft);
  const rightSteps = stepCount(rightForce, thresholdRight);

  // 步态参数
  const durationS = n * dt;
  const leftStepTime = durationS / Math.max(1, leftSteps);
  const rightStepTime = durationS / Math.max(1, rightSteps);
  const crossStepTime = (leftStepTime + rightStepTime) / 2.0;

  const cadence = (leftSteps + rightSteps) / 2.0 / Math.max(1e-6, durationS) * 60.0;
  const symmetry = Math.min(leftSteps, rightSteps) / Math.max(1, Math.max(leftSteps, rightSteps));

  const leftStepLength = 58.0 + (symmetry - 0.8) * 20.0;
  const rightStepLength = 58.0 + (symmetry - 0.8) * 20.0;
  const crossStepLength = (leftStepLength + rightStepLength) / 2.0;
  const stepWidth = 10.0 + (1.0 - symmetry) * 6.0;
  let walkingSpeed = (crossStepLength / 100.0) * (cadence / 120.0);
  walkingSpeed *= Math.max(0.85, Math.min(1.15, 80.0 / Math.max(40.0, bodyWeightKg)));

  // FPA角度 (估算)
  const leftFpaCenter = 6.0 + (safeMean(leftForefoot) - safeMean(leftHeel)) / Math.max(30.0, safeMean(leftForce) + 1.0);
  const rightFpaCenter = 6.0 + (safeMean(rightForefoot) - safeMean(rightHeel)) / Math.max(30.0, safeMean(rightForce) + 1.0);
  const leftFpaSeries = [];
  for (let i = 0; i < Math.max(1, leftSteps); i++) {
    leftFpaSeries.push(Math.round((leftFpaCenter + 1.5 * Math.sin(i * 0.7)) * 100) / 100);
  }
  const rightFpaSeries = [];
  for (let i = 0; i < Math.max(1, rightSteps); i++) {
    rightFpaSeries.push(Math.round((rightFpaCenter + 1.5 * Math.sin(i * 0.7 + 0.4)) * 100) / 100);
  }

  // 压力 = 力/面积
  const leftPressure = leftForce.map((lf, i) => lf / Math.max(0.1, leftArea[i]));
  const rightPressure = rightForce.map((rf, i) => rf / Math.max(0.1, rightArea[i]));

  // COP速度
  const leftCopSpeed = [0.0];
  const rightCopSpeed = [0.0];
  for (let i = 1; i < n; i++) {
    const ldx = (leftCop[i][0] - leftCop[i - 1][0]) * 7.0;
    const ldy = (leftCop[i][1] - leftCop[i - 1][1]) * 7.0;
    const rdx = (rightCop[i][0] - rightCop[i - 1][0]) * 7.0;
    const rdy = (rightCop[i][1] - rightCop[i - 1][1]) * 7.0;
    leftCopSpeed.push(Math.sqrt(ldx * ldx + ldy * ldy) / dt);
    rightCopSpeed.push(Math.sqrt(rdx * rdx + rdy * rdy) / dt);
  }

  // 8分区压力
  const leftPartition = new Array(n);
  const rightPartition = new Array(n);
  for (let i = 0; i < n; i++) {
    leftPartition[i] = new Float64Array(8);
    rightPartition[i] = new Float64Array(8);
    for (let z = 0; z < 8; z++) {
      const rs = z * 8;
      const re = rs + 8;
      let ls = 0, rss = 0;
      for (let r = rs; r < re; r++) {
        for (let c = 0; c < 64; c++) {
          ls += leftFrames[i][r * 64 + c];
          rss += rightFrames[i][r * 64 + c];
        }
      }
      leftPartition[i][z] = ls;
      rightPartition[i][z] = rss;
    }
  }

  // 降采样
  const sampleIdx = downsampleIndices(n, 200);

  // 平衡对象
  function balanceObj(full, fore, heel) {
    return {
      '整足平衡': {
        '峰值': Math.round(Math.max(...full) * 100) / 100,
        '均值': Math.round(safeMean(full) * 100) / 100,
        '标准差': Math.round(safeStd(full) * 100) / 100,
      },
      '前足平衡': {
        '峰值': Math.round(Math.max(...fore) * 100) / 100,
        '均值': Math.round(safeMean(fore) * 100) / 100,
        '标准差': Math.round(safeStd(fore) * 100) / 100,
      },
      '足跟平衡': {
        '峰值': Math.round(Math.max(...heel) * 100) / 100,
        '均值': Math.round(safeMean(heel) * 100) / 100,
        '标准差': Math.round(safeStd(heel) * 100) / 100,
      },
    };
  }

  // 支撑相和步态周期定义
  const supportPhaseDefs = [
    ['支撑前期', 0.10],
    ['支撑初期', 0.30],
    ['支撑中期', 0.40],
    ['支撑末期', 0.20],
  ];
  const cyclePhaseDefs = [
    ['双脚加载期', 0.18],
    ['左脚单支撑期', 0.32],
    ['双脚摆荡期', 0.18],
    ['右脚单支撑期', 0.32],
  ];

  // 组装结果
  return {
    gaitParams: {
      leftStepTime: Math.round(leftStepTime * 1000) / 1000,
      rightStepTime: Math.round(rightStepTime * 1000) / 1000,
      crossStepTime: Math.round(crossStepTime * 1000) / 1000,
      leftStepLength: Math.round(leftStepLength * 100) / 100,
      rightStepLength: Math.round(rightStepLength * 100) / 100,
      crossStepLength: Math.round(crossStepLength * 100) / 100,
      stepWidth: Math.round(stepWidth * 100) / 100,
      walkingSpeed: Math.round(walkingSpeed * 1000) / 1000,
      leftFPA: Math.round(safeMean(leftFpaSeries) * 100) / 100,
      rightFPA: Math.round(safeMean(rightFpaSeries) * 100) / 100,
      doubleContactTime: Math.round(crossStepTime * 0.22 * 1000) / 1000,
    },
    balance: {
      left: balanceObj(leftForce, leftForefoot, leftHeel),
      right: balanceObj(rightForce, rightForefoot, rightHeel),
    },
    timeSeries: {
      left: {
        time: sampleIdx.map(i => Math.round(i * dt * 1000) / 1000),
        area: sampleIdx.map(i => Math.round(leftArea[i] * 1000) / 1000),
        force: sampleIdx.map(i => Math.round(leftForce[i] * 1000) / 1000),
        copSpeed: sampleIdx.map(i => Math.round(leftCopSpeed[i] * 1000) / 1000),
        pressure: sampleIdx.map(i => Math.round(leftPressure[i] * 1000) / 1000),
      },
      right: {
        time: sampleIdx.map(i => Math.round(i * dt * 1000) / 1000),
        area: sampleIdx.map(i => Math.round(rightArea[i] * 1000) / 1000),
        force: sampleIdx.map(i => Math.round(rightForce[i] * 1000) / 1000),
        copSpeed: sampleIdx.map(i => Math.round(rightCopSpeed[i] * 1000) / 1000),
        pressure: sampleIdx.map(i => Math.round(rightPressure[i] * 1000) / 1000),
      },
    },
    partitionFeatures: {
      left: buildPartitionFeatures(leftPartition, fps, forceScale),
      right: buildPartitionFeatures(rightPartition, fps, forceScale),
    },
    fpaPerStep: {
      left: leftFpaSeries,
      right: rightFpaSeries,
    },
    partitionCurves: {
      left: buildPartitionCurves(leftPartition, sampleIdx, forceScale),
      right: buildPartitionCurves(rightPartition, sampleIdx, forceScale),
    },
    supportPhases: {
      left: phaseMetrics(leftStepTime, safeMean(leftCopSpeed), safeMean(leftArea), safeMean(leftForce), supportPhaseDefs),
      right: phaseMetrics(rightStepTime, safeMean(rightCopSpeed), safeMean(rightArea), safeMean(rightForce), supportPhaseDefs),
    },
    cyclePhases: {
      left: phaseMetrics(leftStepTime, safeMean(leftCopSpeed), safeMean(leftArea), safeMean(leftForce), cyclePhaseDefs),
      right: phaseMetrics(rightStepTime, safeMean(rightCopSpeed), safeMean(rightArea), safeMean(rightForce), cyclePhaseDefs),
    },
    images: {},
  };
}

module.exports = { generateGaitReport };
