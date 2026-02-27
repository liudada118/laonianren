/**
 * 步态算法验证脚本
 * 用原始 CSV 数据调用 JS 算法，验证基本输出结构和合理性
 */

const fs = require('fs');
const path = require('path');
const { generateGaitReport } = require('../back-end/code/algorithms/gait/gaitReportAlgorithm');

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

// ============================================================
// 主验证逻辑
// ============================================================

function main() {
  console.log('='.repeat(70));
  console.log('步态算法 (Gait Report) JS 验证');
  console.log('='.repeat(70));

  const baseDir = path.join(__dirname, '../../data_verify/数据/步道数据/20260211_181023');

  console.log('\n加载原始数据...');
  const d1 = loadCSVFrames(path.join(baseDir, '1.csv'));
  const d2 = loadCSVFrames(path.join(baseDir, '2.csv'));
  const d3 = loadCSVFrames(path.join(baseDir, '3.csv'));
  const d4 = loadCSVFrames(path.join(baseDir, '4.csv'));
  console.log(`  脚垫1帧数: ${d1.length} (每帧 ${d1[0]?.length} 点)`);
  console.log(`  脚垫2帧数: ${d2.length}`);
  console.log(`  脚垫3帧数: ${d3.length}`);
  console.log(`  脚垫4帧数: ${d4.length}`);

  // 运行 JS 算法
  console.log('\n运行 JS 步态算法...');
  const startTime = Date.now();
  const jsResult = generateGaitReport(d1, d2, d3, d4, { bodyWeightKg: 70 });
  const elapsed = Date.now() - startTime;
  console.log(`  JS 算法耗时: ${elapsed}ms`);

  // 验证输出结构和合理性
  const results = [];

  function checkField(label, value, expectedType, minVal, maxVal) {
    let pass = true;
    let note = '';

    if (value === null || value === undefined) {
      pass = false;
      note = 'missing';
    } else if (expectedType === 'number' && typeof value !== 'number') {
      pass = false;
      note = `expected number, got ${typeof value}`;
    } else if (expectedType === 'object' && typeof value !== 'object') {
      pass = false;
      note = `expected object, got ${typeof value}`;
    } else if (expectedType === 'array' && !Array.isArray(value)) {
      pass = false;
      note = `expected array, got ${typeof value}`;
    } else if (typeof value === 'number') {
      if (minVal !== undefined && value < minVal) {
        pass = false;
        note = `value ${value.toFixed(3)} < min ${minVal}`;
      }
      if (maxVal !== undefined && value > maxVal) {
        pass = false;
        note = `value ${value.toFixed(3)} > max ${maxVal}`;
      }
    }

    results.push({
      label,
      value: typeof value === 'number' ? Math.round(value * 1000) / 1000 :
             (Array.isArray(value) ? `array(${value.length})` :
             (typeof value === 'object' ? `object(${Object.keys(value).length})` : value)),
      pass,
      note: note || 'OK',
    });
  }

  // 步态参数
  const gp = jsResult.gaitParams;
  checkField('gaitParams.leftStepTime', gp?.leftStepTime, 'number', 0.1, 5.0);
  checkField('gaitParams.rightStepTime', gp?.rightStepTime, 'number', 0.1, 5.0);
  checkField('gaitParams.crossStepTime', gp?.crossStepTime, 'number', 0.1, 5.0);
  checkField('gaitParams.leftStepLength', gp?.leftStepLength, 'number', 20, 120);
  checkField('gaitParams.rightStepLength', gp?.rightStepLength, 'number', 20, 120);
  checkField('gaitParams.stepWidth', gp?.stepWidth, 'number', 3, 30);
  checkField('gaitParams.walkingSpeed', gp?.walkingSpeed, 'number', 0.1, 3.0);
  checkField('gaitParams.leftFPA', gp?.leftFPA, 'number', -20, 40);
  checkField('gaitParams.rightFPA', gp?.rightFPA, 'number', -20, 40);

  // 平衡数据
  checkField('balance.left', jsResult.balance?.left, 'object');
  checkField('balance.right', jsResult.balance?.right, 'object');

  // 时间序列
  checkField('timeSeries.left.time', jsResult.timeSeries?.left?.time, 'array');
  checkField('timeSeries.left.force', jsResult.timeSeries?.left?.force, 'array');
  checkField('timeSeries.right.time', jsResult.timeSeries?.right?.time, 'array');
  checkField('timeSeries.right.force', jsResult.timeSeries?.right?.force, 'array');

  // 分区特征
  checkField('partitionFeatures.left', jsResult.partitionFeatures?.left, 'array');
  checkField('partitionFeatures.right', jsResult.partitionFeatures?.right, 'array');

  // 支撑相
  checkField('supportPhases.left', jsResult.supportPhases?.left, 'object');
  checkField('supportPhases.right', jsResult.supportPhases?.right, 'object');

  // 步态周期
  checkField('cyclePhases.left', jsResult.cyclePhases?.left, 'object');
  checkField('cyclePhases.right', jsResult.cyclePhases?.right, 'object');

  // FPA
  checkField('fpaPerStep.left', jsResult.fpaPerStep?.left, 'array');
  checkField('fpaPerStep.right', jsResult.fpaPerStep?.right, 'array');

  // 输出结果
  console.log('\n' + '='.repeat(80));
  console.log('验证结果汇总');
  console.log('='.repeat(80));
  console.log(
    'Field'.padEnd(40) +
    'Value'.padEnd(25) +
    'Note'.padEnd(20) +
    'Pass'
  );
  console.log('-'.repeat(80));

  let passCount = 0, failCount = 0;
  for (const r of results) {
    const status = r.pass ? '✓' : '✗';
    console.log(
      r.label.padEnd(40) +
      String(r.value).substring(0, 23).padEnd(25) +
      r.note.padEnd(20) +
      status
    );
    if (r.pass) passCount++;
    else failCount++;
  }

  console.log('-'.repeat(80));
  console.log(`总计: ${results.length} 项 | 通过: ${passCount} | 失败: ${failCount} | 通过率: ${(passCount / results.length * 100).toFixed(1)}%`);

  // 保存结果
  const outputPath = path.join(__dirname, 'gait_verify_result.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: { total: results.length, pass: passCount, fail: failCount },
    details: results,
    js_result: {
      gaitParams: jsResult.gaitParams,
      balance_left_keys: jsResult.balance?.left ? Object.keys(jsResult.balance.left) : [],
      timeSeries_left_length: jsResult.timeSeries?.left?.time?.length,
      partitionFeatures_left_length: jsResult.partitionFeatures?.left?.length,
    },
  }, null, 2));
  console.log(`\n详细结果已保存到: ${outputPath}`);
}

main();
