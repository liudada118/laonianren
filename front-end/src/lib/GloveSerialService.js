/**
 * 手套串口通信服务 - 基于 Web Serial API
 * 支持左右手手套，波特率 921600
 * 
 * 帧协议：
 *   分隔符: AA 55 03 99 (作为帧尾)
 *   每只手套分两帧传输:
 *     第一帧(分隔符切割后130字节): [顺序位(1)] [类型位(1)] [数据体(128)]
 *     第二帧(分隔符切割后146字节): [顺序位(1)] [类型位(1)] [数据体(128)] [四元数(16,忽略)]
 *     顺序位: 1=第一帧, 2=第二帧
 *     类型位: 1=左手, 2=右手
 *   两帧合并后得到 256 个传感器值（16×16 矩阵）
 */

class GloveSerialService {
  constructor() {
    this.port = null;
    this.reader = null;
    this.isConnected = false;

    // 回调
    this.onLeftHandData = null;   // (sensorArray256) => void
    this.onRightHandData = null;  // (sensorArray256) => void

    // 事件监听器（支持多个监听器，不会被覆盖）
    this._listeners = {
      log: [],
      status: [],
      leftData: [],
      rightData: []
    };

    // 协议常量
    this.BAUD_RATE = 921600;
    this.FOOTER = [0xAA, 0x55, 0x03, 0x99];
    this.FRAME1_LEN = 130; // 顺序位(1) + 类型位(1) + 数据体(128)
    this.FRAME2_LEN = 146; // 顺序位(1) + 类型位(1) + 数据体(128) + 四元数(16)

    // 缓冲区
    this.buffer = new Uint8Array(0);

    // 帧缓存：存储第一帧数据，等第二帧到来后合并
    this.leftFrame1 = null;
    this.rightFrame1 = null;

    // FPS 统计
    this.leftFrameCount = 0;
    this.rightFrameCount = 0;
    this.lastFpsTime = 0;
    this.leftFps = 0;
    this.rightFps = 0;
    this.totalFramesParsed = 0;
  }

  get connected() {
    return this.isConnected;
  }

  /* ─── 事件系统 ─── */

  /**
   * 添加事件监听器（不会覆盖已有监听器）
   * @param {'log'|'status'|'leftData'|'rightData'} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event].push(callback);
    }
    return () => this.off(event, callback); // 返回取消函数
  }

  /**
   * 移除事件监听器
   */
  off(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
  }

