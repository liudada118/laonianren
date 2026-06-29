const C = {
  blue: '#0066CC',
  green: '#059669',
  amber: '#D97706',
  red: '#DC2626',
  purple: '#7C3AED',
};

// ════════════════════════════════════════════════════════════════
// 老年活动能力综合评分 V3.0
// 每模块 25 分 = 核心硬指标 18 分 + 设备增强指标 7 分
// 四模块合计 100 分 = 核心 72 + 增强 28
// 依据《老年活动能力综合评分_V3逻辑表》
// ════════════════════════════════════════════════════════════════

export const REPORT_BASIS_TEXT =
  '依据说明：本系统采用"核心硬指标(72%) + 柔性触觉感知增强指标(28%)"的 V3 综合评分框架。核心硬指标依据《亚洲肌少症工作组（AWGS）2019 共识》及《社区老年人肌肉减少症筛查专家共识》：握力按性别阈值（男 28kg / 女 18kg）换算 R 值分层，5次起坐总时长分层（≤10s 为佳），日常步速分层（≥1.0m/s 为佳），静态站立结合四阶段平衡、COP 稳态与左右负荷偏移。增强指标利用本设备高密度压力传感特性（手指分区贡献、抓握稳定性、起坐周期稳定性、足底分区、COP 轨迹形态、步态对称性等）作辅助功能解释。本评分用于社区老年活动能力筛查、风险分层和干预建议生成，不作为疾病诊断依据。';

export const ASSESSMENT_LABELS = {
  grip: '握力',
  gait: '步态',
  standing: '静态站立',
  sitstand: '起坐',
};

export const ASSESSMENT_MAX_SCORE = 25;

export function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '' || value === '--' || value === '—') {
    return fallback;
  }
  const text = typeof value === 'string' ? value.replace(/[^\d.+-]/g, '') : value;
  const num = Number(text);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 1) {
  const num = toNumber(value);
  if (num === null) return null;
  return Number(num.toFixed(digits));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreStatus(score, maxScore = 25) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct >= 0.8) return { text: '表现较好', color: C.green, bg: '#ECFDF5' };
  if (pct >= 0.6) return { text: '轻度关注', color: C.amber, bg: '#FFFBEB' };
  if (pct >= 0.4) return { text: '中度关注', color: C.amber, bg: '#FFF7ED' };
  return { text: '重点关注', color: C.red, bg: '#FEF2F2' };
}

export function overallLevel(totalScore, itemResults = []) {
  const hasPriorityRisk = itemResults.some(item => item?.priorityRisk || item?.score <= 15);
  const abnormalCount = itemResults.filter(item => item?.score <= 15 || item?.priorityRisk).length;

  if (totalScore < 40 || abnormalCount >= 3) {
    return {
      text: '重点关注',
      color: C.red,
      bg: '#FEF2F2',
      desc: '活动能力明显下降，建议进行临床评估和个体化干预。',
    };
  }
  if (hasPriorityRisk) {
    return {
      text: '重点关注',
      color: C.red,
      bg: '#FEF2F2',
      desc: '存在单项 ≤15 分或触发安全/跌倒红线的项目，总分不掩盖单项风险，应优先处理主要短板。',
    };
  }
  if (totalScore >= 80) {
    return {
      text: '表现较好',
      color: C.green,
      bg: '#ECFDF5',
      desc: '当前活动能力整体较好，建议维持运动和定期复测。',
    };
  }
  if (totalScore >= 60) {
    return {
      text: '轻度关注',
      color: C.amber,
      bg: '#FFFBEB',
      desc: '存在部分功能短板，建议针对性训练和随访。',
    };
  }
  return {
    text: '中度关注',
    color: C.amber,
    bg: '#FFF7ED',
    desc: '多项能力下降，建议进一步评估衰弱、肌少症或跌倒风险。',
  };
}

function makeResult({ type, title, score, maxScore = 25, metrics = {}, indicators = [], summary, shortfalls = [], redFlags = [], priorityRisk = false, note = '', invalid = false, grade = null, breakdown = [] }) {
  const roundedScore = Math.round(toNumber(score, 0));
  const status = invalid && grade
    ? { text: grade.text, color: grade.color, bg: grade.bg }
    : scoreStatus(roundedScore, maxScore);
  return {
    type,
    title,
    score: roundedScore,
    maxScore,
    level: status.text,
    color: status.color,
    bg: status.bg,
    metrics,
    indicators,
    summary,
    shortfalls,
    redFlags,
    priorityRisk,
    note,
    invalid,
    breakdown,
  };
}

// ────────────────────────────────────────────────────────────────
// 握力评估（25 = 核心 18 + 增强 7）
// ────────────────────────────────────────────────────────────────

function gripThreshold(gender) {
  return gender === '男' ? 28 : 18;
}

function getHandForceN(hand) {
  return toNumber(hand?.peakInfo?.peak_force, null)
    ?? toNumber(hand?.peak_force, null)
    ?? toNumber(hand?.totalForce, null)
    ?? toNumber(hand?.total_force, null)
    ?? 0;
}

function getHandFingers(hand) {
  const fingers = hand?.fingers || hand?.peakInfo?.fingers;
  return Array.isArray(fingers) ? fingers : [];
}

function getHandShakeCount(hand) {
  return toNumber(hand?.shake_count ?? hand?.shakeCount, null);
}

export function extractGripMetrics(reportData = {}, patientInfo = {}) {
  const hands = [];
  if (reportData.left) hands.push({ label: '左手', forceN: getHandForceN(reportData.left), raw: reportData.left });
  if (reportData.right) hands.push({ label: '右手', forceN: getHandForceN(reportData.right), raw: reportData.right });
  if (!hands.length && reportData) {
    hands.push({ label: reportData.handType || reportData.hand || '测试手', forceN: getHandForceN(reportData), raw: reportData });
  }

  const maxHand = hands.reduce((best, item) => (item.forceN > (best?.forceN ?? -1) ? item : best), null);
  const maxKg = round((maxHand?.forceN || 0) / 9.8, 1) || 0;
  const threshold = gripThreshold(patientInfo?.gender);
  const ratio = threshold ? maxKg / threshold : 0;
  const leftKg = round((hands.find(h => h.label.includes('左'))?.forceN || 0) / 9.8, 1);
  const rightKg = round((hands.find(h => h.label.includes('右'))?.forceN || 0) / 9.8, 1);
  const diffPct = leftKg && rightKg
    ? round(Math.abs(leftKg - rightKg) / Math.max(leftKg, rightKg) * 100, 1)
    : null;

  // 增强指标数据源：以力值更大的一侧为主
  const mainRaw = maxHand?.raw || {};
  const fingers = getHandFingers(mainRaw);
  const shakeCount = getHandShakeCount(mainRaw);
  const peakDuration = toNumber(mainRaw.peak_duration ?? mainRaw.peakDuration, null);

  return { maxKg, threshold, ratio, maxHand: maxHand?.label || '-', leftKg, rightKg, diffPct, fingers, shakeCount, peakDuration };
}

// 核心硬指标：最大握力 R 值分档（18 分）
function gripCoreScore(ratio) {
  if (ratio >= 1.10) return 18;
  if (ratio >= 1.00) return 15;
  if (ratio >= 0.85) return 11;
  if (ratio >= 0.70) return 7;
  return 3;
}

// 增强：手指贡献均衡性（0-2）
// 文档要求："贡献均衡/无明显代偿给高分；单指贡献明显异常降低给低分"
// 用 最强指/最弱指 力值比衡量均衡性，同时抓住两种"单指异常"：
//   - 某指独大（如中风后只有个别手指能用力）→ 比值大
//   - 某指过弱/几乎不出力（如扳机指、神经损伤）→ 比值更大
// 只看 5 根手指，排除手掌（抓握时手掌承重本就较大且正常，不计入手指均衡）
function gripFingerBalanceScore(fingers) {
  const fingerOnly = fingers.filter(f => {
    const name = String(f?.name || '').toLowerCase();
    // 排除手掌：前端 name 固定为"手掌"，兼容英文 key "palm"
    return name && !name.includes('掌') && !name.includes('palm');
  });
  const forces = fingerOnly.map(f => toNumber(f.force, 0) || 0);
  if (forces.length < 3) return { score: 1, desc: '手指分区数据不足，按中间档处理' };
  const maxF = Math.max(...forces);
  const minF = Math.min(...forces);
  if (maxF <= 0) return { score: 1, desc: '手指分区力值无效，按中间档处理' };
  const ratio = minF > 0 ? maxF / minF : Infinity; // 最强指/最弱指
  const ratioText = ratio === Infinity ? '∞（某指几乎无力）' : ratio.toFixed(1);
  if (ratio <= 2.5) return { score: 2, desc: `各指贡献均衡（最强/最弱=${ratioText}），无明显代偿` };
  if (ratio <= 4.0) return { score: 1, desc: `手指贡献轻度不均（最强/最弱=${ratioText}）` };
  return { score: 0, desc: `单指贡献明显异常（最强/最弱=${ratioText}），提示某指过强或过弱` };
}

