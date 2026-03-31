import {
  generateSitStandAIReport,
  generateStandingAIReport,
  generateGaitAIReport,
} from './gripPythonApi';

export const ASSESSMENT_AI_SECTION_CONFIG = {
  sitstand: [
    { key: 'overview', label: '测试概况' },
    { key: 'performance_analysis', label: '起坐能力分析' },
    { key: 'symmetry_analysis', label: '对称性分析' },
    { key: 'force_analysis', label: '力学表现分析' },
    { key: 'clinical_suggestion', label: '临床建议' },
  ],
  standing: [
    { key: 'overview', label: '测试概况' },
    { key: 'arch_analysis', label: '足弓结构分析' },
    { key: 'pressure_balance_analysis', label: '压力平衡分析' },
    { key: 'stability_analysis', label: '稳定性分析' },
    { key: 'clinical_suggestion', label: '临床建议' },
  ],
  gait: [
    { key: 'overview', label: '步态概况' },
    { key: 'spatiotemporal_analysis', label: '时空参数分析' },
    { key: 'symmetry_analysis', label: '对称性分析' },
    { key: 'posture_analysis', label: '姿势特征分析' },
    { key: 'stability_analysis', label: '稳定性分析' },
    { key: 'clinical_suggestion', label: '临床建议' },
  ],
};

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '' || value === '--' || value === '—') {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundValue(value, digits = 2) {
  const num = toNumber(value);
  if (num === null) return null;
  return Number(num.toFixed(digits));
}

function pickPhaseValue(container, phaseName, field) {
  const phase = container?.[phaseName];
  if (!phase) return null;
  return toNumber(phase[field]);
}

export function buildSitStandAiPayload(reportData) {
  if (!reportData) return null;

  const forceCurves = reportData.force_curves || {};
  const standTimes = forceCurves.stand_times || reportData.footpad_force_curve?.times || [];
  const samplingRate = standTimes.length >= 2
    ? roundValue(standTimes.length / Math.max(0.001, standTimes[standTimes.length - 1] - standTimes[0]), 1)
    : null;

  return {
    duration_stats: reportData.duration_stats || {},
    sit_peaks: reportData.sit_peaks || reportData.stand_peaks || 0,
    stand_peaks: reportData.sit_peaks || reportData.stand_peaks || 0,
    cycle_peak_forces: reportData.cycle_peak_forces || [],
    symmetry: reportData.symmetry || {},
    pressure_stats: reportData.pressure_stats || {},
    seat_stats: reportData.seat_stats || {},
    footpad_stats: reportData.footpad_stats || {},
    sampling_rate: samplingRate,
    interpretation_note: 'Seat cushion hardware may vary across generations. Prefer percentage, ratio, trend, fluctuation, and relative interpretation. Avoid over-emphasizing absolute force values.',
  };
}

export function buildStandingAiPayload(data) {
  if (!data) return null;

  const leftRatio = roundValue(data.bilateral?.leftPressureRatio, 1);
  const rightRatio = roundValue(data.bilateral?.rightPressureRatio, 1);
  const pressureDiff = (leftRatio != null && rightRatio != null)
    ? roundValue(Math.abs(leftRatio - rightRatio), 1)
    : null;

  const overallCop = data.copTimeSeries || {};
  const leftCop = data.leftCopTimeSeries || overallCop;
  const rightCop = data.rightCopTimeSeries || overallCop;

  const balanceStatus = pressureDiff == null
    ? '未知'
    : pressureDiff < 5
      ? '优秀'
      : pressureDiff < 10
        ? '良好'
        : pressureDiff < 20
          ? '一般'
          : '较差';

  return {
    left_arch_index: roundValue(data.left?.archIndex, 3),
    right_arch_index: roundValue(data.right?.archIndex, 3),
    average_arch_index: roundValue(((toNumber(data.left?.archIndex, 0) + toNumber(data.right?.archIndex, 0)) / 2), 3),
    left_total_area: roundValue(data.left?.totalArea, 2),
    right_total_area: roundValue(data.right?.totalArea, 2),
    left_region_pressure: {
      forefoot: roundValue(data.left?.regionPressure?.forefoot, 2),
      midfoot: roundValue(data.left?.regionPressure?.midfoot, 2),
      hindfoot: roundValue(data.left?.regionPressure?.hindfoot, 2),
    },
    right_region_pressure: {
      forefoot: roundValue(data.right?.regionPressure?.forefoot, 2),
      midfoot: roundValue(data.right?.regionPressure?.midfoot, 2),
      hindfoot: roundValue(data.right?.regionPressure?.hindfoot, 2),
    },
    bilateral: {
      left_pressure_ratio: leftRatio,
      right_pressure_ratio: rightRatio,
      pressure_diff: pressureDiff,
    },
    balance_status: balanceStatus,
    overall_cop: {
      path_length: roundValue(overallCop.pathLength, 2),
      avg_velocity: roundValue(overallCop.avgVelocity, 2),
      max_displacement: roundValue(overallCop.maxDisplacement, 2),
      contact_area: roundValue(overallCop.contactArea, 2),
      ls_ratio: roundValue(overallCop.lsRatio, 2),
      eccentricity: roundValue(overallCop.eccentricity, 3),
    },
    left_cop: {
      path_length: roundValue(leftCop.pathLength, 2),
      avg_velocity: roundValue(leftCop.avgVelocity, 2),
      max_displacement: roundValue(leftCop.maxDisplacement, 2),
      contact_area: roundValue(leftCop.contactArea, 2),
      ls_ratio: roundValue(leftCop.lsRatio, 2),
      eccentricity: roundValue(leftCop.eccentricity, 3),
    },
    right_cop: {
      path_length: roundValue(rightCop.pathLength, 2),
      avg_velocity: roundValue(rightCop.avgVelocity, 2),
      max_displacement: roundValue(rightCop.maxDisplacement, 2),
      contact_area: roundValue(rightCop.contactArea, 2),
      ls_ratio: roundValue(rightCop.lsRatio, 2),
      eccentricity: roundValue(rightCop.eccentricity, 3),
    },
    cop_results: {
      dist_left_to_center: roundValue(data.additionalData?.copResults?.distLeftToBoth, 2),
      dist_right_to_center: roundValue(data.additionalData?.copResults?.distRightToBoth, 2),
      left_forward_offset: roundValue(data.additionalData?.copResults?.leftForward, 2),
    },
  };
}

export function buildGaitAiPayload(reportData) {
  if (!reportData) return null;

  const gaitParams = reportData.gaitParams || {};
  const leftStepTime = toNumber(gaitParams.leftStepTime, 0);
  const rightStepTime = toNumber(gaitParams.rightStepTime, 0);
  const leftStepLength = toNumber(gaitParams.leftStepLength, 0);
  const rightStepLength = toNumber(gaitParams.rightStepLength, 0);
  const leftFpa = toNumber(gaitParams.leftFPA, 0);
  const rightFpa = toNumber(gaitParams.rightFPA, 0);

  const leftSteps = reportData.fpaPerStep?.left || [];
  const rightSteps = reportData.fpaPerStep?.right || [];
  const balance = reportData.balance || {};
  const support = reportData.supportPhases || {};
  const cycle = reportData.cyclePhases || {};

  return {
    walking_speed: roundValue(gaitParams.walkingSpeed, 3),
    left_step_time: roundValue(leftStepTime, 3),
    right_step_time: roundValue(rightStepTime, 3),
    step_time_diff: roundValue(Math.abs(leftStepTime - rightStepTime), 3),
    left_step_length: roundValue(leftStepLength, 2),
    right_step_length: roundValue(rightStepLength, 2),
    step_length_diff: roundValue(Math.abs(leftStepLength - rightStepLength), 2),
    step_width: roundValue(gaitParams.stepWidth, 2),
    left_fpa: roundValue(leftFpa, 2),
    right_fpa: roundValue(rightFpa, 2),
    double_contact_time: roundValue(gaitParams.doubleContactTime, 3),
    balance_summary: {
      left_whole_foot_mean: roundValue(balance.left?.['整足平衡']?.['均值'], 2),
      right_whole_foot_mean: roundValue(balance.right?.['整足平衡']?.['均值'], 2),
      left_forefoot_mean: roundValue(balance.left?.['前足平衡']?.['均值'], 2),
      right_forefoot_mean: roundValue(balance.right?.['前足平衡']?.['均值'], 2),
      left_heel_mean: roundValue(balance.left?.['足跟平衡']?.['均值'], 2),
      right_heel_mean: roundValue(balance.right?.['足跟平衡']?.['均值'], 2),
    },
    support_phase_summary: {
      left_mid_support_duration_ms: pickPhaseValue(support.left, '支撑中期', '时长ms'),
      right_mid_support_duration_ms: pickPhaseValue(support.right, '支撑中期', '时长ms'),
      left_terminal_support_duration_ms: pickPhaseValue(support.left, '支撑末期', '时长ms'),
      right_terminal_support_duration_ms: pickPhaseValue(support.right, '支撑末期', '时长ms'),
    },
    cycle_phase_summary: {
      left_single_support_ms: pickPhaseValue(cycle.left, '左脚单支撑期', '时长ms'),
      right_single_support_ms: pickPhaseValue(cycle.right, '右脚单支撑期', '时长ms'),
      left_double_support_ms: pickPhaseValue(cycle.left, '双脚加载期', '时长ms'),
      right_double_support_ms: pickPhaseValue(cycle.right, '双脚摆动期', '时长ms'),
    },
    fpa_outlier_summary: {
      left_step_count: leftSteps.length,
      right_step_count: rightSteps.length,
      left_outlier_count: leftSteps.filter(v => Math.abs(toNumber(v, 0)) > 25).length,
      right_outlier_count: rightSteps.filter(v => Math.abs(toNumber(v, 0)) > 25).length,
    },
  };
}

export async function requestAssessmentAIReport(type, patientInfo, assessmentData) {
  switch (type) {
    case 'sitstand':
      return generateSitStandAIReport(patientInfo, assessmentData);
    case 'standing':
      return generateStandingAIReport(patientInfo, assessmentData);
    case 'gait':
      return generateGaitAIReport(patientInfo, assessmentData);
    default:
      return { success: false, error: `Unsupported assessment AI type: ${type}` };
  }
}