  /**
   * 触发事件
   */
  _emit(event, ...args) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => {
        try { cb(...args); } catch (e) { console.error(`[Glove] listener error:`, e); }
      });
    }
  }

  /* ─── 旧的回调兼容接口 ─── */
  setOnLeftHandData(callback) { this.onLeftHandData = callback; }
  setOnRightHandData(callback) { this.onRightHandData = callback; }
  // 保留旧接口但也触发事件
  setOnLog(callback) { this._legacyLogCallback = callback; }
  setOnStatus(callback) { this._legacyStatusCallback = callback; }

  log(message, type = 'info') {
    // 触发事件监听器
    this._emit('log', message, type);
    // 旧回调兼容
    if (this._legacyLogCallback) this._legacyLogCallback(message, type);
    // 控制台输出
    if (type === 'error') {
      console.error(`[Glove] ${message}`);
    } else {
      console.log(`[Glove] ${message}`);
    }
  }

  notifyStatus(status) {
    this._emit('status', status);
    if (this._legacyStatusCallback) this._legacyStatusCallback(status);
  }

  /* ─── 连接管理 ─── */

  async connect() {
    if (!('serial' in navigator)) {
      this.log('当前浏览器不支持 Web Serial API，请使用 Chrome/Edge', 'error');
      return false;
    }
    try {
      this.port = await navigator.serial.requestPort();
      this.log(`端口已选择，正在以 ${this.BAUD_RATE} 波特率打开...`);
      await this.port.open({ baudRate: this.BAUD_RATE });
      this._initState();
      this.log(`端口打开成功，波特率 ${this.BAUD_RATE}`);
      this.notifyStatus('connected');
      this.readLoop();
      return true;
    } catch (error) {
      this.log(`连接失败: ${error.message}`, 'error');
      this.notifyStatus('error');
      return false;
    }
  }

  async connectWithPort(port) {
    try {
      this.port = port;
      this.log(`正在以 ${this.BAUD_RATE} 波特率打开端口...`);
      await this.port.open({ baudRate: this.BAUD_RATE });
      this._initState();
      this.log(`端口打开成功，波特率 ${this.BAUD_RATE}`);
      this.notifyStatus('connected');
      this.readLoop();
      return true;
    } catch (error) {
      this.log(`连接失败: ${error.message}`, 'error');
      this.notifyStatus('error');
      return false;
    }
  }

  _initState() {
    this.isConnected = true;
    this.buffer = new Uint8Array(0);
    this.leftFrame1 = null;
    this.rightFrame1 = null;
    this.leftFrameCount = 0;
    this.rightFrameCount = 0;
    this.lastFpsTime = Date.now();
    this.leftFps = 0;
    this.rightFps = 0;
    this.totalFramesParsed = 0;
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
    this.leftFrame1 = null;
    this.rightFrame1 = null;
    this.notifyStatus('disconnected');
    this.log('手套设备已断开');
  }

  /* ─── 数据读取 ─── */

  async readLoop() {
    if (!this.port || !this.port.readable) return;
    this.reader = this.port.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) {
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

  /* ─── 帧解析 ─── */

  /**
   * 查找分隔符 AA 55 03 99 的位置
   */
  findFooter(buf, startFrom = 0) {
    for (let i = startFrom; i <= buf.length - 4; i++) {
      if (buf[i] === 0xAA && buf[i + 1] === 0x55 && buf[i + 2] === 0x03 && buf[i + 3] === 0x99) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 处理接收到的串口数据
   * 核心解析逻辑：
   * 1. 追加到缓冲区
   * 2. 用分隔符 AA 55 03 99 切割
   * 3. 切割后的段长度为130（第一帧）或146（第二帧）
   * 4. 解析顺序位、类型位、数据体
   */
  processData(chunk) {
    // 追加到缓冲区
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    // 循环用分隔符切割帧
    let searchStart = 0;
    while (true) {
      const footerPos = this.findFooter(this.buffer, searchStart);
      if (footerPos === -1) break;

      // footer 前面的数据就是帧内容（从 buffer 开头或上一个 footer+4 到当前 footer）
      // 由于我们每次处理完都会 slice buffer，所以 buffer 开头就是帧数据的起始
      const frameContent = this.buffer.slice(0, footerPos);
      const frameLen = frameContent.length;

      // 根据长度判断帧类型
      if (frameLen === this.FRAME1_LEN || frameLen === this.FRAME2_LEN) {
        const seqByte = frameContent[0];  // 顺序位
        const typeByte = frameContent[1]; // 类型位

        // 校验顺序位和类型位
        if ((seqByte === 1 || seqByte === 2) && (typeByte === 1 || typeByte === 2)) {
          // 提取128字节数据体（从偏移2开始，取128字节）
          const dataBody = frameContent.slice(2, 130);

          this.totalFramesParsed++;

          // 前20帧打印详细hex dump，帮助诊断数据偏移
          if (this.totalFramesParsed <= 20) {
            const hexHead = Array.from(frameContent.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const hexTail = Array.from(frameContent.slice(-6)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const dataMax = Math.max(...dataBody);
            const dataNonZero = Array.from(dataBody).filter(v => v > 0).length;
            this.log(`帧#${this.totalFramesParsed} hex: [${hexHead}...${hexTail}] len=${frameLen} seq=${seqByte} type=${typeByte} dataMax=${dataMax} nonZero=${dataNonZero}/128`, 'data');
          }

          this.handleFrame({ seq: seqByte, type: typeByte, data: dataBody, rawLen: frameLen });
        } else {
          // 顺序位/类型位不合法，记录日志
          if (this.totalFramesParsed < 20 || this.totalFramesParsed % 100 === 0) {
            const hexHead = Array.from(frameContent.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            this.log(`帧校验失败: len=${frameLen}, seq=${seqByte}, type=${typeByte}, hex=[${hexHead}...]`, 'error');
          }
        }
      } else if (frameLen > 0) {
        // 长度不匹配，可能是启动时的残留数据
        if (this.totalFramesParsed < 20) {
          const hexHead = Array.from(frameContent.slice(0, Math.min(16, frameLen))).map(b => b.toString(16).padStart(2, '0')).join(' ');
          this.log(`异常帧: len=${frameLen} (期望 ${this.FRAME1_LEN} 或 ${this.FRAME2_LEN}), hex=[${hexHead}...]`, 'error');
        }
      }

      // 移除已处理的数据（帧内容 + footer 4字节）
      this.buffer = this.buffer.slice(footerPos + 4);
      searchStart = 0; // 重置搜索起点
    }

    // 防止缓冲区无限增长（保留最后一段不完整的数据）
    if (this.buffer.length > 10000) {
      this.log(`缓冲区过大 (${this.buffer.length} bytes)，截断`, 'error');
      this.buffer = this.buffer.slice(this.buffer.length - 2000);
    }
  }

  /**
   * 处理解析出的帧
   */
  handleFrame(frame) {
    const { seq, type, data, rawLen } = frame;
    const isLeft = type === 1;
    const handName = isLeft ? '左手' : '右手';

    if (seq === 1) {
      // 第一帧：缓存起来等第二帧
      if (isLeft) {
        this.leftFrame1 = new Uint8Array(data);
      } else {
        this.rightFrame1 = new Uint8Array(data);
      }

      // 前几帧打印详细日志
      if (this.totalFramesParsed <= 10) {
        this.log(`${handName} 第一帧: len=${rawLen}, data[0..5]=[${Array.from(data.slice(0, 6)).join(',')}]`, 'data');
      }
    } else if (seq === 2) {
      // 第二帧：与第一帧合并
      const frame1 = isLeft ? this.leftFrame1 : this.rightFrame1;
      if (frame1 && frame1.length === 128) {
        // 合并两帧数据：frame1(128) + frame2(128) = 256 bytes
        const fullData = new Array(256);
        for (let i = 0; i < 128; i++) {
          fullData[i] = frame1[i];
        }
        for (let i = 0; i < 128; i++) {
          fullData[128 + i] = data[i];
        }

        // 更新 FPS
        if (isLeft) {
          this.leftFrameCount++;
        } else {
          this.rightFrameCount++;
        }
        const now = Date.now();
        if (now - this.lastFpsTime >= 1000) {
          this.leftFps = this.leftFrameCount;
          this.rightFps = this.rightFrameCount;
          this.leftFrameCount = 0;
          this.rightFrameCount = 0;
          this.lastFpsTime = now;
        }

        // 前几帧打印详细日志
        const totalComplete = (isLeft ? this.leftFps : this.rightFps) || 1;
        if (this.totalFramesParsed <= 20 || this.totalFramesParsed % 200 === 0) {
          const max = Math.max(...fullData);
          const sum = fullData.reduce((a, b) => a + b, 0);
          const avg = (sum / 256).toFixed(1);
          this.log(`${handName} 完整帧: max=${max}, avg=${avg}, sum=${sum}, L_fps=${this.leftFps}, R_fps=${this.rightFps}`, 'data');
        }

        // 触发事件监听器
        if (isLeft) {
          this._emit('leftData', fullData);
        } else {
          this._emit('rightData', fullData);
        }

        // 旧回调兼容
        if (isLeft && this.onLeftHandData) {
          this.onLeftHandData(fullData);
        } else if (!isLeft && this.onRightHandData) {
          this.onRightHandData(fullData);
        }
      } else {
        this.log(`${handName} 第二帧到达但缺少第一帧 (frame1=${frame1 ? frame1.length : 'null'})`, 'error');
      }

      // 清除缓存
      if (isLeft) {
        this.leftFrame1 = null;
      } else {
        this.rightFrame1 = null;
      }
    }
  }
}

// 导出单例
export const gloveService = new GloveSerialService();
export default GloveSerialService;
