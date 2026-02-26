/**
 * 老年人筛查系统 - 7设备串口模拟器 (v2)
 * 
 * 使用 Node.js serialport 库进行可靠的虚拟串口通信
 * 
 * 模拟以下7个设备：
 * 1. HL (左手手套) - 921600 baud, 130+146字节分包
 * 2. HR (右手手套) - 921600 baud, 130+146字节分包
 * 3. sit (坐垫) - 1000000 baud, 1024字节
 * 4. foot1-4 (脚垫) - 3000000 baud, 4096字节
 * 
 * 所有设备数据帧以 AA 55 03 99 分隔符结尾
 */

const { SerialPort } = require('serialport');
const path = require('path');

const PORTS_DIR = '/tmp/vserial';
const DELIMITER = Buffer.from([0xAA, 0x55, 0x03, 0x99]);

// MAC地址映射
const MAC_MAP = {
  foot1: '090030000251333039343533',
  foot2: '30002F000251333039343533',
  foot3: '4A0030000251333039343533',
  foot4: '260030000251333039343533',
};

// 设备配置
const DEVICE_CONFIG = {
  HL:    { type: 'glove', hand: 1, hz: 20, baudRate: 921600 },
  HR:    { type: 'glove', hand: 2, hz: 20, baudRate: 921600 },
  sit:   { type: 'sit',   hz: 12, baudRate: 1000000 },
  foot1: { type: 'foot',  mac: MAC_MAP.foot1, hz: 12, baudRate: 3000000 },
  foot2: { type: 'foot',  mac: MAC_MAP.foot2, hz: 12, baudRate: 3000000 },
  foot3: { type: 'foot',  mac: MAC_MAP.foot3, hz: 12, baudRate: 3000000 },
  foot4: { type: 'foot',  mac: MAC_MAP.foot4, hz: 12, baudRate: 3000000 },
};

class DeviceSimulator {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.simPort = path.join(PORTS_DIR, `${name}_sim`);
    this.port = null;
    this.frameCount = 0;
    this.timer = null;
    this.atResponded = false;
    this.ready = false;
    this.writeQueue = [];
    this.writing = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.port = new SerialPort({
          path: this.simPort,
          baudRate: this.config.baudRate,
          autoOpen: true,
        }, (err) => {
          if (err) {
            console.error(`[${this.name}] Failed to open: ${err.message}`);
            reject(err);
            return;
          }
          console.log(`[${this.name}] Opened ${this.simPort} @ ${this.config.baudRate} baud`);
          this.ready = true;

          // 监听AT指令（脚垫设备）
          if (this.config.type === 'foot') {
            this.port.on('data', (data) => {
              const str = data.toString();
              if (str.includes('AT') || str.includes('NAME=ESP32')) {
                console.log(`[${this.name}] Received AT command, pausing data & responding with MAC`);
                // 暂停数据发送
                if (this.timer) {
                  clearInterval(this.timer);
                  this.timer = null;
                }
                // 清空写队列
                this.writeQueue = [];
                // 等待drain后发MAC响应
                setTimeout(() => {
                  this.sendMACResponse();
                  // MAC响应发送后恢复数据发送
                  setTimeout(() => {
                    if (!this.timer) {
                      this.startSending();
                      console.log(`[${this.name}] Resumed data sending after MAC response`);
                    }
                  }, 500);
                }, 100);
              }
            });
          }

          // 延迟启动数据发送，等待后端连接
          setTimeout(() => {
            this.startSending();
          }, 2000);

          resolve();
        });

