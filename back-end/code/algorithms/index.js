/**
 * JS 算法统一入口 (替代 callPy)
 *
 * 用法:
 *   const { callAlgorithm } = require('./algorithms');
 *   const result = await callAlgorithm('generate_grip_render_report', { sensor_data, hand_type });
 *
 * 支持的函数名 (与原 Python 函数名保持一致):
 *   - generate_grip_render_report
 *   - generate_gait_render_report
 *   - generate_sit_stand_render_report
 *   - generate_standing_render_report
 *   - realtime_server
 *   - replay_server
 */

const { generateGripReport } = require('./grip/gripReportAlgorithm');
const { generateGaitReport } = require('./gait/gaitReportAlgorithm');
const { generateSitStandReport } = require('./sitstand/sitstandReportAlgorithm');
const { generateStandingReport } = require('./standing/standingReportAlgorithm');
const { processFrameRealtime, processPlaybackBatch } = require('./realtime/realtimeCOP');

// 实时COP状态（替代Python端的全局状态）
let lastFootPointArr = null;

/**
 * 统一算法调用入口 (替代 callPy)
 * @param {string} funcName - 函数名 (与原 Python 函数名一致)
 * @param {object} params - 参数对象
 * @returns {Promise<object>} 计算结果
 */
async function callAlgorithm(funcName, params = {}) {
  switch (funcName) {
    case 'generate_grip_render_report':
      return _generateGripRenderReport(params);

    case 'generate_gait_render_report':
      return _generateGaitRenderReport(params);

    case 'generate_sit_stand_render_report':
      return _generateSitStandRenderReport(params);

    case 'generate_standing_render_report':
      return _generateStandingRenderReport(params);

    case 'realtime_server':
      return _realtimeServer(params);

    case 'replay_server':
      return _replayServer(params);

    case 'resetMessage':
      return _resetMessage();

    case 'getParam':
      return _getParam();

    case 'setParam':
      return _setParam(params);

    default:
      throw new Error(`Unknown algorithm function: ${funcName}`);
  }
}

// ============================================================
// 握力报告
// ============================================================

function _generateGripRenderReport({ sensor_data, hand_type }) {
  try {
    const result = generateGripReport(sensor_data, hand_type);
    return result;
  } catch (e) {
    console.error('[JS Algorithm] generate_grip_render_report error:', e.message);
    return null;
  }
}

// ============================================================
// 步态报告
// ============================================================

function _generateGaitRenderReport({ d1, d2, d3, d4, t1, t2, t3, t4, body_weight_kg }) {
  try {
    const result = generateGaitReport(
      d1 || [], d2 || [], d3 || [], d4 || [],
      { bodyWeightKg: body_weight_kg || 80 }
    );
    return result;
  } catch (e) {
    console.error('[JS Algorithm] generate_gait_render_report error:', e.message);
    return null;
  }
}

// ============================================================
// 起坐报告
// ============================================================

function _generateSitStandRenderReport({ stand_data, sit_data, username }) {
  try {
    const result = generateSitStandReport(
      stand_data || [],
      sit_data || [],
      username || 'user',
    );
    return result;
  } catch (e) {
    console.error('[JS Algorithm] generate_sit_stand_render_report error:', e.message);
    return null;
  }
}

// ============================================================
// 站立报告
// ============================================================

function _generateStandingRenderReport({ data_array, fps, threshold_ratio }) {
  try {
    const result = generateStandingReport(
      data_array,
      fps || 42,
      threshold_ratio || 0.8,
    );
    return result;
  } catch (e) {
    console.error('[JS Algorithm] generate_standing_render_report error:', e.message);
    return null;
  }
}

// ============================================================
// 实时COP
// ============================================================

function _realtimeServer({ sensor_data, data_prev }) {
  try {
    const result = processFrameRealtime(sensor_data, data_prev || lastFootPointArr || []);
    lastFootPointArr = sensor_data;
    return result;
  } catch (e) {
    console.error('[JS Algorithm] realtime_server error:', e.message);
    return { left: null, right: null };
  }
}

// ============================================================
// 回放COP
// ============================================================

function _replayServer({ sensor_data }) {
  try {
    return processPlaybackBatch(sensor_data);
  } catch (e) {
    console.error('[JS Algorithm] replay_server error:', e.message);
    return { left: [], right: [] };
  }
}

// ============================================================
// 辅助接口 (配置管理)
// ============================================================

// 内存中的配置参数 (替代 Python 端的全局变量)
let _pyConfig = {
  preprocess: {
    rotate90ccw: true,
    mirroredHorizon: true,
    mirroredVertical: true,
    applyDenoise: true,
    smallCompMinSize: 3,
    smallCompConnectivity: 4,
    margin: 0,
    multiComponentMode: true,
    multiComponentTopN: 3,
    multiComponentMinSize: 10,
  },
  cop: {
    thresholdRatio: 0.8,
    fps: 42,
  },
};

function _resetMessage() {
  lastFootPointArr = null;
  return { status: 'ok' };
}

function _getParam() {
  return _pyConfig;
}

function _setParam({ obj }) {
  if (obj) {
    _pyConfig = { ..._pyConfig, ...obj };
  }
  return _pyConfig;
}

module.exports = {
  callAlgorithm,
};
