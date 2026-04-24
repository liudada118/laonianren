/**
 * 算法统一入口 (Python版)
 *
 * 所有报告算法通过 Python 子进程调用 frontendReport/ 下的 Python 模块。
 * 实时COP算法保留JS实现（低延迟要求）。
 *
 * 用法:
 *   const { callAlgorithm } = require('./algorithms');
 *   const result = await callAlgorithm('generate_grip_render_report', { sensor_data, hand_type });
 *
 * 支持的函数名:
 *   - generate_grip_render_report     → Python 握力报告
 *   - generate_gait_render_report     → Python 步道报告（新版）
 *   - generate_sit_stand_render_report → Python 起坐报告
 *   - generate_standing_render_report  → Python 站立报告
 *   - realtime_server                  → JS 实时COP
 *   - replay_server                    → JS 回放COP
 */
const fs = require('fs');
const path = require('path');

function loadPythonBridge() {
  try {
    return require('./python/pythonBridge');
  } catch (localErr) {
    const resourceBase = process.resourcesPath || process.env.resourcesPath || '';
    const externalBridgePath = resourceBase
      ? path.join(resourceBase, 'algorithms', 'python', 'pythonBridge.js')
      : '';

    if (externalBridgePath && fs.existsSync(externalBridgePath)) {
      return require(externalBridgePath);
    }

    throw localErr;
  }
}

const { callPython } = loadPythonBridge();
const { processFrameRealtime, processPlaybackBatch } = require('./realtime/realtimeCOP');
const GAIT_REPORT_TIMEOUT_MS = parseInt(process.env.PY_TIMEOUT_GAIT_MS, 10) || 600000;

// 实时COP状态
let lastFootPointArr = null;

/**
 * 统一算法调用入口
 * @param {string} funcName - 函数名
 * @param {object} params - 参数对象
 * @returns {Promise<object>} 计算结果
 */
async function callAlgorithm(funcName, params = {}) {
  switch (funcName) {
    // ============================================================
    // 报告算法 → 全部走 Python
    // ============================================================

    case 'generate_grip_render_report':
      return callPython('generate_grip_render_report', {
        sensor_data: params.sensor_data,
        hand_type: params.hand_type,
        times: params.times || null,
        imu_data: params.imu_data || null,
      });

    case 'generate_gait_render_report':
      return callPython('generate_gait_render_report', {
        board_data: params.board_data || [
          params.d1 || [], params.d2 || [], params.d3 || [], params.d4 || []
        ],
        board_times: params.board_times || [
          params.t1 || [], params.t2 || [], params.t3 || [], params.t4 || []
        ],
      }, { timeoutMs: GAIT_REPORT_TIMEOUT_MS });

    case 'generate_gait_python_report':
      // 兼容旧调用名
      return callPython('generate_gait_render_report', {
        board_data: params.board_data || [],
        board_times: params.board_times || [],
      }, { timeoutMs: GAIT_REPORT_TIMEOUT_MS });

    case 'generate_sit_stand_render_report':
      return callPython('generate_sit_stand_render_report', {
        stand_data: params.stand_data || [],
        sit_data: params.sit_data || [],
        stand_times: params.stand_times || null,
        sit_times: params.sit_times || null,
        username: params.username || '用户',
      });

    case 'generate_standing_render_report':
      return callPython('generate_standing_render_report', {
        data_array: params.data_array,
        fps: params.fps || 42,
        threshold_ratio: params.threshold_ratio || 0.8,
      });

    // ============================================================
    // 实时算法 → 保留 JS（低延迟要求）
    // ============================================================

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

    case 'server':
      return _airBedServer(params);

    case 'generate_foot_pressure_report':
      return _generateFootPressureReport(params);

    default:
      console.warn(`[Algorithm] Unknown function: ${funcName}, returning null`);
      return null;
  }
}

// ============================================================
// 实时COP (保留JS)
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

// ============================================================
// 气垫床控制算法 (stub)
// ============================================================

function _airBedServer({ sensor_data }) {
  return {
    control_command: null,
    frame_count: 0,
  };
}

// ============================================================
// 脚压力PDF报告 (stub)
// ============================================================

function _generateFootPressureReport(params) {
  console.warn('[Algorithm] generate_foot_pressure_report: 待实现');
  return { status: 'not_implemented' };
}

module.exports = {
  callAlgorithm,
};
