/**
 * FootpadSerialService - 足底压力传感器串口通信服务
 * 
 * 管理4个独立的足底压力传感器，每个传感器通过独立串口连接。
 * 每个传感器为 64×64 矩阵，波特率 3Mbps。
 * 
 * 依赖：Web Serial API（需要 Chrome 89+ 或 Edge 89+）
 * 
 * @example
 * import { footpadServices, SENSOR_KEYS } from './FootpadSerialService';
 * 
 * // 设置数据回调
 * footpadServices.sensor1.setOnData((matrix) => {
 *   console.log('Sensor 1 data:', matrix); // 64×64 number[][]
 * });
 * 
 * // 连接传感器
 * await footpadServices.sensor1.connect();
 */

/**
 * 单个足底传感器串口服务
 */
class SingleFootpadSerialService {
  /**
   * @param {string} position - 传感器位置标识（如 'sensor1'）
   * @param {string} label - 传感器显示名称（如 '传感器1'）
   */
  constructor(position, label) {
    this.position = position;
    this.label = label;
    this.port = null;
    this.reader = null;
    this.isConnected = false;
    this.onDataCallback = null;
    this.onLogCallback = null;
    this.onConnectionChangeCallback = null;

    // 传感器参数（可通过 configure() 修改）
    this.ROWS = 64;
    this.COLS = 64;
    this.DATA_SIZE = 64 * 64;          // 4096 字节
    this.BAUD_RATE = 3000000;           // 3Mbps
    this.FOOTER = new Uint8Array([0xaa, 0x55, 0x03, 0x99]);
    this.FRAME_SIZE = this.DATA_SIZE + this.FOOTER.length; // 4100 字节

    // 噪音过滤参数
    this.edgeWidth = 3;                 // 边缘过滤宽度（像素）
    this.noiseThreshold = 8;            // 噪音阈值

    // 内部缓冲区
    this.buffer = new Uint8Array(0);

    // 检查浏览器支持
    if (typeof navigator !== 'undefined' && !('serial' in navigator)) {
      console.warn('[FootpadSerialService] Web Serial API not supported in this browser.');
    }
  }

  /**
   * 配置传感器参数
   * @param {Object} config
   * @param {number} [config.rows] - 行数（默认64）
   * @param {number} [config.cols] - 列数（默认64）
   * @param {number} [config.baudRate] - 波特率（默认3000000）
   * @param {Uint8Array} [config.footer] - 帧尾标识
   * @param {number} [config.edgeWidth] - 边缘过滤宽度
   * @param {number} [config.noiseThreshold] - 噪音阈值
   */
  configure(config) {
    if (config.rows !== undefined) this.ROWS = config.rows;
    if (config.cols !== undefined) this.COLS = config.cols;
    if (config.baudRate !== undefined) this.BAUD_RATE = config.baudRate;
    if (config.footer !== undefined) this.FOOTER = config.footer;
    if (config.edgeWidth !== undefined) this.edgeWidth = config.edgeWidth;
    if (config.noiseThreshold !== undefined) this.noiseThreshold = config.noiseThreshold;
    this.DATA_SIZE = this.ROWS * this.COLS;
    this.FRAME_SIZE = this.DATA_SIZE + this.FOOTER.length;
  }

  getPosition() { return this.position; }
  getLabel() { return this.label; }
  getIsConnected() { return this.isConnected; }

