// pyWorker.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
// const { app } = require('electron');



// console.log('userData from env:', process.workerData.isPackaged);
let isPackaged = false
if (typeof process.env.isPackaged !== 'undefined') {
  isPackaged = process.env.isPackaged == 'true'
} else {
  try {
    const { app } = require('electron')
    if (app) isPackaged = app.isPackaged
  } catch {}
}
console.log(process.resourcesPath,path.join(__dirname,  'python', 'app', 'server.py') ,path.join(process.resourcesPath, 'python', 'app', 'server.py'), !isPackaged , isPackaged , 'isPackaged')
function pythonBin() {
  const isDev = !isPackaged;
  if (process.platform === 'win32') {
    return isDev
      ? path.join(__dirname,  'python', 'Python311', 'python.exe')
      : path.join(process.resourcesPath, 'python', 'Python311', 'python.exe');
  }
  return isDev
    ? path.join(__dirname,  'python', 'venv', 'bin', 'python')
    : path.join(process.resourcesPath, 'python', 'venv', 'bin', 'python');
}
function serverPy() {
  const isDev = !isPackaged;
  return isDev
    ? path.join(__dirname,  'python', 'app', 'server.py')
    : path.join(process.resourcesPath, 'python', 'app', 'server.py');
}

let child = null;
let buf = '';
const pending = new Map(); // id -> {resolve,reject,timer}
let nextId = 1;
let starting = false;

// 保留 stderr 尾部，便于定位异常
let stderrTail = '';
function pushErr(s) { stderrTail = (stderrTail + s).slice(-4000); }

function startWorker() {
  if (child || starting) return;
  starting = true;

  const py = pythonBin();
  const sv = serverPy();
  console.log('[PY] start:', py, sv);
  if (!fs.existsSync(py)) console.error('[PY] pythonBin NOT FOUND:', py);
  if (!fs.existsSync(sv)) console.error('[PY] serverPy  NOT FOUND:', sv);

  child = spawn(py, ['-u', sv], {
    stdio: ['pipe','pipe','pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    windowsHide: true
  });
  starting = false;
  buf = ''; stderrTail = '';

  child.stdout.on('data', (d) => {
    buf += d.toString();
    // console.log(JSON.parse(buf))
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || ''; // 剩下一半行，等待下一次拼接

    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); }
      catch {
        // Some Python modules still print progress logs to stdout; ignore non-JSON lines.
        const trimmed = line.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          console.error('[PY] bad JSON line:', line);
        }
        continue;
      }
      const rec = pending.get(msg.id);
      if (!rec) continue;
      clearTimeout(rec.timer);
      pending.delete(msg.id);
      if (msg.ok === false) {
        const detail = [msg.error, msg.trace].filter(Boolean).join('\n');
        rec.reject(new Error(detail || 'python error'));
      } else {
        rec.resolve(msg.data);
      }
    }
  });

  child.stderr.on('data', (d) => {
    const s = d.toString();
    pushErr(s);
    console.error('[PY:stderr]', s.trim());
  });

  child.on('exit', (code, sig) => {
    console.error(`[PY] worker EXIT code=${code} sig=${sig}\n[PY] stderr tail:\n${stderrTail}`);
    for (const [id, rec] of pending) {
      clearTimeout(rec.timer);
      rec.reject(new Error(`python worker exited (code=${code} sig=${sig})`));
    }
    pending.clear();
    child = null;
    setTimeout(startWorker, 500); // 自动重启
  });

  // 握手：确认常驻 OK（会发送一条请求）
  callPy('ping', {}, { timeoutMs: 200000 })
    .then(() => console.log('[PY] ready'))
    .catch(e => console.error('[PY] handshake failed:', e.message));
}

// 反压写：write 返回 false 就等 'drain'
function writeLine(line) {
  return new Promise((resolve, reject) => {
    if (!child || !child.stdin) return reject(new Error('worker not running'));
    const ok = child.stdin.write(line);
    if (ok) return resolve(true);
    child.stdin.once('drain', resolve);
  });
}

function callPy(fn, args, { timeoutMs = 200000 } = {}) {
  if (!child) startWorker();
  const id = nextId++;
  return new Promise(async (resolve, reject) => {
    const rec = { resolve, reject };
    rec.timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout ${timeoutMs}ms`));
      // 不 kill 进程，发个可忽略的取消指令即可
      try { child?.stdin.write(JSON.stringify({ id, fn: '_cancel' }) + '\n'); } catch {}
    }, timeoutMs);
    pending.set(id, rec);
    try {
      await writeLine(JSON.stringify({ id, fn, args }) + '\n'); // ❗不要 .end()
    } catch (e) {
      clearTimeout(rec.timer);
      pending.delete(id);
      reject(new Error('stdin write failed: ' + e.message));
    }
  });
}

module.exports = { startWorker, callPy };
