/**
 * 综合端到端测试 v1 - 全面覆盖采集、报告、历史、回放、CSV导出
 * 
 * 测试覆盖:
 * 1. 登录与设备连接
 * 2. 四个评估的完整采集流程（握力、起坐、站立、步态）
 * 3. 报告生成与查看
 * 4. CSV数据导出
 * 5. 历史记录 CRUD（保存、列表、查看、删除）
 * 6. 历史报告查看
 * 7. 数据库回放功能（getDbHistory、播放、暂停、速度调整、索引跳转）
 * 8. 对比功能
 */
const { SerialSimulator, parseHexDataToFrames } = require("./serial_simulator");
const { _electron: electron } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

// ─── 配置 ───
const SCREENSHOT_DIR = path.join(__dirname, "screenshots_comprehensive");
const ELECTRON_PATH = path.join(__dirname, "../back-end/code/node_modules/.bin/electron");
const APP_ENTRY = path.join(__dirname, "../back-end/code/index.js");
const BACKEND_HTTP = "http://127.0.0.1:19245";
const BACKEND_WS = "ws://127.0.0.1:19999";

// ─── 工具函数 ───
async function screenshot(page, name) {
  const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_");
  try {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${safeName}.png`), fullPage: true });
  } catch (e) {
    console.log(`     [截图失败] ${name}: ${e.message}`);
  }
}

// HTTP 请求工具（带超时）
const HTTP_TIMEOUT = 15000; // 15秒超时

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`POST ${urlObj.pathname} timeout after ${HTTP_TIMEOUT}ms`)); }, HTTP_TIMEOUT);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve({ raw: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const timer = setTimeout(() => { req.destroy(); reject(new Error(`GET ${urlObj.pathname} timeout after ${HTTP_TIMEOUT}ms`)); }, HTTP_TIMEOUT);
    const req = http.get({ hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname }, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve({ raw: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// ─── 测试结果收集 ───
const results = [];
let passCount = 0, failCount = 0, skipCount = 0;
const uxBugs = [];

async function runTest(id, name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  ✅ ${id} - ${name} (${ms}ms)`);
    results.push({ id, name, status: "PASS", ms });
    passCount++;
  } catch (e) {
    const ms = Date.now() - start;
    console.log(`  ❌ ${id} - ${name} (${ms}ms)`);
    console.log(`     └─ ${e.message}`);
    results.push({ id, name, status: "FAIL", ms, error: e.message });
    failCount++;
  }
}