// 增强：抓握稳定性（0-3）
function gripStabilityScore(shakeCount, peakDuration) {
  if (shakeCount == null) return { score: 2, desc: '抖动数据缺失，按中间档处理' };
  if (shakeCount <= 2) {
    if (peakDuration != null && peakDuration < 0.5) return { score: 2, desc: '抖动少但峰值维持时间偏短' };
    return { score: 3, desc: '力-时间曲线平稳，维持能力好' };
  }
  if (shakeCount <= 5) return { score: 2, desc: '存在轻度抖动' };
  if (shakeCount <= 10) return { score: 1, desc: '抖动较多，握持稳定性下降' };
  return { score: 0, desc: '明显抖动/早衰减，稳定性差' };
}

// 增强：左右手差异（0-2）
function gripSymmetryScore(diffPct) {
  if (diffPct == null) return { score: 1, desc: '仅单手数据，无法对比，按中间档处理' };
  if (diffPct <= 10) return { score: 2, desc: '双手差异小，对称性好' };
  if (diffPct <= 20) return { score: 1, desc: '双手存在一定差异' };
  return { score: 0, desc: '双手差异明显，提示偏侧功能下降' };
}

export function scoreGrip(reportData, patientInfo) {
  const m = extractGripMetrics(reportData, patientInfo);

  // ============ 数据有效性硬性校验（防呆） ============
  const invalidReasons = [];
  if (m.maxKg <= 0) invalidReasons.push('未采集到有效握力数据');
  if (m.maxKg > 0 && m.maxKg < 5) invalidReasons.push(`最大握力仅 ${m.maxKg}kg，远低于正常人最低水平，可能只是手指触碰未真实握紧`);

  if (invalidReasons.length > 0) {
    return makeResult({
      type: 'grip',
      title: '握力评分',
      score: 0,
      metrics: m,
      indicators: [
        { label: '最大握力', value: m.maxKg ? `${m.maxKg}kg` : '--' },
        { label: '参考阈值', value: `${m.threshold}kg` },
      ],
      summary: '本次采集数据不足以反映真实握力，建议规范佩戴手套后用最大力量持续握紧 3-5 秒再做评估。',
      redFlags: invalidReasons,
      priorityRisk: true,
      invalid: true,
      grade: { text: '数据异常', color: C.red, bg: '#FEF2F2' },
      note: '数据有效性未通过，无法做出能力判断。按 V3 数据质量原则，不计入综合分并建议复测。',
    });
  }
  // ============ 防呆结束 ============

  const core = gripCoreScore(m.ratio);
  const finger = gripFingerBalanceScore(m.fingers);
  const stability = gripStabilityScore(m.shakeCount, m.peakDuration);
  const symmetry = gripSymmetryScore(m.diffPct);
  const enhanced = finger.score + stability.score + symmetry.score;
  const score = Math.round(core + enhanced);

  const breakdown = [
    { label: '最大握力（核心）', group: 'core', score: core, max: 18, desc: `R=${m.ratio ? m.ratio.toFixed(2) : '--'}（实测/${m.threshold}kg 阈值）`,
      help: 'R = 实测最大握力 / 性别参考阈值（男 28kg、女 18kg）。R≥1.10=18分，1.00–1.09=15，0.85–0.99=11，0.70–0.84=7，<0.70=3。依据 AWGS 2019 肌少症筛查标准。' },
    { label: '手指贡献均衡性', group: 'enhanced', score: finger.score, max: 2, desc: finger.desc,
      help: '用 5 根手指（排除手掌）的「最强指力 / 最弱指力」比值衡量。比值≤2.5=2分（均衡），≤4.0=1分，>4.0=0分（单指过强独大 或 某指过弱几乎不出力）。' },
    { label: '抓握稳定性', group: 'enhanced', score: stability.score, max: 3, desc: stability.desc,
      help: '基于手套 IMU 检测抓握过程中的抖动次数（角速度>30°/s 的快速晃动计 1 次）。抖动≤2次=3分，≤5次=2分，≤10次=1分，>10次=0分。' },
    { label: '左右手差异', group: 'enhanced', score: symmetry.score, max: 2, desc: symmetry.desc,
      help: '差异 = |左手 − 右手| / 较大侧。差异≤10%=2分，≤20%=1分，>20%=0分。差异越小说明双手肌力越对称。' },
  ];

  const redFlags = [];
  if (m.maxKg > 0 && m.maxKg < m.threshold) {
    redFlags.push(`${patientInfo?.gender === '男' ? '男性' : '女性'}最大握力低于 ${m.threshold}kg 参考阈值`);
  }
  if (m.diffPct != null && m.diffPct >= 20) {
    redFlags.push(`左右握力差异约 ${m.diffPct}%`);
  }
  if (stability.score <= 1 && m.shakeCount != null) {
    redFlags.push(`抓握过程抖动 ${m.shakeCount} 次，握持稳定性下降`);
  }

  const summary = score >= 20
    ? `最大握力约 ${m.maxKg}kg（核心 ${core}/18 + 增强 ${enhanced}/7），上肢肌力与抓握质量整体较好。`
    : score >= 15
      ? `最大握力约 ${m.maxKg}kg（核心 ${core}/18 + 增强 ${enhanced}/7），肌力储备或抓握质量需要继续观察。`
      : `最大握力约 ${m.maxKg}kg（核心 ${core}/18 + 增强 ${enhanced}/7），提示肌肉力量储备不足风险增加。`;

  return makeResult({
    type: 'grip',
    title: '握力评分',
    score,
    metrics: m,
    indicators: [
      { label: '最大握力', value: `${m.maxKg || '--'}kg` },
      { label: '参考阈值', value: `${m.threshold}kg` },
      { label: '核心/增强', value: `${core}/18 + ${enhanced}/7` },
      ...(m.diffPct != null ? [{ label: '左右差异', value: `${m.diffPct}%` }] : []),
    ],
    summary,
    redFlags,
    priorityRisk: redFlags.some(text => text.includes('低于')),
    breakdown,
    note: 'V3 握力评分 = 核心 18 分（R≥1.10=18，1.00–1.09=15，0.85–0.99=11，0.70–0.84=7，<0.70=3）+ 增强 7 分（手指贡献均衡 2 + 抓握稳定性 3 + 左右手差异 2）。手指贡献均衡用5根手指(排除手掌)的最强指/最弱指力值比：≤2.5=2分（均衡），≤4.0=1分，>4.0=0分（单指过强或过弱）。',
  });
}

// ────────────────────────────────────────────────────────────────
// 起坐评估（25 = 核心 18 + 增强 7）
// ────────────────────────────────────────────────────────────────

export function extractSitStandMetrics(reportData = {}) {
  const ds = reportData.duration_stats || {};
  const ps = reportData.pressure_stats || {};
  const sym = reportData.symmetry || {};
  const totalDuration = toNumber(ds.total_duration, 0);
  const numCycles = toNumber(ds.num_cycles, 0);
  const avgDuration = toNumber(ds.avg_duration, null);
  const cycleDurations = Array.isArray(ds.cycle_durations) ? ds.cycle_durations.map(v => toNumber(v, 0)).filter(Boolean) : [];
  const cyclePeakForces = Array.isArray(reportData.cycle_peak_forces)
    ? reportData.cycle_peak_forces.map(v => toNumber(v, 0))
    : [];
  const footMax = toNumber(ps.foot_max, 0);
  const footAvg = toNumber(ps.foot_avg, 0);
  const sitMax = toNumber(ps.sit_max, 0);
  const sitAvg = toNumber(ps.sit_avg, 0);
  // 坐站力-时间曲线平滑度（总变差/净变化比，≈1 最平滑，越大越代偿；与帧率、幅度无关）
  const forceCurveSmoothness = toNumber(ps.force_curve_smoothness, null);
  const maxCyclePeak = cyclePeakForces.length > 0 ? Math.max(...cyclePeakForces) : 0;
  const leftRightRatio = toNumber(sym.left_right_ratio, null);
  return {
    totalDuration, numCycles, avgDuration, cycleDurations, cyclePeakForces,
    footMax, footAvg, sitMax, sitAvg, forceCurveSmoothness,
    maxCyclePeak, leftRightRatio,
  };
}

