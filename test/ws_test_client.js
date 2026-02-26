/**
 * WebSocket 测试客户端
 * 连接后端 WS:19999，验证实时数据推送
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:19999';
let messageCount = 0;
let dataTypes = new Set();
let lastData = {};
const startTime = Date.now();

console.log(`Connecting to ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('WebSocket connected!\n');
  
  // 设置评估模式为步态模式(5)，激活 foot1-foot4
  setTimeout(() => {
    console.log('--- Sending mode 5 (gait) to activate foot1-foot4 ---');
    ws.send(JSON.stringify({ mode: 5 }));
  }, 1000);
});

ws.on('message', (data) => {
  messageCount++;
  try {
    const msg = JSON.parse(data.toString());
    
    // 记录数据类型
    if (msg.data) {
      Object.keys(msg.data).forEach(type => {
        dataTypes.add(type);
        const item = msg.data[type];
        lastData[type] = {
          status: item.status,
          arrLength: item.arr ? item.arr.length : 0,
          HZ: item.HZ,
          stamp: item.stamp,
          hasRotate: !!item.rotate,
          hasCop: !!item.cop,
        };
      });
    }
    
    if (msg.sitData) {
      Object.keys(msg.sitData).forEach(type => {
        dataTypes.add(`sit:${type}`);
      });
    }
    
    if (msg.macInfo) {
      console.log('MAC Info received:', JSON.stringify(msg.macInfo, null, 2));
    }
    
    // 每50条消息打印一次状态
    if (messageCount % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n[${elapsed}s] Messages: ${messageCount}, Types: [${Array.from(dataTypes).join(', ')}]`);
      Object.entries(lastData).forEach(([type, info]) => {
        console.log(`  ${type}: status=${info.status}, arr=${info.arrLength}, HZ=${info.HZ}ms, rotate=${info.hasRotate}, cop=${info.hasCop}`);
      });
    }
  } catch (e) {
    // ignore parse errors
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('WebSocket disconnected');
});

// 30秒后打印最终结果并退出
setTimeout(() => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n========== FINAL REPORT (${elapsed}s) ==========`);
  console.log(`Total messages received: ${messageCount}`);
  console.log(`Data types detected: [${Array.from(dataTypes).join(', ')}]`);
  console.log('\nLast data per type:');
  Object.entries(lastData).forEach(([type, info]) => {
    console.log(`  ${type}:`);
    console.log(`    status: ${info.status}`);
    console.log(`    array length: ${info.arrLength}`);
    console.log(`    HZ: ${info.HZ}ms`);
    console.log(`    has rotate: ${info.hasRotate}`);
    console.log(`    has COP: ${info.hasCop}`);
  });
  
  // 测试API
  const http = require('http');
  
  // 测试 setActiveMode
  const testSetMode = (mode) => {
    return new Promise((resolve) => {
      const postData = JSON.stringify({ mode });
      const options = {
        hostname: 'localhost',
        port: 19245,
        path: '/setActiveMode',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          console.log(`\nsetActiveMode(${mode}): ${body}`);
          resolve();
        });
      });
      req.write(postData);
      req.end();
    });
  };
  
  // 测试 startCol
  const testStartCol = () => {
    return new Promise((resolve) => {
      const postData = JSON.stringify({
        fileName: '测试用户',
        date: '2026-02-26',
        name: '测试用户',
        assessmentId: '1001',
      });
      const options = {
        hostname: 'localhost',
        port: 19245,
        path: '/startCol',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          console.log(`\nstartCol: ${body}`);
          resolve();
        });
      });
      req.write(postData);
      req.end();
    });
  };
  
  // 测试 endCol
  const testEndCol = () => {
    return new Promise((resolve) => {
      http.get('http://localhost:19245/endCol', (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          console.log(`endCol: ${body}`);
          resolve();
        });
      });
    });
  };
  
  // 测试 getColHistory
  const testGetHistory = () => {
    return new Promise((resolve) => {
      http.get('http://localhost:19245/getColHistory', (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          console.log(`getColHistory: ${body.substring(0, 200)}...`);
          resolve();
        });
      });
    });
  };

  (async () => {
    console.log('\n\n========== API TESTS ==========');
    
    // 1. 设置模式5（步态）
    await testSetMode(5);
    
    // 2. 等待数据流
    await new Promise(r => setTimeout(r, 3000));
    
    // 3. 开始采集
    await testStartCol();
    
    // 4. 采集5秒
    await new Promise(r => setTimeout(r, 5000));
    
    // 5. 停止采集
    await testEndCol();
    
    // 6. 查询历史
    await testGetHistory();
    
    // 7. 测试模式1（左手）
    await testSetMode(1);
    await new Promise(r => setTimeout(r, 2000));
    
    // 8. 测试模式3（起坐）
    await testSetMode(3);
    await new Promise(r => setTimeout(r, 2000));
    
    console.log('\n========== ALL TESTS COMPLETE ==========');
    ws.close();
    process.exit(0);
  })();
}, 15000);
