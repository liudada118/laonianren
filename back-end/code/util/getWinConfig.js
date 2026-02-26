const si = require('systeminformation');
const crypto = require('crypto');
const os = require('os');

/**
 * 
 * @returns 获取设备uuid
 */

async function getHardwareFingerprint() {
  const data = {};

  try {
    const system = await si.system();
    data.platform = os.platform();
    data.uuid = system.uuid || '';


    // return { 
    //     // fingerprint, 
    //     raw, details: data };
    return data.uuid
  } catch (err) {
    console.error('采集硬件信息失败:', err);
    return null;
  }
}

module.exports = {
  getHardwareFingerprint
}
// 示例调用
getHardwareFingerprint().then(result => {
  console.log('硬件指纹:', result.fingerprint);
  console.log('详细信息:', result.details);
});