// 核心硬指标：5次起坐总时长（18 分）
function sitstandCoreScore(totalDuration) {
  if (totalDuration <= 0) return 0;
  if (totalDuration <= 10) return 18;
  if (totalDuration <= 12) return 15;
  if (totalDuration <= 15) return 10;
  if (totalDuration <= 20) return 5;
  return 2;
}

// 增强：单次起坐周期稳定性（0-2）
function sitstandCycleStabilityScore(cycleDurations) {
  if (!cycleDurations.length || cycleDurations.length < 3) {
    return { score: 1, desc: '周期数据不足，按中间档处理' };
  }
  const mean = cycleDurations.reduce((a, b) => a + b, 0) / cycleDurations.length;
  if (mean <= 0) return { score: 1, desc: '周期数据无效，按中间档处理' };
  const variance = cycleDurations.reduce((s, v) => s + (v - mean) ** 2, 0) / cycleDurations.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv <= 0.10) return { score: 2, desc: '每次起坐耗时稳定' };
  if (cv <= 0.25) return { score: 1, desc: '周期存在一定波动' };
  return { score: 0, desc: '周期波动大或逐次变慢' };
}

// 增强：左右负重对称性（0-2）
function sitstandSymmetryScore(leftRightRatio) {
  if (leftRightRatio == null) return { score: 1, desc: '对称性数据缺失，按中间档处理' };
  if (leftRightRatio >= 85) return { score: 2, desc: '左右负重均衡' };
  if (leftRightRatio >= 70) return { score: 1, desc: '左右负重存在一定偏侧' };
  return { score: 0, desc: '明显偏向一侧，提示代偿' };
}

// 增强：坐站压力变化曲线（0-2）—— 评估"启动顺畅、曲线平滑 vs 迟滞/代偿"
// 原理：健康起坐 = 一条干净的单调上升力曲线；代偿(前后晃身攒劲、撑两次才起来) = 曲线反复上下、多个小峰。
// 用总变差/净变化比(TV/range)衡量平滑度（后端已算好，与帧率、力幅度均无关）：
//   - ≈1.0：一气呵成的单调上升，启动顺畅、曲线平滑 → 高分
//   - >1.3：上升过程有明显回落/震荡，提示迟滞或代偿 → 低分
function sitstandForceCurveScore(forceCurveSmoothness) {
  if (forceCurveSmoothness == null) {
    return { score: 1, desc: '力-时间曲线数据不足，按中间档处理' };
  }
  if (forceCurveSmoothness <= 1.15) return { score: 2, desc: '启动顺畅、曲线平滑，一气呵成' };
  if (forceCurveSmoothness <= 1.40) return { score: 1, desc: '曲线存在轻度波动，启动略有迟滞' };
  return { score: 0, desc: '曲线反复震荡，提示起身迟滞或代偿（晃身攒劲/多次起身）' };
}

// 增强：重心转移/COP（0-1）
function sitstandCopScore(leftRightRatio, cycleDurations) {
  const symBad = leftRightRatio != null && leftRightRatio < 70;
  let cvBad = false;
  if (cycleDurations.length >= 3) {
    const mean = cycleDurations.reduce((a, b) => a + b, 0) / cycleDurations.length;
    if (mean > 0) {
      const variance = cycleDurations.reduce((s, v) => s + (v - mean) ** 2, 0) / cycleDurations.length;
      cvBad = Math.sqrt(variance) / mean > 0.30;
    }
  }
  if (symBad || cvBad) return { score: 0, desc: '重心转移过程存在明显晃动或偏移' };
  return { score: 1, desc: '重心转移过程稳定' };
}

export function scoreSitStand(reportData) {
  const m = extractSitStandMetrics(reportData);

  // ============ 数据有效性硬性校验（防呆） ============
  const invalidReasons = [];
  if (m.numCycles > 0 && m.numCycles < 3) invalidReasons.push(`完整周期数仅 ${m.numCycles} 次，未达到通常要求的 5 次完整起坐标准`);
  if (m.totalDuration > 0 && m.totalDuration < 5) invalidReasons.push(`总时长 ${round(m.totalDuration, 1)}s 过短，未完成完整 5 次起坐`);
  if (m.maxCyclePeak === 0 && m.cyclePeakForces.length > 0) invalidReasons.push('各周期峰值力均为 0，力值检测异常，可能采集设备故障或信号丢失');
  if (m.maxCyclePeak > 0 && m.maxCyclePeak < 50) invalidReasons.push(`周期峰值力最大仅 ${round(m.maxCyclePeak, 1)}N，远低于正常起坐应有的力值`);
  // 起坐必须同时有坐垫(坐下)和足垫(站起)两路压力；缺任意一路即数据不完整，直接判数据异常
  const seatMissing = m.sitMax <= 0 && m.sitAvg <= 0;
  const footMissing = m.footMax <= 0 && m.footAvg <= 0;
  if (seatMissing && footMissing) {
    invalidReasons.push('坐垫与足垫均未采集到压力数据，设备可能未连接或未正确摆放');
  } else if (seatMissing) {
    invalidReasons.push('坐垫未采集到压力数据，数据不完整（仅足垫有数据），无法评估完整起坐过程');
  } else if (footMissing) {
    invalidReasons.push('足垫未采集到压力数据，数据不完整（仅坐垫有数据），无法评估站立发力过程');
  }
  // 两路都有数据、但明显过低（仅触碰/未完成）
  if (m.footMax > 0 && m.footMax < 50) invalidReasons.push(`脚垫最大压力 ${round(m.footMax, 1)} 过低，未捕捉到站立瞬间的发力`);
  if (m.sitMax > 0 && m.sitMax < 100) invalidReasons.push(`坐垫最大压力 ${round(m.sitMax, 1)} 过低，未捕捉到完整坐姿`);
  if (m.totalDuration <= 0 && m.numCycles <= 0) invalidReasons.push('总时长与周期数均为 0，未形成有效起坐数据');

  if (invalidReasons.length > 0) {
    return makeResult({
      type: 'sitstand',
      title: '起坐评分',
      score: 0,
      metrics: m,
      indicators: [
        { label: '总时长', value: m.totalDuration ? `${round(m.totalDuration, 1)}s` : '--' },
        { label: '完成次数', value: m.numCycles ? `${m.numCycles}次` : '--' },
        { label: '关注线', value: '>12s' },
      ],
      summary: '本次采集数据不足以反映真实起坐能力，建议检查压力传感设备是否正常连接，重新规范完成 5 次完整起坐测试。',
      redFlags: invalidReasons,
      priorityRisk: true,
      invalid: true,
      grade: { text: '数据异常', color: C.red, bg: '#FEF2F2' },
      note: '数据有效性未通过，无法做出能力判断。按 V3 数据质量原则，不计入综合分并建议复测。',
    });
  }
  // ============ 防呆结束 ============

  const core = sitstandCoreScore(m.totalDuration);
  const cycleStability = sitstandCycleStabilityScore(m.cycleDurations);
  const symmetry = sitstandSymmetryScore(m.leftRightRatio);
  const forceCurve = sitstandForceCurveScore(m.forceCurveSmoothness);
  const cop = sitstandCopScore(m.leftRightRatio, m.cycleDurations);
  const enhanced = cycleStability.score + symmetry.score + forceCurve.score + cop.score;
  const score = Math.round(core + enhanced);

  const breakdown = [
    { label: '5次起坐总时长（核心）', group: 'core', score: core, max: 18, desc: `${round(m.totalDuration, 1)}s`,
      help: '5 次连续起坐的总耗时。≤10s=18分，10–12s=15，12–15s=10，15–20s=5，>20s 或需辅助=2，无法完成=0。与下肢功能/SPPB 相关。' },
    { label: '周期稳定性', group: 'enhanced', score: cycleStability.score, max: 2, desc: cycleStability.desc,
      help: '用每次起坐耗时的变异系数 CV=标准差/平均值 衡量节律是否一致。CV≤10%=2分，≤25%=1分，>25%=0分（逐次变慢或忽快忽慢）。' },
    { label: '左右负重对称性', group: 'enhanced', score: symmetry.score, max: 2, desc: symmetry.desc,
      help: '基于脚垫数据，对称性 = 弱侧脚平均力 / 强侧脚平均力 ×100%（5 个周期所有帧合并平均）。≥85%=2分，70–85%=1分，<70%=0分。' },
    { label: '坐站压力变化曲线', group: 'enhanced', score: forceCurve.score, max: 2, desc: forceCurve.desc,
      help: '评估起身力曲线是否平滑（启动顺畅 vs 迟滞/代偿）。用力-时间曲线的「总变差/净变化」比：≤1.15=2分（一气呵成），≤1.40=1分，>1.40=0分（晃身攒劲/撑两次）。与帧率、力幅度无关。' },
    { label: '重心转移/COP', group: 'enhanced', score: cop.score, max: 1, desc: cop.desc,
      help: '用左右对称性(<70%)与周期节律(CV>30%)作代理判断重心转移是否稳定。两者都不触发=1分，任一触发=0分。注：当前为代理判断，非真实 COP 轨迹。' },
  ];

  const redFlags = [];
  if (m.totalDuration > 12) redFlags.push('5次起坐时间超过 12s 身体功能关注阈值');
  if (m.totalDuration > 20) redFlags.push('5次起坐超过 20s，坐站转移能力明显下降，建议进一步评估下肢肌力与衰弱风险');
  if (m.numCycles > 0 && m.numCycles < 5) redFlags.push(`有效起坐次数为 ${m.numCycles} 次，建议复核完整性`);
  if (symmetry.score === 0) redFlags.push('起坐过程明显偏向一侧，提示偏侧代偿');
  if (forceCurve.score === 0) redFlags.push('起身力曲线反复震荡，提示启动迟滞或代偿（晃身攒劲/多次起身），建议关注下肢爆发力与动作模式');

  const summary = score >= 20
    ? `5次起坐总时长约 ${round(m.totalDuration, 1)}s（核心 ${core}/18 + 增强 ${enhanced}/7），下肢起身能力与动作质量整体尚可。`
    : score >= 15
      ? `5次起坐总时长约 ${round(m.totalDuration, 1)}s（核心 ${core}/18 + 增强 ${enhanced}/7），接近或超过关注线，提示下肢力量与动作效率需观察。`
      : `5次起坐总时长约 ${round(m.totalDuration, 1)}s（核心 ${core}/18 + 增强 ${enhanced}/7），起身速度偏慢或动作质量下降，提示下肢功能下降风险需要重点关注。`;

  return makeResult({
    type: 'sitstand',
    title: '起坐评分',
    score,
    metrics: m,
    indicators: [
      { label: '总时长', value: m.totalDuration ? `${round(m.totalDuration, 1)}s` : '--' },
      { label: '完成次数', value: m.numCycles ? `${m.numCycles}次` : '--' },
      { label: '核心/增强', value: `${core}/18 + ${enhanced}/7` },
      { label: '关注线', value: '>12s' },
    ],
    summary,
    redFlags,
    priorityRisk: m.totalDuration > 12,
    breakdown,
    note: 'V3 起坐评分 = 核心 18 分（≤10s=18，10–12s=15，12–15s=10，15–20s=5，>20s=2）+ 增强 7 分（周期稳定性 2 + 左右负重对称 2 + 坐站压力变化曲线 2 + 重心转移 1）。坐站压力变化曲线用力-时间曲线平滑度判断"启动顺畅、曲线平滑 vs 迟滞/代偿"：总变差/净变化比 ≤1.15=2分（一气呵成），≤1.40=1分，>1.40=0分（反复震荡/代偿）。该比值与帧率、力幅度均无关。',
  });
}

