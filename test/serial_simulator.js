/**
 * 串口模拟器 - 创建虚拟串口对并发送真实传感器数据
 * 
 * 使用 socat 创建虚拟串口对:
 *   /dev/pts/X_app  <-->  /dev/pts/X_sim
 * 后端连接 _app 端，模拟器向 _sim 端写入数据
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// 分隔符
const DELIMITER = Buffer.from([0xAA, 0x55, 0x03, 0x99]);

// 设备配置
const DEVICES = {
  leftHand: {
    name: '左手',
    baudRate: 921600,
    dataFile: path.join(__dirname, '../upload_data/left_hand.bin'),
    manufacturer: 'wch.cn',
    friendlyName: 'USB-SERIAL',
  },
  rightHand: {
    name: '右手',
    baudRate: 921600,
    dataFile: path.join(__dirname, '../upload_data/right_hand.bin'),
    manufacturer: 'wch.cn',
    friendlyName: 'USB-SERIAL',
  },
  seat: {
    name: '坐垫',
    baudRate: 1000000,
    dataFile: path.join(__dirname, '../upload_data/seat.bin'),
    manufacturer: 'wch.cn',
    friendlyName: 'CH340',
  },
  foot1: {
    name: '脚垫1',
    baudRate: 3000000,
    dataFile: path.join(__dirname, '../upload_data/foot.bin'),
    manufacturer: 'FTDI',
    friendlyName: 'USB Serial',
    mac: '090030000251333039343533',
    type: 'foot1',
  },
  foot2: {
    name: '脚垫2',
    baudRate: 3000000,
    dataFile: path.join(__dirname, '../upload_data/foot.bin'),
    manufacturer: 'FTDI',
    friendlyName: 'USB Serial',
    mac: '30002F000251333039343533',
    type: 'foot2',
  },
  foot3: {
    name: '脚垫3',
    baudRate: 3000000,
    dataFile: path.join(__dirname, '../upload_data/foot.bin'),
    manufacturer: 'FTDI',
    friendlyName: 'USB Serial',
    mac: '4A0030000251333039343533',
    type: 'foot3',
  },
  foot4: {
    name: '脚垫4',
    baudRate: 3000000,
    dataFile: path.join(__dirname, '../upload_data/foot.bin'),
    manufacturer: 'FTDI',
    friendlyName: 'USB Serial',
    mac: '260030000251333039343533',
    type: 'foot4',
  },
};

/**
 * 解析十六进制文本数据为帧数组
 * 按分隔符 AA 55 03 99 切割
 */
function parseHexDataToFrames(hexText) {
  // 清理文本，提取所有十六进制字节
  const bytes = hexText.trim().split(/\s+/).map(h => parseInt(h, 16)).filter(v => !isNaN(v));
  const buffer = Buffer.from(bytes);
  
  // 按分隔符切割
  const frames = [];
  let start = 0;
  
  for (let i = 0; i <= buffer.length - 4; i++) {
    if (buffer[i] === 0xAA && buffer[i+1] === 0x55 && buffer[i+2] === 0x03 && buffer[i+3] === 0x99) {
      if (i > start) {
        // 分隔符之前的数据是一个帧
        frames.push(buffer.slice(start, i));
      }
      start = i + 4; // 跳过分隔符
    }
  }
  // 最后一段
  if (start < buffer.length) {
    frames.push(buffer.slice(start));
  }
  
  return frames.filter(f => f.length > 0);
}

/**
 * 从真实数据文件加载帧
 */
function loadFramesFromFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`数据文件不存在: ${filePath}`);
    return [];
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  return parseHexDataToFrames(text);
}

/**
 * 生成左手帧数据 (130字节: order + type=1 + 128字节矩阵)
 */
function generateHandFrame(order, type, pressureData) {
  const frame = Buffer.alloc(130);
  frame[0] = order; // 1=第一帧, 2=第二帧
  frame[1] = type;  // 1=左手, 2=右手
  if (pressureData && pressureData.length >= 128) {
    pressureData.copy(frame, 2, 0, 128);
  }
  return frame;
}

