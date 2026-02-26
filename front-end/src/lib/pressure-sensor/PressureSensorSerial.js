/**
 * 压力传感器串口通信服务
 * 
 * 支持双传感器：
 * - 坐垫传感器：32×32 矩阵，波特率 1Mbps
 * - 脚垫传感器：64×64 矩阵，波特率 3Mbps
 * 
 * 数据协议：
 * - 帧结构：[数据载荷 N bytes] + [帧尾 4 bytes: AA 55 03 99]
 * - 使用 Web Serial API（Chrome/Edge）
 */

/** 帧尾标识 */
const FRAME_FOOTER = new Uint8Array([0xAA, 0x55, 0x03, 0x99]);

/** 预定义传感器配置 */
const SENSOR_CONFIGS = {
  seat: {
    type: 'seat',
    rows: 32,
    cols: 32,
    baudRate: 1000000,
    dataSize: 32 * 32,
    footer: FRAME_FOOTER,
    frameSize: 32 * 32 + 4,
    enableMirroring: true,
    rotationDeg: 90,
  },
  footpad: {
    type: 'footpad',
    rows: 64,
    cols: 64,
    baudRate: 3000000,
    dataSize: 64 * 64,
    footer: FRAME_FOOTER,
    frameSize: 64 * 64 + 4,
    enableMirroring: false,
    rotationDeg: 90,
  },
};

export class PressureSensorSerial {
  /**
   * @param {string|object} configOrType - 'seat' | 'footpad' 或完整配置对象
   */
  constructor(configOrType) {
    if (typeof configOrType === 'string') {
      this.config = { ...SENSOR_CONFIGS[configOrType] };
    } else {
      this.config = { ...configOrType };
    }

    this.port = null;
    this.reader = null;
    this.isConnected = false;
    this.buffer = new Uint8Array(0);
    this.enableMirroring = this.config.enableMirroring || false;

    // 回调函数
    this.onDataCallback = null;
    this.onLogCallback = null;
    this.onConnectionChangeCallback = null;

    // 统计信息
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.fps = 0;
  }

  /** 获取传感器配置 */
  getConfig() {
    return this.config;
  }

  /** 获取连接状态 */
  getIsConnected() {
    return this.isConnected;
  }

  /** 获取帧率 */
  getFps() {
    return this.fps;
  }

  /** 获取已接收帧数 */
  getFrameCount() {
    return this.frameCount;
  }

  /**
   * 连接传感器
   * @returns {Promise<boolean>}
   */
  async connect() {
    if (!('serial' in navigator)) {
      this.log('当前浏览器不支持 Web Serial API，请使用 Chrome/Edge', 'error');
      return false;
    }
    try {
      this.port = await navigator.serial.requestPort();
      this.log(`端口已选择，正在以 baudRate=${this.config.baudRate} 打开...`);

      await this.port.open({ baudRate: this.config.baudRate });
      this.isConnected = true;
      this.frameCount = 0;
      this.lastFrameTime = performance.now();

      this.log(`端口打开成功 [${this.config.type}] ${this.config.rows}×${this.config.cols} @ ${this.config.baudRate}bps`);
      if (this.onConnectionChangeCallback) this.onConnectionChangeCallback(true);

      this.readLoop();
      return true;
    } catch (error) {
      this.log(`连接失败: ${error}`, 'error');
      return false;
    }
  }

  /**
   * 断开连接
   */
  async disconnect() {
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (error) {
      this.log(`断开连接时出错: ${error}`, 'error');
    } finally {
      this.isConnected = false;
      this.buffer = new Uint8Array(0);
      if (this.onConnectionChangeCallback) this.onConnectionChangeCallback(false);
      this.log('已断开连接');
    }
  }

  /** 设置数据帧回调 */
  onData(callback) {
    this.onDataCallback = callback;
  }

  /** 设置日志回调 */
  onLog(callback) {
    this.onLogCallback = callback;
  }

