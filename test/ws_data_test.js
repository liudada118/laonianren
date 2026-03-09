const WebSocket = require('ws');
const http = require('http');

function setMode(mode) {
  return new Promise((resolve) => {
    const req = http.request('http://localhost:19245/setActiveMode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { console.log('setActiveMode(' + mode + '):', d); resolve(); });
    });
    req.write(JSON.stringify({ mode }));
    req.end();
  });
}

function testWS(mode, duration) {
  return new Promise(async (resolve) => {
    await setMode(mode);
    await new Promise(r => setTimeout(r, 500));
    
    const ws = new WebSocket('ws://localhost:19999');
    let count = 0;
    let firstMsg = null;
    
    ws.on('open', () => console.log('WS connected for mode ' + mode));
    ws.on('message', (raw) => {
      count++;
      const msg = JSON.parse(raw.toString());
      if (count <= 3) {
        if (msg.data) {
          Object.keys(msg.data).forEach(k => {
            const v = msg.data[k];
            console.log('  data.' + k + ': status=' + v.status + ' arr.len=' + (v.arr ? v.arr.length : 'null') + ' HZ=' + v.HZ);
          });
        }
        if (msg.sitData) {
          Object.keys(msg.sitData).forEach(k => {
            const v = msg.sitData[k];
            console.log('  sitData.' + k + ': status=' + v.status + ' arr.len=' + (v.arr ? v.arr.length : 'null') + ' HZ=' + v.HZ);
          });
        }
        if (Object.keys(msg).length === 0) console.log('  empty message: {}');
      }
    });
    ws.on('error', (err) => console.log('WS error:', err.message));
    
    setTimeout(() => {
      console.log('Mode ' + mode + ' total msgs in ' + duration + 'ms: ' + count + '\n');
      ws.close();
      resolve(count);
    }, duration);
  });
}

async function main() {
  console.log('=== Testing WebSocket Data Push ===\n');
  
  const c1 = await testWS(1, 3000);  // 手套模式
  const c3 = await testWS(3, 3000);  // 坐垫模式
  const c5 = await testWS(5, 3000);  // 脚垫模式
  
  console.log('=== Summary ===');
  console.log('Mode 1 (HL): ' + c1 + ' msgs');
  console.log('Mode 3 (sit+foot1): ' + c3 + ' msgs');
  console.log('Mode 5 (foot1-4): ' + c5 + ' msgs');
  
  process.exit(0);
}

main();
