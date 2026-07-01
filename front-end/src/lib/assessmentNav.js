/**
 * 评估测试顺序与「下一项」导航工具（街道快速采集：做完一项点「下一项」继续）
 */

// 测试顺序：步态 → 站立 → 握力 → 起坐
export const ASSESSMENT_ORDER = ['gait', 'standing', 'grip', 'sitstand'];

export const ASSESSMENT_PATH = {
  grip: '/assessment/grip',
  sitstand: '/assessment/sitstand',
  standing: '/assessment/standing',
  gait: '/assessment/gait',
};

export const ASSESSMENT_LABEL = {
  gait: '行走步态',
  standing: '静态站立',
  grip: '握力',
  sitstand: '起坐能力',
};

/**
 * 找下一个「未完成且不是当前刚做的」评估类型。
 * @param {Object} assessments - context.assessments，形如 { grip:{completed}, ... }
 * @param {string} currentType - 当前刚完成的类型（排除自身，因其报告可能还在后台生成）
 * @returns {string|null} 下一个待评估类型，全部完成返回 null
 */
export function getNextAssessmentType(assessments, currentType) {
  // 环形：从当前项的下一个开始，绕一圈找下一个「未完成」的项（可绕回开头，
  // 支持从任意一项乱序开始）。跳过当前刚做的项本身（它报告可能还在后台生成、
  // completed 尚未置位，避免回跳到自己）。其他项全部完成时返回 null（= 四项都做完）。
  const n = ASSESSMENT_ORDER.length;
  const idx = ASSESSMENT_ORDER.indexOf(currentType);
  const base = idx >= 0 ? idx : -1;
  for (let k = 1; k <= n; k++) {
    const t = ASSESSMENT_ORDER[(((base + k) % n) + n) % n];
    if (t === currentType) continue;
    if (!assessments?.[t]?.completed) return t;
  }
  return null;
}

/**
 * 是否四项评估都已完成（用于完成窗判断，避免「向后没有下一项」被误判成「四项已完成」）。
 * @param {Object} assessments
 * @returns {boolean}
 */
export function isAllAssessmentsCompleted(assessments) {
  return ASSESSMENT_ORDER.every((t) => assessments?.[t]?.completed);
}

export default { ASSESSMENT_ORDER, ASSESSMENT_PATH, ASSESSMENT_LABEL, getNextAssessmentType, isAllAssessmentsCompleted };
