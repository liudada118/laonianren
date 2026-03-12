/**
 * particleConfig - 粒子系统参数配置
 *
 * 数据处理参数（gaussSigma, filterThreshold, initValue, colorRange, heightScale）：
 *   步道和静态共用，存储在 localStorage 'particleParams'
 *
 * 空间变换参数（posX, posY, posZ, rotX, rotY, rotZ, particleSize, scale）：
 *   静态和步道各自独立，分别存储在 'particleTransform_standing' / 'particleTransform_gait'
 */

const SHARED_KEY = 'particleParams';
const TRANSFORM_KEY_PREFIX = 'particleTransform_';

/* ─── 共用数据处理参数 ─── */
const SHARED_DEFAULTS = {
  gaussSigma: 2.5,
  filterThreshold: 2,
  initValue: 2.5,
  colorRange: 700,
  heightScale: 2,
};

export const SHARED_RANGES = {
  gaussSigma:      { min: 0.5, max: 10, step: 0.5, label: '高斯模糊', unit: 'σ' },
  filterThreshold: { min: 0,   max: 50, step: 1,   label: '过滤阈值', unit: '' },
  initValue:       { min: 1,   max: 20, step: 0.5,  label: '平滑系数', unit: '' },
  colorRange:      { min: 50,  max: 1000, step: 10, label: '颜色范围', unit: '' },
  heightScale:     { min: 0.5, max: 10, step: 0.5,  label: '高度缩放', unit: 'x' },
};

/* ─── 独立空间变换参数（每个场景各一份） ─── */
// 静态默认值
const STANDING_TRANSFORM_DEFAULTS = {
  posX: -5,
  posY: 190,
  posZ: 275,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  particleSize: 1.6,
  scale: 1.9,
};

// 步道默认值
const GAIT_TRANSFORM_DEFAULTS = {
  posX: 100,
  posY: 295,
  posZ: 350,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  particleSize: 3.7,
  scale: 1.0,
};

// 通用默认值（兜底）
const TRANSFORM_DEFAULTS = {
  posX: 0,
  posY: 0,
  posZ: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  particleSize: 1,
  scale: 1,
};

// 按场景获取默认值
function getTransformDefaults(scene) {
  if (scene === 'standing') return STANDING_TRANSFORM_DEFAULTS;
  if (scene === 'gait') return GAIT_TRANSFORM_DEFAULTS;
  return TRANSFORM_DEFAULTS;
}

export const TRANSFORM_RANGES = {
  posX:            { min: -500, max: 500, step: 5,   label: 'X 位置', unit: '' },
  posY:            { min: -500, max: 500, step: 5,   label: 'Y 位置', unit: '' },
  posZ:            { min: -500, max: 500, step: 5,   label: 'Z 位置', unit: '' },
  rotX:            { min: -180, max: 180, step: 1,   label: 'X 旋转', unit: '°' },
  rotY:            { min: -180, max: 180, step: 1,   label: 'Y 旋转', unit: '°' },
  rotZ:            { min: -180, max: 180, step: 1,   label: 'Z 旋转', unit: '°' },
  particleSize:    { min: 0.1, max: 10,  step: 0.1,  label: '粒子大小', unit: '' },
  scale:           { min: 0.1, max: 5,  step: 0.1,  label: '整体缩放', unit: 'x' },
};

// 兼容旧代码的 PARAM_RANGES（合并）
export const PARAM_RANGES = { ...SHARED_RANGES, ...TRANSFORM_RANGES };

/* ─── 共用参数 load / save / reset ─── */
export function loadParams() {
  try {
    const stored = localStorage.getItem(SHARED_KEY);
    if (stored) return { ...SHARED_DEFAULTS, ...JSON.parse(stored) };
  } catch (e) { /* ignore */ }
  return { ...SHARED_DEFAULTS };
}

export function saveParams(params) {
  try {
    const data = {};
    for (const k of Object.keys(SHARED_DEFAULTS)) {
      if (params[k] !== undefined) data[k] = params[k];
    }
    localStorage.setItem(SHARED_KEY, JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

export function resetParams() {
  saveParams(SHARED_DEFAULTS);
  return { ...SHARED_DEFAULTS };
}

/* ─── 独立空间变换参数 load / save / reset（按 scene 区分） ─── */
export function loadTransform(scene) {
  const defaults = getTransformDefaults(scene);
  try {
    const stored = localStorage.getItem(TRANSFORM_KEY_PREFIX + scene);
    if (stored) return { ...defaults, ...JSON.parse(stored) };
  } catch (e) { /* ignore */ }
  return { ...defaults };
}

export function saveTransform(scene, params) {
  try {
    const data = {};
    for (const k of Object.keys(TRANSFORM_DEFAULTS)) {
      if (params[k] !== undefined) data[k] = params[k];
    }
    localStorage.setItem(TRANSFORM_KEY_PREFIX + scene, JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

export function resetTransform(scene) {
  const defaults = getTransformDefaults(scene);
  saveTransform(scene, defaults);
  return { ...defaults };
}

export { SHARED_DEFAULTS, TRANSFORM_DEFAULTS, STANDING_TRANSFORM_DEFAULTS, GAIT_TRANSFORM_DEFAULTS };
