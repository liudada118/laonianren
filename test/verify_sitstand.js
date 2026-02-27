/**
 * 起坐算法验证脚本
 * 用原始 CSV 数据调用 JS 算法，验证基本输出结构和合理性
 * (起坐的 Python 报告为 PDF，提取关键统计数据进行对比)
 */

const fs = require('fs');
const path = require('path');
const { generateSitStandReport } = require('../back-end/code/algorithms/sitstand/sitstandReportAlgorithm');

// ============================================================
// 数据加载
// ============================================================

function loadCSVFrames(csvPath, expectedSize) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const bracketStart = line.indexOf('[');
    const bracketEnd = line.lastIndexOf(']');
    if (bracketStart === -1 || bracketEnd === -1) continue;

    const dataStr = line.substring(bracketStart + 1, bracketEnd);
    const values = dataStr.split(',').map(v => parseInt(v.trim(), 10) || 0);
    frames.push(values);
  }
  return frames;
}

// ============================================================
// 主验证逻辑
// ============================================================

function main() {
  console.log('='.repeat(70));
  console.log('起坐算法 (Sit-Stand Report) JS 验证');
  console.log('='.repeat(70));

  const standCsvPath = path.join(__dirname, '../../data_verify/数据/起坐数据/stand.csv');
  const sitCsvPath = path.join(__dirname, '../../data_verify/数据/起坐数据/sit.csv');

  console.log('\n加载原始数据...');
  const standFrames = loadCSVFrames(standCsvPath, 4096);
  const sitFrames = loadCSVFrames(sitCsvPath, 1024);
  console.log(`  脚垫帧数: ${standFrames.length} (每帧 ${standFrames[0]?.length} 点)`);
  console.log(`  坐垫帧数: ${sitFrames.length} (每帧 ${sitFrames[0]?.length} 点)`);

  // 运行 JS 算法
  console.log('\n运行 JS 起坐算法...');
  const startTime = Date.now();
  const jsResult = generateSitStandReport(standFrames, sitFrames, '测试用户');
  const elapsed = Date.now() - startTime;
  console.log(`  JS 算法耗时: ${elapsed}ms`);

  // 验证输出结构
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
    } else if (expectedType === 'array' && !Array.isArray(value)) {
      pass = false;
      note = `expected array, got ${typeof value}`;
    } else if (typeof value === 'number') {
      if (minVal !== undefined && value < minVal) {
        pass = false;
        note = `value ${value} < min ${minVal}`;
      }
      if (maxVal !== undefined && value > maxVal) {
        pass = false;
        note = `value ${value} > max ${maxVal}`;
      }
    }

    results.push({
      label,
      value: typeof value === 'number' ? Math.round(value * 100) / 100 : (Array.isArray(value) ? `array(${value.length})` : value),
      pass,
      note: note || 'OK',
    });
  }

  // 基本结构
  checkField('duration_stats.total_duration', jsResult.duration_stats?.total_duration, 'number', 0, 1000);
  checkField('duration_stats.num_cycles', jsResult.duration_stats?.num_cycles, 'number', 0, 100);
  checkField('duration_stats.avg_duration', jsResult.duration_stats?.avg_duration, 'number', 0, 100);
  checkField('stand_frames', jsResult.stand_frames, 'number', standFrames.length, standFrames.length);
  checkField('sit_frames', jsResult.sit_frames, 'number', sitFrames.length, sitFrames.length);

  // COP 数据
  checkField('cop.stand_full', jsResult.cop?.stand_full, 'array');
  checkField('cop.stand_left', jsResult.cop?.stand_left, 'array');
  checkField('cop.stand_right', jsResult.cop?.stand_right, 'array');
  checkField('cop.sit', jsResult.cop?.sit, 'array');

  // 力曲线
  checkField('force_curves.stand_times', jsResult.force_curves?.stand_times, 'array');
  checkField('force_curves.stand_force', jsResult.force_curves?.stand_force, 'array');
  checkField('force_curves.sit_times', jsResult.force_curves?.sit_times, 'array');
  checkField('force_curves.sit_force', jsResult.force_curves?.sit_force, 'array');

  // 演变数据
  checkField('evolution.stand', jsResult.evolution?.stand, 'array');
  checkField('evolution.sit', jsResult.evolution?.sit, 'array');

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
  const outputPath = path.join(__dirname, 'sitstand_verify_result.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: { total: results.length, pass: passCount, fail: failCount },
    details: results,
    js_result: {
      duration_stats: jsResult.duration_stats,
      stand_frames: jsResult.stand_frames,
      sit_frames: jsResult.sit_frames,
      stand_peaks: jsResult.stand_peaks,
      cop_lengths: {
        stand_full: jsResult.cop?.stand_full?.length,
        stand_left: jsResult.cop?.stand_left?.length,
        stand_right: jsResult.cop?.stand_right?.length,
        sit: jsResult.cop?.sit?.length,
      },
    },
  }, null, 2));
  console.log(`\n详细结果已保存到: ${outputPath}`);
}

main();
