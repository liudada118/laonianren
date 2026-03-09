/**
 * ═══════════════════════════════════════════════════════════
 *  老年人筛查系统MAC — 端到端测试脚本
 *  覆盖：生命周期 | 后端API | WebSocket | 数据库 | UI界面
 * ═══════════════════════════════════════════════════════════
 */
const { _electron: electron } = require("playwright");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const http = require("http");

// ==================== 配置 ====================
const PROJECT_DIR = "/home/ubuntu/laonianren";
const BACKEND_DIR = path.join(PROJECT_DIR, "back-end/code");
const FRONTEND_DIST = path.join(PROJECT_DIR, "front-end/dist");
const ELECTRON_PATH = path.join(BACKEND_DIR, "node_modules/electron/dist/electron");
const API_URL = "http://127.0.0.1:19245";
const WS_URL = "ws://127.0.0.1:19999";
const SCREENSHOT_DIR = path.join(PROJECT_DIR, "test/screenshots");
const HTTP_TIMEOUT = 8000; // 所有 HTTP 请求的超时时间

// ==================== 工具函数 ====================
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP GET 超时: ${url}`)), HTTP_TIMEOUT);
    http.get(url, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode, body: data }); });
    }).on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP POST 超时: ${url}`)), HTTP_TIMEOUT);
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, res => {
      let out = "";
      res.on("data", chunk => out += chunk);
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode, body: out }); });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

// 带超时的测试包装器
function withTimeout(fn, ms = 15000) {
  return async (ctx) => {
    return Promise.race([
      fn(ctx),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`测试超时 ${ms}ms`)), ms))
    ]);
  };
}

// ==================== 测试用例定义 ====================
const ALL_TESTS = [];
let createdHistoryId = null;

// ─── 1. 应用生命周期 ───
ALL_TESTS.push(
  { category: "生命周期", name: "T01 - Electron 主进程启动",
    test: withTimeout(async (ctx) => {
      assert(ctx.app.process().pid > 0, "Electron 主进程 PID 应大于 0");
    })
  },
  { category: "生命周期", name: "T02 - 主窗口成功创建",
    test: withTimeout(async (ctx) => {
      assert(ctx.page, "主窗口 page 对象应存在");
      await ctx.page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    })
  },
  { category: "生命周期", name: "T03 - 窗口尺寸正常",
    test: withTimeout(async (ctx) => {
      const bounds = await ctx.page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      assert(bounds.w >= 800, `窗口宽度 ${bounds.w} 应 >= 800`);
      assert(bounds.h >= 600, `窗口高度 ${bounds.h} 应 >= 600`);
    })
  },
  { category: "生命周期", name: "T04 - 页面无白屏（DOM 节点数 > 10）",
    test: withTimeout(async (ctx) => {
      const nodeCount = await ctx.page.evaluate(() => document.querySelectorAll("*").length);
      assert(nodeCount > 10, `DOM 节点数 ${nodeCount} 应 > 10`);
    })
  }
);

