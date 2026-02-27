/**
 * 综合验证脚本 - 运行所有算法验证并生成汇总报告
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tests = [
  { name: '站立算法 (Standing)', script: 'verify_standing.js', resultFile: 'standing_verify_result.json' },
  { name: '握力算法 (Grip)', script: 'verify_grip.js', resultFile: 'grip_verify_result.json' },
  { name: '起坐算法 (Sit-Stand)', script: 'verify_sitstand.js', resultFile: 'sitstand_verify_result.json' },
  { name: '步态算法 (Gait)', script: 'verify_gait.js', resultFile: 'gait_verify_result.json' },
];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║          JS 算法验证综合报告                                  ║');
console.log('║          数据源: Python 原始数据 + 报告                       ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log();

const summary = [];

for (const test of tests) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`运行: ${test.name}`);
  console.log(`${'━'.repeat(60)}`);

  try {
    const output = execSync(`node ${path.join(__dirname, test.script)}`, {
      encoding: 'utf-8',
      timeout: 300000,
    });
    console.log(output);

    const resultPath = path.join(__dirname, test.resultFile);
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      summary.push({
        name: test.name,
        ...result.summary,
        rate: `${(result.summary.pass / result.summary.total * 100).toFixed(1)}%`,
      });
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    summary.push({ name: test.name, total: 0, pass: 0, fail: 0, rate: 'ERROR' });
  }
}

// 汇总
console.log('\n\n');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║                    验证结果汇总                               ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log();
console.log('Algorithm'.padEnd(30) + 'Total'.padEnd(8) + 'Pass'.padEnd(8) + 'Fail'.padEnd(8) + 'Rate');
console.log('─'.repeat(60));

let totalAll = 0, passAll = 0, failAll = 0;
for (const s of summary) {
  console.log(
    s.name.padEnd(30) +
    String(s.total).padEnd(8) +
    String(s.pass).padEnd(8) +
    String(s.fail).padEnd(8) +
    s.rate
  );
  totalAll += s.total;
  passAll += s.pass;
  failAll += s.fail;
}
console.log('─'.repeat(60));
console.log(
  'TOTAL'.padEnd(30) +
  String(totalAll).padEnd(8) +
  String(passAll).padEnd(8) +
  String(failAll).padEnd(8) +
  `${(passAll / totalAll * 100).toFixed(1)}%`
);

// 保存汇总
fs.writeFileSync(path.join(__dirname, 'verify_summary.json'), JSON.stringify({
  timestamp: new Date().toISOString(),
  summary,
  totals: { total: totalAll, pass: passAll, fail: failAll, rate: `${(passAll / totalAll * 100).toFixed(1)}%` },
}, null, 2));