// ────────────────────────────────────────────────────────────────
// 步态评估（25 = 核心 18 + 增强 7）
// ────────────────────────────────────────────────────────────────

export function extractGaitMetrics(reportData = {}) {
  const gp = reportData.gaitParams || {};
  const walkingSpeed = toNumber(gp.walkingSpeed, 0);
  const leftStepTime = toNumber(gp.leftStepTime, 0);
  const rightStepTime = toNumber(gp.rightStepTime, 0);
  const leftStepLength = toNumber(gp.leftStepLength, 0);
  const rightStepLength = toNumber(gp.rightStepLength, 0);
  const stepWidth = toNumber(gp.stepWidth, null);
  const doubleContactTime = toNumber(gp.doubleContactTime, null);
  const leftFPA = toNumber(gp.leftFPA, null);
  const rightFPA = toNumber(gp.rightFPA, null);
  return {
    walkingSpeed,
    leftStepTime,
    rightStepTime,
    stepTimeDiff: round(Math.abs(leftStepTime - rightStepTime), 3) || 0,
    leftStepLength,
    rightStepLength,
    stepLengthDiff: round(Math.abs(leftStepLength - rightStepLength), 1) || 0,
    stepWidth,
    doubleContactTime,
    leftFPA,
    rightFPA,
  };
}

// 核心硬指标：日常步速（18 分）
function gaitCoreScore(walkingSpeed) {
  if (walkingSpeed <= 0) return 0;
  if (walkingSpeed >= 1.0) return 18;
  if (walkingSpeed >= 0.8) return 14;
  if (walkingSpeed >= 0.6) return 9;
  return 4;
}

// 增强：步长/步宽合理性（0-2）
function gaitStepGeometryScore(leftStepLength, rightStepLength, stepWidth) {
  const avgLen = (leftStepLength + rightStepLength) / 2;
  if (avgLen <= 0) return { score: 1, desc: '步长数据缺失，按中间档处理' };
  const lenBad = avgLen < 30;
  const lenWarn = avgLen < 40;
  const widthBad = stepWidth != null && (stepWidth > 25 || stepWidth < 5);
  const widthWarn = stepWidth != null && stepWidth > 20;
  if (lenBad || widthBad) return { score: 0, desc: '步长过短或步宽异常，代偿明显' };
  if (lenWarn || widthWarn) return { score: 1, desc: '步长偏短或步宽偏大' };
  return { score: 2, desc: '步长/步宽在合理范围' };
}

// 增强：双支撑期占比（0-2）
function gaitDoubleSupportScore(doubleContactTime) {
  if (doubleContactTime == null) return { score: 1, desc: '双支撑数据缺失，按中间档处理' };
  if (doubleContactTime <= 0.30) return { score: 2, desc: '双支撑时间正常，步态过渡干脆' };
  if (doubleContactTime <= 0.45) return { score: 1, desc: '双支撑时间偏长，步态偏谨慎' };
  return { score: 0, desc: '双支撑时间明显延长，提示谨慎/不稳步态' };
}

// 增强：足偏角 FPA（0-1）
function gaitFpaScore(leftFPA, rightFPA) {
  if (leftFPA == null && rightFPA == null) return { score: 0.5, desc: '足偏角数据缺失，按中间档处理' };
  const l = Math.abs(leftFPA ?? 0);
  const r = Math.abs(rightFPA ?? 0);
  const diff = Math.abs((leftFPA ?? 0) - (rightFPA ?? 0));
  if (l > 20 || r > 20 || diff > 10) return { score: 0, desc: '明显内八/外八或左右足偏角差异大' };
  return { score: 1, desc: '足偏角在正常范围' };
}

// 增强：左右步态对称性（0-1）
function gaitSymmetryScore(stepLengthDiff, stepTimeDiff) {
  if (stepLengthDiff < 6 && stepTimeDiff < 0.12) return { score: 1, desc: '左右步长、步时基本对称' };
  return { score: 0, desc: '左右步态存在不对称' };
}

