/**
 * quad-footpad-sdk - 四足底压力传感器 3D 可视化 SDK
 * 
 * 提供串口通信、3D渲染、数据处理等功能模块，
 * 可在任何前端项目中集成使用。
 * 
 * @module quad-footpad-sdk
 */

// ============================================================
// 串口通信服务
// ============================================================
export {
  default as SingleFootpadSerialService,
  footpadServices,
  SENSOR_KEYS,
  SENSOR_LABELS,
  SENSOR_COLORS,
  createFootpadServices,
} from './services/FootpadSerialService.js';

// ============================================================
// 3D 场景渲染
// ============================================================
export { FootpadScene } from './components/FootpadScene.js';

// ============================================================
// Shader
// ============================================================
export { vertexShader, fragmentShader } from './shaders/pressureShaders.js';

// ============================================================
// 数据处理
// ============================================================
export {
  gaussianBlur,
  bilinearInterpolate,
  upscaleDataSmooth,
} from './utils/dataProcessing.js';

// ============================================================
// 假数据生成
// ============================================================
export {
  generateWalkwayData,
  generateAnimatedWalkwayData,
  generateFootprint,
} from './utils/mockFootprintData.js';
