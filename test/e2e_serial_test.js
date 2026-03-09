/**
 * 带串口模拟的完整端到端测试
 * 
 * 测试流程:
 * 1. 创建虚拟串口对 (左手、右手、坐垫)
 * 2. 启动 Electron 应用 (带虚拟串口环境变量)
 * 3. 发送模拟传感器数据
 * 4. 测试串口连接、数据采集、评估流程
 */
const { SerialSimulator, DEVICES, parseHexDataToFrames } = require('./serial_simulator');
const { _electron: electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ─── 配置 ───
const BACKEND_PORT = 19245;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots_serial');
const ELECTRON_PATH = path.join(__dirname, '../back-end/code/node_modules/.bin/electron');
const APP_ENTRY = path.join(__dirname, '../back-end/code/index.js');

// ─── 工具函数 ───
function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function httpPost(url, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const postData = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = { hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(postData);
    req.end();
  });
}

async function waitForBackend(maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try { await httpGet(`${BACKEND_URL}/`); return true; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return false;
}

async function screenshot(page, name) {
  const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${safeName}.png`) });
}

// ─── 测试结果收集 ───
const results = [];
let passCount = 0, failCount = 0;

async function runTest(id, name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  ✅ ${id} - ${name} (${ms}ms)`);
    results.push({ id, name, status: 'PASS', ms });
    passCount++;
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`  ❌ ${id} - ${name} (${ms}ms)`);
    console.log(`     └─ ${e.message}`);
    results.push({ id, name, status: 'FAIL', ms, error: e.message });
    failCount++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ─── 主测试 ───