// 增强：足底动态压力分布（0-1）
function gaitDynamicPressureScore(walkingSpeed, stepGeometry, doubleSupport) {
  if (walkingSpeed <= 0) return { score: 0.5, desc: '动态压力数据不足，按中间档处理' };
  if (stepGeometry.score === 2 && doubleSupport.score >= 1) {
    return { score: 1, desc: '着地—过渡—蹬伸压力模式合理' };
  }
  if (stepGeometry.score === 0 || doubleSupport.score === 0) {
    return { score: 0, desc: '动态压力过程存在明显代偿特征' };
  }
  return { score: 0.5, desc: '动态压力模式基本合理，个别环节欠佳' };
}

export function scoreGait(reportData) {
  const m = extractGaitMetrics(reportData);

  // ============ 数据有效性硬性校验（防呆） ============
  const invalidReasons = [];
  if (m.walkingSpeed <= 0 && m.leftStepLength <= 0 && m.rightStepLength <= 0) {
    invalidReasons.push('未采集到有效步态数据（步速与步长均为 0），可能未完成有效行走');
  }

  if (invalidReasons.length > 0) {
    return makeResult({
      type: 'gait',
      title: '步态评分',
      score: 0,
      metrics: m,
      indicators: [
        { label: '步速', value: '--' },
        { label: '参考线', value: '≥1.0m/s' },
      ],
      summary: '本次采集数据不足以反映真实步态能力，建议在步道上完成至少 4-6 个完整步态周期后再做评估。',
      redFlags: invalidReasons,
      priorityRisk: true,
      invalid: true,
      grade: { text: '数据异常', color: C.red, bg: '#FEF2F2' },
      note: '数据有效性未通过，无法做出能力判断。按 V3 数据质量原则，不计入综合分并建议复测。',
    });
  }
  // ============ 防呆结束 ============

  const core = gaitCoreScore(m.walkingSpeed);
  const stepGeometry = gaitStepGeometryScore(m.leftStepLength, m.rightStepLength, m.stepWidth);
  const doubleSupport = gaitDoubleSupportScore(m.doubleContactTime);
  const fpa = gaitFpaScore(m.leftFPA, m.rightFPA);
  const symmetry = gaitSymmetryScore(m.stepLengthDiff, m.stepTimeDiff);
  const dynamicPressure = gaitDynamicPressureScore(m.walkingSpeed, stepGeometry, doubleSupport);
  const enhanced = stepGeometry.score + doubleSupport.score + fpa.score + symmetry.score + dynamicPressure.score;
  const score = Math.round(core + enhanced);

  const breakdown = [
    { label: '日常步速（核心）', group: 'core', score: core, max: 18, desc: `${round(m.walkingSpeed, 2)}m/s`,
      help: '行走全程平均速度=总距离/总时间。≥1.0m/s=18分，0.8–1.0=14，0.6–0.8=9，<0.6=4，无法独立完成=0。依据 AWGS 2019，步速是核心步态指标。' },
    { label: '步长/步宽合理性', group: 'enhanced', score: stepGeometry.score, max: 2, desc: stepGeometry.desc,
      help: '平均步长 ≥40cm 且步宽正常=2分；步长 30–40cm 或步宽偏大=1分；步长<30cm 或步宽异常=0分。步长过短/步宽过宽提示代偿。' },
    { label: '双支撑期占比', group: 'enhanced', score: doubleSupport.score, max: 2, desc: doubleSupport.desc,
      help: '双脚同时着地的时间。≤0.30s=2分，≤0.45s=1分，>0.45s=0分。双支撑期延长提示走得小心翼翼、平衡不稳。' },
    { label: '足偏角FPA', group: 'enhanced', score: fpa.score, max: 1, desc: fpa.desc,
      help: '脚尖相对行进方向的外展角。左右均≤20° 且左右差≤10°=1分；明显内八/外八(>20°)或左右差>10°=0分。' },
    { label: '左右步态对称性', group: 'enhanced', score: symmetry.score, max: 1, desc: symmetry.desc,
      help: '步长差<6cm 且步时差<0.12s=1分，否则=0分。左右越对称，步态越稳、关节磨损越均匀。' },
    { label: '足底动态压力分布', group: 'enhanced', score: dynamicPressure.score, max: 1, desc: dynamicPressure.desc,
      help: '综合步长步宽与双支撑判断着地—过渡—蹬伸的压力模式是否合理。模式合理=1分，存在明显代偿特征=0分。' },
  ];

  const redFlags = [];
  if (m.walkingSpeed > 0 && m.walkingSpeed < 0.6) redFlags.push('步速低于 0.6m/s，步态能力明显下降，提示活动能力下降和跌倒风险需关注');
  else if (m.walkingSpeed > 0 && m.walkingSpeed < 1.0) redFlags.push('步速低于 1.0m/s 身体功能关注阈值');
  if (m.stepLengthDiff >= 6) redFlags.push(`左右步长差约 ${m.stepLengthDiff}cm`);
  if (m.stepTimeDiff >= 0.12) redFlags.push(`左右步时差约 ${m.stepTimeDiff}s`);
  if (doubleSupport.score === 0) redFlags.push('双支撑时间明显延长，提示谨慎/不稳步态');

  const summary = score >= 20
    ? `日常步速约 ${round(m.walkingSpeed, 2)}m/s（核心 ${core}/18 + 增强 ${round(enhanced, 1)}/7），行动能力与步态质量基础较好。`
    : score >= 15
      ? `日常步速约 ${round(m.walkingSpeed, 2)}m/s（核心 ${core}/18 + 增强 ${round(enhanced, 1)}/7），略低于理想水平，建议关注行走效率和左右对称性。`
      : `日常步速约 ${round(m.walkingSpeed, 2)}m/s（核心 ${core}/18 + 增强 ${round(enhanced, 1)}/7），提示行动能力下降风险增加。`;

  return makeResult({
    type: 'gait',
    title: '步态评分',
    score,
    metrics: m,
    indicators: [
      { label: '步速', value: `${round(m.walkingSpeed, 2) || '--'}m/s` },
      { label: '核心/增强', value: `${core}/18 + ${round(enhanced, 1)}/7` },
      { label: '步长差', value: `${m.stepLengthDiff || 0}cm` },
      { label: '步宽', value: m.stepWidth != null ? `${round(m.stepWidth, 1)}cm` : '--' },
    ],
    summary,
    redFlags,
    priorityRisk: m.walkingSpeed > 0 && m.walkingSpeed < 0.6,
    breakdown,
    note: 'V3 步态评分 = 核心 18 分（≥1.0m/s=18，0.8–1.0=14，0.6–0.8=9，<0.6=4）+ 增强 7 分（步长/步宽 2 + 双支撑期 2 + 足偏角 1 + 左右对称 1 + 动态压力 1）。',
  });
}

// ────────────────────────────────────────────────────────────────
// 静态站立评估（25 = 核心 18 + 增强 7）
// 核心 18 = 四阶段平衡 10 + COP 稳态 5 + 左右负荷偏移 3
// ────────────────────────────────────────────────────────────────

function calcPressureRatioFromPeakFrame(peak) {
  if (!Array.isArray(peak) || peak.length !== 4096) return null;
  let left = 0;
  let right = 0;
  for (let row = 0; row < 64; row += 1) {
    for (let col = 0; col < 64; col += 1) {
      const v = toNumber(peak[row * 64 + col], 0);
      if (col < 32) left += v;
      else right += v;
    }
  }
  const total = left + right;
  if (!total) return null;
  return {
    leftPressureRatio: round(left / total * 100, 1),
    rightPressureRatio: round(right / total * 100, 1),
  };
}

