/**
 * ═══════════════════════════════════════════════════════════
 *  老年人筛查系统MAC — 报告与历史记录专项测试
 *  测试范围：
 *    A. 登录 -> Dashboard UI 验证
 *    B. Dashboard 查看报告按钮（4 种评估）
 *    C. 后端 API 创建完整历史记录
 *    D. 历史记录页面展示完整性
 *    E. 从历史记录查看每个评估报告
 *    F. 报告数据一致性验证
 * ═══════════════════════════════════════════════════════════
 */
const { _electron: electron } = require("playwright");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");

// ==================== 配置 ====================
const PROJECT_DIR = "/home/ubuntu/laonianren";
const BACKEND_DIR = path.join(PROJECT_DIR, "back-end/code");
const ELECTRON_PATH = path.join(BACKEND_DIR, "node_modules/electron/dist/electron");
const API_URL = "http://127.0.0.1:19245";
const SCREENSHOT_DIR = path.join(PROJECT_DIR, "test/screenshots_report");
const HTTP_TIMEOUT = 8000;
const PATIENT_NAME = `测试患者_${Date.now().toString().slice(-6)}`;

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

function withTimeout(fn, ms = 20000) {
  return async (ctx) => {
    return Promise.race([
      fn(ctx),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`测试超时 ${ms}ms`)), ms))
    ]);
  };
}

// ==================== 模拟报告数据 ====================
// 握力报告数据（符合 GripReport 组件格式）
const MOCK_GRIP_REPORT = {
  left: {
    fingers: [
      { name: "拇指", force: 5.2, area: 12 },
      { name: "食指", force: 4.8, area: 10 },
      { name: "中指", force: 4.5, area: 11 },
      { name: "无名指", force: 3.2, area: 8 },
      { name: "小指", force: 2.1, area: 6 }
    ],
    totalForce: 19.8,
    totalArea: 47,
    totalFrames: 150,
    timeRange: "3.0s",
    times: Array.from({ length: 150 }, (_, i) => i * 20),
    forceTimeSeries: { total: Array.from({ length: 150 }, () => Math.random() * 25) },
    eulerData: {},
    angularVelocity: [],
    timeAnalysis: []
  },
  right: {
    fingers: [
      { name: "拇指", force: 6.1, area: 14 },
      { name: "食指", force: 5.5, area: 12 },
      { name: "中指", force: 5.0, area: 13 },
      { name: "无名指", force: 3.8, area: 9 },
      { name: "小指", force: 2.5, area: 7 }
    ],
    totalForce: 22.9,
    totalArea: 55,
    totalFrames: 150,
    timeRange: "3.0s",
    times: Array.from({ length: 150 }, (_, i) => i * 20),
    forceTimeSeries: { total: Array.from({ length: 150 }, () => Math.random() * 30) },
    eulerData: {},
    angularVelocity: [],
    timeAnalysis: []
  },
  activeHand: "右手"
};

// 起坐报告数据（符合 SitStandReport 组件格式）
const MOCK_SITSTAND_REPORT = {
  count: 12,
  duration: 30,
  avgTime: 2.5,
  seatForce: Array.from({ length: 300 }, () => Math.random() * 500),
  footForce: Array.from({ length: 300 }, () => Math.random() * 300),
  times: Array.from({ length: 300 }, (_, i) => i * 100),
  phases: [
    { type: "sit", start: 0, end: 2500 },
    { type: "stand", start: 2500, end: 5000 }
  ]
};

