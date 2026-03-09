/**
 * 串口模拟 + 完整评估流程 端到端测试 v3
 * 
 * 修复:
 * - 遵循正确用户流程: 先连接设备，再评估
 * - 修复 API 路径 (加 /api/ 前缀)
 * - 修复 history/save 请求体格式
 * - 增加完整的历史记录 CRUD 测试
 * - 增加 Dashboard 连接状态反馈验证
 * - 增加评估页面设备状态验证
 */
const { SerialSimulator, parseHexDataToFrames } = require("./serial_simulator");
const { _electron: electron } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

// ─── 配置 ───
const BACKEND_PORT = 19245;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const API_URL = `${BACKEND_URL}/api`;
const SCREENSHOT_DIR = path.join(__dirname, "screenshots_serial_v3");
const ELECTRON_PATH = path.join(__dirname, "../back-end/code/node_modules/.bin/electron");
const APP_ENTRY = path.join(__dirname, "../back-end/code/index.js");

// ─── 工具函数 ───
function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${url}`)), timeoutMs);
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    }).on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function httpPost(url, body, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${url}`)), timeoutMs);
    const postData = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.write(postData);
    req.end();
  });
}

async function waitForBackend(maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await httpGet(`${BACKEND_URL}/`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

async function screenshot(page, name) {
  const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_");
  try {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${safeName}.png`) });
  } catch (e) {
    console.log(`     [截图失败] ${name}: ${e.message}`);
  }
}

// ─── 测试结果收集 ───
const results = [];
let passCount = 0,
  failCount = 0;

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

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

async function navigateTo(page, route) {
  await page.evaluate((r) => {
    window.history.pushState({}, "", r);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, route);
  await page.waitForTimeout(1000);
}

// ─── 主测试 ───
async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║   串口模拟 + 完整评估流程 端到端测试 v3 (正确流程)         ║");
  console.log("║   设备: 左手(921600) 右手(921600) 坐垫(1000000)             ║");
  console.log("║   增强: 正确流程、API修复、历史记录CRUD、UI状态验证         ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");

  const sim = new SerialSimulator();
  let electronApp, page;

  try {
    // ─── 阶段1: 创建虚拟串口 ───
    console.log("\n[阶段1] 创建虚拟串口对...");
    const deviceNames = ["leftHand", "rightHand", "seat"];
    await sim.init(deviceNames);
    const envVars = sim.getEnvVars(deviceNames);

    // ─── 阶段2: 加载传感器数据 ───
    console.log("\n[阶段2] 加载传感器数据...");
    const leftFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, "../upload_data/left_hand.bin"), "utf-8")).filter((f) => [18, 130, 146].includes(f.length));
    const rightFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, "../upload_data/right_hand.bin"), "utf-8")).filter((f) => [18, 130, 146].includes(f.length));
    const seatFrames = parseHexDataToFrames(fs.readFileSync(path.join(__dirname, "../upload_data/seat.bin"), "utf-8")).filter((f) => f.length === 1024);
    console.log(`  左手: ${leftFrames.length} 帧, 右手: ${rightFrames.length} 帧, 坐垫: ${seatFrames.length} 帧`);

    // ─── 阶段3: 启动 Electron ───
    console.log("\n[阶段3] 启动 Electron 应用 (DevTools 关闭)...");
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
    console.log("  Electron 进程已创建");
    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    console.log("  主窗口已获取");
    const backendReady = await waitForBackend();
    assert(backendReady, "后端服务未能在 15 秒内启动");
    console.log("  后端 API 已就绪");
    await page.waitForTimeout(3000);
    console.log("  前端页面已加载");

    // ─── 阶段4: 执行测试用例 ───
    console.log("\n[阶段4] 执行测试用例...\n");
    console.log("  ── 一、登录与设备连接 (正确流程) ──");

    await runTest("T01", "登录系统", async () => {
      await page.locator("input").first().fill("123456");
      await page.locator("button:has-text(\"进入系统\")").click();
      await page.waitForURL("**/dashboard");
      await screenshot(page, "T01_dashboard");
    });

    await runTest("T02", "启动串口模拟器", async () => {
      sim.startSending("leftHand", leftFrames, 80);
      sim.startSending("rightHand", rightFrames, 80);
      sim.startSending("seat", seatFrames, 80);
      await new Promise((r) => setTimeout(r, 500));
    });

    await runTest("T03", "一键连接设备", async () => {
      await page.locator("button:has-text(\"一键连接\")").click();
      await page.waitForSelector("button:has-text(\"已连接\")", { timeout: 15000 });
      await screenshot(page, "T03_after_connect");
    });

    await runTest("T04", "验证 Dashboard 连接状态反馈", async () => {
      const connectedButton = await page.$("button:has-text(\"已连接\")");
      assert(connectedButton, "未找到‘已连接’按钮");
      const onlineIndicator = await page.$("text=/7");
      assert(onlineIndicator, "未找到设备在线状态指示器");
      const onlineText = await onlineIndicator.innerText();
      console.log(`     └─ 在线状态: ${onlineText}`);
      assert(onlineText.startsWith("3"), `应有3个设备在线，实际: ${onlineText}`);
    });

    console.log("\n  ── 二、评估流程 (连接后) ──");

    await runTest("T05", "进入握力评估页面并验证设备状态", async () => {
      await navigateTo(page, "/assessment/grip");
      await page.waitForTimeout(2000);
      await screenshot(page, "T05_grip_page_connected");
      const leftGlove = await page.locator("text=左手套").locator("text=已连接");
      const rightGlove = await page.locator("text=右手套").locator("text=已连接");
      assert(await leftGlove.isVisible(), "左手套未显示已连接");
      assert(await rightGlove.isVisible(), "右手套未显示已连接");
    });

    await runTest("T06", "执行握力评估采集", async () => {
      await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 11 });
      await httpPost(`${BACKEND_URL}/startCol`, { assessmentId: "grip_left_v3", sampleType: "1", colName: "握力-左", fileName: "v3" });
      await new Promise((r) => setTimeout(r, 2000));
      await httpGet(`${BACKEND_URL}/endCol`);
      await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 12 });
      await httpPost(`${BACKEND_URL}/startCol`, { assessmentId: "grip_right_v3", sampleType: "1", colName: "握力-右", fileName: "v3" });
      await new Promise((r) => setTimeout(r, 2000));
      await httpGet(`${BACKEND_URL}/endCol`);
      await screenshot(page, "T06_grip_collection_done");
    });

    await runTest("T07", "进入起坐评估页面并验证设备状态", async () => {
      await navigateTo(page, "/assessment/sitstand");
      await page.waitForTimeout(2000);
      await screenshot(page, "T07_sitstand_page_connected");
      const seat = await page.locator("text=坐垫").locator("text=已连接");
      assert(await seat.isVisible(), "坐垫未显示已连接");
    });

    await runTest("T08", "执行起坐评估采集", async () => {
      await httpPost(`${BACKEND_URL}/setActiveMode`, { mode: 3 });
      await httpPost(`${BACKEND_URL}/startCol`, { assessmentId: "sitstand_v3", sampleType: "3", colName: "起坐", fileName: "v3" });
      await new Promise((r) => setTimeout(r, 2000));
      await httpGet(`${BACKEND_URL}/endCol`);
      await screenshot(page, "T08_sitstand_collection_done");
    });

    console.log("\n  ── 三、历史记录与报告 (CRUD) ──");
    let historyId = null;

    await runTest("T09", "[C] 创建一条完整的评估历史", async () => {
      const historyData = {
        patientInfo: { name: "V3-测试患者", age: 75, gender: "女" },
        institution: "V3-测试机构",
        assessments: {
          grip: { completed: true, report: { leftMax: 20, rightMax: 22, level: "正常" } },
          sitstand: { completed: true, report: { count: 10, duration: 30, level: "较弱" } },
          standing: { completed: true, report: { swayArea: 20, level: "正常" } },
          gait: { completed: true, report: { speed: 1.2, level: "正常" } },
        },
      };
      const resp = await httpPost(`${API_URL}/history/save`, historyData);
      assert(resp.code === 0 && resp.data.id, `创建历史失败: ${JSON.stringify(resp)}`);
      historyId = resp.data.id;
      console.log(`     └─ 创建成功, ID: ${historyId}`);
    });

    await runTest("T10", "[R] 导航到历史记录页面并验证列表", async () => {
      await navigateTo(page, "/history");
      await page.waitForTimeout(3000);
      await screenshot(page, "T10_history_page_with_data");
      const record = await page.locator(`text=V3-测试患者`);
      assert(await record.isVisible(), "未在列表中找到新创建的记录");
    });

    await runTest("T11", "[R] 展开历史详情并验证完整性", async () => {
      await page.locator(`text=V3-测试患者`).click();
      await page.waitForTimeout(1000);
      await screenshot(page, "T11_history_detail_expanded");
      const grip = await page.locator("text=握力").locator("text=已完成");
      const sitstand = await page.locator("text=起坐").locator("text=已完成");
      const standing = await page.locator("text=站立").locator("text=已完成");
      const gait = await page.locator("text=步态").locator("text=已完成");
      assert(await grip.isVisible() && await sitstand.isVisible() && await standing.isVisible() && await gait.isVisible(), "展开的详情不完整");
    });

    await runTest("T12", "[R] 查看历史报告", async () => {
      await page.locator("button:has-text(\"查看报告\")").first().click();
      await page.waitForURL("**/history/report**");
      await page.waitForTimeout(2000);
      await screenshot(page, "T12_history_report_view");
      const title = await page.locator("text=综合评估报告");
      assert(await title.isVisible(), "报告页面标题不正确");
      const gripReport = await page.locator("text=握力评估报告");
      assert(await gripReport.isVisible(), "未找到握力报告部分");
    });

    await runTest("T13", "[U] 更新评估历史 (增加一条)", async () => {
      const historyData = {
        patientInfo: { name: "V3-测试患者", age: 75, gender: "女" },
        assessments: {
          grip: { completed: true, report: { leftMax: 21, rightMax: 23, level: "优秀" } },
        },
      };
      const resp = await httpPost(`${API_URL}/history/save`, historyData);
      assert(resp.code === 0 && resp.data.updated === true, `更新历史失败: ${JSON.stringify(resp)}`);
      console.log(`     └─ 更新成功, ID: ${resp.data.id}`);
    });

    await runTest("T14", "[D] 删除评估历史", async () => {
      await navigateTo(page, "/history");
      await page.waitForTimeout(2000);
      await page.locator(`button:has-text(\"删除\")`).first().click();
      await page.waitForTimeout(500);
      // 处理确认对话框
      page.on("dialog", (dialog) => dialog.accept());
      await page.locator("button:has-text(\"确认\")").click();
      await page.waitForTimeout(2000);
      await screenshot(page, "T14_after_delete");
      const record = await page.locator(`text=V3-测试患者`);
      assert((await record.count()) === 0, "记录未被删除");
    });

    console.log("\n  ── 四、用户体验 Bug 验证 ──");

    await runTest("T15", "[UX Bug] 验证连接后 Dashboard 状态反馈", async () => {
      await navigateTo(page, "/dashboard");
      await page.waitForTimeout(1000);
      const button = await page.locator("button:has-text(\"已连接\")");
      const rect = await button.boundingBox();
      console.log(`     └─ “已连接”按钮位置: x=${rect.x.toFixed(0)}, y=${rect.y.toFixed(0)}`);
      await screenshot(page, "T15_dashboard_connected_feedback");
      assert(rect.x > 0, "按钮不可见");
    });

  } catch (e) {
    console.error("测试主流程异常:", e);
    failCount++;
  } finally {
    // ─── 阶段5: 输出结果 ───
    console.log("\n╔═══════════════════════════════════════════════════════════════╗");
    console.log(`║   测试完成: ${passCount} 通过 / ${failCount} 失败 / ${results.length} 总计`);
    if (results.length > 0) {
      console.log(`║   通过率: ${(passCount / results.length * 100).toFixed(1)}%`);
    }
    console.log("╚═══════════════════════════════════════════════════════════════╝");

    const report = {
      timestamp: new Date().toISOString(),
      summary: { total: results.length, pass: passCount, fail: failCount, passRate: results.length > 0 ? (passCount / results.length * 100).toFixed(1) + "%" : "N/A" },
      results,
    };
    fs.writeFileSync(path.join(SCREENSHOT_DIR, "serial_test_results_v3.json"), JSON.stringify(report, null, 2));
    console.log(`\n测试报告已保存到: ${SCREENSHOT_DIR}/serial_test_results_v3.json`);

    // ─── 清理 ───
    console.log("\n[清理] 关闭应用和虚拟串口...");
    if (electronApp) await electronApp.close().catch(() => {});
    sim.cleanup();
    console.log("[完成]");
    process.exit(failCount > 0 ? 1 : 0);
  }
}

main();
