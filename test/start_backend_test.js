/**
 * 测试启动脚本
 * 
 * 设置环境变量后启动后端 serialServer.js
 * 后端代码已添加 VIRTUAL_SERIAL_TEST 模式支持
 */

const path = require('path');

const PORTS_DIR = '/tmp/vserial';

// 虚拟串口设备列表 - 模拟 SerialPort.list() 的返回格式
const VIRTUAL_PORTS = [
  {
    path: path.join(PORTS_DIR, 'HL_app'),
    manufacturer: 'wch.cn',
    serialNumber: 'VIRTUAL_HL',
    pnpId: 'virtual-HL',
    locationId: '',
    friendlyName: 'Virtual HL Glove',
    vendorId: '1A86',
    productId: '7523',
  },
  {
    path: path.join(PORTS_DIR, 'HR_app'),
    manufacturer: 'wch.cn',
    serialNumber: 'VIRTUAL_HR',
    pnpId: 'virtual-HR',
    locationId: '',
    friendlyName: 'Virtual HR Glove',
    vendorId: '1A86',
    productId: '7523',
  },
  {
    path: path.join(PORTS_DIR, 'sit_app'),
    manufacturer: 'Silicon Labs',
    serialNumber: 'VIRTUAL_SIT',
    pnpId: 'virtual-sit',
    locationId: '',
    friendlyName: 'CH340 Virtual Sit Sensor',
    vendorId: '10C4',
    productId: 'EA60',
  },
  {
    path: path.join(PORTS_DIR, 'foot1_app'),
    manufacturer: 'FTDI',
    serialNumber: 'VIRTUAL_FOOT1',
    pnpId: 'virtual-foot1',
    locationId: '',
    friendlyName: 'Virtual Foot1 Sensor',
    vendorId: '0403',
    productId: '6001',
  },
  {
    path: path.join(PORTS_DIR, 'foot2_app'),
    manufacturer: 'FTDI',
    serialNumber: 'VIRTUAL_FOOT2',
    pnpId: 'virtual-foot2',
    locationId: '',
    friendlyName: 'Virtual Foot2 Sensor',
    vendorId: '0403',
    productId: '6001',
  },
  {
    path: path.join(PORTS_DIR, 'foot3_app'),
    manufacturer: 'FTDI',
    serialNumber: 'VIRTUAL_FOOT3',
    pnpId: 'virtual-foot3',
    locationId: '',
    friendlyName: 'Virtual Foot3 Sensor',
    vendorId: '0403',
    productId: '6001',
  },
  {
    path: path.join(PORTS_DIR, 'foot4_app'),
    manufacturer: 'FTDI',
    serialNumber: 'VIRTUAL_FOOT4',
    pnpId: 'virtual-foot4',
    locationId: '',
    friendlyName: 'Virtual Foot4 Sensor',
    vendorId: '0403',
    productId: '6001',
  },
];

// 波特率映射
const BAUD_MAP = {};
VIRTUAL_PORTS.forEach((p) => {
  const name = path.basename(p.path).replace('_app', '');
  if (name === 'HL' || name === 'HR') BAUD_MAP[p.path] = 921600;
  else if (name === 'sit') BAUD_MAP[p.path] = 1000000;
  else BAUD_MAP[p.path] = 3000000;
});

// 设置环境变量
// MAC地址映射
const VIRTUAL_MAC_MAP = {
  foot1: { mac: '090030000251333039343533' },
  foot2: { mac: '30002F000251333039343533' },
  foot3: { mac: '4A0030000251333039343533' },
  foot4: { mac: '260030000251333039343533' },
};

process.env.VIRTUAL_SERIAL_TEST = 'true';
process.env.VIRTUAL_PORT_LIST = JSON.stringify(VIRTUAL_PORTS);
process.env.VIRTUAL_BAUD_MAP = JSON.stringify(BAUD_MAP);
process.env.VIRTUAL_MAC_MAP = JSON.stringify(VIRTUAL_MAC_MAP);
process.env.isPackaged = 'false';
process.env.appPath = '';
process.env.userData = '';

console.log('=== Virtual Serial Test Mode ===');
console.log('Ports:', VIRTUAL_PORTS.length);
Object.entries(BAUD_MAP).forEach(([p, b]) => console.log(`  ${path.basename(p)} -> ${b} baud`));
console.log('');

// Change to backend code directory and load server
process.chdir(path.join(__dirname, '../back-end/code'));
require('../back-end/code/server/serialServer.js');
