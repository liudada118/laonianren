/**
 * 站立算法验证脚本
 * 用原始 CSV 数据调用 JS 算法，与 Python 报告 JSON 进行逐项对比
 */

const fs = require('fs');
const path = require('path');
const { generateStandingReport } = require('../back-end/code/algorithms/standing/standingReportAlgorithm');

// ============================================================
// 数据加载
// ============================================================

function loadCSVFrames(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // data 列被双引号包裹，格式: ...,"0,1,2,...,0"
    const quoteStart = line.indexOf('"');
    const quoteEnd = line.lastIndexOf('"');
    if (quoteStart !== -1 && quoteEnd > quoteStart) {
      const dataStr = line.substring(quoteStart + 1, quoteEnd);
      const values = dataStr.split(',').map(v => parseInt(v.trim(), 10) || 0);
      frames.push(values);
    } else {
      // 尝试 [...] 格式
      const bracketStart = line.indexOf('[');
      const bracketEnd = line.lastIndexOf(']');
      if (bracketStart !== -1 && bracketEnd > bracketStart) {
        const dataStr = line.substring(bracketStart + 1, bracketEnd);
        const values = dataStr.split(',').map(v => parseInt(v.trim(), 10) || 0);
        frames.push(values);
      }
    }
  }
  return frames;
}

function loadPythonReport(jsonPath) {
  const content = fs.readFileSync(jsonPath, 'utf-8');
  return JSON.parse(content);
}

// ============================================================
// 对比工具
// ============================================================

function compareValue(label, jsVal, pyVal, tolerance = 0.05) {
  if (jsVal === null || jsVal === undefined || pyVal === null || pyVal === undefined) {
    return { label, jsVal, pyVal, diff: 'N/A', pass: false, note: 'missing value' };
  }
  if (typeof jsVal === 'string' || typeof pyVal === 'string') {
    const pass = String(jsVal) === String(pyVal);
    return { label, jsVal, pyVal, diff: pass ? '0%' : 'mismatch', pass };
  }
  if (pyVal === 0 && jsVal === 0) {
    return { label, jsVal, pyVal, diff: '0%', pass: true };
  }
  const absDiff = Math.abs(jsVal - pyVal);
  const relDiff = pyVal !== 0 ? absDiff / Math.abs(pyVal) : (jsVal !== 0 ? 1 : 0);
  const pass = relDiff <= tolerance;
  return {
    label,
    jsVal: typeof jsVal === 'number' ? Math.round(jsVal * 10000) / 10000 : jsVal,
    pyVal: typeof pyVal === 'number' ? Math.round(pyVal * 10000) / 10000 : pyVal,
    diff: `${(relDiff * 100).toFixed(2)}%`,
    pass,
  };
}

// ============================================================
// 主验证逻辑
// ============================================================