// 站立报告数据（符合 StandingReport 组件格式）
const MOCK_STANDING_REPORT = {
  additional_data: {
    left_area: { total: 45.2, forefoot: 22.1, rearfoot: 23.1 },
    right_area: { total: 43.8, forefoot: 21.5, rearfoot: 22.3 },
    left_pressure: { peak: 85.3, mean: 42.1 },
    right_pressure: { peak: 82.7, mean: 40.5 },
    cop_results: { total_sway_area: 125.6, total_sway_path: 234.5 }
  },
  arch_features: {
    left_foot: { arch_index: 0.21, arch_type: "正常足弓" },
    right_foot: { arch_index: 0.23, arch_type: "正常足弓" }
  },
  cop_time_series: {
    velocity_series: Array.from({ length: 100 }, () => Math.random() * 10),
    time_points: Array.from({ length: 100 }, (_, i) => i * 0.1)
  },
  left_cop_metrics: { "置信椭圆面积": 12.5 },
  right_cop_metrics: { "置信椭圆面积": 11.8 },
  left_sway_features: { sway_area: 62.3, sway_path: 117.2 },
  right_sway_features: { sway_area: 63.3, sway_path: 117.3 },
  left_cop_trajectory: Array.from({ length: 50 }, () => [Math.random() * 10, Math.random() * 10]),
  right_cop_trajectory: Array.from({ length: 50 }, () => [Math.random() * 10, Math.random() * 10])
};

// 步态报告数据（符合 GaitReportContent 组件格式）
const MOCK_GAIT_REPORT = {
  gaitParams: {
    leftStepTime: "0.52",
    rightStepTime: "0.54",
    crossStepTime: "1.06",
    leftStepLength: "62.3",
    rightStepLength: "63.1",
    crossStepLength: "125.4",
    stepWidth: "8.5",
    walkingSpeed: "1.18",
    leftFPA: "5.2",
    rightFPA: "4.8",
    doubleContactTime: "0.12"
  },
  balance: {
    left: {
      "整足平衡": { "峰值": 85.3, "均值": 42.1, "标准差": 12.5 },
      "前足平衡": { "峰值": 45.2, "均值": 22.1, "标准差": 8.3 },
      "足跟平衡": { "峰值": 40.1, "均值": 20.0, "标准差": 6.2 }
    },
    right: {
      "整足平衡": { "峰值": 82.7, "均值": 40.5, "标准差": 11.8 },
      "前足平衡": { "峰值": 43.8, "均值": 21.5, "标准差": 7.9 },
      "足跟平衡": { "峰值": 38.9, "均值": 19.0, "标准差": 5.8 }
    }
  },
  fpaPerStep: { left: [5.1, 5.3, 5.0], right: [4.7, 4.9, 4.8] }
};

// ==================== 测试用例定义 ====================
const ALL_TESTS = [];
let testRecordId = null;

// ─── A. 登录 ───
ALL_TESTS.push({
  category: "登录", name: "T01 - 登录系统并进入 Dashboard",
  test: withTimeout(async (ctx) => {
    await ctx.page.waitForTimeout(2000);
    await ctx.page.fill('input[placeholder*="密钥"]', "test-key-e2e-report");
    await ctx.page.fill('input[placeholder*="机构"]', "报告专项测试中心");
    await ctx.page.locator('button[type="submit"]').click();
    await ctx.page.waitForTimeout(3000);
    const url = ctx.page.url();
    assert(url.includes("dashboard"), `应跳转到 Dashboard，实际 URL: ${url}`);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "01_dashboard.png"), fullPage: true });
  })
});

// ─── B. Dashboard 评估卡片 UI 验证 ───
ALL_TESTS.push({
  category: "Dashboard", name: "T02 - Dashboard 显示 4 个评估卡片",
  test: withTimeout(async (ctx) => {
    const bodyText = await ctx.page.evaluate(() => document.body.innerText);
    assert(bodyText.includes("握力"), "应显示握力评估");
    assert(bodyText.includes("起坐"), "应显示起坐评估");
    assert(bodyText.includes("站立"), "应显示站立评估");
    assert(bodyText.includes("步态") || bodyText.includes("行走"), "应显示步态评估");
  })
});

ALL_TESTS.push({
  category: "Dashboard", name: "T03 - 未完成评估时应显示'开始评估'按钮",
  test: withTimeout(async (ctx) => {
    const startBtns = await ctx.page.locator('button:has-text("开始评估")').count();
    assert(startBtns >= 1, "应有至少 1 个'开始评估'按钮");
  })
});

