/**
 * 老年人评估监测系统 - 后端服务
 * 
 * 功能：
 * 1. WebSocket 实时推送传感器数据
 * 2. 串口通信管理（连接/断开/数据采集）
 * 3. 调用 Python 算法包生成报告
 * 4. 历史记录管理
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// 静态文件服务 - 报告文件
app.use('/reports', express.static(path.join(__dirname, '../data/reports')));

// 确保数据目录存在
const dataDir = path.join(__dirname, '../data');
const reportsDir = path.join(dataDir, 'reports');
const historyFile = path.join(dataDir, 'history.json');

[dataDir, reportsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

if (!fs.existsSync(historyFile)) {
  fs.writeFileSync(historyFile, JSON.stringify([], null, 2));
}

// ============ 串口管理（Mac Mini 实际部署时启用） ============
// 在实际部署中，这里会使用 serialport 库连接真实传感器
// import { SerialPort } from 'serialport';
// import { ReadlineParser } from '@serialport/parser-readline';

// 传感器配置
const SENSOR_CONFIG = {
  grip: { path: '/dev/tty.usbserial-grip', baudRate: 115200, name: '握力传感器' },
  sitstand: { path: '/dev/tty.usbserial-sitstand', baudRate: 115200, name: '起坐传感器' },
  standing: { path: '/dev/tty.usbserial-standing', baudRate: 115200, name: '站立传感器' },
  gait: { path: '/dev/tty.usbserial-gait', baudRate: 115200, name: '步态传感器' }
};

// 模拟串口连接状态
const deviceStatus = {
  grip: { connected: false, port: null },
  sitstand: { connected: false, port: null },
  standing: { connected: false, port: null },
  gait: { connected: false, port: null }
};

// ============ REST API ============

// 获取设备连接状态
app.get('/api/device/:type/status', (req, res) => {
  const { type } = req.params;
  if (!SENSOR_CONFIG[type]) {
    return res.status(400).json({ error: '未知设备类型' });
  }
  res.json({
    type,
    name: SENSOR_CONFIG[type].name,
    connected: deviceStatus[type].connected,
    path: SENSOR_CONFIG[type].path
  });
});

// 连接设备
app.post('/api/device/:type/connect', (req, res) => {
  const { type } = req.params;
  if (!SENSOR_CONFIG[type]) {
    return res.status(400).json({ error: '未知设备类型' });
  }
  
  // 模拟连接延迟
  setTimeout(() => {
    deviceStatus[type].connected = true;
    res.json({ success: true, message: `${SENSOR_CONFIG[type].name}已连接` });
    
    // 通知所有 WebSocket 客户端
    broadcastToClients({
      type: 'device_status',
      deviceType: type,
      connected: true
    });
  }, 1000);
});

// 断开设备
app.post('/api/device/:type/disconnect', (req, res) => {
  const { type } = req.params;
  deviceStatus[type].connected = false;
  res.json({ success: true, message: `${SENSOR_CONFIG[type].name}已断开` });
  
  broadcastToClients({
    type: 'device_status',
    deviceType: type,
    connected: false
  });
});

// 获取历史记录
app.get('/api/history', (req, res) => {
  try {
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    res.json(history);
  } catch (e) {
    res.json([]);
  }
});

// 保存评估记录
app.post('/api/history', (req, res) => {
  try {
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    const record = {
      id: Date.now().toString(),
      ...req.body,
      createdAt: new Date().toISOString()
    };
    history.unshift(record);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: '保存失败' });
  }
});

// 删除历史记录
app.delete('/api/history/:id', (req, res) => {
  try {
    let history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    history = history.filter(h => h.id !== req.params.id);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

// 调用 Python 算法包生成报告
app.post('/api/report/generate', (req, res) => {
  const { patientName, assessmentType, data } = req.body;
  
  // 实际部署时调用 Python 算法包
  // const python = spawn('python3', ['algorithms/generate_report.py', JSON.stringify(req.body)]);
  
  // 模拟报告生成
  setTimeout(() => {
    const reportId = Date.now().toString();
    res.json({
      success: true,
      reportId,
      staticReport: `/assets/grip_report.pdf`,
      dynamicReport: `/assets/dynamic_report.mp4`
    });
  }, 2000);
});

// ============ WebSocket 服务 ============

const server = createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set();

function broadcastToClients(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('客户端已连接, 当前连接数:', clients.size);
  
  let dataInterval = null;
  
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      switch (msg.action) {
        case 'start_collection':
          // 开始数据采集 - 模拟传感器数据
          console.log(`开始采集: ${msg.deviceType} - ${msg.hand || ''}`);
          dataInterval = startDataSimulation(ws, msg.deviceType, msg.hand);
          break;
          
        case 'stop_collection':
          // 停止数据采集
          console.log(`停止采集: ${msg.deviceType}`);
          if (dataInterval) {
            clearInterval(dataInterval);
            dataInterval = null;
          }
          ws.send(JSON.stringify({ type: 'collection_stopped' }));
          break;
          
        case 'connect_device':
          // 连接设备
          setTimeout(() => {
            deviceStatus[msg.deviceType] = { connected: true };
            ws.send(JSON.stringify({
              type: 'device_connected',
              deviceType: msg.deviceType
            }));
          }, 1500);
          break;
      }
    } catch (e) {
      console.error('消息解析错误:', e);
    }
  });
  
  ws.on('close', () => {
    clients.delete(ws);
    if (dataInterval) clearInterval(dataInterval);
    console.log('客户端断开, 当前连接数:', clients.size);
  });
});

// 模拟传感器数据生成
function startDataSimulation(ws, deviceType, hand) {
  let frameCount = 0;
  const startTime = Date.now();
  
  return setInterval(() => {
    frameCount++;
    const elapsed = (Date.now() - startTime) / 1000;
    
    let data;
    switch (deviceType) {
      case 'grip':
        data = generateGripData(elapsed, frameCount);
        break;
      case 'sitstand':
        data = generateSitStandData(elapsed, frameCount);
        break;
      case 'standing':
        data = generateStandingData(elapsed, frameCount);
        break;
      case 'gait':
        data = generateGaitData(elapsed, frameCount);
        break;
      default:
        data = {};
    }
    
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'sensor_data',
        deviceType,
        hand,
        timestamp: elapsed,
        frameCount,
        data
      }));
    }
  }, 50); // 20Hz 采样率
}

function generateGripData(t, frame) {
  const basePressure = 100 + 80 * Math.sin(t * 0.5) + Math.random() * 20;
  return {
    totalPressure: Math.max(0, basePressure),
    avgPressure: Math.max(0, basePressure * 0.6),
    maxPressure: Math.max(0, basePressure * 1.2),
    fingers: {
      thumb: Math.max(0, basePressure * 0.15 + Math.random() * 5),
      index: Math.max(0, basePressure * 0.18 + Math.random() * 5),
      middle: Math.max(0, basePressure * 0.12 + Math.random() * 5),
      ring: Math.max(0, basePressure * 0.10 + Math.random() * 5),
      pinky: Math.max(0, basePressure * 0.08 + Math.random() * 5),
      palm: Math.max(0, basePressure * 0.37 + Math.random() * 10)
    },
    normalDist: {
      mean: basePressure * 0.8,
      variance: 20 + Math.random() * 10,
      skewness: 0.5 + Math.random() * 0.3,
      kurtosis: 2.5 + Math.random() * 0.5
    }
  };
}

function generateSitStandData(t, frame) {
  const angle = 45 + 30 * Math.sin(t * 0.8);
  return {
    angle,
    velocity: 20 * Math.cos(t * 0.8),
    acceleration: -16 * Math.sin(t * 0.8),
    count: Math.floor(t / 3),
    pressure: 200 + 100 * Math.sin(t * 1.2) + Math.random() * 30
  };
}

function generateStandingData(t, frame) {
  return {
    copX: 5 * Math.sin(t * 2) + Math.random() * 2,
    copY: 3 * Math.cos(t * 1.5) + Math.random() * 2,
    leftFoot: {
      pressure: 300 + 50 * Math.sin(t) + Math.random() * 20,
      area: 120 + Math.random() * 10
    },
    rightFoot: {
      pressure: 280 + 50 * Math.cos(t) + Math.random() * 20,
      area: 115 + Math.random() * 10
    },
    sway: Math.sqrt(Math.pow(5 * Math.sin(t * 2), 2) + Math.pow(3 * Math.cos(t * 1.5), 2))
  };
}

function generateGaitData(t, frame) {
  const stridePhase = (t * 1.2) % (2 * Math.PI);
  return {
    leftFoot: {
      pressure: 200 + 150 * Math.max(0, Math.sin(stridePhase)),
      phase: stridePhase < Math.PI ? 'stance' : 'swing'
    },
    rightFoot: {
      pressure: 200 + 150 * Math.max(0, Math.sin(stridePhase + Math.PI)),
      phase: stridePhase + Math.PI < 2 * Math.PI ? 'stance' : 'swing'
    },
    speed: 0.8 + 0.2 * Math.sin(t * 0.3),
    cadence: 100 + 10 * Math.sin(t * 0.2),
    strideLength: 0.6 + 0.1 * Math.sin(t * 0.4),
    stepCount: Math.floor(t * 1.5)
  };
}

// ============ 启动服务器 ============

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  老年人评估监测系统 - 后端服务`);
  console.log(`  HTTP:      http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`========================================\n`);
});