  /**
   * 连接串口
   * @returns {Promise<boolean>} 是否连接成功
   */
  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      this.log(`${this.label} port selected, opening with baudRate ${this.BAUD_RATE}...`);
      await this.port.open({ baudRate: this.BAUD_RATE });
      this.isConnected = true;
      this.log(`${this.label} port opened successfully.`);
      if (this.onConnectionChangeCallback) this.onConnectionChangeCallback(true);
      this.readLoop();
      return true;
    } catch (error) {
      this.log(`Error connecting ${this.label}: ${error}`, 'error');
      return false;
    }
  }

  /**
   * 断开串口连接
   */
  async disconnect() {
    if (this.reader) { await this.reader.cancel(); this.reader = null; }
    if (this.port) { await this.port.close(); this.port = null; }
    this.isConnected = false;
    this.buffer = new Uint8Array(0);
    if (this.onConnectionChangeCallback) this.onConnectionChangeCallback(false);
  }

  /**
   * 设置数据回调
   * @param {function(number[][]): void} callback - 接收 64×64 矩阵数据
   */
  setOnData(callback) { this.onDataCallback = callback; }

  /**
   * 设置日志回调
   * @param {function(string, string): void} callback - 接收日志消息和类型
   */
  setOnLog(callback) { this.onLogCallback = callback; }

  /**
   * 设置连接状态变化回调
   * @param {function(boolean): void} callback - 接收连接状态
   */
  setOnConnectionChange(callback) { this.onConnectionChangeCallback = callback; }

  log(message, type = 'info') {
    if (this.onLogCallback) this.onLogCallback(message, type);
    console.log(`[Footpad ${this.label}] ${message}`);
  }

  /**
   * 边缘噪音过滤
   * @param {number[][]} matrix - 原始矩阵数据
   * @returns {number[][]} 过滤后的矩阵
   */
  filterEdgeNoise(matrix) {
    const result = [];
    const rows = matrix.length;
    const cols = (matrix[0] && matrix[0].length) || 0;
    for (let r = 0; r < rows; r++) {
      const newRow = [];
      for (let c = 0; c < cols; c++) {
        let val = matrix[r][c];
        const isEdge = r < this.edgeWidth || r >= rows - this.edgeWidth ||
                       c < this.edgeWidth || c >= cols - this.edgeWidth;
        if (isEdge) val = 0;
        else if (val < this.noiseThreshold) val = 0;
        newRow.push(val);
      }
      result.push(newRow);
    }
    return result;
  }

  async readLoop() {
    if (!this.port || !this.port.readable) return;
    this.reader = this.port.readable.getReader();
    this.log(`Starting ${this.label} read loop...`);
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) { this.log(`${this.label} read loop done signal received.`); break; }
        if (value) this.processData(value);
      }
    } catch (error) {
      this.log(`Error reading ${this.label}: ${error}`, 'error');
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
        this.log(`${this.label} reader lock released.`);
      }
    }
  }

  processData(chunk) {
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    while (this.buffer.length >= this.FRAME_SIZE) {
      let footerIndex = -1;
      for (let i = 0; i <= this.buffer.length - 4; i++) {
        if (this.buffer[i] === this.FOOTER[0] && this.buffer[i + 1] === this.FOOTER[1] &&
            this.buffer[i + 2] === this.FOOTER[2] && this.buffer[i + 3] === this.FOOTER[3]) {
          if (i >= this.DATA_SIZE) { footerIndex = i; break; }
        }
      }
      if (footerIndex === -1) {
        if (this.buffer.length > this.FRAME_SIZE * 2) {
          this.buffer = this.buffer.slice(this.buffer.length - this.FRAME_SIZE);
        }
        break;
      }
      const frameStartIndex = footerIndex - this.DATA_SIZE;
      const dataPayload = this.buffer.slice(frameStartIndex, footerIndex);

      // 解析为二维矩阵
      const tempMatrix = [];
      for (let r = 0; r < this.ROWS; r++) {
        const row = [];
        for (let c = 0; c < this.COLS; c++) row.push(dataPayload[r * this.COLS + c]);
        tempMatrix.push(row);
      }

      // 旋转90度
      const rotatedMatrix = [];
      for (let c = 0; c < this.COLS; c++) {
        const newRow = [];
        for (let r = this.ROWS - 1; r >= 0; r--) newRow.push(tempMatrix[r][c]);
        rotatedMatrix.push(newRow);
      }

      // 边缘噪音过滤
      const matrix = this.filterEdgeNoise(rotatedMatrix);
      if (this.onDataCallback) this.onDataCallback(matrix);
      this.buffer = this.buffer.slice(footerIndex + 4);
    }
  }
}

// ============================================================
// 预创建的4个传感器实例
// ============================================================

/**
 * 创建指定数量的传感器服务实例
 * @param {number} count - 传感器数量（默认4）
 * @param {Object} [config] - 可选的传感器配置
 * @returns {{ services: Object, keys: string[], labels: Object, colors: Object }}
 */
export function createFootpadServices(count = 4, config = {}) {
  const services = {};
  const keys = [];
  const labels = {};
  const defaultColors = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ef4444', '#06b6d4', '#eab308', '#ec4899'];

  for (let i = 0; i < count; i++) {
    const key = `sensor${i + 1}`;
    const label = `传感器 ${i + 1}`;
    const service = new SingleFootpadSerialService(key, label);
    if (config) service.configure(config);
    services[key] = service;
    keys.push(key);
    labels[key] = label;
  }

  return {
    services,
    keys,
    labels,
    colors: Object.fromEntries(keys.map((k, i) => [k, defaultColors[i % defaultColors.length]])),
  };
}

// 默认4个传感器实例（向后兼容）
const defaultServices = createFootpadServices(4);

export const footpadServices = defaultServices.services;
export const SENSOR_KEYS = defaultServices.keys;
export const SENSOR_LABELS = defaultServices.labels;
export const SENSOR_COLORS = defaultServices.colors;
export { SingleFootpadSerialService };
export default SingleFootpadSerialService;