/**
 * 生成146字节帧 (含四元数)
 */
function generateHandFrame146(order, type, pressureData, quaternion) {
  const frame = Buffer.alloc(146);
  frame[0] = order;
  frame[1] = type;
  if (pressureData && pressureData.length >= 128) {
    pressureData.copy(frame, 2, 0, 128);
  }
  if (quaternion && quaternion.length >= 16) {
    quaternion.copy(frame, 130, 0, 16);
  }
  return frame;
}

/**
 * 生成坐垫帧 (1024字节)
 */
function generateSeatFrame(pressureData) {
  const frame = Buffer.alloc(1024);
  if (pressureData && pressureData.length >= 1024) {
    pressureData.copy(frame, 0, 0, 1024);
  } else if (pressureData) {
    pressureData.copy(frame, 0, 0, Math.min(pressureData.length, 1024));
  }
  return frame;
}

/**
 * 生成脚垫帧 (4096字节)
 */
function generateFootFrame(pressureData) {
  const frame = Buffer.alloc(4096);
  if (pressureData && pressureData.length >= 4096) {
    pressureData.copy(frame, 0, 0, 4096);
  } else if (pressureData) {
    pressureData.copy(frame, 0, 0, Math.min(pressureData.length, 4096));
  }
  return frame;
}

/**
 * 创建 socat 虚拟串口对
 * 返回 { appPath, simPath, process }
 */
function createVirtualSerialPair(name) {
  return new Promise((resolve, reject) => {
    const proc = spawn('socat', [
      '-d', '-d',
      `PTY,raw,echo=0,link=/tmp/vserial_${name}_app`,
      `PTY,raw,echo=0,link=/tmp/vserial_${name}_sim`,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // socat 在 stderr 输出 PTY 路径
      if (stderr.includes('/tmp/vserial_' + name + '_app') && stderr.includes('/tmp/vserial_' + name + '_sim')) {
        setTimeout(() => {
          resolve({
            appPath: `/tmp/vserial_${name}_app`,
            simPath: `/tmp/vserial_${name}_sim`,
            process: proc,
          });
        }, 200);
      }
    });
    
    proc.on('error', reject);
    
    // 超时
    setTimeout(() => {
      if (fs.existsSync(`/tmp/vserial_${name}_app`) && fs.existsSync(`/tmp/vserial_${name}_sim`)) {
        resolve({
          appPath: `/tmp/vserial_${name}_app`,
          simPath: `/tmp/vserial_${name}_sim`,
          process: proc,
        });
      } else {
        reject(new Error(`创建虚拟串口超时: ${name}`));
      }
    }, 3000);
  });
}

/**
 * 串口模拟器类
 */
class SerialSimulator {
  constructor() {
    this.socatProcesses = [];
    this.writeIntervals = [];
    this.portMap = {}; // name -> { appPath, simPath, fd }
  }

  /**
   * 初始化所有虚拟串口对
   */
  async init(deviceNames) {
    console.log('[Simulator] 正在创建虚拟串口对...');
    
    for (const name of deviceNames) {
      try {
        const pair = await createVirtualSerialPair(name);
        this.socatProcesses.push(pair.process);
        this.portMap[name] = {
          appPath: pair.appPath,
          simPath: pair.simPath,
        };
        console.log(`  ✓ ${name}: app=${pair.appPath} sim=${pair.simPath}`);
      } catch (e) {
        console.error(`  ✗ ${name}: ${e.message}`);
      }
    }
    
    return this.portMap;
  }

  /**
   * 生成后端需要的环境变量
   */
  getEnvVars(deviceNames) {
    const portList = [];
    const baudMap = {};
    const macMap = {};
    
    for (const name of deviceNames) {
      const port = this.portMap[name];
      const device = DEVICES[name];
      if (!port || !device) continue;
      
      portList.push({
        path: port.appPath,
        manufacturer: device.manufacturer || '',
        friendlyName: device.friendlyName || '',
      });
      
      baudMap[port.appPath] = device.baudRate;
      
      if (device.mac) {
        const portName = port.appPath.split('/').pop().replace('_app', '');
        macMap[portName] = {
          mac: device.mac,
          type: device.type,
        };
      }
    }
    
    return {
      VIRTUAL_SERIAL_TEST: 'true',
      VIRTUAL_PORT_LIST: JSON.stringify(portList),
      VIRTUAL_BAUD_MAP: JSON.stringify(baudMap),
      VIRTUAL_MAC_MAP: JSON.stringify(macMap),
    };
  }