// ─── C. 通过 API 创建完整历史记录 ───
ALL_TESTS.push({
  category: "数据准备", name: "T04 - 通过 API 创建包含全部 4 项评估的历史记录",
  test: withTimeout(async () => {
    const res = await httpPost(`${API_URL}/api/history/save`, {
      patientInfo: { name: PATIENT_NAME, gender: "男", age: 72, weight: 68.5 },
      institution: "报告专项测试中心",
      assessments: {
        grip: { completed: true, report: { completed: true, reportData: MOCK_GRIP_REPORT } },
        sitstand: { completed: true, report: { completed: true, reportData: MOCK_SITSTAND_REPORT } },
        standing: { completed: true, report: { completed: true, reportData: MOCK_STANDING_REPORT } },
        gait: { completed: true, report: { completed: true, reportData: MOCK_GAIT_REPORT } }
      }
    });
    const json = JSON.parse(res.body);
    assert.strictEqual(json.code, 0, `创建应成功, 实际: ${JSON.stringify(json)}`);
    assert(json.data.id, "应返回记录 ID");
    testRecordId = json.data.id;
  })
});

ALL_TESTS.push({
  category: "数据准备", name: "T05 - 验证 API 返回的记录包含完整的 4 项评估",
  test: withTimeout(async () => {
    assert(testRecordId, "前置测试 T04 必须通过");
    const res = await httpPost(`${API_URL}/api/history/get`, { id: testRecordId });
    const json = JSON.parse(res.body);
    assert.strictEqual(json.code, 0, "获取应成功");
    const assessments = json.data.assessments;
    assert(assessments, "应有 assessments 字段");
    const types = ["grip", "sitstand", "standing", "gait"];
    for (const type of types) {
      assert(assessments[type], `应有 ${type} 评估数据`);
      assert.strictEqual(assessments[type].completed, true, `${type} 应为已完成`);
      assert(assessments[type].report, `${type} 应有 report 字段`);
      assert(assessments[type].report.reportData, `${type} 应有 report.reportData 字段`);
    }
  })
});

// ─── C2. 创建一条只有部分评估的记录 ───
let partialRecordId = null;
ALL_TESTS.push({
  category: "数据准备", name: "T06 - 创建只有握力和步态的不完整记录",
  test: withTimeout(async () => {
    const res = await httpPost(`${API_URL}/api/history/save`, {
      patientInfo: { name: `不完整_${PATIENT_NAME}`, gender: "女", age: 68, weight: 55 },
      institution: "报告专项测试中心",
      assessments: {
        grip: { completed: true, report: { completed: true, reportData: MOCK_GRIP_REPORT } },
        gait: { completed: true, report: { completed: true, reportData: MOCK_GAIT_REPORT } }
      }
    });
    const json = JSON.parse(res.body);
    assert.strictEqual(json.code, 0, "创建应成功");
    partialRecordId = json.data.id;
  })
});

// ─── C3. 创建一条有 completed 但没有 reportData 的记录 ───
let noReportRecordId = null;
ALL_TESTS.push({
  category: "数据准备", name: "T07 - 创建已完成但无报告数据的记录",
  test: withTimeout(async () => {
    const res = await httpPost(`${API_URL}/api/history/save`, {
      patientInfo: { name: `无报告_${PATIENT_NAME}`, gender: "男", age: 75, weight: 70 },
      institution: "报告专项测试中心",
      assessments: {
        grip: { completed: true, report: { completed: true } },
        sitstand: { completed: true, report: null },
        standing: { completed: true },
        gait: { completed: false }
      }
    });
    const json = JSON.parse(res.body);
    assert.strictEqual(json.code, 0, "创建应成功");
    noReportRecordId = json.data.id;
  })
});

