/**
 * particleConfig - 粒子系统共用参数配置
 *
 * 步道和静态评估共享同一组参数，通过 localStorage 持久化。
 * 参数说明：
 *   - gaussSigma: 高斯模糊 sigma 值（越大越模糊）
 *   - filterThreshold: 过滤阈值（低于此值的数据视为噪声）
 *   - initValue: 初始值 / 平滑系数（数据平滑的惯性）
 *   - colorRange: 颜色映射范围上限（jet 颜色映射的最大值）
 *   - heightScale: 高度缩放系数（粒子 Y 方向的放大倍数）
 */

const STORAGE_KEY = 'particleParams';

const DEFAULTS = {
  gaussSigma: 2,        // 高斯模糊 sigma
  filterThreshold: 2,   // 过滤阈值
  initValue: 2,         // 平滑系数 / 初始值
  colorRange: 200,      // 颜色范围上限
  heightScale: 2,       // 高度缩放
};

// 参数范围定义（用于 UI 滑块）
export const PARAM_RANGES = {
  gaussSigma:      { min: 0.5, max: 10, step: 0.5, label: '高斯模糊', unit: 'σ' },
  filterThreshold: { min: 0,   max: 50, step: 1,   label: '过滤阈值', unit: '' },
  initValue:       { min: 1,   max: 20, step: 0.5,  label: '平滑系数', unit: '' },
  colorRange:      { min: 50,  max: 1000, step: 10, label: '颜色范围', unit: '' },
  heightScale:     { min: 0.5, max: 10, step: 0.5,  label: '高度缩放', unit: 'x' },
};

/**
 * 从 localStorage 加载参数，缺失的使用默认值
 */
export function loadParams() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULTS, ...parsed };
    }
  } catch (e) {
    // ignore
  }
  return { ...DEFAULTS };
}

/**
 * 保存参数到 localStorage
 */
export function saveParams(params) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch (e) {
    // ignore
  }
}

/**
 * 重置为默认值
 */
export function resetParams() {
  saveParams(DEFAULTS);
  return { ...DEFAULTS };
}

export { DEFAULTS };
