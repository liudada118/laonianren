const C = {
  blue: '#0066CC',
  green: '#059669',
  amber: '#D97706',
  red: '#DC2626',
  purple: '#7C3AED',
};

export const REPORT_BASIS_TEXT =
  '依据说明：本系统依据《亚洲肌少症工作组（AWGS）2019 共识》及《社区老年人肌肉减少症筛查专家共识》构建早筛路径；握力参考男性 <28kg、女性 <18kg，步速参考 <1.0m/s，5次坐站参考 ≥12s。静态站立结合 CDC STEADI 四阶段平衡、SPPB/姿势图框架及本设备压力/COP轨迹长度指标，用于社区/居家功能风险提示，不作为疾病诊断。';

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
      text: '高度关注',
      color: C.red,
      bg: '#FEF2F2',
      desc: '多项功能表现明显下降或总分偏低，建议尽快进行专业评估。',
    };
  }
  if (hasPriorityRisk) {
    return {
      text: '重点关注',
      color: C.red,
      bg: '#FEF2F2',
      desc: '存在触发外部参考阈值或单项低分的项目，应优先处理主要短板。',
    };
  }
  if (totalScore >= 80) {
    return {
      text: '整体较好',
      color: C.green,
      bg: '#ECFDF5',
      desc: '力量、行走、站立和起坐能力整体基础较好，建议继续保持规律活动。',
    };
  }
  if (totalScore >= 60) {
    return {
      text: '轻度关注',
      color: C.amber,
      bg: '#FFFBEB',
      desc: '总体功能尚可，但已有单项轻度下降，建议针对短板训练并复测。',
    };
  }
  return {
    text: '中度关注',
    color: C.amber,
    bg: '#FFF7ED',
    desc: '多个功能维度表现一般，建议加强训练并结合专业评估。',
  };
}

function makeResult({ type, title, score, maxScore = 25, metrics = {}, indicators = [], summary, shortfalls = [], redFlags = [], priorityRisk = false, note = '' }) {
  const roundedScore = Math.round(toNumber(score, 0));
  const status = scoreStatus(roundedScore, maxScore);
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
  };
}

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