  /**
   * 开始向指定设备发送数据
   */
  startSending(deviceName, frames, intervalMs = 80) {
    const port = this.portMap[deviceName];
    if (!port) {
      console.error(`[Simulator] 设备 ${deviceName} 未初始化`);
      return;
    }
    
    let fd;
    try {
      fd = fs.openSync(port.simPath, 'w');
    } catch (e) {
      console.error(`[Simulator] 无法打开 ${port.simPath}: ${e.message}`);
      return;
    }
    
    let frameIndex = 0;
    const interval = setInterval(() => {
      if (frameIndex >= frames.length) {
        frameIndex = 0; // 循环发送
      }
      
      try {
        const frame = frames[frameIndex];
        // 写入: 帧数据 + 分隔符
        const packet = Buffer.concat([frame, DELIMITER]);
        fs.writeSync(fd, packet);
        frameIndex++;
      } catch (e) {
        // 写入失败，可能对端已关闭
      }
    }, intervalMs);
    
    this.writeIntervals.push({ interval, fd });
    console.log(`[Simulator] 开始发送 ${deviceName} 数据, ${frames.length} 帧, 间隔 ${intervalMs}ms`);
  }

  /**
   * 开始发送脚垫数据（需要先响应 AT 指令）
   */
  startFootSending(deviceName, frames, intervalMs = 80) {
    const port = this.portMap[deviceName];
    const device = DEVICES[deviceName];
    if (!port || !device) return;
    
    let fd;
    try {
      fd = fs.openSync(port.simPath, 'r+');
    } catch (e) {
      console.error(`[Simulator] 无法打开 ${port.simPath}: ${e.message}`);
      return;
    }
    
    // 对于脚垫，先发送 MAC 响应，然后发送数据帧
    // 在虚拟串口测试模式下，后端会自动从 VIRTUAL_MAC_MAP 获取 MAC
    // 所以我们直接发送数据帧即可
    
    let frameIndex = 0;
    const interval = setInterval(() => {
      if (frameIndex >= frames.length) {
        frameIndex = 0;
      }
      try {
        const frame = frames[frameIndex];
        const packet = Buffer.concat([frame, DELIMITER]);
        fs.writeSync(fd, packet);
        frameIndex++;
      } catch (e) {}
    }, intervalMs);
    
    this.writeIntervals.push({ interval, fd });
    console.log(`[Simulator] 开始发送 ${deviceName} 数据, ${frames.length} 帧, 间隔 ${intervalMs}ms`);
  }

  /**
   * 停止所有发送并清理
   */
  cleanup() {
    console.log('[Simulator] 正在清理...');
    
    for (const item of this.writeIntervals) {
      clearInterval(item.interval);
      try { fs.closeSync(item.fd); } catch (e) {}
    }
    this.writeIntervals = [];
    
    for (const proc of this.socatProcesses) {
      try { proc.kill(); } catch (e) {}
    }
    this.socatProcesses = [];
    
    // 清理符号链接
    for (const name of Object.keys(this.portMap)) {
      try { fs.unlinkSync(`/tmp/vserial_${name}_app`); } catch (e) {}
      try { fs.unlinkSync(`/tmp/vserial_${name}_sim`); } catch (e) {}
    }
    this.portMap = {};
    
    console.log('[Simulator] 清理完成');
  }
}

module.exports = {
  SerialSimulator,
  DEVICES,
  DELIMITER,
  parseHexDataToFrames,
  loadFramesFromFile,
  generateHandFrame,
  generateHandFrame146,
  generateSeatFrame,
  generateFootFrame,
};