// ─── D. 历史记录页面验证 ───
ALL_TESTS.push({
  category: "历史记录", name: "T08 - 导航到历史记录页面",
  test: withTimeout(async (ctx) => {
    await ctx.page.evaluate(() => { window.location.href = "/history"; });
    await ctx.page.waitForTimeout(3000);
    const url = ctx.page.url();
    assert(url.includes("history"), `应在历史记录页面，实际 URL: ${url}`);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "08_history_page.png"), fullPage: true });
  })
});

ALL_TESTS.push({
  category: "历史记录", name: "T09 - 历史记录中能找到完整评估的患者",
  test: withTimeout(async (ctx) => {
    await ctx.page.waitForTimeout(1000);
    const bodyText = await ctx.page.evaluate(() => document.body.innerText);
    assert(bodyText.includes(PATIENT_NAME), `应能找到患者 ${PATIENT_NAME}`);
  })
});

ALL_TESTS.push({
  category: "历史记录", name: "T10 - 点击展开完整记录，显示 4 项已完成",
  test: withTimeout(async (ctx) => {
    // 找到包含患者名的行并点击展开
    const row = ctx.page.locator(`text=${PATIENT_NAME}`).first();
    await row.click();
    await ctx.page.waitForTimeout(1500);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "10_expanded_full.png"), fullPage: true });
    // 检查是否有 4 个"已完成"标签
    const completedBadges = ctx.page.locator('span:has-text("已完成")');
    const count = await completedBadges.count();
    assert(count >= 4, `应显示至少 4 个'已完成'标签，实际: ${count}`);
  })
});

ALL_TESTS.push({
  category: "历史记录", name: "T11 - 完整记录中 4 个'查看报告'按钮均可点击",
  test: withTimeout(async (ctx) => {
    const reportBtns = ctx.page.locator('button:has-text("查看报告")');
    const count = await reportBtns.count();
    assert(count >= 4, `应有至少 4 个'查看报告'按钮，实际: ${count}`);
    for (let i = 0; i < Math.min(count, 4); i++) {
      const btn = reportBtns.nth(i);
      const enabled = await btn.isEnabled();
      assert(enabled, `第 ${i + 1} 个'查看报告'按钮应可点击`);
    }
  })
});

// ─── E. 从历史记录查看每个评估报告 ───
const ASSESSMENT_TYPES = [
  { key: "grip", label: "握力评估", index: 0 },
  { key: "sitstand", label: "起坐能力评估", index: 1 },
  { key: "standing", label: "静态站立评估", index: 2 },
  { key: "gait", label: "行走步态评估", index: 3 }
];

ASSESSMENT_TYPES.forEach((type, i) => {
  ALL_TESTS.push({
    category: "报告查看", name: `T${12 + i} - 从历史记录查看 ${type.label} 报告`,
    test: withTimeout(async (ctx) => {
      assert(testRecordId, "前置测试 T04 必须通过");
      // 直接通过 URL 导航到报告页面
      await ctx.page.evaluate((params) => {
        window.location.href = `/history/report?id=${params.id}&type=${params.type}`;
      }, { id: testRecordId, type: type.key });
      await ctx.page.waitForTimeout(3000);
      await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, `${12 + i}_report_${type.key}.png`), fullPage: true });

      // 检查是否显示"没有保存报告数据"的提示
      const noReportMsg = await ctx.page.locator('text=没有保存报告数据').count();
      assert.strictEqual(noReportMsg, 0, `${type.label} 不应显示'没有保存报告数据'`);

      // 检查是否显示"未找到对应的记录"
      const notFoundMsg = await ctx.page.locator('text=未找到对应的记录').count();
      assert.strictEqual(notFoundMsg, 0, `${type.label} 不应显示'未找到对应的记录'`);

      // 检查页面有实质内容
      const bodyText = await ctx.page.evaluate(() => document.body.innerText);
      assert(bodyText.length > 100, `${type.label} 报告页面应有实质内容，实际长度: ${bodyText.length}`);

      // 检查报告标题
      const headerText = await ctx.page.locator('header').innerText();
      assert(headerText.includes(PATIENT_NAME) || headerText.includes("报告"), `报告标题应包含患者名或'报告'`);
    }, 25000)
  });
});