export function extractGripMetrics(reportData = {}, patientInfo = {}) {
  const hands = [];
  if (reportData.left) hands.push({ label: '左手', forceN: getHandForceN(reportData.left) });
  if (reportData.right) hands.push({ label: '右手', forceN: getHandForceN(reportData.right) });
  if (!hands.length && reportData) {
    hands.push({ label: reportData.handType || reportData.hand || '测试手', forceN: getHandForceN(reportData) });
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

  return { maxKg, threshold, ratio, maxHand: maxHand?.label || '-', leftKg, rightKg, diffPct };
}

export function scoreGrip(reportData, patientInfo) {
  const m = extractGripMetrics(reportData, patientInfo);
  let score = 5;
  if (m.ratio >= 1.1) score = 25;
  else if (m.ratio >= 1) score = 20;
  else if (m.ratio >= 0.85) score = 15;
  else if (m.ratio >= 0.7) score = 10;

  const redFlags = [];
  if (m.maxKg > 0 && m.maxKg < m.threshold) {
    redFlags.push(`${patientInfo?.gender === '男' ? '男性' : '女性'}最大握力低于 ${m.threshold}kg 参考阈值`);
  }
  if (m.diffPct != null && m.diffPct >= 20) {
    redFlags.push(`左右握力差异约 ${m.diffPct}%`);
  }

  const summary = score >= 20
    ? `最大握力约 ${m.maxKg}kg，已达到${m.threshold}kg参考阈值，上肢肌力基础较好。`
    : score >= 15
      ? `最大握力约 ${m.maxKg}kg，接近${m.threshold}kg参考阈值，肌力储备需要继续观察。`
      : `最大握力约 ${m.maxKg}kg，低于${m.threshold}kg参考阈值，提示肌肉力量储备不足风险增加。`;

  return makeResult({
    type: 'grip',
    title: '握力评分',
    score,
    metrics: m,
    indicators: [
      { label: '最大握力', value: `${m.maxKg || '--'}kg` },
      { label: '参考阈值', value: `${m.threshold}kg` },
      { label: '阈值比', value: m.ratio ? m.ratio.toFixed(2) : '--' },
      ...(m.diffPct != null ? [{ label: '左右差异', value: `${m.diffPct}%` }] : []),
    ],
    summary,
    redFlags,
    priorityRisk: redFlags.some(text => text.includes('低于')),
    note: '握力按性别阈值比 R 分层：R≥1.10 为25分，1.00-1.09 为20分，0.85-0.99 为15分，0.70-0.84 为10分，R<0.70 为5分。',
  });
}

export function extractSitStandMetrics(reportData = {}) {
  const ds = reportData.duration_stats || {};
  const totalDuration = toNumber(ds.total_duration, 0);
  const numCycles = toNumber(ds.num_cycles, 0);
  const avgDuration = toNumber(ds.avg_duration, null);
  const cycleDurations = Array.isArray(ds.cycle_durations) ? ds.cycle_durations.map(v => toNumber(v, 0)).filter(Boolean) : [];
  return { totalDuration, numCycles, avgDuration, cycleDurations };
}

export function scoreSitStand(reportData) {
  const m = extractSitStandMetrics(reportData);
  let score = 5;
  if (m.totalDuration > 0 && m.totalDuration <= 11.19) score = 25;
  else if (m.totalDuration > 0 && m.totalDuration <= 13.69) score = 20;
  else if (m.totalDuration > 0 && m.totalDuration <= 16.69) score = 15;
  else if (m.totalDuration > 0 && m.totalDuration <= 60) score = 10;

  const redFlags = [];
  if (m.totalDuration <= 0) redFlags.push('未形成有效5次起坐总时长，建议复核采集数据');
  if (m.totalDuration >= 12) redFlags.push('5次起坐时间达到 ≥12s 身体功能关注阈值');
  if (m.numCycles > 0 && m.numCycles < 5) redFlags.push(`有效起坐次数为 ${m.numCycles} 次，建议复核完整性`);

  const summary = score >= 20
    ? `5次起坐总时长约 ${round(m.totalDuration, 1)}s，下肢起身能力整体尚可。`
    : score >= 15
      ? `5次起坐总时长约 ${round(m.totalDuration, 1)}s，接近或超过关注线，提示下肢力量与动作效率需观察。`
      : `5次起坐总时长约 ${round(m.totalDuration, 1)}s，起身速度偏慢，提示下肢功能下降风险需要重点关注。`;

  return makeResult({
    type: 'sitstand',
    title: '起坐评分',
    score,
    metrics: m,
    indicators: [
      { label: '总时长', value: m.totalDuration ? `${round(m.totalDuration, 1)}s` : '--' },
      { label: '完成次数', value: m.numCycles ? `${m.numCycles}次` : '--' },
      { label: '平均周期', value: m.avgDuration ? `${round(m.avgDuration, 2)}s` : '--' },
      { label: '关注线', value: '≥12s' },
    ],
    summary,
    redFlags,
    priorityRisk: m.totalDuration >= 12,
    note: '5次起坐按 SPPB 分层评分；≥12s 作为 AWGS 2019 常用低身体功能提示阈值。',
  });
}

export function extractGaitMetrics(reportData = {}) {
  const gp = reportData.gaitParams || {};
  const walkingSpeed = toNumber(gp.walkingSpeed, 0);
  const leftStepTime = toNumber(gp.leftStepTime, 0);
  const rightStepTime = toNumber(gp.rightStepTime, 0);
  const leftStepLength = toNumber(gp.leftStepLength, 0);
  const rightStepLength = toNumber(gp.rightStepLength, 0);
  const stepWidth = toNumber(gp.stepWidth, null);
  return {
    walkingSpeed,
    leftStepTime,
    rightStepTime,
    stepTimeDiff: round(Math.abs(leftStepTime - rightStepTime), 3) || 0,
    leftStepLength,
    rightStepLength,
    stepLengthDiff: round(Math.abs(leftStepLength - rightStepLength), 1) || 0,
    stepWidth,
  };
}

export function scoreGait(reportData) {
  const m = extractGaitMetrics(reportData);
  let score = 5;
  if (m.walkingSpeed >= 1) score = 25;
  else if (m.walkingSpeed >= 0.8) score = 20;
  else if (m.walkingSpeed >= 0.6) score = 15;
  else if (m.walkingSpeed >= 0.43) score = 10;

  const redFlags = [];
  if (m.walkingSpeed > 0 && m.walkingSpeed < 1) redFlags.push('步速低于 1.0m/s 身体功能关注阈值');
  if (m.stepLengthDiff >= 6) redFlags.push(`左右步长差约 ${m.stepLengthDiff}cm`);
  if (m.stepTimeDiff >= 0.12) redFlags.push(`左右步时差约 ${m.stepTimeDiff}s`);

  const summary = score >= 20
    ? `日常步速约 ${round(m.walkingSpeed, 2)}m/s，行动能力基础较好。`
    : score >= 15
      ? `日常步速约 ${round(m.walkingSpeed, 2)}m/s，略低于理想水平，建议关注行走效率和左右对称性。`
      : `日常步速约 ${round(m.walkingSpeed, 2)}m/s，低于1.0m/s参考线，提示行动能力下降风险增加。`;

  return makeResult({
    type: 'gait',
    title: '步态评分',
    score,
    metrics: m,
    indicators: [
      { label: '步速', value: `${round(m.walkingSpeed, 2) || '--'}m/s` },
      { label: '步长差', value: `${m.stepLengthDiff || 0}cm` },
      { label: '步时差', value: `${m.stepTimeDiff || 0}s` },
      { label: '步宽', value: m.stepWidth != null ? `${round(m.stepWidth, 1)}cm` : '--' },
    ],
    summary,
    redFlags,
    priorityRisk: m.walkingSpeed > 0 && m.walkingSpeed < 1,
    note: '步态按日常步速分层：≥1.0m/s 为25分，0.80-0.99 为20分，0.60-0.79 为15分，0.43-0.59 为10分，<0.43或不能完成为5分。',
  });
}

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
  } else {
    leftArchIndex = toNumber(reportData.left?.archAnalysis?.archIndex ?? reportData.left?.archIndex, null);
    rightArchIndex = toNumber(reportData.right?.archAnalysis?.archIndex ?? reportData.right?.archIndex, null);
    leftPressureRatio = toNumber(reportData.bilateral?.leftPressureRatio, 50);
    rightPressureRatio = toNumber(reportData.bilateral?.rightPressureRatio, 50);
    cop = reportData.bilateral?.copMetrics || reportData.copTimeSeries || {};
    explicit = reportData.scoreInputs || reportData.standingScore || {};
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
  };
}

