/**
 * 握力手套串口通信服务 - 基于 Web Serial API
 * 协议来源: serial_parser_two.py
 *
 * 协议说明:
 *   波特率: 921600
 *   帧头: 0xAA 0x55 0x03 0x99
 *   双包结构:
 *     包1 (0x01): 帧头(4) + 包序(1) + sensor_type(1) + 数据(128) = 134字节
 *     包2 (0x02): 帧头(4) + 包序(1) + sensor_type(1) + 数据(144) = 150字节
 *   合并后: 256字节传感器 + 16字节IMU四元数 = 272字节
 *   sensor_type 区分左右手
 */

const HEADER = [0xAA, 0x55, 0x03, 0x99];
const HEADER_LEN = 4;
const PACKET_TYPE_1 = 0x01;
const PACKET_TYPE_2 = 0x02;
const PACKET1_DATA_LEN = 128;
const PACKET2_DATA_LEN = 144;
const BAUD_RATE = 921600;

class GripSerialService {
  constructor() {
    this.port = null;
    this.reader = null;
    this.isConnected = false;
    this.buffer = new Uint8Array(0);

    // 包1缓存 (按 sensor_type 分组)
    this.packet1Cache = new Map();

    // 回调
    this.onDataCallback = null;
    this.onStatusCallback = null;
    this.onLogCallback = null;

    // 统计
    this.packetCount = 0;
    this.errorCount = 0;
    this.fps = 0;
    this._frameCount = 0;
    this._lastFpsTime = 0;
  }

  get connected() {
    return this.isConnected;
  }

  setOnData(callback) { this.onDataCallback = callback; }
  setOnStatus(callback) { this.onStatusCallback = callback; }
  setOnLog(callback) { this.onLogCallback = callback; }

  log(message, type = 'info') {
    if (this.onLogCallback) this.onLogCallback(message, type);
    if (type === 'error') console.error(`[GripSerial] ${message}`);
  }

  notifyStatus(status) {
    if (this.onStatusCallback) this.onStatusCallback(status);
  }

  async connect() {
    if (!('serial' in navigator)) {
      this.log('当前浏览器不支持 Web Serial API，请使用 Chrome/Edge', 'error');
      return false;
    }
    try {
      this.port = await navigator.serial.requestPort();
      this.log(`端口已选择，正在以 ${BAUD_RATE} 波特率打开...`);
      await this.port.open({ baudRate: BAUD_RATE });
      this.isConnected = true;
      this.packetCount = 0;
      this.errorCount = 0;
      this.packet1Cache.clear();
      this._frameCount = 0;
      this._lastFpsTime = Date.now();
      this.log(`端口打开成功，波特率 ${BAUD_RATE}`);
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
    this.packet1Cache.clear();
    this.notifyStatus('disconnected');
    this.log('设备已断开');
  }

  async readLoop() {
    if (!this.port || !this.port.readable) return;
    this.reader = this.port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.processData(value);
      }
    } catch (error) {
      if (this.isConnected) {
        this.log(`读取错误: ${error.message}`, 'error');
      }
    } finally {
      if (this.reader) this.reader.releaseLock();
    }
  }

  /**
   * 处理串口数据流，查找帧头并解析双包结构
   */
  processData(chunk) {
    // 拼接到 buffer
    const newBuf = new Uint8Array(this.buffer.length + chunk.length);
    newBuf.set(this.buffer);
    newBuf.set(chunk, this.buffer.length);
    this.buffer = newBuf;

    while (this.buffer.length >= HEADER_LEN) {
      // 查找帧头
      const headerPos = this.findHeader(this.buffer);
      if (headerPos === -1) {
        // 保留最后 HEADER_LEN-1 字节防止帧头跨块
        if (this.buffer.length > HEADER_LEN) {
          this.buffer = this.buffer.slice(this.buffer.length - HEADER_LEN + 1);
        }
        break;
      }

      // 丢弃帧头前的垃圾数据
      if (headerPos > 0) {
        this.buffer = this.buffer.slice(headerPos);
      }

      // 至少需要 帧头(4) + 包序(1) + sensor_type(1) = 6 字节
      if (this.buffer.length < HEADER_LEN + 2) break;

      const packetOrder = this.buffer[HEADER_LEN];
      const sensorType = this.buffer[HEADER_LEN + 1];

      let dataLen;
      if (packetOrder === PACKET_TYPE_1) {
        dataLen = PACKET1_DATA_LEN;
      } else if (packetOrder === PACKET_TYPE_2) {
        dataLen = PACKET2_DATA_LEN;
      } else {
        // 无效包序，跳过帧头继续搜索
        this.errorCount++;
        this.buffer = this.buffer.slice(HEADER_LEN);
        continue;
      }

      const totalLen = HEADER_LEN + 2 + dataLen;
      if (this.buffer.length < totalLen) break;

      // 提取数据载荷
      const packetData = this.buffer.slice(HEADER_LEN + 2, totalLen);
      this.buffer = this.buffer.slice(totalLen);

      // 处理包
      const result = this.processPacket(packetOrder, sensorType, packetData);
      if (result) {
        // 更新 FPS
        this._frameCount++;
        const now = Date.now();
        if (now - this._lastFpsTime >= 1000) {
          this.fps = this._frameCount;
          this._frameCount = 0;
          this._lastFpsTime = now;
        }
        if (this.onDataCallback) this.onDataCallback(result);
      }
    }
  }

  /**
   * 在 buffer 中查找帧头位置
   */
  findHeader(buffer) {
    for (let i = 0; i <= buffer.length - HEADER_LEN; i++) {
      if (
        buffer[i] === HEADER[0] &&
        buffer[i + 1] === HEADER[1] &&
        buffer[i + 2] === HEADER[2] &&
        buffer[i + 3] === HEADER[3]
      ) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 处理单个包：包1缓存，包2合并后返回完整数据
   * 返回: { sensorValues: number[256], quaternion: Float32Array[4], hand: number } | null
   */
  processPacket(packetOrder, sensorType, data) {
    if (packetOrder === PACKET_TYPE_1) {
      // 缓存包1，等待包2
      this.packet1Cache.set(sensorType, data);
      return null;
    }

    if (packetOrder === PACKET_TYPE_2) {
      const packet1Data = this.packet1Cache.get(sensorType);
      if (!packet1Data) {
        this.errorCount++;
        return null;
      }
      this.packet1Cache.delete(sensorType);

      // 合并: 包1(128字节) + 包2(144字节) = 272字节
      const combined = new Uint8Array(packet1Data.length + data.length);
      combined.set(packet1Data);
      combined.set(data, packet1Data.length);

      // 前256字节 = 传感器值
      const sensorValues = Array.from(combined.slice(0, 256));

      // 后16字节 = IMU四元数 (4个float32, little-endian)
      let quaternion = null;
      if (combined.length >= 272) {
        const imuBytes = combined.slice(256, 272);
        const dv = new DataView(imuBytes.buffer, imuBytes.byteOffset, 16);
        quaternion = [
          dv.getFloat32(0, true),
          dv.getFloat32(4, true),
          dv.getFloat32(8, true),
          dv.getFloat32(12, true),
        ];
        // 校验四元数有效性
        const mag = Math.sqrt(quaternion.reduce((s, v) => s + v * v, 0));
        if (!isFinite(mag) || mag < 0.5 || mag > 2.0) {
          quaternion = null;
        }
      }

      this.packetCount++;
      return { sensorValues, quaternion, hand: sensorType };
    }

    return null;
  }
}

export const gripLeftService = new GripSerialService();
export const gripRightService = new GripSerialService();
export default GripSerialService;
