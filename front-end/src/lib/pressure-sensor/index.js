/**
 * 压力传感器 3D 可视化模块
 * 
 * 老年人能力评估套装 - 压力传感器数据采集与3D可视化
 */

// 3D 场景
export { PressureScene3D } from './PressureScene3D';

// 串口通信
export { PressureSensorSerial, createSeatSensorSerial, createFootpadSensorSerial } from './PressureSensorSerial';

// 数据处理
export { gaussianBlur, bilinearInterpolate, upscaleDataSmooth, normalizeMatrix, matrixStats, calculateCoP } from './PressureDataProcessor';

// 工具
export { PressureSimulator } from './PressureSimulator';

// 着色器
export { pressurePadVertexShader, pressurePadFragmentShader, footpadFragmentShader } from './shaders';