function archType(ai) {
  if (ai == null) return '-';
  if (ai < 0.21) return '高弓足';
  if (ai <= 0.26) return '正常足弓';
  return '扁平足';
}

function scoreCopPathLength(pathLength) {
  if (pathLength == null || pathLength <= 0) return 2;
  if (pathLength <= 1000) return 10;
  if (pathLength <= 1500) return 8;
  if (pathLength <= 2200) return 5;
  return 2;
}

export function scoreStanding(reportData) {
  const m = extractStandingMetrics(reportData);
  const stageScore = m.hasFourStageLevel ? Math.round((m.fourStageLevel / 4) * 10) : 0;
  const copScore = scoreCopPathLength(m.pathLength);
  const loadScore = m.loadOffset <= 10 ? 5 : m.loadOffset <= 20 ? 3 : m.loadOffset <= 30 ? 1 : 0;
  const score = Math.round(stageScore + copScore + loadScore);

  const redFlags = [];
  if (!m.hasFourStageLevel) redFlags.push('缺少四阶段平衡测试结果，平衡等级项按保守档处理');
  if (!m.hasCopPathLength) redFlags.push('缺少有效COP轨迹长度，COP项按保守档处理');
  if (!m.hasCopMetric) redFlags.push('缺少有效COP稳定性指标，静态站立评分需结合原始数据复核');
  if (m.loadOffset > 20) redFlags.push(`左右负荷偏移约 ${m.loadOffset}%`);
  if (m.hasCopPathLength && m.pathLength > 2200) {
    redFlags.push(`COP轨迹长度明显偏高，约 ${round(m.pathLength, 0)}mm`);
  } else if (m.hasCopPathLength && m.pathLength > 1500) {
    redFlags.push(`COP轨迹长度偏高，约 ${round(m.pathLength, 0)}mm`);
  } else if (m.hasCopPathLength && m.pathLength > 1000) {
    redFlags.push(`COP轨迹长度轻度偏高，约 ${round(m.pathLength, 0)}mm`);
  }
  const leftArch = archType(m.leftArchIndex);
  const rightArch = archType(m.rightArchIndex);
  if (leftArch !== '正常足弓' || rightArch !== '正常足弓') {
    redFlags.push(`足弓形态：左脚${leftArch}，右脚${rightArch}`);
  }

  const copText = m.hasCopPathLength
    ? `COP轨迹长度约 ${round(m.pathLength, 0)}mm`
    : 'COP轨迹长度缺失';
  const summary = score >= 20
    ? `${copText}，站立稳定性与左右负荷整体较均衡，静态平衡基础较好。`
    : score >= 15
      ? `${copText}，站立时存在轻度重心波动或负荷偏移，建议关注平衡控制和日常防跌倒。`
      : `${copText}，站立稳定性或左右负荷控制偏弱，提示平衡能力需要重点关注。`;

  return makeResult({
    type: 'standing',
    title: '静态站立评分',
    score,
    metrics: m,
    indicators: [
      { label: '四阶段等级', value: m.hasFourStageLevel ? `${round(m.fourStageLevel, 1)}/4` : '待录入' },
      { label: 'COP轨迹长度', value: m.hasCopPathLength ? `${round(m.pathLength, 0)}mm` : '未采集' },
      { label: '左右偏移', value: `${m.loadOffset}%` },
      { label: '足弓', value: `L ${leftArch} / R ${rightArch}` },
    ],
    summary,
    redFlags,
    priorityRisk: score <= 15 || m.loadOffset > 30 || !m.hasFourStageLevel || !m.hasCopPathLength || m.pathLength > 2200,
    note: '静态站立由四阶段平衡等级、COP轨迹长度和左右负荷偏移合成。第1阶段双脚站立实际采集30秒，COP轨迹长度≤1000mm为10分，1001-1500mm为8分，1501-2200mm为5分，>2200mm为2分；缺失按2分保守处理。',
  });
}

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
  '整体较好': '建议继续保持规律步行、下肢力量训练和平衡训练，每周至少2-3次适度锻炼；同时注意蛋白质摄入、睡眠、慢病管理和居家防滑，建议6-12个月复测一次。',
  '轻度关注': '建议围绕相对薄弱项进行1-3个月针对性训练并复测；如近期出现走路变慢、起身费力、容易疲劳或曾经跌倒，建议咨询社区医生或康复人员。',
  '中度关注': '建议加强下肢力量、坐站转移和平衡能力训练，并结合专业人员做进一步功能评估；日常避免独自进行快速转身、上下楼梯、夜间行走等高风险动作。',
  '重点关注': '建议把防跌倒和主要短板处理放在优先位置，尽快联系社区卫生服务中心、康复科或老年医学相关专业人员进一步评估；近期避免独自外出、快速起身、湿滑地面行走和长时间站立。',
  '高度关注': '建议尽快到社区卫生服务中心或医院进行肌少症、跌倒风险、营养和慢病相关评估；日常活动建议有家属陪同，必要时使用扶手、助行器等辅助工具。',
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
    return `${completedText}本次综合得分为 ${totalScore}/100，综合等级为“${level.text}”。先给您一个肯定的结论：本次四项结果整体较好，${itemText}，说明上肢肌力、日常行走、站立控制和起坐转移能力基础较稳，当前日常活动能力储备较好。${flagText}${COMPREHENSIVE_LEVEL_GUIDANCE['整体较好']}若之后出现跌倒、明显乏力、体重下降、走路变慢、疼痛麻木或起身安全感下降，可提前带报告咨询社区卫生服务中心、全科或老年医学科。`;
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

  return `${completedText}本次综合得分为 ${totalScore}/100，综合等级为“${level.text}”。四项得分为${itemText}，${focusText}。${reasonText}${impactText ? `${impactText}。` : '这些表现可能影响日常起身、步行、上下楼或防跌倒能力。'}建议优先围绕${actionText || '规律活动、力量训练和平衡训练'}制定训练和复测计划。${levelAdvice}${doctorText}`;
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
    priorityRisk: level.text === '重点关注' || level.text === '高度关注',
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
    scoring_note: scoreResult.note || '',
  };
}
