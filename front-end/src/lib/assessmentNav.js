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
  for (const t of ASSESSMENT_ORDER) {
    if (t === currentType) continue;
    if (!assessments?.[t]?.completed) return t;
  }
  return null;
}

export default { ASSESSMENT_ORDER, ASSESSMENT_PATH, ASSESSMENT_LABEL, getNextAssessmentType };
