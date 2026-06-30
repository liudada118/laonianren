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
  // 只在当前项之后按顺序找下一个未完成的，绝不回头找前面的项。
  // 否则：刚做完的项（如步态）报告还在后台生成、completed 尚未置位时，会被当成
  // 「下一个未完成」，导致做完下一项后又回跳到它。前面漏做/失败的项通过历史补测，不在流程里回跳。
  const idx = ASSESSMENT_ORDER.indexOf(currentType);
  const startFrom = idx >= 0 ? idx + 1 : 0;
  for (let i = startFrom; i < ASSESSMENT_ORDER.length; i++) {
    const t = ASSESSMENT_ORDER[i];
    if (!assessments?.[t]?.completed) return t;
  }
  return null;
}

export default { ASSESSMENT_ORDER, ASSESSMENT_PATH, ASSESSMENT_LABEL, getNextAssessmentType };