  /** 设置连接状态变化回调 */
  onConnectionChange(callback) {
    this.onConnectionChangeCallback = callback;
  }

  /** 设置数据镜像重排 */
  setMirroring(enabled) {
    this.enableMirroring = enabled;
    this.log(`数据镜像重排 ${enabled ? '已启用' : '已禁用'}`);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  log(message, type = 'info') {
    const prefix = `[${this.config.type.toUpperCase()}]`;
    if (this.onLogCallback) this.onLogCallback(`${prefix} ${message}`, type);
    if (type === 'error') {
      console.error(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  async readLoop() {
    if (!this.port || !this.port.readable) return;

    this.reader = this.port.readable.getReader();
    this.log('开始数据读取循环...');

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) {
          this.log('读取循环结束信号');
          break;
        }
        if (value) {
          this.processData(value);
        }
      }
    } catch (error) {
      this.log(`读取错误: ${error}`, 'error');
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
      }
      this.log('读取器锁已释放');
    }
  }

  processData(chunk) {
    // 追加新数据到缓冲区
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    const { dataSize, frameSize, footer } = this.config;

    while (this.buffer.length >= frameSize) {
      let footerIndex = -1;

      for (let i = 0; i <= this.buffer.length - 4; i++) {
        if (this.buffer[i] === footer[0] &&
            this.buffer[i + 1] === footer[1] &&
            this.buffer[i + 2] === footer[2] &&
            this.buffer[i + 3] === footer[3]) {
          if (i >= dataSize) {
            footerIndex = i;
            break;
          }
        }
      }

      if (footerIndex === -1) {
        if (this.buffer.length > frameSize * 2) {
          this.buffer = this.buffer.slice(this.buffer.length - frameSize);
        }
        break;
      }

      const frameStartIndex = footerIndex - dataSize;
      const dataPayload = this.buffer.slice(frameStartIndex, footerIndex);

      const frame = this.parseFrame(dataPayload);

      // 更新帧率统计
      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFrameTime > 1000) {
        this.fps = Math.round(this.frameCount / ((now - this.lastFrameTime) / 1000));
        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      if (this.onDataCallback) this.onDataCallback(frame);

      this.buffer = this.buffer.slice(footerIndex + 4);
    }
  }

  parseFrame(dataPayload) {
    const { rows, cols } = this.config;
    let wsPointData = Array.from(dataPayload);

    // 坐垫传感器的数据镜像重排
    if (this.enableMirroring && this.config.type === 'seat') {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < cols; j++) {
          const idx1 = i * cols + j;
          const idx2 = (14 - i) * cols + j;
          const temp = wsPointData[idx1];
          wsPointData[idx1] = wsPointData[idx2];
          wsPointData[idx2] = temp;
        }
      }
      const first15Rows = wsPointData.splice(0, 15 * cols);
      wsPointData = wsPointData.concat(first15Rows);
    }

    // 转换为二维矩阵
    const tempMatrix = [];
    let maxVal = 0;
    let minVal = 255;
    let nonZeroCount = 0;

    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const val = wsPointData[r * cols + c];
        row.push(val);
        if (val > maxVal) maxVal = val;
        if (val < minVal) minVal = val;
        if (val > 0) nonZeroCount++;
      }
      tempMatrix.push(row);
    }

    // 顺时针旋转90°
    const matrix = [];
    for (let c = 0; c < cols; c++) {
      const newRow = [];
      for (let r = rows - 1; r >= 0; r--) {
        newRow.push(tempMatrix[r][c]);
      }
      matrix.push(newRow);
    }

    return {
      matrix,
      maxVal,
      minVal,
      nonZeroCount,
      timestamp: Date.now(),
    };
  }
}

/** 创建坐垫传感器串口服务（32×32, 1Mbps） */
export function createSeatSensorSerial() {
  return new PressureSensorSerial('seat');
}

/** 创建脚垫传感器串口服务（64×64, 3Mbps） */
export function createFootpadSensorSerial() {
  return new PressureSensorSerial('footpad');
}