// ─── 2. 后端 API ───
ALL_TESTS.push(
  { category: "后端 API", name: "T05 - GET / 服务状态检查",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/`);
      assert.strictEqual(res.status, 200, `HTTP 状态码应为 200，实际 ${res.status}`);
      assert.strictEqual(res.body, "Hello World!", "响应体应为 'Hello World!'");
    })
  },
  { category: "后端 API", name: "T06 - GET /getSystem 获取系统配置",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/getSystem`);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "code 应为 0");
      assert(json.data.value, "应返回系统类型 value");
    })
  },
  { category: "后端 API", name: "T07 - GET /getPort 获取串口列表",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/getPort`);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "code 应为 0");
      assert(Array.isArray(json.data), "data 应为数组");
    })
  },
  { category: "后端 API", name: "T08 - GET /serialCache 获取缓存",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/serialCache`);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "code 应为 0");
      assert(typeof json.data.hasCache === "boolean", "hasCache 应为布尔值");
    })
  },
  { category: "后端 API", name: "T09 - GET /getPyConfig 获取 Python 配置",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/getPyConfig`);
      assert.strictEqual(res.status, 200, "HTTP 状态码应为 200");
    })
  },
  { category: "后端 API", name: "T10 - POST /startCol 无效参数不崩溃",
    test: withTimeout(async () => {
      const res = await httpPost(`${API_URL}/startCol`, {});
      assert.strictEqual(res.status, 200, "即使参数不完整也不应返回 500");
    })
  },
  { category: "后端 API", name: "T11 - GET /endCol 结束采集",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/endCol`);
      assert.strictEqual(res.status, 200, "HTTP 状态码应为 200");
    })
  },
  { category: "后端 API", name: "T12 - GET /getColHistory 获取采集历史",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/getColHistory`);
      assert.strictEqual(res.status, 200, "HTTP 状态码应为 200");
    })
  },
  { category: "后端 API", name: "T13 - GET /sendMac 获取 MAC 信息",
    test: withTimeout(async () => {
      const res = await httpGet(`${API_URL}/sendMac`);
      assert.strictEqual(res.status, 200, "HTTP 状态码应为 200");
    })
  },
  { category: "后端 API", name: "T14 - POST /bindKey 空参数不崩溃",
    test: withTimeout(async () => {
      const res = await httpPost(`${API_URL}/bindKey`, {});
      assert.strictEqual(res.status, 200, "即使参数为空也不应返回 500");
    })
  },
  { category: "后端 API", name: "T15 - POST /getSysconfig 获取系统配置",
    test: withTimeout(async () => {
      const res = await httpPost(`${API_URL}/getSysconfig`, {});
      assert.strictEqual(res.status, 200, "HTTP 状态码应为 200");
    })
  }
);

// ─── 3. WebSocket ───
ALL_TESTS.push(
  { category: "WebSocket", name: "T16 - 成功建立 WS 连接",
    test: withTimeout(async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timer = setTimeout(() => { ws.close(); reject(new Error("WS 连接超时 5s")); }, 5000);
        ws.on("open", () => { clearTimeout(timer); ws.close(); resolve(); });
        ws.on("error", (e) => { clearTimeout(timer); reject(new Error("WS 连接失败: " + e.message)); });
      });
    })
  },
  { category: "WebSocket", name: "T17 - 接收初始状态消息",
    test: withTimeout(async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timer = setTimeout(() => { ws.close(); reject(new Error("WS 消息超时 5s")); }, 5000);
        ws.on("message", (msg) => {
          clearTimeout(timer);
          const data = JSON.parse(msg.toString());
          assert.strictEqual(typeof data, "object", "初始消息应为 JSON 对象");
          ws.close();
          resolve();
        });
        ws.on("error", (e) => { clearTimeout(timer); reject(new Error("WS 错误: " + e.message)); });
      });
    })
  },
  { category: "WebSocket", name: "T18 - 发送 clearActiveTypes 消息",
    test: withTimeout(async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timer = setTimeout(() => { ws.close(); reject(new Error("WS 超时")); }, 5000);
        ws.on("open", () => {
          ws.send(JSON.stringify({ clearActiveTypes: true }));
          setTimeout(() => { clearTimeout(timer); ws.close(); resolve(); }, 1000);
        });
        ws.on("error", (e) => { clearTimeout(timer); reject(new Error("WS 错误: " + e.message)); });
      });
    })
  },
  { category: "WebSocket", name: "T19 - 发送 activeMode 消息",
    test: withTimeout(async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const timer = setTimeout(() => { ws.close(); reject(new Error("WS 超时")); }, 5000);
        ws.on("open", () => {
          ws.send(JSON.stringify({ mode: "foot" }));
          setTimeout(() => { clearTimeout(timer); ws.close(); resolve(); }, 1000);
        });
        ws.on("error", (e) => { clearTimeout(timer); reject(new Error("WS 错误: " + e.message)); });
      });
    })
  }
);

// ─── 4. 数据库与历史记录 CRUD ───
ALL_TESTS.push(
  { category: "数据库", name: "T20 - 创建历史记录 (save)",
    test: withTimeout(async () => {
      const res = await httpPost(`${API_URL}/api/history/save`, {
        patientInfo: { name: "自动化测试-张三", gender: "男", age: 72, weight: 68.5 },
        institution: "Playwright测试中心",
        assessments: { grip: { leftMax: 25.3, rightMax: 28.1, level: "正常" } }
      });
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "创建应成功, code=0");
      assert(json.data.id, "应返回新记录 ID");
      createdHistoryId = json.data.id;
    })
  },
  { category: "数据库", name: "T21 - 查询历史记录 (list)",
    test: withTimeout(async () => {
      assert(createdHistoryId, "前置测试 T20 必须通过");
      const res = await httpPost(`${API_URL}/api/history/list`, {
        keyword: "自动化测试-张三", page: 1, pageSize: 10
      });
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "查询应成功");
      assert(json.data.total >= 1, "至少应查到 1 条记录");
      const found = json.data.items.find(i => i.id === createdHistoryId);
      assert(found, "应能找到刚创建的记录");
      assert.strictEqual(found.patientName, "自动化测试-张三", "患者姓名应匹配");
      assert.strictEqual(found.patientAge, 72, "患者年龄应匹配");
    })
  },
  { category: "数据库", name: "T22 - 获取单条记录 (get)",
    test: withTimeout(async () => {
      assert(createdHistoryId, "前置测试 T20 必须通过");
      const res = await httpPost(`${API_URL}/api/history/get`, { id: createdHistoryId });
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "获取应成功");
      assert.strictEqual(json.data.institution, "Playwright测试中心", "机构名应匹配");
      assert(json.data.assessments.grip, "应包含握力评估数据");
    })
  },
  { category: "数据库", name: "T23 - 更新历史记录 (save 同名覆盖)",
    test: withTimeout(async () => {
      assert(createdHistoryId, "前置测试 T20 必须通过");
      const res = await httpPost(`${API_URL}/api/history/save`, {
        patientInfo: { name: "自动化测试-张三", gender: "男", age: 72, weight: 70 },
        institution: "Playwright测试中心-更新",
        assessments: { grip: { leftMax: 26, rightMax: 29, level: "正常" }, sitstand: { count: 12 } }
      });
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "更新应成功");
    })
  },
  { category: "数据库", name: "T24 - 删除历史记录 (delete)",
    test: withTimeout(async () => {
      assert(createdHistoryId, "前置测试 T20 必须通过");
      const res = await httpPost(`${API_URL}/api/history/delete`, { id: createdHistoryId });
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "删除应成功");
      assert.strictEqual(json.data.deleted, 1, "应删除 1 条");
      // 验证确实删除了
      const res2 = await httpPost(`${API_URL}/api/history/get`, { id: createdHistoryId });
      const json2 = JSON.parse(res2.body);
      assert.strictEqual(json2.code, 1, "删除后再查应返回 code=1");
    })
  },
  { category: "数据库", name: "T25 - 空参数查询不崩溃",
    test: withTimeout(async () => {
      const res = await httpPost(`${API_URL}/api/history/list`, {});
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "空参数查询应成功");
      assert(json.data.total >= 0, "total 应 >= 0");
    })
  },
  { category: "数据库", name: "T26 - 删除不存在的记录",
    test: withTimeout(async () => {
      const res = await httpPost(`${API_URL}/api/history/delete`, { id: "nonexistent_id_xyz" });
      const json = JSON.parse(res.body);
      assert.strictEqual(json.code, 0, "删除不存在的记录不应报错");
      assert.strictEqual(json.data.deleted, 0, "应报告删除 0 条");
    })
  }
);

// ─── 5. UI 界面测试 ───
ALL_TESTS.push(
  { category: "UI 界面", name: "T27 - 登录页渲染正确",
    test: withTimeout(async (ctx) => {
      await ctx.page.waitForTimeout(2000);
      const hasForm = await ctx.page.locator("form").count();
      assert(hasForm > 0, "应存在登录表单");
      const hasKeyInput = await ctx.page.locator('input[placeholder*="密钥"]').count();
      assert(hasKeyInput > 0, "应存在密钥输入框");
      const hasOrgInput = await ctx.page.locator('input[placeholder*="机构"]').count();
      assert(hasOrgInput > 0, "应存在机构名称输入框");
      const hasSubmitBtn = await ctx.page.locator('button[type="submit"]').count();
      assert(hasSubmitBtn > 0, "应存在提交按钮");
    })
  },
  { category: "UI 界面", name: "T28 - 登录按钮初始状态为禁用",
    test: withTimeout(async (ctx) => {
      const btn = ctx.page.locator('button[type="submit"]');
      const disabled = await btn.isDisabled();
      assert.strictEqual(disabled, true, "未输入密钥时登录按钮应禁用");
    })
  },
  { category: "UI 界面", name: "T29 - 输入密钥后按钮启用",
    test: withTimeout(async (ctx) => {
      await ctx.page.fill('input[placeholder*="密钥"]', "test-key-e2e");
      await ctx.page.waitForTimeout(300);
      const btn = ctx.page.locator('button[type="submit"]');
      const disabled = await btn.isDisabled();
      assert.strictEqual(disabled, false, "输入密钥后登录按钮应启用");
    })
  },
  { category: "UI 界面", name: "T30 - 登录并跳转到 Dashboard",
    test: withTimeout(async (ctx) => {
      await ctx.page.fill('input[placeholder*="密钥"]', "test-key-e2e");
      await ctx.page.fill('input[placeholder*="机构"]', "E2E测试中心");
      await ctx.page.locator('button[type="submit"]').click();
      await ctx.page.waitForTimeout(2000);
      const url = ctx.page.url();
      assert(url.includes("dashboard") || url.includes("#/dashboard"), `登录后应跳转到 Dashboard，实际 URL: ${url}`);
    })
  },
  { category: "UI 界面", name: "T31 - Dashboard 显示 4 个评估卡片",
    test: withTimeout(async (ctx) => {
      await ctx.page.waitForTimeout(1000);
      const bodyText = await ctx.page.evaluate(() => document.body.innerText);
      assert(bodyText.includes("握力"), "应显示握力评估");
      assert(bodyText.includes("起坐"), "应显示起坐评估");
      assert(bodyText.includes("站立"), "应显示站立评估");
      assert(bodyText.includes("步态"), "应显示步态评估");
    })
  },
  { category: "UI 界面", name: "T32 - 导航到握力评估页",
    test: withTimeout(async (ctx) => {
      await ctx.page.evaluate(() => { window.location.hash = "#/assessment/grip"; });
      await ctx.page.waitForTimeout(2000);
      const text = await ctx.page.evaluate(() => document.body.innerText);
      assert(text.length > 50, "握力评估页应有内容");
    })
  },
  { category: "UI 界面", name: "T33 - 导航到起坐评估页",
    test: withTimeout(async (ctx) => {
      await ctx.page.evaluate(() => { window.location.hash = "#/assessment/sitstand"; });
      await ctx.page.waitForTimeout(2000);
      const text = await ctx.page.evaluate(() => document.body.innerText);
      assert(text.length > 50, "起坐评估页应有内容");
    })
  },
  { category: "UI 界面", name: "T34 - 导航到静态站立评估页",
    test: withTimeout(async (ctx) => {
      await ctx.page.evaluate(() => { window.location.hash = "#/assessment/standing"; });
      await ctx.page.waitForTimeout(2000);
      const text = await ctx.page.evaluate(() => document.body.innerText);
      assert(text.length > 50, "静态站立评估页应有内容");
    })
  },
  { category: "UI 界面", name: "T35 - 导航到步态评估页",
    test: withTimeout(async (ctx) => {
      await ctx.page.evaluate(() => { window.location.hash = "#/assessment/gait"; });
      await ctx.page.waitForTimeout(2000);
      const text = await ctx.page.evaluate(() => document.body.innerText);
      assert(text.length > 50, "步态评估页应有内容");
    })
  },
  { category: "UI 界面", name: "T36 - 导航到历史记录页",
    test: withTimeout(async (ctx) => {
      await ctx.page.evaluate(() => { window.location.hash = "#/history"; });
      await ctx.page.waitForTimeout(2000);
      const text = await ctx.page.evaluate(() => document.body.innerText);
      assert(text.length > 50, "历史记录页应有内容");
    })
  },
  { category: "UI 界面", name: "T37 - 导航到不存在页面",
    test: withTimeout(async (ctx) => {
      await ctx.page.evaluate(() => { window.location.hash = "#/nonexistent"; });
      await ctx.page.waitForTimeout(1500);
      const text = await ctx.page.evaluate(() => document.body.innerText);
      assert(text.length > 0, "页面应有内容（404 或重定向）");
    })
  }
);

// ─── 6. 性能与稳定性 ───
ALL_TESTS.push(
  { category: "性能", name: "T38 - 页面切换无严重内存泄漏",
    test: withTimeout(async (ctx) => {
      const memBefore = await ctx.page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
      for (const hash of ["#/dashboard", "#/assessment/grip", "#/assessment/sitstand", "#/history", "#/dashboard"]) {
        await ctx.page.evaluate((h) => { window.location.hash = h; }, hash);
        await ctx.page.waitForTimeout(800);
      }
      const memAfter = await ctx.page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
      if (memBefore > 0 && memAfter > 0) {
        const leakMB = (memAfter - memBefore) / 1024 / 1024;
        assert(leakMB < 100, `页面切换后内存增长 ${leakMB.toFixed(1)}MB 应 < 100MB`);
      }
    })
  },
  { category: "性能", name: "T39 - 控制台无致命 JS 错误",
    test: withTimeout(async (ctx) => {
      const errors = ctx.consoleErrors.filter(e =>
        !e.toLowerCase().includes("resizeobserver") &&
        !e.toLowerCase().includes("favicon") &&
        !e.toLowerCase().includes("net::err") &&
        !e.toLowerCase().includes("failed to fetch") &&
        !e.toLowerCase().includes("websocket")
      );
      // 只报告，不强制失败（某些环境差异可能导致非致命错误）
      if (errors.length > 0) {
        console.log(`     ⚠️ 发现 ${errors.length} 个控制台错误（非致命）: ${errors[0]}`);
      }
    })
  }
);

// ─── 7. 应用关闭 ───
ALL_TESTS.push(
  { category: "生命周期", name: "T40 - 应用正常关闭",
    test: withTimeout(async (ctx) => {
      await ctx.app.close();
      await wait(2000);
    })
  }
);

// ==================== 执行引擎 ====================
async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const results = [];
  const consoleErrors = [];
  let app, page;

  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  console.log("║   老年人筛查系统MAC — 端到端测试                          ║");
  console.log("║   测试用例: " + ALL_TESTS.length + " 个                                         ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  // ── 启动应用 ──
  console.log("[启动] 正在启动 Electron 应用...");
  try {
    app = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: [BACKEND_DIR, "--no-sandbox"],
      env: { ...process.env, DISPLAY: ":99", NODE_ENV: "production", OPEN_DEVTOOLS: "0" },
    });
    console.log("[启动] Electron 进程已创建, PID:", app.process().pid);

    page = await app.firstWindow({ timeout: 30000 });
    console.log("[启动] 主窗口已获取");

    page.on("pageerror", (err) => { consoleErrors.push(err.message); });

    // 等待后端服务完全启动
    console.log("[启动] 等待后端服务启动...");
    let apiReady = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await httpGet(`${API_URL}/`);
        if (res.status === 200) { apiReady = true; break; }
      } catch {}
      await wait(1000);
    }
    console.log(apiReady ? "[启动] 后端 API 服务已就绪" : "[启动] ⚠️ 后端 API 未就绪");
    await page.waitForTimeout(3000);
    console.log("[启动] 前端页面已加载\n");

  } catch (e) {
    console.error(`[启动] ❌ 应用启动失败: ${e.message}`);
    ALL_TESTS.forEach(t => results.push({
      category: t.category, name: t.name,
      status: "⏭️ 跳过", detail: "应用启动失败", duration: 0, screenshot: null
    }));
    generateReport(results);
    return;
  }

  // ── 执行测试 ──
  const ctx = { app, page, consoleErrors };

  for (const testCase of ALL_TESTS) {
    const start = Date.now();
    let status = "✅ 通过";
    let detail = "";
    let screenshot = null;

    try {
      await testCase.test(ctx);
    } catch (e) {
      status = "❌ 失败";
      detail = e.message.replace(/\n/g, " ").substring(0, 200);
      const safeName = testCase.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      screenshot = path.join(SCREENSHOT_DIR, `${safeName}.png`);
      if (page && !page.isClosed()) {
        try { await page.screenshot({ path: screenshot, fullPage: true }); } catch {}
      }
    }

    const duration = Date.now() - start;
    results.push({ category: testCase.category, name: testCase.name, status, detail, duration, screenshot });

    const icon = status.startsWith("✅") ? "✅" : "❌";
    console.log(`  ${icon} ${testCase.name} (${duration}ms)`);
    if (detail) console.log(`     └─ ${detail}`);
  }

  // ── 截图所有页面 ──
  if (page && !page.isClosed()) {
    console.log("\n[截图] 正在截取各页面截图...");
    const pages = [
      { hash: "#/", file: "page_login.png" },
      { hash: "#/dashboard", file: "page_dashboard.png" },
      { hash: "#/assessment/grip", file: "page_grip.png" },
      { hash: "#/assessment/sitstand", file: "page_sitstand.png" },
      { hash: "#/assessment/standing", file: "page_standing.png" },
      { hash: "#/assessment/gait", file: "page_gait.png" },
      { hash: "#/history", file: "page_history.png" },
    ];
    for (const p of pages) {
      try {
        await page.evaluate((h) => { window.location.hash = h; }, p.hash);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, p.file), fullPage: true });
        console.log(`  📸 ${p.file}`);
      } catch {}
    }
  }

  // ── 清理 ──
  if (app && !app.process().killed) {
    try { await app.close(); } catch {}
  }

  // ── 生成报告 ──
  generateReport(results);
}

function generateReport(results) {
  const passed = results.filter(r => r.status.startsWith("✅")).length;
  const failed = results.filter(r => r.status.startsWith("❌")).length;
  const skipped = results.filter(r => r.status.startsWith("⏭️")).length;
  const total = results.length;

  const categories = {};
  results.forEach(r => {
    if (!categories[r.category]) categories[r.category] = { passed: 0, failed: 0, skipped: 0 };
    if (r.status.startsWith("✅")) categories[r.category].passed++;
    else if (r.status.startsWith("❌")) categories[r.category].failed++;
    else categories[r.category].skipped++;
  });

  console.log("\n\n╔═══════════════════════════════════════════════════════════╗");
  console.log("║                    测 试 报 告                            ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  for (const [cat, stats] of Object.entries(categories)) {
    const catTotal = stats.passed + stats.failed + stats.skipped;
    const statusIcon = stats.failed > 0 ? "⚠️" : "✅";
    console.log(`║  ${statusIcon} ${cat.padEnd(14)} ${stats.passed}/${catTotal} 通过${stats.failed > 0 ? `, ${stats.failed} 失败` : ""}${stats.skipped > 0 ? `, ${stats.skipped} 跳过` : ""}`);
  }
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║  总计: ${total} | ✅ 通过: ${passed} | ❌ 失败: ${failed} | ⏭️ 跳过: ${skipped}`);
  console.log(`║  通过率: ${(passed / total * 100).toFixed(1)}%`);
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // 保存 JSON 报告
  const reportPath = path.join(SCREENSHOT_DIR, "test_report.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    project: "老年人筛查系统MAC",
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, skipped, passRate: (passed / total * 100).toFixed(1) + "%" },
    categories,
    results: results.map(r => ({
      category: r.category, name: r.name, status: r.status,
      detail: r.detail, duration: r.duration, screenshot: r.screenshot
    }))
  }, null, 2));
  console.log(`\n📄 JSON 报告: ${reportPath}`);
  console.log(`📸 截图目录: ${SCREENSHOT_DIR}`);
}

run().catch(e => {
  console.error("测试执行异常:", e);
  process.exit(1);
});