        this.port.on('error', (err) => {
          console.error(`[${this.name}] Port error: ${err.message}`);
        });

      } catch (e) {
        console.error(`[${this.name}] Exception: ${e.message}`);
        reject(e);
      }
    });
  }

  startSending() {
    const interval = Math.floor(1000 / this.config.hz);
    this.timer = setInterval(() => {
      if (this.ready) {
        this.sendFrame();
      }
    }, interval);
    console.log(`[${this.name}] Sending at ${this.config.hz}Hz (${interval}ms interval)`);
  }

  enqueueWrite(buf) {
    this.writeQueue.push(buf);
    this.drainQueue();
  }

  drainQueue() {
    if (this.writing || !this.writeQueue.length || !this.port) return;
    this.writing = true;
    const buf = this.writeQueue.shift();
    this.port.write(buf, (err) => {
      if (err) {
        // silently skip write errors
      }
      this.port.drain(() => {
        this.writing = false;
        if (this.writeQueue.length) {
          this.drainQueue();
        }
      });
    });
  }

  sendMACResponse() {
    const mac = this.config.mac;
    const version = 'C40510';
    const response = `Unique ID: ${mac} - Versions: ${version}\r\n`;
    // 先发一个分隔符来结束之前可能未完成的数据帧
    const flushBuf = Buffer.from(DELIMITER);
    const responseBuf = Buffer.concat([
      Buffer.from(response, 'utf-8'),
      DELIMITER
    ]);
    // 先flush，再发MAC响应
    this.enqueueWrite(Buffer.concat([flushBuf, responseBuf]));
  }

  sendFrame() {
    this.frameCount++;
    let frameData;

    switch (this.config.type) {
      case 'glove':
        frameData = this.generateGloveFrame();
        break;
      case 'sit':
        frameData = this.generateSitFrame();
        break;
      case 'foot':
        frameData = this.generateFootFrame();
        break;
      default:
        return;
    }

    if (Array.isArray(frameData)) {
      // 手套有两帧
      for (const frame of frameData) {
        const packet = Buffer.concat([frame, DELIMITER]);
        this.enqueueWrite(packet);
      }
    } else {
      const packet = Buffer.concat([frameData, DELIMITER]);
      this.enqueueWrite(packet);
    }
  }

  /**
   * 生成手套数据帧（分两帧）
   * 第一帧: 130字节 = [顺序位(1)][类型位(1)][数据(128)]
   * 第二帧: 146字节 = [顺序位(1)][类型位(1)][数据(128)][四元数(16)]
   */
  generateGloveFrame() {
    const hand = this.config.hand; // 1=左手, 2=右手
    const t = this.frameCount * 0.05;

    const matrix = this.generateGloveMatrix(t);
    const firstHalf = matrix.slice(0, 128);
    const secondHalf = matrix.slice(128, 256);

    // 第一帧: 130字节
    const frame1 = Buffer.alloc(130);
    frame1[0] = 1; // 顺序位: 第一帧
    frame1[1] = hand; // 类型位: 1=左手, 2=右手
    Buffer.from(firstHalf).copy(frame1, 2);

    // 第二帧: 146字节
    const frame2 = Buffer.alloc(146);
    frame2[0] = 2; // 顺序位: 第二帧
    frame2[1] = hand; // 类型位
    Buffer.from(secondHalf).copy(frame2, 2);
    // 最后16字节是四元数
    const quat = Buffer.alloc(16);
    quat.writeFloatLE(Math.cos(t * 0.1), 0);
    quat.writeFloatLE(Math.sin(t * 0.1), 4);
    quat.writeFloatLE(0, 8);
    quat.writeFloatLE(1, 12);
    quat.copy(frame2, 130);

    return [frame1, frame2];
  }

  generateGloveMatrix(t) {
    const matrix = new Uint8Array(256);
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        const idx = i * 16 + j;
        const cx = 8, cy = 8;
        const dist = Math.sqrt((i - cx) ** 2 + (j - cy) ** 2);
        const base = Math.max(0, 150 - dist * 15);
        const wave = 30 * Math.sin(t * 0.5 + i * 0.3);
        const noise = Math.random() * 15;
        matrix[idx] = Math.min(255, Math.max(0, Math.round(base + wave + noise)));
      }
    }
    return matrix;
  }

  /**
   * 生成坐垫数据帧: 1024字节 (32x32矩阵)
   */
  generateSitFrame() {
    const t = this.frameCount * 0.08;
    const matrix = Buffer.alloc(1024);

    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 32; j++) {
        const idx = i * 32 + j;
        const leftDist = Math.sqrt((i - 12) ** 2 + (j - 10) ** 2);
        const rightDist = Math.sqrt((i - 12) ** 2 + (j - 22) ** 2);
        const leftPressure = Math.max(0, 120 - leftDist * 8);
        const rightPressure = Math.max(0, 120 - rightDist * 8);
        const base = Math.max(leftPressure, rightPressure);
        const wave = 15 * Math.sin(t * 0.3 + i * 0.2);
        const noise = Math.random() * 10;
        matrix[idx] = Math.min(255, Math.max(0, Math.round(base + wave + noise)));
      }
    }

    return matrix;
  }

  /**
   * 生成脚垫数据帧: 4096字节 (64x64矩阵)
   */
  generateFootFrame() {
    const t = this.frameCount * 0.08;
    const matrix = Buffer.alloc(4096);

    for (let i = 0; i < 64; i++) {
      for (let j = 0; j < 64; j++) {
        const idx = i * 64 + j;
        let pressure = 0;

        // 足跟区域
        const heelDist = Math.sqrt((i - 52) ** 2 + ((j - 32) * 0.8) ** 2);
        if (heelDist < 12) {
          pressure = Math.max(pressure, 180 - heelDist * 10);
        }

        // 前掌区域
        const ballDist = Math.sqrt(((i - 18) * 0.7) ** 2 + ((j - 32) * 0.5) ** 2);
        if (ballDist < 18) {
          pressure = Math.max(pressure, 150 - ballDist * 6);
        }

        // 足弓区域
        const archDist = Math.sqrt(((i - 35) * 0.5) ** 2 + ((j - 32) * 0.8) ** 2);
        if (archDist < 10) {
          pressure = Math.max(pressure, 40 - archDist * 3);
        }

        // 大拇趾区域
        const toeDist = Math.sqrt((i - 6) ** 2 + ((j - 25) * 0.8) ** 2);
        if (toeDist < 6) {
          pressure = Math.max(pressure, 120 - toeDist * 12);
        }

        const wave = 20 * Math.sin(t * 0.4 + i * 0.1 + j * 0.05);
        const noise = Math.random() * 8;
        const value = Math.min(255, Math.max(0, Math.round(pressure + wave + noise)));

        matrix[idx] = value > 8 ? value : 0;
      }
    }

    return matrix;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    console.log(`[${this.name}] Stopped (sent ${this.frameCount} frames)`);
  }
}

// ==================== 主程序 ====================

async function main() {
  console.log('=== 老年人筛查系统 - 7设备串口模拟器 v2 ===\n');

  const simulators = [];
  const devices = Object.keys(DEVICE_CONFIG);

  for (const dev of devices) {
    const sim = new DeviceSimulator(dev, DEVICE_CONFIG[dev]);
    simulators.push(sim);
    try {
      await sim.start();
    } catch (e) {
      console.error(`Failed to start ${dev}: ${e.message}`);
    }
  }

  console.log(`\n=== All ${simulators.length} device simulators started ===\n`);

  // 每10秒打印状态
  setInterval(() => {
    const stats = simulators.map(s => `${s.name}:${s.frameCount}`).join(' | ');
    console.log(`[STATUS] ${stats}`);
  }, 10000);

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    simulators.forEach(s => s.stop());
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    simulators.forEach(s => s.stop());
    process.exit(0);
  });
}

main().catch(console.error);