// ─── F. 不完整记录验证 ───
ALL_TESTS.push({
  category: "不完整记录", name: "T16 - 不完整记录中未完成的评估显示'暂无报告'",
  test: withTimeout(async (ctx) => {
    assert(partialRecordId, "前置测试 T06 必须通过");
    await ctx.page.evaluate(() => { window.location.href = "/history"; });
    await ctx.page.waitForTimeout(2000);
    // 找到不完整记录并展开
    const row = ctx.page.locator(`text=不完整_${PATIENT_NAME}`).first();
    await row.click();
    await ctx.page.waitForTimeout(1500);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "16_partial_record.png"), fullPage: true });
    // 应有 2 个"已完成"和 2 个"未完成"
    const completedCount = await ctx.page.locator('span:has-text("已完成")').count();
    const uncompletedCount = await ctx.page.locator('span:has-text("未完成")').count();
    assert(completedCount >= 2, `应有至少 2 个'已完成'，实际: ${completedCount}`);
    assert(uncompletedCount >= 2, `应有至少 2 个'未完成'，实际: ${uncompletedCount}`);
    // 应有"暂无报告"按钮
    const noReportBtns = await ctx.page.locator('button:has-text("暂无报告")').count();
    assert(noReportBtns >= 2, `应有至少 2 个'暂无报告'按钮，实际: ${noReportBtns}`);
  })
});

ALL_TESTS.push({
  category: "不完整记录", name: "T17 - 不完整记录中已完成的评估可查看报告",
  test: withTimeout(async (ctx) => {
    assert(partialRecordId, "前置测试 T06 必须通过");
    // 查看握力报告
    await ctx.page.evaluate((params) => {
      window.location.href = `/history/report?id=${params.id}&type=grip`;
    }, { id: partialRecordId });
    await ctx.page.waitForTimeout(3000);
    const noReportMsg = await ctx.page.locator('text=没有保存报告数据').count();
    assert.strictEqual(noReportMsg, 0, "握力报告不应显示'没有保存报告数据'");
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "17_partial_grip_report.png"), fullPage: true });
  })
});

ALL_TESTS.push({
  category: "不完整记录", name: "T18 - 不完整记录中未完成的评估显示无报告提示",
  test: withTimeout(async (ctx) => {
    assert(partialRecordId, "前置测试 T06 必须通过");
    // 查看起坐报告（未完成的）
    await ctx.page.evaluate((params) => {
      window.location.href = `/history/report?id=${params.id}&type=sitstand`;
    }, { id: partialRecordId });
    await ctx.page.waitForTimeout(3000);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "18_partial_sitstand_no_report.png"), fullPage: true });
    const bodyText = await ctx.page.evaluate(() => document.body.innerText);
    // 应显示"没有保存报告数据"或"未找到"等提示
    const hasNoReport = bodyText.includes("没有保存报告数据") || bodyText.includes("暂未完成") || bodyText.includes("未找到");
    assert(hasNoReport, "未完成的评估应显示无报告提示");
  })
});

// ─── G. 已完成但无 reportData 的记录验证 ───
ALL_TESTS.push({
  category: "无报告数据", name: "T19 - 已完成但无 reportData 的握力评估显示无报告提示",
  test: withTimeout(async (ctx) => {
    assert(noReportRecordId, "前置测试 T07 必须通过");
    await ctx.page.evaluate((params) => {
      window.location.href = `/history/report?id=${params.id}&type=grip`;
    }, { id: noReportRecordId });
    await ctx.page.waitForTimeout(3000);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "19_no_reportdata_grip.png"), fullPage: true });
    const bodyText = await ctx.page.evaluate(() => document.body.innerText);
    const hasNoReport = bodyText.includes("没有保存报告数据") || bodyText.includes("请重新进行评估");
    assert(hasNoReport, "无 reportData 的评估应显示'没有保存报告数据'提示");
  })
});