export function extractStandingMetrics(reportData = {}) {
  const isBackend = !!(reportData.additional_data || reportData.arch_features || reportData.cop_time_series);
  let leftArchIndex = null;
  let rightArchIndex = null;
  let leftPressureRatio = 50;
  let rightPressureRatio = 50;
  let cop = {};
  let explicit = {};
  let leftRegionPressure = null;
  let rightRegionPressure = null;

  if (isBackend) {
    const af = reportData.arch_features || {};
    const ad = reportData.additional_data || {};
    leftArchIndex = toNumber(af.left_foot?.area_index, null);
    rightArchIndex = toNumber(af.right_foot?.area_index, null);
    const ratio = calcPressureRatioFromPeakFrame(af.peak_frame_data);
    if (ratio) {
      leftPressureRatio = ratio.leftPressureRatio;
      rightPressureRatio = ratio.rightPressureRatio;
    } else if (ad.left_pressure_ratio != null || ad.right_pressure_ratio != null) {
      leftPressureRatio = toNumber(ad.left_pressure_ratio, 50);
      rightPressureRatio = toNumber(ad.right_pressure_ratio, 50);
    }
    cop = reportData.cop_time_series || {};
    explicit = reportData.score_inputs || reportData.standing_score || {};
    leftRegionPressure = reportData.left_region_pressure || af.left_foot?.region_pressure || null;
    rightRegionPressure = reportData.right_region_pressure || af.right_foot?.region_pressure || null;
  } else {
    leftArchIndex = toNumber(reportData.left?.archAnalysis?.archIndex ?? reportData.left?.archIndex, null);
    rightArchIndex = toNumber(reportData.right?.archAnalysis?.archIndex ?? reportData.right?.archIndex, null);
    leftPressureRatio = toNumber(reportData.bilateral?.leftPressureRatio, 50);
    rightPressureRatio = toNumber(reportData.bilateral?.rightPressureRatio, 50);
    cop = reportData.bilateral?.copMetrics || reportData.copTimeSeries || {};
    explicit = reportData.scoreInputs || reportData.standingScore || {};
    leftRegionPressure = reportData.left?.regionPressure || null;
    rightRegionPressure = reportData.right?.regionPressure || null;
  }

  const loadOffset = round(Math.abs(leftPressureRatio - rightPressureRatio), 1) || 0;
  const pathLength = toNumber(cop.path_length ?? cop.pathLength, null);
  const avgVelocity = toNumber(cop.avg_velocity ?? cop.avgVelocity, null);
  const maxDisplacement = toNumber(cop.max_displacement ?? cop.maxDisplacement, null);
  const contactArea = toNumber(cop.contact_area ?? cop.contactArea ?? cop.ellipseArea, null);
  const hasCopMetric = [pathLength, avgVelocity, maxDisplacement, contactArea].some(value => value != null && value > 0);
  const hasCopPathLength = pathLength != null && pathLength > 0;

  const explicitStage = toNumber(
    explicit.four_stage_level ?? explicit.fourStageLevel ?? explicit.balanceLevel ?? reportData.four_stage_balance_level,
    null,
  );
  const hasFourStageLevel = explicitStage != null;

  return {
    leftArchIndex,
    rightArchIndex,
    leftPressureRatio,
    rightPressureRatio,
    loadOffset,
    fourStageLevel: hasFourStageLevel ? clamp(explicitStage, 0, 4) : null,
    hasFourStageLevel,
    pathLength,
    hasCopPathLength,
    avgVelocity,
    maxDisplacement,
    contactArea,
    hasCopMetric,
    leftRegionPressure,
    rightRegionPressure,
  };
}

function archType(ai) {
  if (ai == null) return '-';
  if (ai < 0.21) return '高弓足';
  if (ai <= 0.26) return '正常足弓';
  return '扁平足';
}

// 核心：四阶段平衡等级（10 分）
function standingStageScore(fourStageLevel, hasFourStageLevel) {
  if (!hasFourStageLevel) return { score: 5, desc: '四阶段平衡结果待录入，按中等档保守处理' };
  if (fourStageLevel >= 4) return { score: 10, desc: '站立平衡稳定完成' };
  if (fourStageLevel >= 3) return { score: 8, desc: '较高等级，轻微不稳' };
  if (fourStageLevel >= 2) return { score: 5, desc: '中等等级' };
  if (fourStageLevel >= 1) return { score: 2, desc: '低等级' };
  return { score: 0, desc: '无法安全完成基础站立' };
}

// 核心：COP 稳态水平（5 分）
function standingCopSteadyScore(pathLength, hasCopPathLength) {
  if (!hasCopPathLength) return { score: 0, desc: 'COP 轨迹缺失，无法判断' };
  if (pathLength <= 1000) return { score: 5, desc: 'COP 稳定' };
  if (pathLength <= 1500) return { score: 3, desc: 'COP 轻度增大' };
  return { score: 1, desc: 'COP 明显增大' };
}

// 核心：左右负荷偏移（3 分）
function standingLoadScore(loadOffset) {
  if (loadOffset <= 10) return { score: 3, desc: `左右压力差 ${loadOffset}%，均衡` };
  if (loadOffset <= 15) return { score: 2, desc: `左右压力差 ${loadOffset}%，轻度偏移` };
  if (loadOffset <= 20) return { score: 1, desc: `左右压力差 ${loadOffset}%，偏移较明显` };
  return { score: 0, desc: `左右压力差 ${loadOffset}%，明显偏移` };
}

// 增强：足底压力分区合理性（0-2）
function standingRegionScore(leftRegion, rightRegion) {
  const regions = [leftRegion, rightRegion].filter(r => r && typeof r === 'object');
  if (!regions.length) return { score: 1, desc: '分区压力数据缺失，按中间档处理' };
  let worst = 2;
  for (const region of regions) {
    const fore = toNumber(region.forefoot ?? region.front ?? region['前足'], 0) || 0;
    const mid = toNumber(region.midfoot ?? region.middle ?? region['中足'], 0) || 0;
    const rear = toNumber(region.rearfoot ?? region.heel ?? region['后足'], 0) || 0;
    const total = fore + mid + rear;
    if (total <= 0) continue;
    const maxShare = Math.max(fore, mid, rear) / total;
    if (maxShare > 0.75) worst = Math.min(worst, 0);
    else if (maxShare > 0.60) worst = Math.min(worst, 1);
  }
  if (worst === 2) return { score: 2, desc: '前/中/后足压力无异常集中' };
  if (worst === 1) return { score: 1, desc: '局部区域压力偏高' };
  return { score: 0, desc: '压力明显集中于单一区域' };
}

// 增强：足弓/足型压力特征（0-1）
function standingArchScore(leftArchIndex, rightArchIndex) {
  if (leftArchIndex == null && rightArchIndex == null) {
    return { score: 0.5, desc: '足弓数据缺失，按中间档处理' };
  }
  const leftNormal = leftArchIndex == null || (leftArchIndex >= 0.21 && leftArchIndex <= 0.26);
  const rightNormal = rightArchIndex == null || (rightArchIndex >= 0.21 && rightArchIndex <= 0.26);
  if (leftNormal && rightNormal) return { score: 1, desc: '足弓/足型压力模式无明显异常' };
  return { score: 0, desc: `足弓形态异常：左${archType(leftArchIndex)}/右${archType(rightArchIndex)}` };
}

// 增强：COP 轨迹形态（0-2）
function standingCopShapeScore(avgVelocity, maxDisplacement) {
  if (avgVelocity == null && maxDisplacement == null) {
    return { score: 1, desc: 'COP 形态数据缺失，按中间档处理' };
  }
  const velBad = avgVelocity != null && avgVelocity > 30;
  const velWarn = avgVelocity != null && avgVelocity > 15;
  const dispBad = maxDisplacement != null && maxDisplacement > 50;
  const dispWarn = maxDisplacement != null && maxDisplacement > 25;
  if (velBad || dispBad) return { score: 0, desc: '轨迹漂移/扩散明显' };
  if (velWarn || dispWarn) return { score: 1, desc: '轨迹存在一定漂移' };
  return { score: 2, desc: '轨迹集中稳定' };
}

// 增强：AP/ML 稳定性（0-2）
function standingApMlScore(maxDisplacement, pathLength) {
  if (maxDisplacement == null && pathLength == null) {
    return { score: 1, desc: 'AP/ML 摆动数据缺失，按中间档处理' };
  }
  if (maxDisplacement != null) {
    if (maxDisplacement <= 25) return { score: 2, desc: '前后/内外侧摆动小' };
    if (maxDisplacement <= 50) return { score: 1, desc: '摆动幅度中等' };
    return { score: 0, desc: '前后/内外侧摆动明显' };
  }
  if (pathLength <= 1000) return { score: 2, desc: '整体摆动小' };
  if (pathLength <= 2200) return { score: 1, desc: '摆动幅度中等' };
  return { score: 0, desc: '整体摆动明显' };
}

