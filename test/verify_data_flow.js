/**
 * 数据流验证脚本
 * 模拟前端 completeAssessment → saveAssessmentSession → 后端 save → get 的完整流程
 * 验证 reportData 是否能正确存储和读取
 */
const http = require('http');

const BASE = 'http://127.0.0.1:19245';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, BASE);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 5000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== 数据流验证 ===\n');

  // 模拟前端 completeAssessment 后的 assessments 状态
  // completeAssessment('grip', { completed: true, reportData: { maxForce: 25.5 } }, { leftData: [1,2,3] })
  // → assessments.grip = { completed: true, report: { completed: true, reportData: { maxForce: 25.5 } }, data: { leftData: [1,2,3] } }
  const assessments = {
    grip: {
      completed: true,
      report: { completed: true, reportData: { maxForce: 25.5, avgForce: 20.1 } },
      data: { leftData: [1, 2, 3], rightData: [4, 5, 6] }
    },
    sitstand: { completed: false, report: null, data: null },
    standing: { completed: false, report: null, data: null },
    gait: { completed: false, report: null, data: null },
  };

  console.log('1. 前端传给后端的 assessments:');
  console.log(JSON.stringify(assessments.grip, null, 2));
  console.log();

  // 先清空历史
  await post('/api/history/clear', {});

  // 保存
  const saveResult = await post('/api/history/save', {
    patientInfo: { name: '测试用户_数据流', gender: '男', age: 70, weight: 65 },
    institution: '测试机构',
    assessments,
  });
  console.log('2. 后端 save 返回:', JSON.stringify(saveResult));
  console.log();

  if (saveResult.code !== 0) {
    console.log('保存失败！');
    return;
  }

  // 获取列表
  const listResult = await post('/api/history/list', { page: 1, pageSize: 10 });
  console.log('3. 后端 list 返回的 items[0].assessments:');
  if (listResult.data?.items?.[0]) {
    const item = listResult.data.items[0];
    console.log(JSON.stringify(item.assessments, null, 2));
    console.log();

    // 获取单条记录
    const getResult = await post('/api/history/get', { id: item.id });
    console.log('4. 后端 get 返回的 assessments.grip:');
    console.log(JSON.stringify(getResult.data?.assessments?.grip, null, 2));
    console.log();

    // 模拟 HistoryReportView 的取数据逻辑
    const assessmentData = getResult.data?.assessments?.grip;
    const reportData = assessmentData?.report?.reportData || null;
    console.log('5. HistoryReportView 取到的 reportData:');
    console.log(JSON.stringify(reportData));
    console.log();

    if (reportData) {
      console.log('✅ 数据流正确！reportData 可以正确取到');
    } else {
      console.log('❌ 数据流断裂！reportData 为 null');
      console.log('   assessmentData.report =', JSON.stringify(assessmentData?.report));
    }
  }

  // 清空
  await post('/api/history/clear', {});
}

main().catch(console.error);