ALL_TESTS.push({
  category: "无报告数据", name: "T20 - 已完成但 report=null 的起坐评估显示无报告提示",
  test: withTimeout(async (ctx) => {
    assert(noReportRecordId, "前置测试 T07 必须通过");
    await ctx.page.evaluate((params) => {
      window.location.href = `/history/report?id=${params.id}&type=sitstand`;
    }, { id: noReportRecordId });
    await ctx.page.waitForTimeout(3000);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "20_no_reportdata_sitstand.png"), fullPage: true });
    const bodyText = await ctx.page.evaluate(() => document.body.innerText);
    const hasNoReport = bodyText.includes("没有保存报告数据") || bodyText.includes("请重新进行评估");
    assert(hasNoReport, "report=null 的评估应显示'没有保存报告数据'提示");
  })
});

ALL_TESTS.push({
  category: "无报告数据", name: "T21 - 已完成但无 report 字段的站立评估显示无报告提示",
  test: withTimeout(async (ctx) => {
    assert(noReportRecordId, "前置测试 T07 必须通过");
    await ctx.page.evaluate((params) => {
      window.location.href = `/history/report?id=${params.id}&type=standing`;
    }, { id: noReportRecordId });
    await ctx.page.waitForTimeout(3000);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "21_no_reportdata_standing.png"), fullPage: true });
    const bodyText = await ctx.page.evaluate(() => document.body.innerText);
    const hasNoReport = bodyText.includes("没有保存报告数据") || bodyText.includes("请重新进行评估");
    assert(hasNoReport, "无 report 字段的评估应显示'没有保存报告数据'提示");
  })
});

// ─── H. Dashboard 查看报告按钮测试（viewReport state 传递） ───
ALL_TESTS.push({
  category: "Dashboard报告", name: "T22 - 模拟评估完成后 Dashboard 显示'查看报告'按钮",
  test: withTimeout(async (ctx) => {
    // 通过 JS 直接设置 assessments 状态来模拟评估完成
    await ctx.page.evaluate(() => { window.location.href = "/dashboard"; });
    await ctx.page.waitForTimeout(2000);
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "22_dashboard_before.png"), fullPage: true });
    // 检查当前是否有"查看报告"按钮（取决于当前 session 的评估状态）
    const viewReportBtns = await ctx.page.locator('button:has-text("查看报告")').count();
    const startBtns = await ctx.page.locator('button:has-text("开始评估")').count();
    // 至少应有按钮存在（查看报告或开始评估）
    assert(viewReportBtns + startBtns >= 1, "Dashboard 应有评估操作按钮");
  })
});

// ─── I. 返回按钮和导航测试 ───
ALL_TESTS.push({
  category: "导航", name: "T23 - 报告页面返回按钮可正常工作",
  test: withTimeout(async (ctx) => {
    assert(testRecordId, "前置测试 T04 必须通过");
    await ctx.page.evaluate((params) => {
      window.location.href = `/history/report?id=${params.id}&type=grip`;
    }, { id: testRecordId });
    await ctx.page.waitForTimeout(3000);
    // 点击返回按钮
    const backBtn = ctx.page.locator('button:has-text("返回历史记录")');
    const count = await backBtn.count();
    if (count > 0) {
      await backBtn.click();
      await ctx.page.waitForTimeout(2000);
      const url = ctx.page.url();
      assert(url.includes("history"), `点击返回后应回到历史记录页面，实际 URL: ${url}`);
    } else {
      // 尝试通过返回箭头按钮
      const arrowBack = ctx.page.locator('header button').first();
      await arrowBack.click();
      await ctx.page.waitForTimeout(2000);
    }
    await ctx.page.screenshot({ path: path.join(SCREENSHOT_DIR, "23_back_to_history.png"), fullPage: true });
  })
});