export function scoreStanding(reportData) {
  const m = extractStandingMetrics(reportData);

  // ============ 数据有效性硬性校验（防呆） ============
  const invalidReasons = [];
  if (m.leftArchIndex == null && m.rightArchIndex == null && !m.hasCopMetric) {
    invalidReasons.push('足弓与 COP 稳定性数据均缺失');
  }
  if (m.leftPressureRatio === 50 && m.rightPressureRatio === 50 && !m.hasCopMetric && m.leftArchIndex == null) {
    invalidReasons.push('左右压力分布与稳定性数据均无有效采集，可能受试者未真正站立在足垫上');
  }
  // 注意：m.contactArea 实为 COP 置信椭圆面积（摆动范围），椭圆小=站得稳=好事，
  // 不能当成"足底接触面积"来判无效，否则会把稳定站立误判为数据异常。此处不做该校验。

  if (invalidReasons.length > 0) {
    return makeResult({
      type: 'standing',
      title: '静态站立评分',
      score: 0,
      metrics: m,
      indicators: [
        { label: '左足弓指数', value: m.leftArchIndex != null ? round(m.leftArchIndex, 2) : '--' },
        { label: '右足弓指数', value: m.rightArchIndex != null ? round(m.rightArchIndex, 2) : '--' },
        { label: 'COP 轨迹长度', value: m.pathLength != null ? `${round(m.pathLength, 1)}` : '--' },
      ],
      summary: '本次采集数据不足以反映真实静态平衡能力，建议确保受试者双脚完整站立在足垫上、保持自然站姿 10-15 秒后再做评估。',
      redFlags: invalidReasons,
      priorityRisk: true,
      invalid: true,
      grade: { text: '数据异常', color: C.red, bg: '#FEF2F2' },
      note: '数据有效性未通过，无法做出能力判断。按 V3 数据质量原则，不计入综合分并建议复测。',
    });
  }
  // ============ 防呆结束 ============

  const stage = standingStageScore(m.fourStageLevel, m.hasFourStageLevel);
  const copSteady = standingCopSteadyScore(m.pathLength, m.hasCopPathLength);
  const load = standingLoadScore(m.loadOffset);
  const core = stage.score + copSteady.score + load.score;

  const region = standingRegionScore(m.leftRegionPressure, m.rightRegionPressure);
  const arch = standingArchScore(m.leftArchIndex, m.rightArchIndex);
  const copShape = standingCopShapeScore(m.avgVelocity, m.maxDisplacement);
  const apml = standingApMlScore(m.maxDisplacement, m.pathLength);
  const enhanced = region.score + arch.score + copShape.score + apml.score;
  const score = Math.round(core + enhanced);

  const breakdown = [
    { label: '站立平衡（核心）', group: 'core', score: stage.score, max: 10, desc: stage.desc,
      help: '站立平衡能力。单阶段（双脚站立）模式下站稳=10分、无法稳定完成=0分；多阶段模式按双脚并立→半足距→全足距→单脚达到的等级计分（最高=10/较高=8/中等=5/低=2/无法=0）。缺失按中等档保守计 5 分。' },
    { label: 'COP 稳态水平（核心）', group: 'core', score: copSteady.score, max: 5, desc: copSteady.desc,
      help: '站立时足底压力中心(COP)的轨迹长度，反映重心摆动多少。≤1000mm=5分（稳），1001–1500mm=3分，>1500mm=1分，缺失=0。' },
    { label: '左右负荷偏移（核心）', group: 'core', score: load.score, max: 3, desc: load.desc,
      help: '左右脚承重的压力占比差。≤10%=3分，10–15%=2分，15–20%=1分，>20%=0分。差值越小说明双脚承重越均衡。' },
    { label: '足底压力分区合理性', group: 'enhanced', score: region.score, max: 2, desc: region.desc,
      help: '前足/中足/后足三区单区最高占比。≤60%=2分（无异常集中），60–75%=1分，>75%=0分（压力明显集中于单一区域）。' },
    { label: '足弓/足型压力特征', group: 'enhanced', score: arch.score, max: 1, desc: arch.desc,
      help: '足弓指数（中足面积占比）。0.21–0.26 为正常足弓，<0.21 高弓足，>0.26 扁平足。左右均正常=1分，存在高弓/扁平=0分。' },
    { label: 'COP 轨迹形态', group: 'enhanced', score: copShape.score, max: 2, desc: copShape.desc,
      help: '按 COP 平均速度与最大偏移判断轨迹是否漂移扩散。速度≤15mm/s 且偏移≤25mm=2分；速度≤30 或偏移≤50=1分；更大=0分。' },
    { label: 'AP/ML 稳定性', group: 'enhanced', score: apml.score, max: 2, desc: apml.desc,
      help: '前后(AP)/内外侧(ML)方向的最大摆动幅度。≤25mm=2分，≤50mm=1分，>50mm=0分。摆动越小姿势控制越好。' },
  ];

  const redFlags = [];
  if (!m.hasFourStageLevel) redFlags.push('缺少四阶段平衡测试结果，平衡等级项按中等档保守处理');
  if (m.hasFourStageLevel && m.fourStageLevel <= 0) redFlags.push('无法安全完成基础站立，基础平衡能力不足，建议进行安全防护和进一步临床评估');
  if (!m.hasCopPathLength) redFlags.push('缺少有效 COP 轨迹长度，COP 稳态项按"无法判断"计 0 分');
  if (m.loadOffset > 20) redFlags.push(`左右负荷偏移约 ${m.loadOffset}%`);
  if (m.hasCopPathLength && m.pathLength > 1500) redFlags.push(`COP 轨迹长度偏高，约 ${round(m.pathLength, 0)}mm`);
  const leftArch = archType(m.leftArchIndex);
  const rightArch = archType(m.rightArchIndex);
  if ((m.leftArchIndex != null && leftArch !== '正常足弓') || (m.rightArchIndex != null && rightArch !== '正常足弓')) {
    redFlags.push(`足弓形态：左脚${leftArch}，右脚${rightArch}`);
  }

  const copText = m.hasCopPathLength
    ? `COP轨迹长度约 ${round(m.pathLength, 0)}mm`
    : 'COP轨迹长度缺失';
  const summary = score >= 20
    ? `${copText}（核心 ${core}/18 + 增强 ${round(enhanced, 1)}/7），站立稳定性与左右负荷整体较均衡，静态平衡基础较好。`
    : score >= 15
      ? `${copText}（核心 ${core}/18 + 增强 ${round(enhanced, 1)}/7），站立时存在轻度重心波动或负荷偏移，建议关注平衡控制和日常防跌倒。`
      : `${copText}（核心 ${core}/18 + 增强 ${round(enhanced, 1)}/7），站立稳定性或左右负荷控制偏弱，提示平衡能力需要重点关注。`;

  return makeResult({
    type: 'standing',
    title: '静态站立评分',
    score,
    metrics: m,
    indicators: [
      { label: '四阶段等级', value: m.hasFourStageLevel ? `${round(m.fourStageLevel, 1)}/4` : '待录入' },
      { label: 'COP轨迹长度', value: m.hasCopPathLength ? `${round(m.pathLength, 0)}mm` : '未采集' },
      { label: '核心/增强', value: `${core}/18 + ${round(enhanced, 1)}/7` },
      { label: '足弓', value: `L ${leftArch} / R ${rightArch}` },
    ],
    summary,
    redFlags,
    priorityRisk: score <= 15 || m.loadOffset > 20 || (m.hasFourStageLevel && m.fourStageLevel <= 0),
    breakdown,
    note: 'V3 静态站立评分 = 核心 18 分（四阶段平衡 10 + COP 稳态 5：≤1000mm=5/1001–1500=3/>1500=1/缺失=0 + 左右负荷偏移 3：≤10%=3/≤15%=2/≤20%=1/>20%=0）+ 增强 7 分（足底分区 2 + 足弓足型 1 + COP 轨迹形态 2 + AP/ML 稳定性 2）。',
  });
}

// ────────────────────────────────────────────────────────────────
// 综合评分
// ────────────────────────────────────────────────────────────────

export function scoreAssessment(type, reportData, patientInfo = {}) {
  switch (type) {
    case 'grip':
      return scoreGrip(reportData, patientInfo);
    case 'sitstand':
      return scoreSitStand(reportData);
    case 'standing':
      return scoreStanding(reportData);
    case 'gait':
      return scoreGait(reportData);
    default:
      return null;
  }
}

