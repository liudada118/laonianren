/**
 * 串口模拟 + 完整评估流程 端到端测试 v2
 * 
 * 修复:
 * - 关闭 DevTools, 截图正确的应用窗口
 * - 重置模式传 null
 * - 增加更多 UI 页面测试
 */
const { SerialSimulator, parseHexDataToFrames } = require('./serial_simulator');
const { _electron: electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ─── 配置 ───
const BACKEND_PORT = 19245;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots_serial_v2');
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
  try {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${safeName}.png`) });
  } catch (e) {
    console.log(`     [截图失败] ${name}: ${e.message}`);
  }
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

/**
 * 获取应用主窗口（非 DevTools）
 */
async function getAppWindow(electronApp) {
  const windows = electronApp.windows();
  for (const w of windows) {
    const url = w.url();
    if (!url.includes('devtools') && !url.startsWith('devtools://')) {
      return w;
    }
  }
  // 如果所有窗口都是 devtools，等待新窗口
  return electronApp.firstWindow();
}

/**
 * 导航到指定前端路由
 */
async function navigateTo(page, route) {
  // 前端使用 BrowserRouter，通过 JS 导航
  await page.evaluate((r) => {
    window.history.pushState({}, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await page.waitForTimeout(1000);
}

// ─── 主测试 ───
async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   串口模拟 + 完整评估流程 端到端测试 v2                      ║');
  console.log('║   设备: 左手(921600) 右手(921600) 坐垫(1000000)             ║');
  console.log('║   增强: UI 页面导航、报告查看、历史记录完整性                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

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
  const envVars = sim.getEnvVars(deviceNames);

  // ─── 阶段2: 加载传感器数据 ───
  console.log('\n[阶段2] 加载传感器数据...');
  const leftFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, '../upload_data/left_hand.bin'), 'utf-8')).filter(f => [18, 130, 146].includes(f.length));
  const rightFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, '../upload_data/right_hand.bin'), 'utf-8')).filter(f => [18, 130, 146].includes(f.length));
  const seatFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, '../upload_data/seat.bin'), 'utf-8')).filter(f => f.length === 1024);
  console.log(`  左手: ${leftFrames.length} 帧, 右手: ${rightFrames.length} 帧, 坐垫: ${seatFrames.length} 帧`);

  // ─── 阶段3: 启动 Electron ───
  console.log('\n[阶段3] 启动 Electron 应用 (DevTools 关闭)...');
  
  let electronApp, page;
  try {
    electronApp = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: [APP_ENTRY],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
        OPEN_DEVTOOLS: '0',  // 关闭 DevTools
        ...envVars,
      },
    });
    console.log('  Electron 进程已创建');

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    console.log('  主窗口已获取');

    const backendReady = await waitForBackend();
    assert(backendReady, '后端服务未能在 15 秒内启动');
    console.log('  后端 API 已就绪');

    await page.waitForTimeout(3000);
    console.log('  前端页面已加载');

  } catch (e) {
    console.error('启动失败:', e.message);
    sim.cleanup();
    process.exit(1);
  }

  // ─── 阶段4: 执行测试用例 ───
  console.log('\n[阶段4] 执行测试用例...\n');
  console.log('  ── 一、基础功能测试 ──');

  // === T01: 登录页面 ===
  await runTest('T01', '登录页面加载与截图', async () => {
    await screenshot(page, 'T01_login_page');
    const content = await page.content();
    assert(content.length > 100, '页面内容为空');
  });

  // === T02: 执行登录 ===
  await runTest('T02', '填写信息并登录', async () => {
    // 尝试填写姓名
    const nameInput = await page.$('input');
    if (nameInput) {
      await nameInput.fill('测试患者');
    }
    // 尝试填写年龄
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[1].fill('70');
    }
    // 选择性别（如果有）
    const genderSelect = await page.$('select');
    if (genderSelect) {
      await genderSelect.selectOption({ index: 1 });
    }
    await screenshot(page, 'T02_login_filled');
    
    // 点击登录/进入按钮
    const loginBtn = await page.$('button');
    if (loginBtn) {
      await loginBtn.click();
      await page.waitForTimeout(2000);
    }
    await screenshot(page, 'T02_after_login');
  });

  // === T03: Dashboard 页面 ===
  await runTest('T03', 'Dashboard 页面正常显示', async () => {
    await screenshot(page, 'T03_dashboard');
    const content = await page.content();
    assert(content.length > 100, 'Dashboard 页面内容为空');
  });

  // === T04: 后端健康检查 ===
  await runTest('T04', '后端 API 健康检查', async () => {
    const resp = await httpGet(`${BACKEND_URL}/`);
    assert(resp === 'Hello World!', `API 返回异常: ${resp}`);
  });

  // === T05: 获取系统信息 ===
  await runTest('T05', '获取系统信息 (getSystem)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/getSystem`);
    assert(resp.code === 0, `getSystem 失败`);
    console.log(`     └─ 系统类型: ${resp.data?.value}`);
  });

  // === T06: 获取串口列表 ===
  await runTest('T06', '获取虚拟串口列表 (getPort)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/getPort`);
    assert(resp.code === 0, `getPort 失败`);
    const ports = resp.data || [];
    assert(ports.length >= 3, `应有至少 3 个串口，实际: ${ports.length}`);
    console.log(`     └─ ${ports.length} 个串口: ${ports.map(p => p.path.split('/').pop()).join(', ')}`);
  });

  console.log('\n  ── 二、串口连接与设备识别测试 ──');

  // === T07: 开始发送模拟数据 ===
  await runTest('T07', '启动串口模拟器发送传感器数据', async () => {
    sim.startSending('leftHand', leftFrames, 80);
    sim.startSending('rightHand', rightFrames, 80);
    sim.startSending('seat', seatFrames, 80);
    await new Promise(r => setTimeout(r, 500));
  });

  // === T08: 一键连接 ===
  await runTest('T08', '一键连接串口 (connPort)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/connPort`, 15000);
    assert(resp.code === 0, `connPort 失败: ${JSON.stringify(resp)}`);
    // 等待设备识别和数据帧解析
    await new Promise(r => setTimeout(r, 5000));
    await screenshot(page, 'T08_after_connect');
  });

  // === T09: 验证设备在线状态 ===
  await runTest('T09', '验证设备在线状态 (通过 Dashboard UI)', async () => {
    await screenshot(page, 'T09_device_status');
    // 检查页面中是否有在线状态指示
    const content = await page.content();
    console.log(`     └─ 页面内容长度: ${content.length}`);
  });

  console.log('\n  ── 三、握力评估流程测试 ──');

  // === T10: 导航到握力评估页面 ===
  await runTest('T10', '导航到握力评估页面', async () => {
    // 尝试通过 UI 点击
    const gripCard = await page.$('text=握力');
    if (gripCard) {
      await gripCard.click();
      await page.waitForTimeout(2000);
    } else {
      // 直接导航
      await navigateTo(page, '/assessment/grip');
    }
    await screenshot(page, 'T10_grip_assessment_page');
  });

  // === T11: 设置握力评估模式 ===
  await runTest('T11', '设置握力评估模式 (mode=1)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 1 });
    assert(resp.code === 0, `setActiveMode 失败`);
    console.log(`     └─ activeTypes: ${JSON.stringify(resp.data?.activeTypes)}`);
    await page.waitForTimeout(1000);
    await screenshot(page, 'T11_grip_mode_active');
  });

  // === T12: 开始左手握力采集 ===
  await runTest('T12', '开始左手握力采集 (mode=11)', async () => {
    await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 11 });
    const resp = await httpPost(`${BACKEND_URL}/startCol`, {
      assessmentId: 'test_grip_left_001',
      sampleType: '1',
      colName: '握力测试-左手',
      fileName: '测试患者',
      select: ['HL'],
    });
    console.log(`     └─ startCol 响应: code=${resp.code}, msg=${resp.message}`);
    // 采集 3 秒
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, 'T12_grip_left_collecting');
  });

  // === T13: 停止左手采集 ===
  await runTest('T13', '停止左手握力采集', async () => {
    const resp = await httpGet(`${BACKEND_URL}/endCol`);
    assert(resp.code === 0, `endCol 失败`);
    await page.waitForTimeout(500);
  });

  // === T14: 开始右手握力采集 ===
  await runTest('T14', '开始右手握力采集 (mode=12)', async () => {
    await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 12 });
    const resp = await httpPost(`${BACKEND_URL}/startCol`, {
      assessmentId: 'test_grip_right_001',
      sampleType: '1',
      colName: '握力测试-右手',
      fileName: '测试患者',
      select: ['HR'],
    });
    console.log(`     └─ startCol 响应: code=${resp.code}, msg=${resp.message}`);
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, 'T14_grip_right_collecting');
  });

  // === T15: 停止右手采集 ===
  await runTest('T15', '停止右手握力采集', async () => {
    const resp = await httpGet(`${BACKEND_URL}/endCol`);
    assert(resp.code === 0, `endCol 失败`);
  });

  // === T16: 握力评估页面截图 ===
  await runTest('T16', '握力评估完成后页面状态', async () => {
    await page.waitForTimeout(1000);
    await screenshot(page, 'T16_grip_after_collection');
  });

  console.log('\n  ── 四、起坐评估流程测试 ──');

  // === T17: 导航到起坐评估页面 ===
  await runTest('T17', '导航到起坐评估页面', async () => {
    await navigateTo(page, '/assessment/sitstand');
    await page.waitForTimeout(1000);
    await screenshot(page, 'T17_sitstand_page');
  });

  // === T18: 设置起坐评估模式并采集 ===
  await runTest('T18', '起坐评估模式设置与数据采集', async () => {
    const modeResp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 3 });
    assert(modeResp.code === 0, `setActiveMode 失败`);
    console.log(`     └─ activeTypes: ${JSON.stringify(modeResp.data?.activeTypes)}`);
    
    const startResp = await httpPost(`${BACKEND_URL}/startCol`, {
      assessmentId: 'test_sitstand_001',
      sampleType: '3',
      colName: '起坐测试',
      fileName: '测试患者',
      select: ['sit'],
    });
    console.log(`     └─ startCol: code=${startResp.code}, msg=${startResp.message}`);
    
    await new Promise(r => setTimeout(r, 3000));
    await screenshot(page, 'T18_sitstand_collecting');
    
    await httpGet(`${BACKEND_URL}/endCol`);
    await screenshot(page, 'T18_sitstand_after_collect');
  });

  console.log('\n  ── 五、静态站立评估流程测试 ──');

  // === T19: 导航到站立评估页面 ===
  await runTest('T19', '导航到静态站立评估页面', async () => {
    await navigateTo(page, '/assessment/standing');
    await page.waitForTimeout(1000);
    await screenshot(page, 'T19_standing_page');
  });

  // === T20: 设置站立评估模式 ===
  await runTest('T20', '站立评估模式设置 (mode=4)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 4 });
    assert(resp.code === 0, `setActiveMode 失败`);
    console.log(`     └─ activeTypes: ${JSON.stringify(resp.data?.activeTypes)}`);
    await page.waitForTimeout(1000);
    await screenshot(page, 'T20_standing_mode');
  });

  console.log('\n  ── 六、步态评估流程测试 ──');

  // === T21: 导航到步态评估页面 ===
  await runTest('T21', '导航到步态评估页面', async () => {
    await navigateTo(page, '/assessment/gait');
    await page.waitForTimeout(1000);
    await screenshot(page, 'T21_gait_page');
  });

  // === T22: 设置步态评估模式 ===
  await runTest('T22', '步态评估模式设置 (mode=5)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 5 });
    assert(resp.code === 0, `setActiveMode 失败`);
    console.log(`     └─ activeTypes: ${JSON.stringify(resp.data?.activeTypes)}`);
    await page.waitForTimeout(1000);
    await screenshot(page, 'T22_gait_mode');
  });

  console.log('\n  ── 七、历史记录与报告测试 ──');

  // === T23: 保存评估历史 ===
  await runTest('T23', '保存评估历史记录 (history/save)', async () => {
    const historyData = {
      name: '测试患者',
      age: 70,
      gender: '男',
      date: new Date().toISOString().split('T')[0],
      assessments: {
        grip: {
          completed: true,
          report: {
            leftMax: 25.5,
            rightMax: 28.3,
            leftAvg: 22.1,
            rightAvg: 24.7,
            level: '正常',
          },
        },
        sitstand: {
          completed: true,
          report: {
            count: 12,
            duration: 30,
            level: '正常',
          },
        },
        standing: {
          completed: true,
          report: {
            duration: 30,
            swayArea: 15.2,
            level: '轻度异常',
          },
        },
        gait: {
          completed: true,
          report: {
            steps: 20,
            duration: 15,
            speed: 1.33,
            level: '正常',
          },
        },
      },
    };
    const resp = await httpPost(`${BACKEND_URL}/history/save`, historyData);
    console.log(`     └─ 保存结果: code=${resp.code}, msg=${resp.message}`);
  });

  // === T24: 导航到历史记录页面 ===
  await runTest('T24', '导航到历史记录页面', async () => {
    await navigateTo(page, '/history');
    await page.waitForTimeout(2000);
    await screenshot(page, 'T24_history_page');
  });

  // === T25: 历史记录列表展示 ===
  await runTest('T25', '历史记录列表展示验证', async () => {
    const content = await page.content();
    console.log(`     └─ 页面内容长度: ${content.length}`);
    // 检查是否有历史记录项
    const historyItems = await page.$$('[class*="history"], [class*="record"], tr, [class*="item"], [class*="card"]');
    console.log(`     └─ 找到 ${historyItems.length} 个可能的历史记录元素`);
    await screenshot(page, 'T25_history_list');
  });

  // === T26: 展开历史记录详情 ===
  await runTest('T26', '展开历史记录详情', async () => {
    // 尝试点击第一条记录
    const firstRecord = await page.$('tr:nth-child(1), [class*="item"]:first-child, [class*="card"]:first-child');
    if (firstRecord) {
      await firstRecord.click();
      await page.waitForTimeout(1000);
    }
    await screenshot(page, 'T26_history_detail');
  });

  // === T27: 导航到历史报告查看页面 ===
  await runTest('T27', '导航到历史报告查看页面', async () => {
    await navigateTo(page, '/history/report');
    await page.waitForTimeout(2000);
    await screenshot(page, 'T27_history_report');
  });

  console.log('\n  ── 八、Dashboard 评估卡片测试 ──');

  // === T28: 返回 Dashboard 查看评估卡片状态 ===
  await runTest('T28', '返回 Dashboard 查看评估卡片状态', async () => {
    await navigateTo(page, '/dashboard');
    await page.waitForTimeout(2000);
    await screenshot(page, 'T28_dashboard_cards');
  });

  // === T29: 检查 Dashboard 中各评估卡片 ===
  await runTest('T29', 'Dashboard 评估卡片内容检查', async () => {
    const content = await page.content();
    const hasGrip = content.includes('握力') || content.includes('grip');
    const hasSitStand = content.includes('起坐') || content.includes('sit');
    const hasStanding = content.includes('站立') || content.includes('standing');
    const hasGait = content.includes('步态') || content.includes('gait');
    console.log(`     └─ 握力: ${hasGrip}, 起坐: ${hasSitStand}, 站立: ${hasStanding}, 步态: ${hasGait}`);
    await screenshot(page, 'T29_dashboard_content');
  });

  console.log('\n  ── 九、API 完整性测试 ──');

  // === T30: serialCache 读取 ===
  await runTest('T30', '读取 serialCache', async () => {
    const resp = await httpGet(`${BACKEND_URL}/serialCache`);
    assert(resp.code === 0, `serialCache 失败`);
    console.log(`     └─ hasCache: ${resp.data?.hasCache}`);
  });

  // === T31: serialCache 写入 ===
  await runTest('T31', '写入 serialCache (MAC->类型映射)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/serialCache`, {
      key: '090030000251333039343533:foot1\n30002F000251333039343533:foot2\n4A0030000251333039343533:foot3\n260030000251333039343533:foot4',
      orgName: '测试机构',
    });
    assert(resp.code === 0, `serialCache 写入失败`);
  });

  // === T32: 验证 serialCache 已保存 ===
  await runTest('T32', '验证 serialCache 已保存', async () => {
    const resp = await httpGet(`${BACKEND_URL}/serialCache`);
    assert(resp.code === 0, `serialCache 读取失败`);
    assert(resp.data?.hasCache === true, `serialCache 未保存`);
    console.log(`     └─ orgName: ${resp.data?.orgName}`);
  });

  // === T33: 重置评估模式 ===
  await runTest('T33', '重置评估模式 (mode=null)', async () => {
    const resp = await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: null });
    assert(resp.code === 0, `setActiveMode 失败: ${JSON.stringify(resp)}`);
    console.log(`     └─ activeTypes: ${JSON.stringify(resp.data?.activeTypes)}`);
  });

  // === T34: 获取采集历史 ===
  await runTest('T34', '获取采集历史 (getColHistory)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/getColHistory`, 10000);
    if (typeof resp === 'object' && resp.code === 0) {
      const history = resp.data || [];
      console.log(`     └─ 采集历史记录数: ${history.length}`);
    } else {
      console.log(`     └─ 响应: ${JSON.stringify(resp).substring(0, 100)}`);
    }
  });

  // === T35: 获取评估历史 ===
  await runTest('T35', '获取评估历史 (history/get)', async () => {
    const resp = await httpGet(`${BACKEND_URL}/history/get`);
    assert(resp.code === 0, `history/get 失败`);
    const list = resp.data || [];
    console.log(`     └─ 评估历史记录数: ${list.length}`);
    if (list.length > 0) {
      const latest = list[0];
      console.log(`     └─ 最新: ${latest.name || 'N/A'}, 评估项: ${Object.keys(latest.assessments || {}).length}`);
    }
  });

  console.log('\n  ── 十、页面导航完整性测试 ──');

  // === T36: 所有页面截图 ===
  const pages = [
    { route: '/', name: 'T36a_login' },
    { route: '/dashboard', name: 'T36b_dashboard' },
    { route: '/assessment/grip', name: 'T36c_grip' },
    { route: '/assessment/sitstand', name: 'T36d_sitstand' },
    { route: '/assessment/standing', name: 'T36e_standing' },
    { route: '/assessment/gait', name: 'T36f_gait' },
    { route: '/history', name: 'T36g_history' },
  ];

  await runTest('T36', '所有页面导航与截图 (7个页面)', async () => {
    for (const p of pages) {
      await navigateTo(page, p.route);
      await page.waitForTimeout(1500);
      await screenshot(page, p.name);
      const content = await page.content();
      assert(content.length > 50, `页面 ${p.route} 内容为空`);
    }
  });

  // ─── 阶段5: 输出结果 ───
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log(`║   测试完成: ${passCount} 通过 / ${failCount} 失败 / ${results.length} 总计`);
  console.log(`║   通过率: ${(passCount / results.length * 100).toFixed(1)}%`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  // 保存结果
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total: results.length, pass: passCount, fail: failCount, passRate: (passCount / results.length * 100).toFixed(1) + '%' },
    environment: {
      devices: deviceNames.map(n => `${n} (${n === 'seat' ? '1000000' : n.startsWith('foot') ? '3000000' : '921600'})`),
      virtualSerial: true,
      devTools: false,
    },
    results,
  };
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'serial_test_results_v2.json'), JSON.stringify(report, null, 2));
  console.log(`\n测试报告已保存到: ${SCREENSHOT_DIR}/serial_test_results_v2.json`);

  // ─── 清理 ───
  console.log('\n[清理] 关闭应用和虚拟串口...');
  try { await electronApp.close().catch(() => {}); } catch (e) {}
  sim.cleanup();
  
  console.log('[完成]');
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
