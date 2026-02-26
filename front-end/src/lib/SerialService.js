/**
 * 串口通信服务 - 基于 Web Serial API
 * 支持 64x64 传感器矩阵，波特率 3,000,000
 */

class SerialService {
  constructor() {
    this.port = null;
    this.reader = null;
    this.isConnected = false;
    this.onDataCallback = null;
    this.onLogCallback = null;
    this.onStatusCallback = null;
    this.enableMirroring = true;
    this.filterThreshold = 0;
    this.ROWS = 64;
    this.COLS = 64;
    this.DATA_SIZE = 64 * 64;
    this.FOOTER = new Uint8Array([0xAA, 0x55, 0x03, 0x99]);
    this.FRAME_SIZE = 4096 + 4;
    this.buffer = new Uint8Array(0);
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.fps = 0;
  }

  get connected() {
    return this.isConnected;
  }

  async connect() {
    if (!('serial' in navigator)) {
      this.log('当前浏览器不支持 Web Serial API，请使用 Chrome/Edge', 'error');
      return false;
    }
    try {
      this.port = await navigator.serial.requestPort();
      this.log('端口已选择，正在以 3000000 波特率打开...');
      await this.port.open({ baudRate: 3000000 });
      this.isConnected = true;
      this.frameCount = 0;
      this.lastFrameTime = Date.now();
      this.log('端口打开成功，波特率 3000000');
      this.notifyStatus('connected');
      this.readLoop();
      return true;
    } catch (error) {
      this.log(`连接失败: ${error.message}`, 'error');
      this.notifyStatus('error');
      return false;
    }
  }

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
    } catch (e) {
      // ignore
    }
    this.isConnected = false;
    this.buffer = new Uint8Array(0);
    this.notifyStatus('disconnected');
    this.log('设备已断开');
  }

  setOnData(callback) {
    this.onDataCallback = callback;
  }

  setOnLog(callback) {
    this.onLogCallback = callback;
  }

  setOnStatus(callback) {
    this.onStatusCallback = callback;
  }

  setFilterThreshold(threshold) {
    this.filterThreshold = Math.max(0, Math.min(255, threshold));
  }

  log(message, type = 'info') {
    if (this.onLogCallback) {
      this.onLogCallback(message, type);
    }
    if (type === 'error') {
      console.error(`[Serial] ${message}`);
    }
  }

  notifyStatus(status) {
    if (this.onStatusCallback) {
      this.onStatusCallback(status);
    }
  }

  async readLoop() {
    if (!this.port || !this.port.readable) return;
    this.reader = this.port.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.processData(value);
        }
      }
    } catch (error) {
      if (this.isConnected) {
        this.log(`读取错误: ${error.message}`, 'error');
      }
    } finally {
      if (this.reader) {
        this.reader.releaseLock();
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
        if (
          this.buffer[i] === this.FOOTER[0] &&
          this.buffer[i + 1] === this.FOOTER[1] &&
          this.buffer[i + 2] === this.FOOTER[2] &&
          this.buffer[i + 3] === this.FOOTER[3]
        ) {
          if (i >= this.DATA_SIZE) {
            footerIndex = i;
            break;
          }
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

      // 转为 64x64 矩阵
      const matrix = [];
      for (let r = 0; r < this.ROWS; r++) {
        const row = [];
        for (let c = 0; c < this.COLS; c++) {
          let val = dataPayload[r * this.COLS + c];
          if (val < this.filterThreshold) {
            val = 0;
          }
          row.push(val);
        }
        matrix.push(row);
      }

      // 计算 FPS
      this.frameCount++;
      const now = Date.now();
      if (now - this.lastFrameTime >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      if (this.onDataCallback) {
        this.onDataCallback(matrix);
      }

      this.buffer = this.buffer.slice(footerIndex + 4);
    }
  }
}

export const serialService = new SerialService();
export default SerialService;
