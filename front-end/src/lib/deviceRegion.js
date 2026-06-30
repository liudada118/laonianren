/**
 * 设备地区配置 - 北京/广州设备线序与数据预处理不同，其余逻辑一致。
 * 通过此配置切换预处理方式，一套代码兼容两地设备。
 */

const KEY = 'device_region';

export const REGION_LABEL = { guangzhou: '广州', beijing: '北京' };

export function getDeviceRegion() {
  try {
    const r = localStorage.getItem(KEY);
    return r === 'beijing' ? 'beijing' : 'guangzhou'; // 默认广州
  } catch {
    return 'guangzhou';
  }
}

export function setDeviceRegion(region) {
  try {
    localStorage.setItem(KEY, region === 'beijing' ? 'beijing' : 'guangzhou');
  } catch (e) {
    console.error('保存设备地区失败:', e);
  }
}

export default { getDeviceRegion, setDeviceRegion, REGION_LABEL };
