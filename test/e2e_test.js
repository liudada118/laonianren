
const { _electron: electron } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ─── 配置 ───
const PROJECT_DIR = '/home/ubuntu/laonianren';
const API_PORT = 19245;
const WS_PORT = 19999;
const ROUTES = [
  '/',
  '/dashboard',
  '/assessment/grip',
  '/assessment/sitstand',
  '/assessment/standing',
  '/assessment/gait',
  '/history',
  '/history/report',
];
const SCREENSHOT_DIR = path.join(PROJECT_DIR, 'test/screenshots');

// ─── 测试用例 ───
const TEST_CASES = [
  {
    category: 'Lifecycle',
    name: '应用启动测试',
    test: async (app, page) => {
      assert(app.process().pid > 0, 'Electron 进程已启动');
      await page.waitForLoadState('domcontentloaded');
      const title = await page.title();
      assert(title.includes('JQ'), '窗口标题正确');
    },
  },
  {
    category: 'API',
    name: 'GET / - 服务状态检查',
    test: async () => {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/`);
      assert.strictEqual(res.status, 200, 'API 服务在线');
    },
  },
  {
    category: 'WebSocket',
    name: 'WebSocket 连接测试',
    test: async () => {
      return new Promise((resolve, reject) => {
        const ws = new (require('ws'))(`ws://127.0.0.1:${WS_PORT}`);
        ws.on('open', () => {
          ws.close();
          resolve();
        });
        ws.on('error', (err) => {
          reject(new Error('WebSocket 连接失败'));
        });
      });
    },
  },
  ...ROUTES.map(route => ({
    category: 'UI',
    name: `页面导航 - ${route}`,
    test: async (app, page) => {
      await page.goto(`file://${PROJECT_DIR}/front-end/dist/index.html#${route.substring(1)}`);
      await page.waitForTimeout(1500);
      const screenshotPath = path.join(SCREENSHOT_DIR, `nav_${route.replace(/\//g, '_')}.png`);
      await page.screenshot({ path: screenshotPath });
      const content = await page.evaluate(() => document.body.innerText.length);
      assert(content > 0, `页面 ${route} 有内容`);
    },
  })),
  {
    category: 'Lifecycle',
    name: '应用关闭测试',
    test: async (app, page) => {
      await app.close();
      assert(app.process().killed, 'Electron 进程已关闭');
    },
  },
];

// ─── 执行引擎 ───
async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const results = [];
  let app, page;

  console.log('═══ Electron 端到端测试报告 ═══');

  try {
    app = await electron.launch({
      args: [path.join(PROJECT_DIR, 'back-end/code')],
      env: { ...process.env, DISPLAY: ':99', NODE_ENV: 'production' },
    });
    page = await app.firstWindow();
    await page.waitForTimeout(5000); // 等待应用完全加载

  } catch (e) {
    console.error('应用启动失败:', e);
    return;
  }

  for (const testCase of TEST_CASES) {
    const startTime = Date.now();
    let status = 'PASSED';
    let detail = '';
    try {
      await testCase.test(app, page);
    } catch (e) {
      status = 'FAILED';
      detail = e.message;
      const screenshotPath = path.join(SCREENSHOT_DIR, `fail_${testCase.name.replace(/\s/g, '_')}.png`);
      if (page && !page.isClosed()) {
        await page.screenshot({ path: screenshotPath });
      }
    }
    const duration = Date.now() - startTime;
    results.push({ ...testCase, status, detail, duration });
    console.log(`  - [${status}] ${testCase.category} - ${testCase.name} (${duration}ms)`);
  }

  if (app && !app.process().killed) {
    await app.close();
  }

  // 输出总结
  const summary = results.reduce((acc, r) => {
    acc[r.category] = acc[r.category] || { passed: 0, failed: 0 };
    if (r.status === 'PASSED') acc[r.category].passed++;
    else acc[r.category].failed++;
    return acc;
  }, {});

  console.log('\n─── 总结 ───');
  for (const category in summary) {
    const { passed, failed } = summary[category];
    console.log(`  ${category}: ${passed}/${passed + failed} 通过`);
  }
}

run();