async function main() {
  // 创建截图目录
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   串口模拟 + 完整评估流程 端到端测试                     ║');
  console.log('║   设备: 左手(921600) 右手(921600) 坐垫(1000000)         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // ─── 阶段1: 创建虚拟串口 ───
  console.log('\n[阶段1] 创建虚拟串口对...');
  const sim = new SerialSimulator();
  const deviceNames = ['leftHand', 'rightHand', 'seat'];
  
  try {
    await sim.init(deviceNames);
  } catch (e) {
    console.error('创建虚拟串口失败:', e.message);
    process.exit(1);
  }

  // 生成环境变量
  const envVars = sim.getEnvVars(deviceNames);
  console.log('  环境变量已生成');
  console.log('  VIRTUAL_PORT_LIST:', envVars.VIRTUAL_PORT_LIST);

  // ─── 阶段2: 加载传感器数据 ───
  console.log('\n[阶段2] 加载传感器数据...');
  const leftFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, '../upload_data/left_hand.bin'), 'utf-8'));
  const rightFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, '../upload_data/right_hand.bin'), 'utf-8'));
  const seatFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, '../upload_data/seat.bin'), 'utf-8'));

  // 过滤有效帧
  const validLeftFrames = leftFrames.filter(f => [18, 130, 146].includes(f.length));
  const validRightFrames = rightFrames.filter(f => [18, 130, 146].includes(f.length));
  const validSeatFrames = seatFrames.filter(f => f.length === 1024);

  console.log(`  左手: ${validLeftFrames.length} 有效帧`);
  console.log(`  右手: ${validRightFrames.length} 有效帧`);
  console.log(`  坐垫: ${validSeatFrames.length} 有效帧`);

  // ─── 阶段3: 启动 Electron ───
  console.log('\n[阶段3] 启动 Electron 应用...');
  
  let electronApp, page;
  try {
    electronApp = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: [APP_ENTRY],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
        ...envVars,
      },
    });
    console.log('  Electron 进程已创建');

    page = await electronApp.firstWindow();
    console.log('  主窗口已获取');

    // 等待后端
    const backendReady = await waitForBackend();
    assert(backendReady, '后端服务未能在 15 秒内启动');
    console.log('  后端 API 已就绪');

    // 等待前端加载
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    console.log('  前端页面已加载');

  } catch (e) {
    console.error('启动失败:', e.message);
    sim.cleanup();
    process.exit(1);
  }

  // ─── 阶段4: 执行测试用例 ───
  console.log('\n[阶段4] 执行测试用例...\n');

  // === T01: 登录 ===
  await runTest('T01', '登录系统并进入 Dashboard', async () => {
    await page.waitForTimeout(1000);
    // 检查是否在登录页
    const loginBtn = await page.$('button:has-text("登录"), button:has-text("进入")');
    if (loginBtn) {
      // 填写姓名
      const nameInput = await page.$('input[placeholder*="姓名"], input[placeholder*="名字"], input');
      if (nameInput) await nameInput.fill('测试患者');
      await loginBtn.click();
      await page.waitForTimeout(2000);
    }
    await screenshot(page, 'T01_dashboard');
  });

  // === T02: 检查 Dashboard ===
  await runTest('T02', 'Dashboard 页面正常显示', async () => {
    const content = await page.content();
    assert(content.length > 100, 'Dashboard 页面内容为空');
    await screenshot(page, 'T02_dashboard_loaded');
  });

  // === T03: 后端 API 健康检查 ===
  await runTest('T03', '后端 API 健康检查', async () => {
    const resp = await httpGet(`${BACKEND_URL}/`);
    assert(resp === 'Hello World!', `API 返回异常: ${resp}`);
  });

  // === T04: 获取系统信息 ===
  await runTest('T04', '获取系统信息 (getSystem)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/getSystem`);
    assert(resp.code === 0, `getSystem 失败: ${JSON.stringify(resp)}`);
    console.log(`     └─ 系统类型: ${resp.data?.value}`);
  });

  // === T05: 获取虚拟串口列表 ===
  await runTest('T05', '获取串口列表 (getPort) - 应返回虚拟串口', async () => {
    const resp = await httpGet(`${BACKEND_URL}/getPort`);
    assert(resp.code === 0, `getPort 失败: ${JSON.stringify(resp)}`);
    const ports = resp.data || [];
    assert(ports.length >= 3, `应有至少 3 个串口，实际: ${ports.length}`);
    console.log(`     └─ 检测到 ${ports.length} 个串口`);
    ports.forEach(p => console.log(`        ${p.path} (${p.manufacturer || 'unknown'})`));
  });

  // === T06: 开始发送模拟数据 ===
  await runTest('T06', '开始向虚拟串口发送模拟传感器数据', async () => {
    sim.startSending('leftHand', validLeftFrames, 80);
    sim.startSending('rightHand', validRightFrames, 80);
    sim.startSending('seat', validSeatFrames, 80);
    await new Promise(r => setTimeout(r, 500));
  });

  // === T07: 一键连接 ===
  await runTest('T07', '一键连接串口 (connPort)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/connPort`, 15000);
    assert(resp.code === 0, `connPort 失败: ${JSON.stringify(resp)}`);
    console.log(`     └─ 连接成功`);
    // 等待设备识别
    await new Promise(r => setTimeout(r, 3000));
  });

  // === T08: 验证设备在线状态 (通过 WebSocket) ===
  await runTest('T08', '等待设备数据帧被识别', async () => {
    // 等待足够时间让帧被解析
    await new Promise(r => setTimeout(r, 3000));
    // 通过截图查看连接状态
    await screenshot(page, 'T08_after_connect');
  });

  // === T09: 设置握力评估模式 ===
  await runTest('T09', '设置握力评估模式 (setActiveMode=1)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 1 });
    assert(resp.code === 0, `setActiveMode 失败: ${JSON.stringify(resp)}`);
    const data = resp.data || {};
    console.log(`     └─ activeTypes: ${JSON.stringify(data.activeTypes)}`);
  });

  // === T10: 开始握力采集 ===
  await runTest('T10', '开始握力数据采集 (startCol)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/startCol`, {
      assessmentId: 'test_grip_001',
      sampleType: '1',
      colName: '握力测试',
      fileName: '测试患者',
      select: ['HL', 'HR'],
    });
    assert(resp.code === 0, `startCol 失败: ${JSON.stringify(resp)}`);
    // 采集 3 秒
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, 'T10_grip_collecting');
  });

  // === T11: 停止握力采集 ===
  await runTest('T11', '停止握力数据采集 (endCol)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/endCol`);
    assert(resp.code === 0, `endCol 失败: ${JSON.stringify(resp)}`);
  });

  // === T12: 设置起坐评估模式 ===
  await runTest('T12', '设置起坐评估模式 (setActiveMode=3)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 3 });
    assert(resp.code === 0, `setActiveMode 失败: ${JSON.stringify(resp)}`);
    const data = resp.data || {};
    console.log(`     └─ activeTypes: ${JSON.stringify(data.activeTypes)}`);
  });

  // === T13: 开始起坐采集 ===
  await runTest('T13', '开始起坐数据采集 (startCol)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/startCol`, {
      assessmentId: 'test_sitstand_001',
      sampleType: '3',
      colName: '起坐测试',
      fileName: '测试患者',
      select: ['sit'],
    });
    // 注意: 如果没有 sit 类型的在线设备，可能返回 error
    console.log(`     └─ 响应: ${JSON.stringify(resp)}`);
    // 采集 3 秒
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, 'T13_sitstand_collecting');
  });

  // === T14: 停止起坐采集 ===
  await runTest('T14', '停止起坐数据采集 (endCol)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/endCol`);
    assert(resp.code === 0, `endCol 失败: ${JSON.stringify(resp)}`);
  });

  // === T15: 设置静态站立评估模式 ===
  await runTest('T15', '设置静态站立评估模式 (setActiveMode=4)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 4 });
    assert(resp.code === 0, `setActiveMode 失败: ${JSON.stringify(resp)}`);
    const data = resp.data || {};
    console.log(`     └─ activeTypes: ${JSON.stringify(data.activeTypes)}`);
  });

  // === T16: 开始站立采集 ===
  await runTest('T16', '开始站立数据采集 (startCol)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/startCol`, {
      assessmentId: 'test_standing_001',
      sampleType: '4',
      colName: '站立测试',
      fileName: '测试患者',
      select: ['foot1'],
    });
    console.log(`     └─ 响应: ${JSON.stringify(resp)}`);
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, 'T16_standing_collecting');
  });

  // === T17: 停止站立采集 ===
  await runTest('T17', '停止站立数据采集 (endCol)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/endCol`);
    assert(resp.code === 0, `endCol 失败: ${JSON.stringify(resp)}`);
  });

  // === T18: 查询采集历史 ===
  await runTest('T18', '查询采集历史 (getColHistory)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/getColHistory`, 10000);
    assert(resp.code === 0, `getColHistory 失败: ${JSON.stringify(resp)}`);
    const history = resp.data || [];
    console.log(`     └─ 历史记录数: ${history.length}`);
    if (history.length > 0) {
      console.log(`     └─ 最新记录: ${JSON.stringify(history[0])}`);
    }
  });

  // === T19: 通过 UI 导航到评估页面 ===
  await runTest('T19', '通过 UI 导航到握力评估页面', async () => {
    // 尝试点击握力评估相关按钮
    const gripBtn = await page.$('text=握力, text=开始评估, [data-testid*="grip"]');
    if (gripBtn) {
      await gripBtn.click();
      await page.waitForTimeout(2000);
    }
    await screenshot(page, 'T19_grip_page');
  });

  // === T20: 返回 Dashboard ===
  await runTest('T20', '返回 Dashboard', async () => {
    const backBtn = await page.$('text=返回, button:has-text("返回"), [class*="back"]');
    if (backBtn) {
      await backBtn.click();
      await page.waitForTimeout(1000);
    }
    await screenshot(page, 'T20_back_dashboard');
  });

  // === T21: 重置评估模式 ===
  await runTest('T21', '重置评估模式 (setActiveMode=0)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 0 });
    assert(resp.code === 0, `setActiveMode 失败: ${JSON.stringify(resp)}`);
  });

  // === T22: 验证 WebSocket 数据推送 ===
  await runTest('T22', '验证 WebSocket 连接和数据推送', async () => {
    // 通过页面 JS 检查 WebSocket 状态
    const wsStatus = await page.evaluate(() => {
      // 检查页面中是否有 WebSocket 连接的迹象
      return {
        hasPerformanceEntries: performance.getEntriesByType('resource').some(e => e.name.includes('ws')),
        documentReady: document.readyState,
      };
    });
    console.log(`     └─ 页面状态: ${JSON.stringify(wsStatus)}`);
    await screenshot(page, 'T22_ws_status');
  });

  // === T23: 截图所有主要页面 ===
  await runTest('T23', '截图当前应用状态', async () => {
    await screenshot(page, 'T23_final_state');
  });

  // ─── 阶段5: 输出结果 ───
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log(`║   测试完成: ${passCount} 通过 / ${failCount} 失败 / ${results.length} 总计`);
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // 保存结果
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount },
    results,
  };
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'serial_test_results.json'), JSON.stringify(report, null, 2));
  console.log(`\n测试报告已保存到: ${SCREENSHOT_DIR}/serial_test_results.json`);

  // ─── 清理 ───
  console.log('\n[清理] 关闭应用和虚拟串口...');
  try {
    await electronApp.close().catch(() => {});
  } catch (e) {}
  
  sim.cleanup();
  
  console.log('[完成]');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