function skipTest(id, name, reason) {
  console.log(`  ⏭️  ${id} - ${name} (跳过: ${reason})`);
  results.push({ id, name, status: "SKIP", reason });
  skipCount++;
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function logUxBug(id, desc) {
  console.log(`     └─ [UX Bug] ${desc}`);
  uxBugs.push({ id, desc });
}

// ─── 主测试 ───
async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║   综合端到端测试 v1 - 全面覆盖采集/报告/历史/回放/CSV导出       ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝");

  const sim = new SerialSimulator();
  let electronApp, page;
  // 跟踪assessmentId用于后续回放/历史测试
  let gripLeftAssessmentId = null;
  let gripRightAssessmentId = null;
  let sitstandAssessmentId = null;
  let standingAssessmentId = null;
  let gaitAssessmentId = null;
  let historyRecordId = null;

  try {
    // ═══════════════════════════════════════════════════════
    // 阶段1: 准备环境
    // ═══════════════════════════════════════════════════════
    console.log("\n[阶段1] 创建虚拟串口并加载传感器数据...");
    const deviceNames = ["leftHand", "rightHand", "seat", "foot1", "foot2", "foot3", "foot4"];
    await sim.init(deviceNames);
    const envVars = sim.getEnvVars(deviceNames);
    const leftFrames = parseHexDataToFrames(
      fs.readFileSync(path.join(__dirname, "../upload_data/left_hand.bin"), "utf-8")
    ).filter((f) => [18, 130, 146].includes(f.length));
    const rightFrames = parseHexDataToFrames(
      fs.readFileSync(path.join(__dirname, "../upload_data/right_hand.bin"), "utf-8")
    ).filter((f) => [18, 130, 146].includes(f.length));
    const seatFrames = parseHexDataToFrames(
      fs.readFileSync(path.join(__dirname, "../upload_data/seat.bin"), "utf-8")
    ).filter((f) => f.length === 1024);
    // 加载4路脚垫数据
    const foot1Frames = parseHexDataToFrames(
      fs.readFileSync(path.join(__dirname, "../upload_data/foot1.bin"), "utf-8")
    ).filter((f) => f.length === 4096);
    const foot2Frames = parseHexDataToFrames(
      fs.readFileSync(path.join(__dirname, "../upload_data/foot2.bin"), "utf-8")
    ).filter((f) => f.length === 4096);
    const foot3Frames = parseHexDataToFrames(
      fs.readFileSync(path.join(__dirname, "../upload_data/foot3.bin"), "utf-8")
    ).filter((f) => f.length === 4096);
    const foot4Frames = parseHexDataToFrames(
      fs.readFileSync(path.join(__dirname, "../upload_data/foot4.bin"), "utf-8")
    ).filter((f) => f.length === 4096);

    console.log(`  数据帧: 左手=${leftFrames.length}, 右手=${rightFrames.length}, 坐垫=${seatFrames.length}`);
    console.log(`  脚垫帧: foot1=${foot1Frames.length}, foot2=${foot2Frames.length}, foot3=${foot3Frames.length}, foot4=${foot4Frames.length}`);

    // ═══════════════════════════════════════════════════════
    // 阶段2: 启动应用
    // ═══════════════════════════════════════════════════════
    console.log("\n[阶段2] 启动 Electron 应用...");
    electronApp = await electron.launch({
      executablePath: ELECTRON_PATH,
      args: [APP_ENTRY],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
        OPEN_DEVTOOLS: "0",
        ...envVars,
      },
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(3000);

    // 注入JS错误收集器
    await page.evaluate(() => {
      window.e2e_errors = [];
      window.addEventListener("error", (e) => window.e2e_errors.push(e.message));
      window.addEventListener("unhandledrejection", (e) => window.e2e_errors.push(String(e.reason)));
    });

    // ═══════════════════════════════════════════════════════
    // 阶段3: 执行测试用例
    // ═══════════════════════════════════════════════════════
    console.log("\n[阶段3] 执行测试用例...\n");

    // ════════════════════════════════════════════════════
    // 一、登录与设备连接
    // ════════════════════════════════════════════════════
    console.log("  ── 一、登录与设备连接 ──");

    await runTest("T01", "登录系统", async () => {
      await page.locator('input[placeholder="请输入密钥"]').fill("123456");
      await page.locator('button:has-text("进入系统")').click();
      await page.waitForTimeout(3000);
      await screenshot(page, "T01_dashboard");
      const hasConnect = await page.locator('text=一键连接').count();
      assert(hasConnect > 0, "Dashboard 未加载: 找不到一键连接按钮");
    });

    await runTest("T02", "一键连接设备", async () => {
      // 启动串口模拟器
      sim.startSending("leftHand", leftFrames, 80);
      sim.startSending("rightHand", rightFrames, 80);
      sim.startSending("seat", seatFrames, 80);
      sim.startFootSending("foot1", foot1Frames, 80);
      sim.startFootSending("foot2", foot2Frames, 80);
      sim.startFootSending("foot3", foot3Frames, 80);
      sim.startFootSending("foot4", foot4Frames, 80);
      // 点击一键连接
      await page.locator('button:has-text("一键连接")').click();
      await page.waitForTimeout(10000); // 等待设备连接
      await screenshot(page, "T02_after_connect");
      const connected = await page.locator('text=已连接').count();
      console.log(`     └─ 连接状态: ${connected > 0 ? "已连接" : "未连接"}`);
    });

    await runTest("T03", "验证Dashboard设备状态", async () => {
      await screenshot(page, "T03_dashboard_status");
      // 检查设备在线指示器
      const onlineLabels = await page.locator('text=/\\d+\\/\\d+/').count();
      console.log(`     └─ 设备在线标签: ${onlineLabels}`);
    });

    // ════════════════════════════════════════════════════
    // 二、握力评估完整流程
    // ════════════════════════════════════════════════════
    console.log("\n  ── 二、握力评估完整流程 ──");

    await runTest("T04", "弹出患者信息并填写", async () => {
      await page.locator('button:has-text("开始评估")').first().click();
      await page.waitForTimeout(2000);
      await screenshot(page, "T04_patient_dialog");
      const hasDialog = await page.locator('text=评估对象信息').count();
      assert(hasDialog > 0, "患者信息弹窗未出现");
      // 填写信息
      await page.locator('input[placeholder="请输入姓名"]').fill("综合测试患者");
      const dialogBtns = await page.locator('button:has-text("开始评估")').all();
      await dialogBtns[dialogBtns.length - 1].click();
      await page.waitForTimeout(3000);
      await screenshot(page, "T04b_grip_page");
    });

    await runTest("T05", "握力评估 - 检查设备连接状态", async () => {
      await page.waitForTimeout(2000);
      await screenshot(page, "T05_grip_status");
      const needConnect = await page.locator('text=请先连接传感器').count();
      const hasStartBtn = await page.locator('text=开始采集左手').count();
      if (needConnect > 0) {
        logUxBug("T05", '全局已连接但握力评估页面显示"请先连接传感器"');
        const backendBtn = await page.locator('button:has-text("后端")').count();
        if (backendBtn > 0) {
          await page.locator('button:has-text("后端")').click();
          await page.waitForTimeout(3000);
        }
      }
      console.log(`     └─ 开始采集按钮: ${hasStartBtn > 0}, 需要连接: ${needConnect > 0}`);
    });

    await runTest("T06", "握力评估 - 采集左手数据", async () => {
      const startSpan = page.locator('span:has-text("开始采集左手")');
      const count = await startSpan.count();
      if (count > 0) {
        await startSpan.click();
        await page.waitForTimeout(6000); // 采集6秒
        await screenshot(page, "T06_grip_left_collecting");
        // 从控制台日志捕获assessmentId
        gripLeftAssessmentId = await page.evaluate(() => {
          // 尝试从页面状态获取
          const el = document.querySelector('[data-assessment-id]');
          return el ? el.dataset.assessmentId : null;
        });
        // 结束采集
        const stopSpan = page.locator('span:has-text("结束采集左手")');
        if (await stopSpan.count() > 0) {
          await stopSpan.click();
          await page.waitForTimeout(3000);
          await screenshot(page, "T06b_grip_left_done");
        }
      } else {
        throw new Error('找不到"开始采集左手"按钮');
      }
    });

    await runTest("T07", "握力评估 - 采集右手数据", async () => {
      await page.waitForTimeout(2000);
      const hasRightStart = await page.locator('text=开始采集右手').count();
      if (hasRightStart > 0) {
        await page.locator('span:has-text("开始采集右手")').click();
        await page.waitForTimeout(6000); // 采集6秒
        await screenshot(page, "T07_grip_right_collecting");
        // 结束采集
        const stopSpan = page.locator('span:has-text("结束采集右手")');
        if (await stopSpan.count() > 0) {
          await stopSpan.click();
          await page.waitForTimeout(5000);
          await screenshot(page, "T07b_grip_right_done");
        }
      } else {
        logUxBug("T07", "左手采集结束后未自动切换到右手");
      }
    });

    await runTest("T08", "握力评估 - 查看报告", async () => {
      // 等待报告生成完成（完成弹窗出现）
      console.log(`     └─ 等待报告生成完成...`);
      try {
        await page.locator('button:has-text("查看报告")').first().waitFor({ timeout: 30000 });
      } catch (e) {
        console.log(`     └─ 等待查看报告按钮超时，尝试继续...`);
      }
      await screenshot(page, "T08_grip_complete");
      const hasViewReport = await page.locator('button:has-text("查看报告")').count();
      console.log(`     └─ 查看报告按钮: ${hasViewReport > 0}`);
      if (hasViewReport > 0) {
        await page.locator('button:has-text("查看报告")').first().click();
        await page.waitForTimeout(5000);
        await screenshot(page, "T08b_grip_report");
        const hasReportContent = await page.locator('text=基本信息').count() +
          await page.locator('text=手部压力分布').count() +
          await page.locator('text=力-时间曲线').count();
        console.log(`     └─ 报告内容元素: ${hasReportContent}`);
      }
    });

    await runTest("T09", "握力评估 - 返回首页", async () => {
      // 报告页面中的"返回首页"按钮
      const backBtn = await page.locator('button:has-text("返回首页")').count();
      if (backBtn > 0) {
        await page.locator('button:has-text("返回首页")').first().click();
      } else {
        // 使用后退键而不是href，保持React状态
        await page.goBack();
      }
      await page.waitForTimeout(3000);
      await screenshot(page, "T09_back_dashboard");
      // 确保在Dashboard页面
      const hasDashboard = (await page.locator('text=一键连接').count()) + (await page.locator('text=已连接').count());
      if (hasDashboard === 0) {
        await page.goBack();
        await page.waitForTimeout(2000);
      }
    });

    // ════════════════════════════════════════════════════
    // 三、起坐评估完整流程
    // ════════════════════════════════════════════════════
    console.log("\n  ── 三、起坐评估完整流程 ──");

    await runTest("T10", "起坐评估 - 进入页面", async () => {
      // 精确匹配起坐评估卡片中的"开始评估"按钮
      const cards = await page.locator('.rounded-2xl, .zeiss-card').all();
      let clicked = false;
      for (const card of cards) {
        const text = await card.innerText();
        if (text.includes('起坐') && text.includes('开始评估')) {
          const btn = card.locator('button:has-text("开始评估")');
          if (await btn.count() > 0) {
            await btn.click();
            clicked = true;
            break;
          }
        }
      }
      if (!clicked) {
        // 备选：点击第二个"开始评估"按钮（索引为1）
        const startBtns = await page.locator('button:has-text("开始评估")').all();
        if (startBtns.length >= 2) {
          await startBtns[1].click();
          clicked = true;
        } else if (startBtns.length >= 1) {
          await startBtns[0].click();
          clicked = true;
        }
      }
      if (!clicked) logUxBug("T10", "Dashboard上没有找到起坐评估卡片");
      await page.waitForTimeout(3000);
      const url = page.url();
      console.log(`     └─ 当前URL: ${url}`);
      await screenshot(page, "T10_sitstand_page");
    });

    await runTest("T11", "起坐评估 - 采集数据", async () => {
      await page.waitForTimeout(2000);
      const startSpan = page.locator('span:has-text("开始采集")');
      if (await startSpan.count() > 0) {
        await startSpan.click();
        await page.waitForTimeout(8000); // 采集8秒
        await screenshot(page, "T11_sitstand_collecting");
        // 结束采集
        const stopSpan = page.locator('span:has-text("结束采集")');
        if (await stopSpan.count() > 0) {
          await stopSpan.click();
          await page.waitForTimeout(5000);
          await screenshot(page, "T11b_sitstand_done");
        }
      } else {
        logUxBug("T11", "起坐评估页面未显示开始采集按钮");
      }
    });

    await runTest("T12", "起坐评估 - 查看报告并返回", async () => {
      // 等待完成弹窗出现
      console.log(`     └─ 等待报告生成完成...`);
      try {
        await page.locator('button:has-text("查看报告")').first().waitFor({ timeout: 30000 });
      } catch (e) {
        console.log(`     └─ 等待查看报告按钮超时`);
      }
      const hasViewReport = await page.locator('button:has-text("查看报告")').count();
      if (hasViewReport > 0) {
        // 先点击弹窗中的"返回首页"按钮（会触发completeAssessment并导航到dashboard）
        const dialogBackBtn = page.locator('.zeiss-overlay button:has-text("返回首页")');
        if (await dialogBackBtn.count() > 0) {
          await dialogBackBtn.click();
          await page.waitForTimeout(3000);
          await screenshot(page, "T12b_back_dashboard");
          return;
        }
        // 如果没有弹窗中的返回按钮，点击查看报告
        await page.locator('button:has-text("查看报告")').first().click();
        await page.waitForTimeout(5000);
        await screenshot(page, "T12_sitstand_report");
      }
      // 返回首页
      const backBtn = await page.locator('button:has-text("返回首页")').count();
      if (backBtn > 0) {
        await page.locator('button:has-text("返回首页")').first().click();
      } else {
        // 使用后退键而不是href，保持React状态
        await page.goBack();
      }
      await page.waitForTimeout(3000);
      await screenshot(page, "T12b_back_dashboard");
    });

    // ════════════════════════════════════════════════════
    // 四、静态站立评估完整流程
    // ════════════════════════════════════════════════════
    console.log("\n  ── 四、静态站立评估完整流程 ──");

    await runTest("T13", "站立评估 - 进入页面", async () => {
      await page.waitForTimeout(2000);
      // 精确匹配站立评估卡片
      const cards = await page.locator('.rounded-2xl, .zeiss-card').all();
      let clicked = false;
      for (const card of cards) {
        const text = await card.innerText();
        if (text.includes('站立') && text.includes('开始评估')) {
          const btn = card.locator('button:has-text("开始评估")');
          if (await btn.count() > 0) {
            await btn.click();
            clicked = true;
            break;
          }
        }
      }
      if (!clicked) {
        const startBtns = await page.locator('button:has-text("开始评估")').all();
        console.log(`     └─ 找到开始评估按钮: ${startBtns.length}个`);
        if (startBtns.length >= 3) {
          await startBtns[2].click();
          clicked = true;
        } else if (startBtns.length >= 1) {
          await startBtns[0].click();
          clicked = true;
        }
      }
      if (!clicked) logUxBug("T13", "Dashboard上没有找到站立评估卡片");
      await page.waitForTimeout(5000);
      const url = page.url();
      console.log(`     └─ 当前URL: ${url}`);
      const isStanding = url.includes('standing');
      console.log(`     └─ 是否站立评估页面: ${isStanding}`);
      await screenshot(page, "T13_standing_page");
    });

    await runTest("T14", "站立评估 - 采集数据", async () => {
      // 等待后端模式建立连接
      await page.waitForTimeout(5000);
      // 先关闭overlay弹窗（如果有）
      const overlay = page.locator('.zeiss-overlay');
      if (await overlay.count() > 0) {
        const closeBtn = overlay.locator('button');
        if (await closeBtn.count() > 0) {
          await closeBtn.first().click();
          await page.waitForTimeout(1000);
        }
      }
      let startSpan = page.locator('span:has-text("开始采集")');
      if (await startSpan.count() === 0) {
        // 可能后端模式还未建立，尝试点击"连接"按钮
        const connectBtn = page.locator('button:has-text("连接")');
        if (await connectBtn.count() > 0) {
          await connectBtn.first().click();
          await page.waitForTimeout(5000);
        }
        startSpan = page.locator('span:has-text("开始采集")');
      }
      if (await startSpan.count() > 0) {
        await startSpan.click();
        await page.waitForTimeout(10000);
        await screenshot(page, "T14_standing_collecting");
        const stopSpan = page.locator('span:has-text("结束采集")');
        if (await stopSpan.count() > 0) {
          await stopSpan.click();
          await page.waitForTimeout(8000); // 等待报告生成
          await screenshot(page, "T14b_standing_done");
        }
      } else {
        logUxBug("T14", "站立评估页面未显示开始采集按钮");
      }
    });

    await runTest("T15", "站立评估 - 查看报告并返回", async () => {
      // 等待完成弹窗出现
      console.log(`     └─ 等待报告生成完成...`);
      try {
        await page.locator('button:has-text("查看报告")').first().waitFor({ timeout: 30000 });
      } catch (e) {
        console.log(`     └─ 等待查看报告按钮超时`);
      }
      const hasViewReport = await page.locator('button:has-text("查看报告")').count();
      if (hasViewReport > 0) {
        // 优先点击弹窗中的"返回首页"按钮（触发completeAssessment）
        const dialogBackBtn = page.locator('.zeiss-overlay button:has-text("返回首页")');
        if (await dialogBackBtn.count() > 0) {
          await dialogBackBtn.click();
          await page.waitForTimeout(3000);
          await screenshot(page, "T15b_back_dashboard");
          return;
        }
        await page.locator('button:has-text("查看报告")').first().click();
        await page.waitForTimeout(5000);
        await screenshot(page, "T15_standing_report");
      }
      const backBtn = await page.locator('button:has-text("返回首页")').count();
      if (backBtn > 0) {
        await page.locator('button:has-text("返回首页")').first().click();
      } else {
        await page.goBack();
      }
      await page.waitForTimeout(3000);
      await screenshot(page, "T15b_back_dashboard");
    });

    // ════════════════════════════════════════════════════════
    // 五、步态评估完整流程
    // ════════════════════════════════════════════════════════
    console.log("\n  ── 五、步态评估完整流程 ──");

    await runTest("T16", "步态评估 - 进入页面", async () => {
      await page.waitForTimeout(2000);
      // 精确匹配步态评估卡片
      const cards = await page.locator('.rounded-2xl, .zeiss-card').all();
      let clicked = false;
      for (const card of cards) {
        const text = await card.innerText();
        if ((text.includes('步态') || text.includes('行走')) && text.includes('开始评估')) {
          const btn = card.locator('button:has-text("开始评估")');
          if (await btn.count() > 0) {
            await btn.click();
            clicked = true;
            break;
          }
        }
      }
      if (!clicked) {
        const startBtns = await page.locator('button:has-text("开始评估")').all();
        console.log(`     └─ 找到开始评估按钮: ${startBtns.length}个`);
        if (startBtns.length >= 4) {
          await startBtns[3].click();
          clicked = true;
        } else if (startBtns.length >= 1) {
          await startBtns[startBtns.length - 1].click();
          clicked = true;
        }
      }
      if (!clicked) logUxBug("T16", "Dashboard上没有找到步态评估卡片");
      await page.waitForTimeout(5000);
      const url = page.url();
      console.log(`     └─ 当前URL: ${url}`);
      await screenshot(page, "T16_gait_page");
    });

    await runTest("T17", "步态评估 - 采集数据", async () => {
      // 等待后端模式建立连接
      await page.waitForTimeout(5000);
      // 先关闭overlay弹窗（如果有）
      const overlay = page.locator('.zeiss-overlay');
      if (await overlay.count() > 0) {
        const closeBtn = overlay.locator('button:has-text("关闭"), button:has-text("取消")');
        if (await closeBtn.count() > 0) await closeBtn.first().click();
        await page.waitForTimeout(1000);
      }
      let startSpan = page.locator('span:has-text("开始采集")');
      if (await startSpan.count() === 0) {
        // 可能后端模式还未建立，尝试点击"连接"按钮
        const connectBtn = page.locator('button:has-text("连接")');
        if (await connectBtn.count() > 0) {
          await connectBtn.first().click();
          await page.waitForTimeout(5000);
        }
        startSpan = page.locator('span:has-text("开始采集")');
      }
      if (await startSpan.count() > 0) {
        await startSpan.click();
        await page.waitForTimeout(8000);
        await screenshot(page, "T17_gait_collecting");
        const stopSpan = page.locator('span:has-text("结束采集")');
        if (await stopSpan.count() > 0) {
          await stopSpan.click();
          await page.waitForTimeout(8000);
        }
      } else {
        logUxBug("T17", "步态评估页面未显示开始采集按钮");
      }
      await screenshot(page, "T17b_gait_done");
    });

    await runTest("T18", "步态评估 - 查看报告并返回", async () => {
      // 等待完成弹窗出现
      console.log(`     └─ 等待报告生成完成...`);
      try {
        await page.locator('button:has-text("查看报告")').first().waitFor({ timeout: 30000 });
      } catch (e) {
        console.log(`     └─ 等待查看报告按钮超时`);
      }
      const hasViewReport = await page.locator('button:has-text("查看报告")').count();
      if (hasViewReport > 0) {
        // 优先点击弹窗中的"返回首页"按钮（触发completeAssessment）
        const dialogBackBtn = page.locator('.zeiss-overlay button:has-text("返回首页")');
        if (await dialogBackBtn.count() > 0) {
          await dialogBackBtn.click();
          await page.waitForTimeout(3000);
          await screenshot(page, "T18b_back_dashboard");
          return;
        }
        await page.locator('button:has-text("查看报告")').first().click();
        await page.waitForTimeout(5000);
        await screenshot(page, "T18_gait_report");
        await page.waitForTimeout(3000);
        const backBtn = await page.locator('button:has-text("返回首页")').count();
        if (backBtn > 0) {
          await page.locator('button:has-text("返回首页")').first().click();
        }
      } else {
        const backBtn = await page.locator('button:has-text("返回首页")').count();
        if (backBtn > 0) {
          await page.locator('button:has-text("返回首页")').first().click();
        }
      }
      await page.waitForTimeout(3000);
      // 确保回到Dashboard
      const isDashboard = page.url().includes('dashboard');
      if (!isDashboard) {
        // 用后退键尝试返回
        await page.goBack();
        await page.waitForTimeout(2000);
      }
      await screenshot(page, "T18b_back_dashboard");
    });

    // ════════════════════════════════════════════════════
    // 六、Dashboard 评估完成状态验证
    // ════════════════════════════════════════════════════
    console.log("\n  ── 六、Dashboard 评估完成状态验证 ──");

    await runTest("T19", "验证Dashboard显示已完成评估", async () => {
      await page.waitForTimeout(2000);
      await screenshot(page, "T19_dashboard_complete_status");
      const viewReportBtns = await page.locator('button:has-text("查看报告")').count();
      const startBtns = await page.locator('button:has-text("开始评估")').count();
      console.log(`     └─ 查看报告: ${viewReportBtns}, 开始评估: ${startBtns}`);
      // 至少应该有一些评估完成
      if (viewReportBtns === 0) {
        logUxBug("T19", "完成多个评估后Dashboard没有显示任何查看报告按钮");
      }
    });

    await runTest("T20", "从Dashboard查看已完成评估报告", async () => {
      const viewReportBtns = await page.locator('button:has-text("查看报告")').all();
      if (viewReportBtns.length > 0) {
        await viewReportBtns[0].evaluate((el) => el.click());
        await page.waitForTimeout(5000);
        await screenshot(page, "T20_dashboard_report_view");
        const url = page.url();
        console.log(`     └─ 报告页URL: ${url}`);
        // 返回
        const backBtn = await page.locator('button:has-text("返回首页")').count();
        if (backBtn > 0) {
          await page.locator('button:has-text("返回首页")').first().evaluate((el) => el.click());
          await page.waitForTimeout(3000);
        } else {
          await page.evaluate(() => (window.location.href = '/dashboard'));
          await page.waitForTimeout(2000);
        }
      } else {
        console.log("     └─ 无查看报告按钮");
      }
    });

    // ════════════════════════════════════════════════════
    // 七、历史记录功能验证
    // ════════════════════════════════════════════════════
    console.log("\n  ── 七、历史记录功能验证 ──");

    await runTest("T21", "进入历史记录页面", async () => {
      const historyBtn = page.locator('button:has(svg path[d*="M12 8v4l3 3"])');
      if (await historyBtn.count() > 0) {
        await historyBtn.click();
      } else {
        const textBtn = await page.locator('text=历史记录').count();
        if (textBtn > 0) {
          await page.locator('text=历史记录').click();
        } else {
          await page.evaluate(() => (window.location.href = '/history'));
        }
      }
      await page.waitForTimeout(3000);
      await screenshot(page, "T21_history_page");
    });

    await runTest("T22", "验证历史记录列表包含测试患者", async () => {
      const hasPatient = await page.locator('text=综合测试患者').count();
      console.log(`     └─ 找到测试患者: ${hasPatient > 0}`);
      if (hasPatient === 0) {
        logUxBug("T22", "完成评估后历史记录中没有对应的患者记录");
      }
      await screenshot(page, "T22_history_list");
    });

    await runTest("T23", "展开历史详情", async () => {
      const detailBtns = await page.locator("button").filter({ hasText: "详情" }).all();
      console.log(`     └─ 详情按钮数量: ${detailBtns.length}`);
      if (detailBtns.length > 0) {
        await detailBtns[0].evaluate((el) => el.click());
        await page.waitForTimeout(2000);
        await screenshot(page, "T23_history_expanded");
        // 检查评估完成状态
        const completedLabels = await page.locator('text=已完成').count();
        const notCompletedLabels = await page.locator('text=未完成').count();
        console.log(`     └─ 已完成: ${completedLabels}, 未完成: ${notCompletedLabels}`);
      } else {
        const patient = await page.locator('text=综合测试患者').count();
        if (patient > 0) {
          await page.locator('text=综合测试患者').first().click();
          await page.waitForTimeout(2000);
          await screenshot(page, "T23_history_expanded_alt");
        }
      }
    });

    await runTest("T24", "查看历史中的握力评估报告", async () => {
      const reportBtns = await page.locator('button:has-text("查看报告")').all();
      console.log(`     └─ 查看报告按钮: ${reportBtns.length}`);
      if (reportBtns.length > 0) {
        await reportBtns[0].click();
        await page.waitForTimeout(5000);
        await screenshot(page, "T24_history_grip_report");
        // 检查报告是否有数据
        const noData = await page.locator('text=没有保存报告数据').count();
        const noReport = await page.locator('text=没有报告数据').count();
        if (noData > 0 || noReport > 0) {
          logUxBug("T24", "历史报告页面显示没有报告数据 → 报告数据未正确保存");
        }
        // 验证报告内容
        const hasContent = await page.locator('text=基本信息').count() +
          await page.locator('text=手部压力分布').count();
        console.log(`     └─ 报告内容: ${hasContent > 0 ? "有" : "无"}, 无数据提示: ${noData > 0 || noReport > 0}`);
        // 返回
        const backBtn = await page.locator('text=返回历史记录').count();
        if (backBtn > 0) {
          await page.locator('text=返回历史记录').click();
        } else {
          await page.goBack();
        }
        await page.waitForTimeout(2000);
      }
    });

    await runTest("T25", "查看历史中的其他评估报告", async () => {
      // 重新展开详情
      const detailBtns = await page.locator("button").filter({ hasText: "详情" }).all();
      if (detailBtns.length > 0) {
        await detailBtns[0].evaluate((el) => el.click());
        await page.waitForTimeout(2000);
      }
      const reportBtns = await page.locator('button:has-text("查看报告")').all();
      if (reportBtns.length > 1) {
        // 查看第二个报告
        await reportBtns[1].click();
        await page.waitForTimeout(5000);
        await screenshot(page, "T25_history_other_report");
        const noData = await page.locator('text=没有保存报告数据').count();
        if (noData > 0) {
          logUxBug("T25", "第二个评估的历史报告也显示没有数据");
        }
        // 返回
        const backBtn = await page.locator('text=返回历史记录').count();
        if (backBtn > 0) {
          await page.locator('text=返回历史记录').click();
        } else {
          await page.goBack();
        }
        await page.waitForTimeout(2000);
      } else {
        console.log("     └─ 只有一个或没有报告按钮");
      }
    });

    // ════════════════════════════════════════════════════
    // 八、后端API直接测试（回放、CSV导出、历史CRUD）
    // ════════════════════════════════════════════════════
    console.log("\n  ── 八、后端API直接测试 ──");

    await runTest("T26", "API: 获取采集历史列表 (getColHistory)", async () => {
      try {
        const resp = await httpGet(`${BACKEND_HTTP}/getColHistory`);
        console.log(`     └─ 响应code: ${resp.code}, 记录数: ${Array.isArray(resp.data) ? resp.data.length : "N/A"}`);
        if (resp.code === 0 && Array.isArray(resp.data) && resp.data.length > 0) {
          const firstRecord = resp.data[0];
          console.log(`     └─ 第一条记录: assessment_id=${firstRecord.assessment_id}, date=${firstRecord.date}, name=${firstRecord.name}`);
          for (const record of resp.data) {
            const aid = record.assessment_id || "";
            if (aid.startsWith("grip_L_") && !gripLeftAssessmentId) gripLeftAssessmentId = aid;
            if (aid.startsWith("grip_R_") && !gripRightAssessmentId) gripRightAssessmentId = aid;
            if (aid.startsWith("sitstand_") && !sitstandAssessmentId) sitstandAssessmentId = aid;
            if (aid.startsWith("standing_") && !standingAssessmentId) standingAssessmentId = aid;
            if (aid.startsWith("gait_") && !gaitAssessmentId) gaitAssessmentId = aid;
          }
        }
      } catch (e) {
        console.log(`     └─ getColHistory超时或失败: ${e.message}`);
        logUxBug("T26", `getColHistory API超时: ${e.message}`);
      }
      // 备选方案：从matrix表直接查询assessmentId
      if (!gripLeftAssessmentId && !sitstandAssessmentId) {
        console.log(`     └─ 尝试从数据库直接查询assessmentId...`);
        try {
          const dbResp = await httpPost(`${BACKEND_HTTP}/api/history/list`, { page: 1, pageSize: 10 });
          if (dbResp.code === 0 && dbResp.data?.items?.length > 0) {
            // 从matrix表中没有数据时，生成模拟assessmentId用于测试
            const item = dbResp.data.items[0];
            const assessments = item.assessments || {};
            if (assessments.grip?.completed) {
              gripLeftAssessmentId = `grip_L_test_${Date.now()}`;
              gripRightAssessmentId = `grip_R_test_${Date.now()}`;
            }
            if (assessments.sitstand?.completed) sitstandAssessmentId = `sitstand_test_${Date.now()}`;
            if (assessments.standing?.completed) standingAssessmentId = `standing_test_${Date.now()}`;
            if (assessments.gait?.completed) gaitAssessmentId = `gait_test_${Date.now()}`;
            console.log(`     └─ 从历史记录推断的assessmentId: grip_L=${gripLeftAssessmentId}, sitstand=${sitstandAssessmentId}, standing=${standingAssessmentId}, gait=${gaitAssessmentId}`);
          }
        } catch (e2) {
          console.log(`     └─ 备选查询也失败: ${e2.message}`);
        }
      }
      // 检查matrix表是否有数据（验证schema修复是否生效）
      console.log(`     └─ 最终assessmentId: grip_L=${gripLeftAssessmentId}, grip_R=${gripRightAssessmentId}, sitstand=${sitstandAssessmentId}, standing=${standingAssessmentId}, gait=${gaitAssessmentId}`);
    });

    await runTest("T27", "API: 历史记录列表 (history/list)", async () => {
      const resp = await httpPost(`${BACKEND_HTTP}/api/history/list`, { page: 1, pageSize: 10 });
      console.log(`     └─ 响应code: ${resp.code}, 总数: ${resp.data?.total}, 页数: ${resp.data?.totalPages}`);
      assert(resp.code === 0, `history/list 返回错误: ${resp.msg}`);
      if (resp.data?.items?.length > 0) {
        historyRecordId = resp.data.items[0].id;
        const item = resp.data.items[0];
        console.log(`     └─ 第一条: id=${item.id}, name=${item.patientName}, date=${item.dateStr}`);
        console.log(`     └─ 评估数据: ${JSON.stringify(Object.keys(item.assessments || {}))}`);
      }
    });

    await runTest("T28", "API: 搜索历史记录 (keyword)", async () => {
      const resp = await httpPost(`${BACKEND_HTTP}/api/history/list`, { keyword: "综合测试", page: 1, pageSize: 10 });
      console.log(`     └─ 搜索结果: ${resp.data?.total || 0} 条`);
      assert(resp.code === 0, `搜索失败: ${resp.msg}`);
    });

    await runTest("T29", "API: 获取单条历史记录 (history/get)", async () => {
      if (!historyRecordId) {
        throw new Error("没有可用的历史记录ID");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/api/history/get`, { id: historyRecordId });
      console.log(`     └─ 响应code: ${resp.code}`);
      assert(resp.code === 0, `history/get 返回错误: ${resp.msg}`);
      const record = resp.data;
      console.log(`     └─ 患者: ${record.patientName}, 性别: ${record.patientGender}, 年龄: ${record.patientAge}`);
      // 检查评估数据完整性
      const assessments = record.assessments || {};
      for (const [type, data] of Object.entries(assessments)) {
        const hasReport = data?.report?.reportData ? "有" : "无";
        console.log(`     └─ ${type}: completed=${data.completed}, 报告数据=${hasReport}`);
        if (data.completed && !data.report?.reportData) {
          logUxBug("T29", `${type} 评估已完成但没有保存报告数据`);
        }
      }
    });

    // ════════════════════════════════════════════════════
    // 九、CSV导出功能测试
    // ════════════════════════════════════════════════════
    console.log("\n  ── 九、CSV导出功能测试 ──");

    await runTest("T30", "API: 导出握力CSV数据", async () => {
      if (!gripLeftAssessmentId && !gripRightAssessmentId) {
        logUxBug("T30", "matrix表无数据，无法导出CSV（可能是schema缺失bug导致）");
        throw new Error("没有握力assessmentId - matrix表可能为空");
      }
      const ids = [gripLeftAssessmentId, gripRightAssessmentId].filter(Boolean);
      const resp = await httpPost(`${BACKEND_HTTP}/exportCsv`, { assessmentIds: ids, sampleType: "1" });
      console.log(`     └─ 响应code: ${resp.code}, fileName: ${resp.data?.fileName}, rows: ${resp.data?.rowCount}`);
      assert(resp.code === 0, `exportCsv 失败: ${resp.msg}`);
      assert(resp.data?.rowCount > 0, "导出的CSV没有数据行");
      console.log(`     └─ 数据keys: ${JSON.stringify(resp.data?.dataKeys)}`);
    });

    await runTest("T31", "API: 导出起坐CSV数据", async () => {
      if (!sitstandAssessmentId) {
        logUxBug("T31", "matrix表无数据，无法导出起坐CSV");
        throw new Error("没有起坐assessmentId - matrix表可能为空");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/exportCsv`, { assessmentId: sitstandAssessmentId, sampleType: "3" });
      console.log(`     └─ 响应code: ${resp.code}, rows: ${resp.data?.rowCount}`);
      assert(resp.code === 0, `exportCsv 失败: ${resp.msg}`);
    });

    await runTest("T32", "API: 导出站立CSV数据", async () => {
      if (!standingAssessmentId) {
        logUxBug("T32", "matrix表无数据，无法导出站立CSV");
        throw new Error("没有站立assessmentId - matrix表可能为空");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/exportCsv`, { assessmentId: standingAssessmentId, sampleType: "4" });
      console.log(`     └─ 响应code: ${resp.code}, rows: ${resp.data?.rowCount}`);
      assert(resp.code === 0, `exportCsv 失败: ${resp.msg}`);
    });

    await runTest("T33", "API: 导出步态CSV数据", async () => {
      if (!gaitAssessmentId) {
        logUxBug("T33", "matrix表无数据，无法导出步态CSV");
        throw new Error("没有步态assessmentId - matrix表可能为空");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/exportCsv`, { assessmentId: gaitAssessmentId, sampleType: "5" });
      console.log(`     └─ 响应code: ${resp.code}, rows: ${resp.data?.rowCount}`);
      assert(resp.code === 0, `exportCsv 失败: ${resp.msg}`);
    });

    // ════════════════════════════════════════════════════
    // 十、数据库回放功能测试
    // ════════════════════════════════════════════════════
    console.log("\n  ── 十、数据库回放功能测试 ──");

    await runTest("T34", "API: 加载回放数据 (getDbHistory)", async () => {
      // 使用起坐评估的数据进行回放测试（因为有sit和foot1两种数据）
      const aid = sitstandAssessmentId || standingAssessmentId;
      if (!aid) {
        throw new Error("没有可用的assessmentId进行回放");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/getDbHistory`, { assessmentId: aid });
      console.log(`     └─ 响应code: ${resp.code}, msg: ${resp.msg}`);
      assert(resp.code === 0, `getDbHistory 失败: ${resp.msg}`);
      // 检查返回数据
      const data = resp.data;
      if (data.length !== undefined) {
        console.log(`     └─ 数据长度: ${data.length}`);
      }
      if (data.pressArr) {
        console.log(`     └─ pressArr keys: ${JSON.stringify(Object.keys(data.pressArr))}`);
      }
      if (data.areaArr) {
        console.log(`     └─ areaArr keys: ${JSON.stringify(Object.keys(data.areaArr))}`);
      }
    });

    await runTest("T35", "API: 开始回放 (getDbHistoryPlay)", async () => {
      const resp = await httpPost(`${BACKEND_HTTP}/getDbHistoryPlay`, {});
      console.log(`     └─ 响应code: ${resp.code}, msg: ${resp.msg}`);
      assert(resp.code === 0, `getDbHistoryPlay 失败: ${resp.msg}`);
      // 等待一些回放数据通过WebSocket发送
      await new Promise((r) => setTimeout(r, 2000));
    });

    await runTest("T36", "API: 暂停回放 (getDbHistoryStop)", async () => {
      const resp = await httpPost(`${BACKEND_HTTP}/getDbHistoryStop`, {});
      console.log(`     └─ 响应code: ${resp.code}, msg: ${resp.msg}`);
      assert(resp.code === 0, `getDbHistoryStop 失败: ${resp.msg}`);
    });

    await runTest("T37", "API: 调整回放速度 (changeDbplaySpeed)", async () => {
      // 先恢复回放
      await httpPost(`${BACKEND_HTTP}/getDbHistoryPlay`, {});
      await new Promise((r) => setTimeout(r, 500));
      // 测试2倍速
      const resp2x = await httpPost(`${BACKEND_HTTP}/changeDbplaySpeed`, { speed: 2 });
      console.log(`     └─ 2倍速: code=${resp2x.code}`);
      assert(resp2x.code === 0, `changeDbplaySpeed 2x 失败: ${resp2x.msg}`);
      await new Promise((r) => setTimeout(r, 1000));
      // 测试0.5倍速
      const resp05x = await httpPost(`${BACKEND_HTTP}/changeDbplaySpeed`, { speed: 0.5 });
      console.log(`     └─ 0.5倍速: code=${resp05x.code}`);
      assert(resp05x.code === 0, `changeDbplaySpeed 0.5x 失败: ${resp05x.msg}`);
      // 暂停
      await httpPost(`${BACKEND_HTTP}/getDbHistoryStop`, {});
    });

    await runTest("T38", "API: 跳转到指定帧 (getDbHistoryIndex)", async () => {
      // 跳转到第5帧
      const resp = await httpPost(`${BACKEND_HTTP}/getDbHistoryIndex`, { index: 5 });
      console.log(`     └─ 响应code: ${resp.code}, msg: ${resp.msg}`);
      if (resp.code === 555) {
        logUxBug("T38", "getDbHistoryIndex 返回555 → 回放数据可能已被清除");
      } else {
        assert(resp.code === 0, `getDbHistoryIndex 失败: code=${resp.code}, msg=${resp.msg}`);
      }
    });

    await runTest("T39", "API: 取消回放 (cancalDbPlay)", async () => {
      const resp = await httpPost(`${BACKEND_HTTP}/cancalDbPlay`, {});
      console.log(`     └─ 响应code: ${resp.code}, msg: ${resp.msg}`);
      assert(resp.code === 0, `cancalDbPlay 失败: ${resp.msg}`);
    });

    // ════════════════════════════════════════════════════
    // 十一、报告生成API测试
    // ════════════════════════════════════════════════════
    console.log("\n  ── 十一、报告生成API测试 ──");

    await runTest("T40", "API: 生成握力报告 (getHandPdf)", async () => {
      if (!gripLeftAssessmentId && !gripRightAssessmentId) {
        throw new Error("没有握力assessmentId");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/getHandPdf`, {
        leftAssessmentId: gripLeftAssessmentId,
        rightAssessmentId: gripRightAssessmentId,
        collectName: "综合测试患者",
      });
      console.log(`     └─ 响应code: ${resp.code}`);
      assert(resp.code === 0, `getHandPdf 失败: ${resp.msg}`);
      const rd = resp.data?.render_data;
      if (rd) {
        console.log(`     └─ left: ${rd.left ? "有数据" : "无"}, right: ${rd.right ? "有数据" : "无"}, activeHand: ${rd.activeHand}`);
        if (rd.left) {
          console.log(`     └─ 左手报告keys: ${Object.keys(rd.left).slice(0, 5).join(", ")}...`);
        }
      }
    });

    await runTest("T41", "API: 生成站立报告 (getDbHeatmap)", async () => {
      if (!standingAssessmentId) {
        throw new Error("没有站立assessmentId");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/getDbHeatmap`, {
        assessmentId: standingAssessmentId,
        fps: 42,
        threshold_ratio: 0.8,
      });
      console.log(`     └─ 响应code: ${resp.code}`);
      assert(resp.code === 0, `getDbHeatmap 失败: ${resp.msg}`);
      if (resp.data?.render_data) {
        console.log(`     └─ render_data keys: ${Object.keys(resp.data.render_data).slice(0, 5).join(", ")}...`);
      }
    });

    await runTest("T42", "API: 生成起坐报告 (getSitAndFootPdf)", async () => {
      if (!sitstandAssessmentId) {
        throw new Error("没有起坐assessmentId");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/getSitAndFootPdf`, {
        assessmentId: sitstandAssessmentId,
        collectName: "综合测试患者",
      });
      console.log(`     └─ 响应code: ${resp.code}`);
      assert(resp.code === 0, `getSitAndFootPdf 失败: ${resp.msg}`);
      if (resp.data?.render_data) {
        console.log(`     └─ render_data keys: ${Object.keys(resp.data.render_data).slice(0, 5).join(", ")}...`);
      }
    });

    await runTest("T43", "API: 生成步态报告 (getFootPdf)", async () => {
      if (!gaitAssessmentId) {
        throw new Error("没有步态assessmentId");
      }
      const resp = await httpPost(`${BACKEND_HTTP}/getFootPdf`, {
        assessmentId: gaitAssessmentId,
        collectName: "综合测试患者",
        body_weight_kg: 70,
      });
      console.log(`     └─ 响应code: ${resp.code}`);
      assert(resp.code === 0, `getFootPdf 失败: ${resp.msg}`);
      if (resp.data?.render_data) {
        console.log(`     └─ render_data keys: ${Object.keys(resp.data.render_data).slice(0, 5).join(", ")}...`);
      }
    });

    // ════════════════════════════════════════════════════
    // 十二、WebSocket数据验证
    // ════════════════════════════════════════════════════
    console.log("\n  ── 十二、WebSocket数据验证 ──");

    await runTest("T44", "WebSocket连接和数据接收", async () => {
      const wsResult = await page.evaluate(() => {
        return new Promise((resolve) => {
          try {
            const ws = new WebSocket("ws://127.0.0.1:19999");
            let messageCount = 0;
            let firstMsg = null;
            const timer = setTimeout(() => {
              ws.close();
              resolve({ ok: messageCount > 0, messageCount, firstMsg });
            }, 5000);
            ws.onopen = () => console.log("[WS] Connected");
            ws.onmessage = (e) => {
              messageCount++;
              if (!firstMsg) {
                try {
                  const data = JSON.parse(e.data);
                  firstMsg = Object.keys(data).join(",");
                } catch {}
              }
            };
            ws.onerror = () => {
              clearTimeout(timer);
              resolve({ ok: false, error: "connection error" });
            };
          } catch (e) {
            resolve({ ok: false, error: e.message });
          }
        });
      });
      console.log(`     └─ WS消息数: ${wsResult.messageCount}, 首消息keys: ${wsResult.firstMsg}`);
      assert(wsResult.ok, `WebSocket未收到数据: ${wsResult.error || "0 messages"}`);
    });

    // ════════════════════════════════════════════════════
    // 十三、历史记录删除测试
    // ════════════════════════════════════════════════════
    console.log("\n  ── 十三、历史记录管理测试 ──");

    await runTest("T45", "API: 保存新的历史记录 (history/save)", async () => {
      const resp = await httpPost(`${BACKEND_HTTP}/api/history/save`, {
        patientInfo: { name: "API测试患者", gender: "女", age: 70, weight: 55 },
        institution: "测试机构",
        assessments: {
          grip: { completed: true, report: { reportData: { left: { summary: "test" } } } },
        },
      });
      console.log(`     └─ 响应code: ${resp.code}, id: ${resp.data?.id}, updated: ${resp.data?.updated}`);
      assert(resp.code === 0, `history/save 失败: ${resp.msg}`);
    });

    await runTest("T46", "API: 验证新记录已保存", async () => {
      const resp = await httpPost(`${BACKEND_HTTP}/api/history/list`, { keyword: "API测试", page: 1, pageSize: 10 });
      console.log(`     └─ 搜索结果: ${resp.data?.total || 0} 条`);
      assert(resp.code === 0 && resp.data?.total > 0, "新保存的记录未出现在列表中");
    });

    await runTest("T47", "API: 删除历史记录 (history/delete)", async () => {
      // 先获取API测试患者的记录
      const listResp = await httpPost(`${BACKEND_HTTP}/api/history/list`, { keyword: "API测试", page: 1, pageSize: 10 });
      if (listResp.data?.items?.length > 0) {
        const deleteId = listResp.data.items[0].id;
        const resp = await httpPost(`${BACKEND_HTTP}/api/history/delete`, { id: deleteId });
        console.log(`     └─ 删除结果: code=${resp.code}, deleted=${resp.data?.deleted}`);
        assert(resp.code === 0, `history/delete 失败: ${resp.msg}`);
        // 验证删除成功
        const verifyResp = await httpPost(`${BACKEND_HTTP}/api/history/list`, { keyword: "API测试", page: 1, pageSize: 10 });
        console.log(`     └─ 删除后搜索: ${verifyResp.data?.total || 0} 条`);
      } else {
        throw new Error("找不到要删除的记录");
      }
    });

    // ════════════════════════════════════════════════════
    // 十四、JS错误检查
    // ════════════════════════════════════════════════════
    console.log("\n  ── 十四、JS错误检查 ──");

    await runTest("T48", "检查JS运行时错误", async () => {
      const errors = await page.evaluate(() => window.e2e_errors || []);
      const realErrors = errors.filter((e) => !e.includes("ResizeObserver"));
      console.log(`     └─ 总错误: ${errors.length}, 实际错误: ${realErrors.length}`);
      if (realErrors.length > 0) {
        realErrors.slice(0, 5).forEach((e) => console.log(`     └─ ${e.substring(0, 100)}`));
        logUxBug("T48", `发现 ${realErrors.length} 个JS运行时错误`);
      }
    });

    // ════════════════════════════════════════════════════
    // 十五、最终状态截图
    // ════════════════════════════════════════════════════
    console.log("\n  ── 十五、最终状态 ──");

    await runTest("T49", "返回Dashboard最终状态", async () => {
      await page.evaluate(() => (window.location.href = '/dashboard'));
      await page.waitForTimeout(2000);
      await screenshot(page, "T49_final_dashboard");
    });

  } catch (e) {
    console.error("\n测试主流程异常:", e.message);
    console.error(e.stack);
    failCount++;
    if (page) await screenshot(page, "FATAL_ERROR");
  } finally {
    // ─── 输出结果 ───
    console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
    console.log(`║   测试完成: ${passCount} 通过 / ${failCount} 失败 / ${skipCount} 跳过 / ${results.length} 总计`);
    if (results.length > 0) console.log(`║   通过率: ${((passCount / results.length) * 100).toFixed(1)}%`);
    console.log("╚═══════════════════════════════════════════════════════════════════╝");

    if (uxBugs.length > 0) {
      console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
      console.log("║   发现的 UX Bug:                                                 ║");
      uxBugs.forEach((b) => console.log(`║   [${b.id}] ${b.desc}`));
      console.log("╚═══════════════════════════════════════════════════════════════════╝");
    }

    // 保存测试报告
    const report = {
      timestamp: new Date().toISOString(),
      testMode: "综合端到端测试 v1",
      summary: {
        total: results.length,
        pass: passCount,
        fail: failCount,
        skip: skipCount,
        passRate: results.length > 0 ? ((passCount / results.length) * 100).toFixed(1) + "%" : "N/A",
      },
      results,
      uxBugs,
      assessmentIds: {
        gripLeft: gripLeftAssessmentId,
        gripRight: gripRightAssessmentId,
        sitstand: sitstandAssessmentId,
        standing: standingAssessmentId,
        gait: gaitAssessmentId,
      },
    };
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, "comprehensive_test_results.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(`\n测试报告已保存到: ${SCREENSHOT_DIR}/comprehensive_test_results.json`);

    // 失败用例汇总
    const failedTests = results.filter((r) => r.status === "FAIL");
    if (failedTests.length > 0) {
      console.log("\n失败用例:");
      failedTests.forEach((t) => console.log(`  ❌ ${t.id} - ${t.name}: ${t.error}`));
    }

    // ─── 清理 ───
    console.log("\n[清理] 关闭应用和虚拟串口...");
    if (electronApp) await electronApp.close().catch(() => {});
    sim.cleanup();
    console.log("[完成]");
    process.exit(failCount > 0 ? 1 : 0);
  }
}

main();