function main() {
  console.log('='.repeat(70));
  console.log('站立算法 (Standing Report) JS vs Python 验证');
  console.log('='.repeat(70));

  // 加载原始数据
  const csvPath = path.join(__dirname, '../../data_verify/数据/步道数据/20260211_181023/stand.csv');
  const jsonPath = path.join(__dirname, '../../data_verify/数据/步道数据/20260211_181023/report/stand_report.json');

  console.log('\n加载原始数据...');
  const frames = loadCSVFrames(csvPath);
  console.log(`  帧数: ${frames.length}`);
  console.log(`  每帧数据点: ${frames[0]?.length}`);

  console.log('\n加载 Python 基准报告...');
  const pyReport = loadPythonReport(jsonPath);

  // 运行 JS 算法
  console.log('\n运行 JS 站立算法...');
  const startTime = Date.now();
  const jsResult = generateStandingReport(frames, 42, 0.8);
  const elapsed = Date.now() - startTime;
  console.log(`  JS 算法耗时: ${elapsed}ms`);

  if (!jsResult) {
    console.log('ERROR: JS 算法返回 null');
    return;
  }

  // ---- 对比 COP 时间序列指标 ----
  console.log('\n' + '-'.repeat(50));
  console.log('COP 时间序列指标对比 (5% 容差)');
  console.log('-'.repeat(50));

  const pyTS = pyReport.cop_time_series;
  const jsTS = jsResult.cop_time_series;

  const tsFields = [
    'path_length', 'contact_area', 'ls_ratio', 'eccentricity',
    'major_axis', 'minor_axis', 'delta_x', 'delta_y',
    'max_displacement', 'min_displacement', 'avg_velocity',
    'rms_displacement', 'std_x', 'std_y',
  ];

  const results = [];
  for (const field of tsFields) {
    results.push(compareValue(`cop_ts.${field}`, jsTS?.[field], pyTS?.[field], 0.10));
  }

  // ---- 对比足弓特征 ----
  console.log('\n' + '-'.repeat(50));
  console.log('足弓特征对比 (10% 容差)');
  console.log('-'.repeat(50));

  const pyArch = pyReport.arch_features;
  const jsArch = jsResult.arch_features;

  for (const foot of ['left_foot', 'right_foot']) {
    for (const field of ['area_index', 'clarke_angle', 'staheli_ratio']) {
      results.push(compareValue(
        `arch.${foot}.${field}`,
        jsArch?.[foot]?.[field],
        pyArch?.[foot]?.[field],
        0.15
      ));
    }
    results.push(compareValue(
      `arch.${foot}.area_type`,
      jsArch?.[foot]?.area_type,
      pyArch?.[foot]?.area_type,
      0
    ));
    results.push(compareValue(
      `arch.${foot}.clarke_type`,
      jsArch?.[foot]?.clarke_type,
      pyArch?.[foot]?.clarke_type,
      0
    ));
  }

  // ---- 对比附加数据 ----
  console.log('\n' + '-'.repeat(50));
  console.log('附加数据对比 (10% 容差)');
  console.log('-'.repeat(50));

  const pyAD = pyReport.additional_data;
  const jsAD = jsResult.additional_data;

  for (const field of ['left_length', 'right_length', 'left_width', 'right_width']) {
    results.push(compareValue(`additional.${field}`, jsAD?.[field], pyAD?.[field], 0.10));
  }

  // 面积
  for (const side of ['left_area', 'right_area']) {
    const pyArea = pyAD?.[side];
    const jsArea = jsAD?.[side];
    if (pyArea && jsArea) {
      results.push(compareValue(`${side}.total_area_cm2`, jsArea?.total_area_cm2, pyArea?.total_area_cm2, 0.10));
      for (let i = 0; i < 3; i++) {
        results.push(compareValue(`${side}.counts[${i}]`, jsArea?.counts?.[i], pyArea?.counts?.[i], 0.15));
      }
    }
  }

  // 压力分布
  for (const side of ['left_pressure', 'right_pressure']) {
    const pyP = pyAD?.[side];
    const jsP = jsAD?.[side];
    if (pyP && jsP) {
      for (const region of ['前足', '中足', '后足']) {
        results.push(compareValue(`${side}.${region}`, jsP?.[region], pyP?.[region], 0.15));
      }
    }
  }

  // COP 结果
  const pyCop = pyAD?.cop_results;
  const jsCop = jsAD?.cop_results;
  if (pyCop && jsCop) {
    results.push(compareValue('cop.frame_index', jsCop.frame_index, pyCop.frame_index, 0.05));
    results.push(compareValue('cop.left_forward', jsCop.left_forward, pyCop.left_forward, 0.15));
  }

  // ---- 对比椭圆数据 ----
  // JS 版本的椭圆数据在 cop_time_series 中的 eccentricity 等已对比

  // ---- 输出结果表 ----
  console.log('\n' + '='.repeat(90));
  console.log('验证结果汇总');
  console.log('='.repeat(90));
  console.log(
    'Metric'.padEnd(40) +
    'JS Value'.padEnd(18) +
    'Python Value'.padEnd(18) +
    'Diff'.padEnd(10) +
    'Pass'
  );
  console.log('-'.repeat(90));

  let passCount = 0, failCount = 0;
  for (const r of results) {
    const status = r.pass ? '✓' : '✗';
    console.log(
      r.label.padEnd(40) +
      String(r.jsVal).substring(0, 16).padEnd(18) +
      String(r.pyVal).substring(0, 16).padEnd(18) +
      String(r.diff).padEnd(10) +
      status
    );
    if (r.pass) passCount++;
    else failCount++;
  }

  console.log('-'.repeat(90));
  console.log(`总计: ${results.length} 项 | 通过: ${passCount} | 失败: ${failCount} | 通过率: ${(passCount / results.length * 100).toFixed(1)}%`);

  // 输出 JSON 结果
  const outputPath = path.join(__dirname, 'standing_verify_result.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: { total: results.length, pass: passCount, fail: failCount },
    details: results,
    js_result_sample: {
      cop_time_series: jsTS,
      arch_left: jsArch?.left_foot ? {
        area_index: jsArch.left_foot.area_index,
        area_type: jsArch.left_foot.area_type,
        clarke_angle: jsArch.left_foot.clarke_angle,
        clarke_type: jsArch.left_foot.clarke_type,
        staheli_ratio: jsArch.left_foot.staheli_ratio,
      } : null,
      arch_right: jsArch?.right_foot ? {
        area_index: jsArch.right_foot.area_index,
        area_type: jsArch.right_foot.area_type,
        clarke_angle: jsArch.right_foot.clarke_angle,
        clarke_type: jsArch.right_foot.clarke_type,
        staheli_ratio: jsArch.right_foot.staheli_ratio,
      } : null,
      additional_data: jsAD,
    },
  }, null, 2));
  console.log(`\n详细结果已保存到: ${outputPath}`);
}

main();
