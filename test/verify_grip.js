/**
 * 握力算法验证脚本
 * 用原始 CSV 数据调用 JS 算法，与 Python 报告 PDF 中提取的数据进行对比
 *
 * 关键发现: 握力 CSV 中的 sensor_data_raw 和 sensor_data_calibrated 字段
 * 内部包含 256 个逗号分隔的值，但被引号包裹作为单个 CSV 字段。
 * 不能简单用 split(',') 解析，需要正确处理 CSV 引号。
 */

const fs = require('fs');
const path = require('path');
const { generateGripReport } = require('../back-end/code/algorithms/grip/gripReportAlgorithm');

// ============================================================
// Python 基准数据 (从 PDF 报告中提取)
// ============================================================

const PY_BASELINE = {
  hand_type: '左手',
  total_frames: 1860,
  peak_force: 111.50,
  peak_time: 6.225,
  grip_start_time: 0.015,
  shake_count: 6,
  avg_angular_velocity: 18.50,
  max_angular_velocity: 139.60,
  fingers: {
    Thumb:  { force: 43.00, area: 216, points: '9/12' },
    Index:  { force: 18.34, area: 288, points: '12/12' },
    Middle: { force: 15.99, area: 264, points: '11/12' },
    Ring:   { force: 11.70, area: 240, points: '10/12' },
    Little: { force: 15.00, area: 288, points: '12/12' },
    Palm:   { force: 7.47,  area: 336, points: '14/72' },
  },
  total_force: 111.50,
  total_area: 1632,
};

// ============================================================
// CSV 解析 (正确处理引号包裹的字段)
// ============================================================

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function loadGripCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const header = parseCSVLine(lines[0]);

  const colIdx = {};
  for (let i = 0; i < header.length; i++) {
    colIdx[header[i].trim()] = i;
  }

  console.log(`  CSV 列: ${header.join(', ')}`);
  console.log(`  列索引: ${JSON.stringify(colIdx)}`);

  const sensorDataCal = [];
  const sensorDataRaw = [];
  const times = [];
  const imuData = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < header.length) continue;

    const relTime = parseFloat(fields[colIdx['relative_time']]) || 0;
    times.push(relTime);

    // sensor_data_calibrated - 逗号分隔的 256 个值在一个字段中
    const calStr = fields[colIdx['sensor_data_calibrated']];
    const calValues = calStr.split(',').map(v => parseFloat(v.trim()) || 0);
    sensorDataCal.push(calValues);

    // sensor_data_raw
    const rawStr = fields[colIdx['sensor_data_raw']];
    const rawValues = rawStr.split(',').map(v => parseFloat(v.trim()) || 0);
    sensorDataRaw.push(rawValues);

    // IMU 数据 (imu_data_raw: w,x,y,z 逗号分隔)
    const imuStr = fields[colIdx['imu_data_raw']];
    if (imuStr) {
      const imuVals = imuStr.split(',').map(v => parseFloat(v.trim()) || 0);
      imuData.push(imuVals);
    }
  }

  return { sensorDataCal, sensorDataRaw, times, imuData };
}

// ============================================================
// 对比工具
// ============================================================

function compareValue(label, jsVal, pyVal, tolerance = 0.10) {
  if (jsVal === null || jsVal === undefined || pyVal === null || pyVal === undefined) {
    return { label, jsVal, pyVal, diff: 'N/A', pass: false, note: 'missing' };
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
    jsVal: typeof jsVal === 'number' ? Math.round(jsVal * 100) / 100 : jsVal,
    pyVal: typeof pyVal === 'number' ? Math.round(pyVal * 100) / 100 : pyVal,
    diff: `${(relDiff * 100).toFixed(2)}%`,
    pass,
  };
}

// ============================================================
// 主验证逻辑
// ============================================================