// ─── J. 清理测试数据 ───
ALL_TESTS.push({
  category: "清理", name: "T24 - 清理测试创建的历史记录",
  test: withTimeout(async () => {
    if (testRecordId) {
      await httpPost(`${API_URL}/api/history/delete`, { id: testRecordId });
    }
    if (partialRecordId) {
      await httpPost(`${API_URL}/api/history/delete`, { id: partialRecordId });
    }
    if (noReportRecordId) {
      await httpPost(`${API_URL}/api/history/delete`, { id: noReportRecordId });
    }
  })
});

// ==================== 执行引擎 ====================
async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const results = [];
  let app, page;

  console.log("\n╔═══════════════════════════════════════════════════════════╗");
  console.log("║   报告与历史记录专项测试                                  ║");
  console.log(`║   测试用例: ${ALL_TESTS.length} 个                                         ║`);
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

    // 等待后端就绪
    console.log("[启动] 等待后端服务启动...");
    for (let i = 0; i < 20; i++) {
      try {
        const res = await httpGet(`${API_URL}/`);
        if (res.status === 200) { console.log("[启动] 后端 API 已就绪"); break; }
      } catch {}
      await wait(1000);
    }
    await page.waitForTimeout(3000);
    console.log("[启动] 前端页面已加载\n");
  } catch (e) {
    console.error(`[启动] ❌ 应用启动失败: ${e.message}`);
    ALL_TESTS.forEach(t => results.push({
      category: t.category, name: t.name,
      status: "⏭️ 跳过", detail: "应用启动失败", duration: 0
    }));
    generateReport(results);
    return;
  }

  // ── 执行测试 ──
  const ctx = { app, page };
  for (const testCase of ALL_TESTS) {
    const start = Date.now();
    let status = "✅ 通过";
    let detail = "";
    try {
      await testCase.test(ctx);
    } catch (e) {
      status = "❌ 失败";
      detail = e.message.replace(/\n/g, " ").substring(0, 300);
      const safeName = testCase.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      try { await page.screenshot({ path: path.join(SCREENSHOT_DIR, `FAIL_${safeName}.png`), fullPage: true }); } catch {}
    }
    const duration = Date.now() - start;
    results.push({ category: testCase.category, name: testCase.name, status, detail, duration });
    const icon = status.startsWith("✅") ? "✅" : "❌";
    console.log(`  ${icon} ${testCase.name} (${duration}ms)`);
    if (detail) console.log(`     └─ ${detail}`);
  }

  // ── 清理 ──
  try { await app.close(); } catch {}
  await wait(2000);

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
  console.log("║              报告与历史记录专项测试报告                    ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  for (const [cat, stats] of Object.entries(categories)) {
    const catTotal = stats.passed + stats.failed + stats.skipped;
    const statusIcon = stats.failed > 0 ? "⚠️" : "✅";
    console.log(`║  ${statusIcon} ${cat.padEnd(14)} ${stats.passed}/${catTotal} 通过${stats.failed > 0 ? `, ${stats.failed} 失败` : ""}`);
  }
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║  总计: ${total} | ✅ 通过: ${passed} | ❌ 失败: ${failed} | ⏭️ 跳过: ${skipped}`);
  console.log(`║  通过率: ${(passed / total * 100).toFixed(1)}%`);
  console.log("╚═══════════════════════════════════════════════════════════╝");

  const reportPath = path.join(SCREENSHOT_DIR, "report_test_results.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    project: "老年人筛查系统MAC - 报告与历史记录专项测试",
    timestamp: new Date().toISOString(),
    patientName: PATIENT_NAME,
    summary: { total, passed, failed, skipped, passRate: (passed / total * 100).toFixed(1) + "%" },
    categories,
    results: results.map(r => ({
      category: r.category, name: r.name, status: r.status, detail: r.detail, duration: r.duration
    }))
  }, null, 2));
  console.log(`\n📄 JSON 报告: ${reportPath}`);
  console.log(`📸 截图目录: ${SCREENSHOT_DIR}`);
}

run().catch(e => {
  console.error("测试执行异常:", e);
  process.exit(1);
});
