/**
 * 端到端集成测试脚本
 * 
 * 模拟前端完整数据流：
 * 1. 调用后端 HTTP API（getPort, connPort, setActiveMode, startCol, endCol）
 * 2. 连接后端 WebSocket 接收实时数据
 * 3. 验证数据格式与前端期望的格式一致
 * 4. 验证数据库存储
 * 5. 测试所有3种评估模式
 */

const WebSocket = require('ws');
const http = require('http');

const BACKEND_HTTP = 'http://localhost:19245';
const BACKEND_WS = 'ws://localhost:19999';

// 颜色输出
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(msg, color = RESET) { console.log(`${color}${msg}${RESET}`); }
function pass(msg) { log(`  ✅ PASS: ${msg}`, GREEN); }
function fail(msg) { log(`  ❌ FAIL: ${msg}`, RED); }
function info(msg) { log(`  ℹ️  ${msg}`, CYAN); }
function section(msg) { log(`\n${'='.repeat(60)}\n  ${msg}\n${'='.repeat(60)}`, YELLOW); }

let totalTests = 0, passedTests = 0, failedTests = 0;

function assert(condition, msg) {
  totalTests++;
  if (condition) { passedTests++; pass(msg); }
  else { failedTests++; fail(msg); }
}

// HTTP 请求工具
function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BACKEND_HTTP}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 100)}`)); }
      });
    }).on('error', reject);
  });
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'localhost', port: 19245, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data.substring(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// WebSocket 数据收集
function collectWSData(durationMs, expectedKey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BACKEND_WS);
    const messages = [];
    ws.on('open', () => { info(`WebSocket connected, collecting ${expectedKey} data for ${durationMs}ms...`); });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (Object.keys(msg).length > 0) messages.push(msg);
      } catch (e) {}
    });
    ws.on('error', (e) => reject(e));
    setTimeout(() => {
      ws.close();
      resolve(messages);
    }, durationMs);
  });
}

async function testMode1_Glove() {
  section('测试模式1: 手套模式 (Grip Assessment)');
  
  // 设置模式1
  const modeResult = await httpPost('/setActiveMode', { mode: '1' });
  assert(modeResult.code === 0, `setActiveMode(1) 返回 code=0`);
  assert(modeResult.data?.activeTypes?.includes('HL'), `activeTypes 包含 HL`);
  info(`activeTypes: ${JSON.stringify(modeResult.data?.activeTypes)}`);
  
  // 等待定时器启动
  await new Promise(r => setTimeout(r, 1000));
  
  // 收集WebSocket数据
  const messages = await collectWSData(3000, 'glove');
  assert(messages.length > 0, `收到 ${messages.length} 条WebSocket消息`);
  
  if (messages.length > 0) {
    const firstMsg = messages[0];
    const hasSitData = !!firstMsg.sitData;
    const hasData = !!firstMsg.data;
    info(`消息格式: ${hasData ? 'data' : hasSitData ? 'sitData' : 'unknown'}`);
    
    // 检查HL数据
    const hlData = firstMsg.sitData?.HL || firstMsg.data?.HL;
    assert(!!hlData, `消息包含 HL 手套数据`);
    if (hlData) {
      assert(hlData.status === 'online', `HL status = online`);
      assert(Array.isArray(hlData.arr), `HL arr 是数组`);
      assert(hlData.arr.length === 256, `HL arr 长度 = 256 (16x16矩阵)`);
      assert(typeof hlData.stamp === 'number', `HL stamp 是时间戳`);
      assert(typeof hlData.HZ === 'number', `HL HZ 是数字`);
      
      // 验证数据值范围（模拟器生成0-255的值）
      const min = Math.min(...hlData.arr);
      const max = Math.max(...hlData.arr);
      assert(min >= 0 && max <= 255, `HL 数据值范围 [${min}, ${max}] 在 [0, 255] 内`);
      
      // 验证非零值比例
      const nonZero = hlData.arr.filter(v => v > 0).length;
      assert(nonZero > 100, `HL 非零值 ${nonZero}/256 > 100 (有效数据)`);
      
      info(`HL 数据样本: [${hlData.arr.slice(0, 10).join(', ')}...]`);
      info(`HL HZ: ${hlData.HZ}ms, stamp: ${hlData.stamp}`);
    }
    
    // 检查HR数据
    const hrData = firstMsg.sitData?.HR || firstMsg.data?.HR;
    assert(!!hrData, `消息包含 HR 手套数据`);
    if (hrData) {
      assert(hrData.arr?.length === 256, `HR arr 长度 = 256`);
    }
  }
  
  // 测试采集流程
  info('测试采集流程: startCol → 等待 → endCol');
  const startResult = await httpPost('/startCol', { 
    name: 'E2E_GloveTest', 
    assessmentId: 'E2E_001',
    sample_type: '1',
    date: new Date().toISOString()
  });
  assert(startResult.code === 0, `startCol 返回 code=0`);
  
  await new Promise(r => setTimeout(r, 3000));
  
  const endResult = await httpGet('/endCol');
  assert(endResult.code === 0, `endCol 返回 code=0`);
  info(`采集结果: ${JSON.stringify(endResult.data || {}).substring(0, 200)}`);
}

async function testMode3_Sit() {
  section('测试模式3: 坐垫模式 (Sit-to-Stand Assessment)');
  
  const modeResult = await httpPost('/setActiveMode', { mode: '3' });
  assert(modeResult.code === 0, `setActiveMode(3) 返回 code=0`);
  assert(modeResult.data?.activeTypes?.includes('sit'), `activeTypes 包含 sit`);
  info(`activeTypes: ${JSON.stringify(modeResult.data?.activeTypes)}`);
  
  await new Promise(r => setTimeout(r, 1000));
  
  const messages = await collectWSData(3000, 'sit');
  assert(messages.length > 0, `收到 ${messages.length} 条WebSocket消息`);
  
  if (messages.length > 0) {
    const firstMsg = messages[0];
    const sitData = firstMsg.sitData?.sit;
    assert(!!sitData, `消息包含 sit 坐垫数据`);
    if (sitData) {
      assert(sitData.status === 'online', `sit status = online`);
      assert(Array.isArray(sitData.arr), `sit arr 是数组`);
      assert(sitData.arr.length === 1024, `sit arr 长度 = 1024 (32x32矩阵)`);
      
      const nonZero = sitData.arr.filter(v => v > 0).length;
      assert(nonZero > 400, `sit 非零值 ${nonZero}/1024 > 400`);
      info(`sit 数据样本: [${sitData.arr.slice(0, 10).join(', ')}...]`);
    }
    
    // 检查是否同时包含脚垫数据
    const foot1Data = firstMsg.sitData?.foot1;
    if (foot1Data) {
      info(`模式3同时包含 foot1 数据: arr.length=${foot1Data.arr?.length}`);
    }
  }
  
  // 测试采集
  const startResult = await httpPost('/startCol', { 
    name: 'E2E_SitTest', assessmentId: 'E2E_003', sample_type: '3', date: new Date().toISOString()
  });
  assert(startResult.code === 0, `startCol(mode3) 返回 code=0`);
  await new Promise(r => setTimeout(r, 3000));
  const endResult = await httpGet('/endCol');
  assert(endResult.code === 0, `endCol(mode3) 返回 code=0`);
}

async function testMode5_Foot() {
  section('测试模式5: 脚垫模式 (Standing/Gait Assessment)');
  
  const modeResult = await httpPost('/setActiveMode', { mode: '5' });
  assert(modeResult.code === 0, `setActiveMode(5) 返回 code=0`);
  info(`activeTypes: ${JSON.stringify(modeResult.data?.activeTypes)}`);
  
  await new Promise(r => setTimeout(r, 1000));
  
  const messages = await collectWSData(3000, 'foot');
  assert(messages.length > 0, `收到 ${messages.length} 条WebSocket消息`);
  
  if (messages.length > 0) {
    const firstMsg = messages[0];
    
    // 检查4个脚垫
    for (const footType of ['foot1', 'foot2', 'foot3', 'foot4']) {
      const footData = firstMsg.sitData?.[footType];
      assert(!!footData, `消息包含 ${footType} 数据`);
      if (footData) {
        assert(footData.status === 'online', `${footType} status = online`);
        assert(footData.arr?.length === 4096, `${footType} arr 长度 = 4096 (64x64矩阵)`);
        
        const nonZero = footData.arr.filter(v => v > 0).length;
        assert(nonZero > 1000, `${footType} 非零值 ${nonZero}/4096 > 1000`);
      }
    }
  }
  
  // 测试采集
  const startResult = await httpPost('/startCol', { 
    name: 'E2E_FootTest', assessmentId: 'E2E_005', sample_type: '5', date: new Date().toISOString()
  });
  assert(startResult.code === 0, `startCol(mode5) 返回 code=0`);
  await new Promise(r => setTimeout(r, 3000));
  const endResult = await httpGet('/endCol');
  assert(endResult.code === 0, `endCol(mode5) 返回 code=0`);
}

async function testHistoryAndDB() {
  section('测试历史记录与数据库');
  
  const historyResult = await httpGet('/getColHistory');
  assert(historyResult.code === 0, `getColHistory 返回 code=0`);
  
  const records = historyResult.data || [];
  assert(records.length >= 3, `历史记录 >= 3 条 (实际: ${records.length})`);
  
  if (records.length > 0) {
    info(`最近的记录:`);
    records.slice(-3).forEach(r => {
      info(`  - ${r.name || r.colName} | type=${r.sample_type} | id=${r.assessmentId} | time=${r.date || r.created_at}`);
    });
  }
}

async function testDeviceList() {
  section('测试设备列表与连接');
  
  const portResult = await httpGet('/getPort');
  assert(portResult.code === 0, `getPort 返回 code=0`);
  assert(Array.isArray(portResult.data), `data 是数组`);
  assert(portResult.data.length === 7, `设备数量 = 7 (实际: ${portResult.data?.length})`);
  
  if (portResult.data) {
    info('设备列表:');
    portResult.data.forEach(d => {
      info(`  - ${d.path} | ${d.friendlyName} | manufacturer=${d.manufacturer}`);
    });
  }
  
  // 测试连接
  const connResult = await httpGet('/connPort');
  assert(connResult.code === 0, `connPort 返回 code=0`);
}

async function testDataFormatCompatibility() {
  section('测试数据格式与前端兼容性');
  
  // 设置模式1收集数据
  await httpPost('/setActiveMode', { mode: '1' });
  await new Promise(r => setTimeout(r, 1000));
  
  const messages = await collectWSData(2000, 'format-check');
  
  if (messages.length > 0) {
    const msg = messages[0];
    
    // 前端 BackendBridge._handleMessage 期望的格式
    info('验证 BackendBridge 数据格式兼容性:');
    
    // 检查 sitData 或 data 格式
    const dataSource = msg.sitData || msg.data;
    assert(!!dataSource, `消息包含 sitData 或 data 字段`);
    
    if (dataSource?.HL) {
      // 前端 GloveSerialService 期望: 256个值的数组
      const arr = dataSource.HL.arr;
      assert(arr.length === 256, `HL.arr 长度=256 (与 GloveSerialService 兼容)`);
      
      // 验证值类型（前端期望数字数组）
      assert(typeof arr[0] === 'number', `arr[0] 是 number 类型`);
      assert(!arr.some(v => typeof v !== 'number'), `所有值都是 number 类型`);
      
      // 前端 mapLeftHand/mapRightHand 期望 16x16 矩阵
      assert(Math.sqrt(arr.length) === 16, `sqrt(256)=16 (可转为16x16矩阵)`);
      
      // 前端热力图期望 0-255 范围
      const allInRange = arr.every(v => v >= 0 && v <= 255);
      assert(allInRange, `所有值在 [0, 255] 范围内 (热力图兼容)`);
      
      pass('HL 数据格式与前端 GloveSerialService 完全兼容');
    }
    
    if (dataSource?.HR) {
      assert(dataSource.HR.arr?.length === 256, `HR.arr 长度=256`);
      pass('HR 数据格式与前端完全兼容');
    }
  }
  
  // 测试模式5的脚垫数据格式
  await httpPost('/setActiveMode', { mode: '5' });
  await new Promise(r => setTimeout(r, 1000));
  
  const footMessages = await collectWSData(2000, 'foot-format');
  if (footMessages.length > 0) {
    const msg = footMessages[0];
    if (msg.sitData?.foot1) {
      const arr = msg.sitData.foot1.arr;
      assert(arr.length === 4096, `foot1.arr 长度=4096 (64x64矩阵)`);
      assert(Math.sqrt(arr.length) === 64, `sqrt(4096)=64 (可转为64x64矩阵)`);
      pass('foot 数据格式与前端 FootpadSerialService 兼容');
    }
  }
}

async function main() {
  log('\n' + '🔬'.repeat(30), CYAN);
  log('  老年人筛查系统 - 端到端集成测试', CYAN);
  log('🔬'.repeat(30) + '\n', CYAN);
  
  try {
    await testDeviceList();
    await testMode1_Glove();
    await testMode3_Sit();
    await testMode5_Foot();
    await testHistoryAndDB();
    await testDataFormatCompatibility();
    
    section('测试结果汇总');
    log(`  总测试数: ${totalTests}`, CYAN);
    log(`  通过: ${passedTests}`, GREEN);
    if (failedTests > 0) log(`  失败: ${failedTests}`, RED);
    else log(`  失败: 0`, GREEN);
    log(`  通过率: ${(passedTests / totalTests * 100).toFixed(1)}%`, passedTests === totalTests ? GREEN : YELLOW);
    
  } catch (e) {
    log(`\n  💥 测试异常: ${e.message}`, RED);
    console.error(e);
  }
}

main();