function main() {
  console.log('='.repeat(70));
  console.log('握力算法 (Grip Report) JS vs Python 验证');
  console.log('='.repeat(70));

  const csvPath = path.join(__dirname, '../../data_verify/数据/握力数据/握力数据.csv');

  console.log('\n加载原始数据...');
  const { sensorDataCal, sensorDataRaw, times, imuData } = loadGripCSV(csvPath);
  console.log(`  帧数: ${sensorDataCal.length}`);
  console.log(`  Cal 每帧传感器数: ${sensorDataCal[0]?.length}`);
  console.log(`  Raw 每帧传感器数: ${sensorDataRaw[0]?.length}`);
  console.log(`  IMU 数据帧数: ${imuData.length}`);
  console.log(`  时间范围: ${times[0]?.toFixed(3)}s - ${times[times.length - 1]?.toFixed(3)}s`);

  // 数据验证
  const peakFrameIdx = 1525;
  const calPeakSum = sensorDataCal[peakFrameIdx].reduce((a, b) => a + b, 0);
  const rawPeakSum = sensorDataRaw[peakFrameIdx].reduce((a, b) => a + b, 0);
  console.log(`\n  峰值帧(${peakFrameIdx}) Cal 总和: ${calPeakSum}`);
  console.log(`  峰值帧(${peakFrameIdx}) Raw 总和: ${rawPeakSum}`);

  // ---- 测试1: 使用 calibrated 数据 ----
  console.log('\n' + '='.repeat(70));
  console.log('测试1: 使用 Calibrated 数据');
  console.log('='.repeat(70));

  const startTime1 = Date.now();
  const jsResult1 = generateGripReport(
    sensorDataCal,
    PY_BASELINE.hand_type,
    times,
    imuData.length === sensorDataCal.length ? imuData : null
  );
  console.log(`  JS 算法耗时: ${Date.now() - startTime1}ms`);
  console.log(`  JS peakForce: ${jsResult1.peakInfo?.peak_force?.toFixed(2)}`);
  console.log(`  JS totalForce: ${jsResult1.totalForce}`);

  // ---- 测试2: 使用 raw 数据 ----
  console.log('\n' + '='.repeat(70));
  console.log('测试2: 使用 Raw 数据');
  console.log('='.repeat(70));

  const startTime2 = Date.now();
  const jsResult2 = generateGripReport(
    sensorDataRaw,
    PY_BASELINE.hand_type,
    times,
    imuData.length === sensorDataRaw.length ? imuData : null
  );
  console.log(`  JS 算法耗时: ${Date.now() - startTime2}ms`);
  console.log(`  JS peakForce: ${jsResult2.peakInfo?.peak_force?.toFixed(2)}`);
  console.log(`  JS totalForce: ${jsResult2.totalForce}`);

  // ---- 对比分析 ----
  console.log('\n' + '='.repeat(90));
  console.log('对比分析 (使用 Calibrated 数据)');
  console.log('='.repeat(90));

  const results = [];
  const jsResult = jsResult1;

  results.push(compareValue('totalFrames', jsResult.totalFrames, PY_BASELINE.total_frames, 0.01));
  results.push(compareValue('handType', jsResult.handType, PY_BASELINE.hand_type));
  results.push(compareValue('peakForce', jsResult.peakInfo?.peak_force, PY_BASELINE.peak_force, 0.15));
  results.push(compareValue('totalForce', jsResult.totalForce, PY_BASELINE.total_force, 0.15));
  results.push(compareValue('totalArea', jsResult.totalArea, PY_BASELINE.total_area, 0.15));

  // 手指对比
  for (const finger of jsResult.fingers || []) {
    if (PY_BASELINE.fingers[finger.name]) {
      const pyFinger = PY_BASELINE.fingers[finger.name];
      results.push(compareValue(`finger.${finger.name}.force`, finger.force, pyFinger.force, 0.20));
      results.push(compareValue(`finger.${finger.name}.area`, finger.area, pyFinger.area, 0.20));
      results.push(compareValue(`finger.${finger.name}.points`, finger.points, pyFinger.points));
    }
  }

  // 时间分析
  const timeAnalysis = {};
  for (const item of jsResult.timeAnalysis || []) {
    timeAnalysis[item.label] = item.value;
  }
  const jsShakeCount = parseInt(timeAnalysis['Shake Count'] || '0');
  results.push(compareValue('shakeCount', jsShakeCount, PY_BASELINE.shake_count, 0.50));

  // 输出
  console.log(
    'Metric'.padEnd(35) +
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
      r.label.padEnd(35) +
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

  // ---- 问题分析 ----
  console.log('\n' + '='.repeat(70));
  console.log('问题分析');
  console.log('='.repeat(70));
  console.log(`
关键发现:
1. JS 算法中 forceTimeSeries 直接累加传感器 ADC 值 (第201-210行)
   没有调用 adcToForceSinglePoint() 进行 ADC->力 的转换
   导致 peakForce 是 ADC 总和而非实际力值(N)

2. JS 的 PART_SLICES 分区为 42/42/42/42/42/46 = 256
   而 Python 报告中的分区为 12/12/12/12/12/72 = 132
   分区映射不一致

3. 峰值帧的力值计算 (第280-305行) 也是直接累加 ADC 值
   虽然 adcToForceSinglePoint 函数存在，但只在 regionForce 辅助函数中使用
   主流程未调用

修复建议:
- 在 forceTimeSeries 计算中对每个传感器值调用 adcToForceSinglePoint()
- 统一 PART_SLICES 分区映射与 Python 版本一致
- 峰值帧力值计算也需要经过 ADC 转换
`);

  // 保存结果
  const outputPath = path.join(__dirname, 'grip_verify_result.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: { total: results.length, pass: passCount, fail: failCount },
    details: results,
    analysis: {
      issue_1: 'forceTimeSeries 直接累加 ADC 值，未调用 adcToForceSinglePoint 转换',
      issue_2: 'PART_SLICES 分区 (42/42/42/42/42/46) 与 Python (12/12/12/12/12/72) 不一致',
      issue_3: '峰值帧力值计算未经 ADC 转换',
      cal_peak_sum: calPeakSum,
      raw_peak_sum: rawPeakSum,
      js_peak_force_cal: jsResult1.peakInfo?.peak_force,
      js_peak_force_raw: jsResult2.peakInfo?.peak_force,
      py_peak_force: PY_BASELINE.peak_force,
    },
    js_result_cal: {
      totalFrames: jsResult1.totalFrames,
      peakInfo: jsResult1.peakInfo,
      totalForce: jsResult1.totalForce,
      totalArea: jsResult1.totalArea,
      fingers: jsResult1.fingers,
    },
    js_result_raw: {
      totalFrames: jsResult2.totalFrames,
      peakInfo: jsResult2.peakInfo,
      totalForce: jsResult2.totalForce,
      totalArea: jsResult2.totalArea,
      fingers: jsResult2.fingers,
    },
  }, null, 2));
  console.log(`\n详细结果已保存到: ${outputPath}`);
}

main();