const COMPREHENSIVE_ACTIONS = {
  grip: '握力球、弹力带、提物等上肢抗阻训练，同时观察蛋白质摄入、体重变化和慢病控制',
  gait: '规律步行、步幅对称练习、下肢力量和平衡训练，必要时评估鞋具或辅助具',
  standing: '扶椅平衡训练、站姿对称练习、足部支撑调整，以及居家防滑、照明和扶手管理',
  sitstand: '坐站训练、靠墙半蹲、踮脚训练和起身节律控制，训练时可扶椅背或扶手',
};

const COMPREHENSIVE_IMPACTS = {
  grip: '握力反映上肢肌力和整体肌肉力量储备，下降时可能影响提物、扶撑、起身辅助和跌倒后的自我保护能力',
  gait: '步态主要反映日常行走效率和左右对称性，下降时可能影响外出、转身、上下楼梯和过马路安全',
  standing: '静态站立反映重心控制、左右负荷和防跌倒基础，异常时在起夜、转身、湿滑地面或长时间站立时更需要小心',
  sitstand: '五次起坐反映下肢力量、坐下控制和日常转移能力，下降时可能影响如厕、从椅子起身、上下楼和疲劳耐受',
};

const COMPREHENSIVE_LEVEL_GUIDANCE = {
  '表现较好': '建议继续保持规律步行、下肢力量训练和平衡训练，每周至少2-3次适度锻炼；同时注意蛋白质摄入、睡眠、慢病管理和居家防滑，建议6-12个月复测一次。',
  '轻度关注': '建议围绕相对薄弱项进行1-3个月针对性训练并复测；如近期出现走路变慢、起身费力、容易疲劳或曾经跌倒，建议咨询社区医生或康复人员。',
  '中度关注': '建议加强下肢力量、坐站转移和平衡能力训练，并结合专业人员做进一步衰弱、肌少症或跌倒风险评估；日常避免独自进行快速转身、上下楼梯、夜间行走等高风险动作。',
  '重点关注': '建议把防跌倒和主要短板处理放在优先位置，尽快联系社区卫生服务中心、康复科或老年医学相关专业人员进一步评估；近期避免独自外出、快速起身、湿滑地面行走和长时间站立。',
};

function formatItemScore(item) {
  return `${ASSESSMENT_LABELS[item.type]}（${item.score}/${item.maxScore || 25}）`;
}

function formatCompactItemScore(item) {
  return `${ASSESSMENT_LABELS[item.type]}${item.score}/${item.maxScore || 25}`;
}

function joinChinese(items) {
  return items.filter(Boolean).join('；');
}

function buildComprehensiveSummary(totalScore, level, completedResults, redFlags = []) {
  if (!completedResults.length) {
    return '尚未形成完整综合评分，请先完成四项评估。';
  }

  const completedText = completedResults.length < 4
    ? `当前已完成 ${completedResults.length}/4 项，`
    : '';
  const sorted = [...completedResults].sort((a, b) => a.score - b.score);
  const lowItems = sorted.filter(item => item.score <= 15 || item.priorityRisk);
  const watchItems = sorted.filter(item => item.score > 15 && item.score < 20 && !item.priorityRisk);
  const hasAnyFlag = redFlags.length > 0;
  const mainItems = (lowItems.length ? lowItems : watchItems).slice(0, 2);
  const relativeItems = sorted.filter(item => item.score < (item.maxScore || 25));
  const itemText = completedResults.map(formatCompactItemScore).join('、');

  if (totalScore >= 80 && !lowItems.length && !watchItems.length) {
    const flagText = hasAnyFlag
      ? `同时看到局部提示：${redFlags.slice(0, 2).join('；')}。这些提示不等于综合功能差，更像是足部支撑、动作习惯或单项细节上的优化空间。`
      : '本次未见明显短板或红线提示。';
    return `${completedText}本次综合得分为 ${totalScore}/100，综合等级为"${level.text}"。先给您一个肯定的结论：本次四项结果整体较好，${itemText}，说明上肢肌力、日常行走、站立控制和起坐转移能力基础较稳，当前日常活动能力储备较好。${flagText}${COMPREHENSIVE_LEVEL_GUIDANCE['表现较好']}若之后出现跌倒、明显乏力、体重下降、走路变慢、疼痛麻木或起身安全感下降，可提前带报告咨询社区卫生服务中心、全科或老年医学科。`;
  }

  const focusItems = mainItems.length ? mainItems : relativeItems.slice(0, 2);
  const focusText = focusItems.length
    ? `相对薄弱项集中在${focusItems.map(formatItemScore).join('、')}`
    : '已完成项目没有明显低分，当前综合分主要受未完成项目或单项细节影响';
  const reasons = redFlags.slice(0, 3).join('；');
  const reasonText = reasons
    ? `触发提示包括：${reasons}。`
    : '目前未触发明确红线，但单项分数提示功能储备需要继续观察。';
  const actionTypes = [...new Set((focusItems.length ? focusItems : relativeItems.length ? relativeItems : [sorted[0]]).map(item => item.type))];
  const impactText = joinChinese(actionTypes.map(type => COMPREHENSIVE_IMPACTS[type])).replace(/；/g, '；');
  const actionText = joinChinese(actionTypes.map(type => COMPREHENSIVE_ACTIONS[type]));
  const levelAdvice = COMPREHENSIVE_LEVEL_GUIDANCE[level.text] || COMPREHENSIVE_LEVEL_GUIDANCE['轻度关注'];
  const doctorText = lowItems.length || totalScore < 60 || redFlags.length >= 2
    ? '如果近3个月有跌倒、起身困难、走路明显变慢、疼痛麻木、体重下降或多项分数偏低，建议带本报告到社区卫生服务中心、全科/老年医学科先做综合评估；需要训练方案时可转康复医学科，合并关节疼痛或神经症状时再按医生建议转骨科或神经内科。'
    : '若训练后1-3个月复测没有改善，或日常走路、上下楼、起身时安全感下降，可带报告咨询社区医生、全科或康复医学科。';

  return `${completedText}本次综合得分为 ${totalScore}/100，综合等级为"${level.text}"。四项得分为${itemText}，${focusText}。${reasonText}${impactText ? `${impactText}。` : '这些表现可能影响日常起身、步行、上下楼或防跌倒能力。'}建议优先围绕${actionText || '规律活动、力量训练和平衡训练'}制定训练和复测计划。${levelAdvice}${doctorText}`;
}

export function buildComprehensiveScoreResult(assessments = {}, patientInfo = {}) {
  const results = ['grip', 'gait', 'standing', 'sitstand'].map(type => {
    const reportData = assessments[type]?.report?.reportData || assessments[type]?.reportData || null;
    return assessments[type]?.completed && reportData
      ? scoreAssessment(type, reportData, patientInfo)
      : makeResult({
        type,
        title: `${ASSESSMENT_LABELS[type]}评分`,
        score: 0,
        summary: `${ASSESSMENT_LABELS[type]}尚未完成。`,
      });
  });

  const completedResults = results.filter(item => item.score > 0);
  const totalScore = results.reduce((sum, item) => sum + (item?.score || 0), 0);
  const level = overallLevel(totalScore, completedResults);
  const sorted = [...completedResults].sort((a, b) => a.score - b.score);
  const mainShortfall = sorted[0];
  const redFlags = completedResults.flatMap(item => item.redFlags.map(flag => `${ASSESSMENT_LABELS[item.type]}：${flag}`));
  const summary = buildComprehensiveSummary(totalScore, level, completedResults, redFlags);

  return {
    type: 'comprehensive',
    title: '综合评分',
    score: totalScore,
    maxScore: 100,
    level: level.text,
    color: level.color,
    bg: level.bg,
    summary,
    redFlags,
    priorityRisk: level.text === '重点关注',
    itemResults: results,
    completedCount: completedResults.length,
    mainShortfall: mainShortfall?.type || null,
    levelDesc: level.desc,
    indicators: results.map(item => ({
      label: ASSESSMENT_LABELS[item.type],
      value: `${item.score}/25`,
    })),
  };
}

export function scoreToAiContext(scoreResult) {
  if (!scoreResult) return null;
  return {
    type: scoreResult.type,
    score: scoreResult.score,
    max_score: scoreResult.maxScore,
    level: scoreResult.level,
    summary: scoreResult.summary,
    red_flags: scoreResult.redFlags || [],
    indicators: scoreResult.indicators || [],
    breakdown: scoreResult.breakdown || [],
    scoring_note: scoreResult.note || '',
  };
}
