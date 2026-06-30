/**
 * 设备地区配置 - 北京/广州设备线序与数据预处理不同，其余逻辑一致。
 * 通过此配置切换预处理方式，一套代码兼容两地设备。
 */

const KEY = 'device_region';

export const REGION_LABEL = { guangzhou: '广州', beijing: '北京' };

export function normalizeDeviceRegion(region) {
  return region === 'beijing' ? 'beijing' : 'guangzhou';
}

export function getStoredDeviceRegion() {
  try {
    const r = localStorage.getItem(KEY);
    return r === 'beijing' || r === 'guangzhou' ? r : null;
  } catch {
    return null;
  }
}

export function getDeviceRegion() {
  return getStoredDeviceRegion() || 'guangzhou'; // 默认广州
}

export function setDeviceRegion(region) {
  const next = normalizeDeviceRegion(region);
  try {
    localStorage.setItem(KEY, next);
  } catch (e) {
    console.error('保存设备地区失败:', e);
  }
  return next;
}

export default { getDeviceRegion, getStoredDeviceRegion, normalizeDeviceRegion, setDeviceRegion, REGION_LABEL };
