const { configureLogging } = require('./util/configureLogging')
configureLogging('progress')

const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')
const { fork, spawn, spawnSync } = require('child_process')
const { getHardwareFingerprint } = require('./util/getWinConfig')
const { getKeyfromWinuuid } = require('./util/getServer')
const { initDb, getCsvData } = require('./util/db')
const http = require('http')
const fs = require('fs')
const { initAutoUpdater, registerUpdaterIpcHandlers, cleanupUpdater } = require('./updater')
// const { startWorker, callPy } = require('./pyWorker')  // [已迁移到JS算法] Python子进程不再需要
const isPackaged = app.isPackaged

const devWebRoot = path.join(__dirname, 'client', 'dist')
const prodWebRoot = path.join(__dirname, 'renderer-build')
const webRoot = isPackaged ? prodWebRoot : devWebRoot
const defaultDevPort = process.env.VITE_DEV_PORT || '5173'
let devServerUrl = process.env.VITE_DEV_SERVER_URL || `http://localhost:${defaultDevPort}`
let viteProcess = null
let apiChild = null  // serialServer 子进程引用
let pythonAiChild = null
const pythonAiPort = parseInt(process.env.PYTHON_API_PORT || '8765', 10)

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const shouldOpenDevTools = process.env.OPEN_DEVTOOLS !== '0'

async function checkDevServerOnce(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForDevServer(url, timeoutMs = 20000) {
  const start = Date.now()
  console.log('[vite] waiting for dev server at:', url)
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkDevServerOnce(url, 1000)
    if (ok) {
      console.log('[vite] dev server is reachable at:', url)
      return true
    }
    // eslint-disable-next-line no-await-in-loop
    await wait(500)
  }
  // 如果默认端口不可达，扫描附近端口
  const basePort = parseInt(new URL(url).port, 10) || 5173
  console.log('[vite] default port not reachable, scanning ports', basePort, '-', basePort + 20)
  for (let p = basePort + 1; p <= basePort + 20; p++) {
    const tryUrl = url.replace(':' + basePort, ':' + p)
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkDevServerOnce(tryUrl, 500)
    if (ok) {
      console.log('[vite] found dev server at port:', p)
      devServerUrl = tryUrl
      return true
    }
  }
  console.log('[vite] dev server not found on any port')
  return false
}

async function checkPythonAiOnce(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${pythonAiPort}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForPythonAi(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkPythonAiOnce(1000)
    if (ok) return true
    // eslint-disable-next-line no-await-in-loop
    await wait(500)
  }
  return false
}

function startViteDevServer() {
  if (viteProcess) return Promise.resolve()

  // 前端项目在 front-end 目录
  const clientDir = path.join(__dirname, '..', '..', 'front-end')
  console.log('[vite] frontend dir:', clientDir)
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const viteArgs = ['run', 'dev', '--', '--port', defaultDevPort]
  const viteBin = path.join(
    clientDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vite.cmd' : 'vite'
  )

  // 所有 spawn 策略统一使用 shell: true 以兼容 Windows
  const attempts = [
    () => {
      console.log('[vite] attempt 1: npm run dev (shell)')
      return spawn(npmCmd, viteArgs, { cwd: clientDir, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    },
    () => {
      if (!fs.existsSync(viteBin)) return null
      console.log('[vite] attempt 2: direct vite bin')
      return spawn(viteBin, ['--port', defaultDevPort], { cwd: clientDir, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    },
    () => {
      // 最后兜底：用 npx vite
      console.log('[vite] attempt 3: npx vite')
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
      return spawn(npxCmd, ['vite', '--port', defaultDevPort], { cwd: clientDir, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    }
  ]

  return new Promise((resolve) => {
    let settled = false
    let attemptIndex = 0

    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const startAttempt = () => {
      let child
      try {
        child = attempts[attemptIndex]()
        if (!child) throw new Error('vite spawn skipped')
      } catch (err) {
        console.log('[vite] spawn throw:', err.message)
        if (attemptIndex + 1 < attempts.length) {
          attemptIndex += 1
          startAttempt()
          return
        }
        finish()
        return
      }

      viteProcess = child
      let timer = null

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        child?.stdout?.off('data', onData)
        child?.stderr?.off('data', onData)
        child?.off('error', onError)
        child?.off('exit', onExit)
      }

      const ready = () => {
        cleanup()
        console.log('[vite] ready, devServerUrl =', devServerUrl)
        finish()
      }

      const onData = (chunk) => {
        const text = chunk.toString()
        if (text && text.trim()) {
          process.stdout.write(`[vite] ${text}`)
        }
        const localMatch =
          text.match(/https?:\/\/localhost:(\d+)/i) ||
          text.match(/https?:\/\/127\.0\.0\.1:(\d+)/i) ||
          text.match(/https?:\/\/\[::1\]:(\d+)/i)
        const anyMatch = text.match(/https?:\/\/[^\s]+/i)
        if (localMatch) {
          devServerUrl = localMatch[0]
          ready()
          return
        }
        if (anyMatch && text.includes('Local')) {
          devServerUrl = anyMatch[0]
          ready()
          return
        }
        if (text.includes('ready in')) {
          ready()
        }
      }

      const onError = (err) => {
        cleanup()
        console.log('[vite] start error:', err.message)
        if (attemptIndex + 1 < attempts.length) {
          attemptIndex += 1
          startAttempt()
          return
        }
        viteProcess = null
        finish()
      }

      const onExit = (code, signal) => {
        cleanup()
        if (!settled) {
          console.log(`[vite] exited: code=${code} signal=${signal}`)
        }
        if (code !== 0 && attemptIndex + 1 < attempts.length) {
          attemptIndex += 1
          startAttempt()
          return
        }
        if (code !== 0) {
          viteProcess = null
        }
        finish()
      }

      timer = setTimeout(ready, 15000)

      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.on('error', onError)
      child.on('exit', onExit)
    }

    startAttempt()
  })
}

function openWeb({ hostname, port, fn, webRoot }) {
  const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/'
    const pathname = rawUrl.split('?')[0] || '/'
    const isRoot = pathname === '/'
    const targetPath = isRoot ? 'index.html' : pathname
    const filePath = path.join(webRoot, targetPath)

    fs.readFile(filePath, (err, data) => {
      if (!err) {
        res.statusCode = 200
        res.setHeader('Content-Type', getContentType(filePath))
        res.end(data)
        return
      }

      // SPA fallback: return index.html for non-asset routes
      if (path.extname(pathname) === '') {
        const indexPath = path.join(webRoot, 'index.html')
        fs.readFile(indexPath, (indexErr, indexData) => {
          if (indexErr) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain')
            res.end('Internal Server Error')
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(indexData)
        })
        return
      }

      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain')
      res.end('Not Found')
    })
  });

  server.listen(port, hostname, () => {
    const url = `http://${hostname}:${port}`;
    // console.log(`Server running at http://${hostname}:${port}/`);
    // exec(`start chrome "${url}"`, (err, stdout, stderr) => {
    //     if (err) {
    //         console.error(`exec error: ${err}`);
    //         return;
    //     }
    //     console.log(`stdout: ${stdout}`);
    //     console.error(`stderr: ${stderr}`);
    // });
    fn()
  });

  function getContentType(filePath) {
    const extname = path.extname(filePath);
    switch (extname) {
      case '.html':
        return 'text/html';
      case '.css':
        return 'text/css';
      case '.js':
        return 'text/javascript';
      case '.json':
        return 'application/json';
      case '.svg':
        return 'image/svg+xml';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.woff2':
        return 'font/woff2';
      default:
        return 'text/plain';
    }
  }
}
function startApiChild() {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, './server/serialServer.js'), {
      silent: false,
      env: {
        ...process.env,
        isPackaged: isPackaged,
        appPath: app.getAppPath(),
        userData: app.getPath('userData'),
        resourcesPath: process.resourcesPath
      }
    })
    apiChild = child  // 保存引用以便退出时清理

    const readyTimer = setTimeout(() => {
      reject(new Error('API child not ready in time'));
    }, 15000);

    child.on('message', (msg) => {
      if (msg.type === 'ready') {
        clearTimeout(readyTimer);
        apiPort = msg.port;
        console.log(`[backend] serialServer ready on port ${msg.port}`);
        resolve(msg.port);
      } else if (msg?.type === 'error') {
        clearTimeout(readyTimer);
        console.error('[backend] serialServer error message:', msg);
        reject(new Error(`API child error: ${msg.code || ''} ${msg.message || ''}`));
      }
    })

    child.on('exit', (code, signal) => {
      // 如果需要可在这里做自动重启
      console.log(`API child exited: code=${code} signal=${signal}`);
    });
  })
}

// const child1 = fork(path.join(__dirname, './pyWorker.js'), {
//   env: {
//     isPackaged: isPackaged,
//     appPath: app.getAppPath()
//   }
// })

const createWindow = async () => {
  const win = new BrowserWindow({
    // width: 800,
    // height: 600,
    fullscreen: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true
    },

    icon: path.join(__dirname, 'logo.ico')

  })
  
  // win.maximize()
  if (shouldOpenDevTools) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  const hostname = "127.0.0.1";
  const port = 2999;


  // win.loadURL('http://sensor.bodyta.com/4096')

  // win.loadURL('https://sensor.bodyta.com/jqtools2')

  function fn() {
    win.loadURL(`http://${hostname}:${port}`)
  }

  if (!isPackaged) {
    console.log('[window] checking dev server first:', devServerUrl)
    let ok = await waitForDevServer(devServerUrl, 3000)
    if (!ok) {
      console.log('[window] starting vite dev server...')
      await startViteDevServer()
      console.log('[window] vite started, devServerUrl =', devServerUrl)
      ok = await waitForDevServer(devServerUrl, 20000)
    }
    console.log('[window] waitForDevServer result:', ok, 'url:', devServerUrl)
    if (!ok) {
      const safeUrl = devServerUrl
      const msg = encodeURIComponent(
        `Vite dev server not reachable: ${safeUrl}\n\n` +
        `Please run: npm run start (in ../front-end) and keep it running.`
      )
      win.loadURL(`data:text/plain;charset=utf-8,${msg}`)

      const retryTimer = setInterval(async () => {
        const alive = await checkDevServerOnce(devServerUrl, 1000)
        if (alive) {
          clearInterval(retryTimer)
          win.loadURL(devServerUrl)
        }
      }, 2000)
      win.on('closed', () => clearInterval(retryTimer))
      return
    }
    win.loadURL(devServerUrl)
    return
  }

  if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
    console.log(`[web] index.html not found: ${webRoot}`)
  }

  openWeb({ hostname, port, fn, webRoot })
}







function pyBin() {
  const isDev = !app.isPackaged
  if (process.platform === 'win32') {
    return isDev
      ? path.join(__dirname, 'python', 'venv', 'Scripts', 'python.exe')
      : path.join(process.resourcesPath, 'python', 'venv', 'Scripts', 'python.exe')
  } else {
    return isDev
      ? path.join(__dirname, 'python', 'venv', 'bin', 'python')
      : path.join(process.resourcesPath, 'python', 'venv', 'bin', 'python')
  }
}
function apiPy() {
  const isDev = !app.isPackaged
  return isDev
    ? path.join(__dirname, 'python', 'app', 'api.py')
    : path.join(process.resourcesPath, 'python', 'app', 'api.py')
}

function pyAiBin() {
  const isDev = !app.isPackaged
  const candidates = process.platform === 'win32'
    ? [
        isDev
          ? path.join(__dirname, 'python', 'venv', 'Scripts', 'python.exe')
          : path.join(process.resourcesPath, 'python', 'venv', 'Scripts', 'python.exe'),
        'python',
        'py'
      ]
    : [
        isDev
          ? path.join(__dirname, 'python', 'venv', 'bin', 'python')
          : path.join(process.resourcesPath, 'python', 'venv', 'bin', 'python'),
        isDev
          ? path.join(__dirname, 'python', 'venv', 'bin', 'python3')
          : path.join(process.resourcesPath, 'python', 'venv', 'bin', 'python3'),
        'python3',
        'python'
      ]

  return candidates.find((candidate) => !candidate.includes(path.sep) || fs.existsSync(candidate))
}

function aiApiPy() {
  const isDev = !app.isPackaged
  return isDev
    ? path.join(__dirname, 'python', 'app', 'algorithms', 'api_server.py')
    : path.join(process.resourcesPath, 'python', 'app', 'algorithms', 'api_server.py')
}

function aiRequirementsPath() {
  const isDev = !app.isPackaged
  return isDev
    ? path.join(__dirname, 'python', 'requirements-electron.txt')
    : path.join(process.resourcesPath, 'python', 'requirements-electron.txt')
}

function checkPythonAiDeps(pythonBin) {
  if (!pythonBin) {
    return { ok: false, reason: 'Python runtime not found' }
  }

  const probeCode = [
    'import fastapi',
    'import uvicorn',
    'import numpy',
    'import pydantic',
    'import matplotlib',
    'import pandas',
    'import cv2',
    'import scipy',
    'import skimage',
    'from PIL import Image',
  ].join('; ')

  try {
    const result = spawnSync(pythonBin, ['-c', probeCode], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      encoding: 'utf8',
    })

    if (result.status === 0) {
      return { ok: true }
    }

    const detail = (result.stderr || result.stdout || '').trim() || `exit ${result.status}`
    return { ok: false, reason: detail }
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}

async function startPythonAiChild() {
  if (await checkPythonAiOnce(1000)) {
    console.log(`[pyai] Python AI service already running on port ${pythonAiPort}`)
    return
  }

  if (pythonAiChild && !pythonAiChild.killed) {
    const ok = await waitForPythonAi(5000)
    if (ok) return
  }

  const pythonBin = pyAiBin()
  const scriptPath = aiApiPy()

  if (!pythonBin) {
    throw new Error('Python runtime not found for AI service')
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`AI api server not found: ${scriptPath}`)
  }

  const depsCheck = checkPythonAiDeps(pythonBin)
  if (!depsCheck.ok) {
    const requirementsPath = aiRequirementsPath()
    const installHint = fs.existsSync(requirementsPath)
      ? `Install Python deps with: ${pythonBin} -m pip install -r "${requirementsPath}"`
      : 'Install the Python AI dependencies before starting the packaged app'
    throw new Error(`Python AI dependencies missing: ${depsCheck.reason}. ${installHint}`)
  }

  console.log(`[pyai] starting AI service with ${pythonBin}`)
  console.log(`[pyai] script path: ${scriptPath}`)

  const child = spawn(pythonBin, [scriptPath], {
    cwd: path.dirname(scriptPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHON_API_PORT: String(pythonAiPort)
    },
    shell: false,
    windowsHide: true
  })

  pythonAiChild = child

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text && text.trim()) {
      process.stdout.write(`[pyai] ${text}`)
    }
  })

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString()
    if (text && text.trim()) {
      process.stderr.write(`[pyai] ${text}`)
    }
  })

  child.on('error', (err) => {
    console.error('[pyai] start error:', err.message)
  })

  child.on('exit', (code, signal) => {
    console.log(`[pyai] exited: code=${code} signal=${signal}`)
    if (pythonAiChild === child) {
      pythonAiChild = null
    }
  })

  const ok = await waitForPythonAi(15000)
  if (!ok) {
    throw new Error(`Python AI service did not become ready on port ${pythonAiPort}`)
  }

  console.log(`[pyai] ready on http://127.0.0.1:${pythonAiPort}`)
}

/** 主进程里直接像调用函数一样用 */
// function callPy(fn, args) {
//   return new Promise((resolve, reject) => {
//     const child = spawn(pyBin(), [apiPy()], {
//       stdio: ['pipe', 'pipe', 'pipe'],
//       env: { ...process.env, PYTHONUNBUFFERED: '1' }
//     })
//     let out = '', err = ''
//     child.stdout.on('data', d => (out += d.toString()))
//     child.stderr.on('data', d => (err += d.toString()))
//     child.on('error', e => reject(new Error('spawn error: ' + e.message)))
//     child.on('close', code => {
//       if (code !== 0) return reject(new Error(`Python exit ${code}\n${err}`))
//       try {
//         const last = (out.trim().split(/\r?\n/).pop() || '{}')
//         // console.log(last, 'last')
//         const res = JSON.parse(last)
//         if (res.ok) resolve(res.data)
//         else reject(new Error(res.error + '\n' + (res.trace || '')))
//       } catch (e) {
//         reject(new Error('Parse fail: ' + e.message + '\nraw: ' + out))
//       }
//     })
//     child.stdin.write(JSON.stringify({ fn, args }) + '\n')
//     child.stdin.end()
//   })
// }

let py = null;
let buf = '';
const pending = new Map();

// function startPy() {
//   py = spawn(pyBin(), [apiPy()], { stdio: ['pipe','pipe','pipe'] });
//   py.stdout.on('data', d => {
//     buf += d.toString();
//     const lines = buf.split(/\r?\n/); buf = lines.pop() || '';
//     for (const line of lines) {
//       if (!line.trim()) continue;
//       const msg = JSON.parse(line);
//       const cb = pending.get(msg.id);
//       if (cb) { pending.delete(msg.id); cb(msg.data); }
//     }
//   });
//   py.stderr.on('data', d => console.error('[PY]', d.toString()));
//   py.on('exit', ()=>{ py=null; setTimeout(startPy, 300); });
// }

// function callPy(fn, args) {
//   if (!py) startPy();
//   const id = Math.random().toString(36).slice(2);
//   return new Promise(resolve => {
//     pending.set(id, resolve);
//     py?.stdin.write(JSON.stringify({ id, fn, args }) + '\n');
//   });
// }


// child.on('message', (msg) => {
//   console.log('主线程', msg)
// })

function startServerProcess() {

}

// 调用你的函数（示例）
// async function demo(matrix) {
//   // 构造一条 1024 长度的测试数据

//   // console.log(matrix)
//   // const data = new Array(10).fill(new Array(1024).fill(50)); // 可以放多条
//   // const res = await callPy('cal_cop_fromData', { data : matrix });
//   const res = await callPy('cal_cop_fromData', { data: matrix });
//   console.log(res);
//   console.log('结果:', res, new Date().getTime()); // { left: [...], right: [...] }
// }

app.whenReady().then(async () => {
  const uuid = await getHardwareFingerprint()
  const dateKey = await getKeyfromWinuuid(uuid)
  console.log(uuid, dateKey)

  // 开始本地api线程
  await startApiChild()
  try {
    await startPythonAiChild()
  } catch (err) {
    console.warn('[pyai] AI service unavailable, continuing without AI report generation:', err.message)
  }
  // 开启python线程
  // startWorker(); // [已迁移到JS算法] Python子进程不再需要
  await createWindow()

  Menu.setApplicationMenu(null);
  registerUpdaterIpcHandlers()

  // 初始化自动更新（仅在打包后的生产环境启用）
  if (isPackaged) {
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length > 0) {
      initAutoUpdater(allWindows[0])
    }
  } else {
    console.log('[updater] 开发模式，跳过自动更新初始化')
  }

  // const data1 = await getCsvData('D:/jqtoolsWin - 副本/python/app/静态数据集1.csv')

  // const matrix = data1.map((a) => JSON.parse(a.data))

  // try {
  //   console.log('setTimeout')
  //   const data = await callPy('getData', { data: new Array(1024).fill(20)})

  //   //  {
  //   //   'frameData': new Array(1024).fill(0),
  //   //   'tim': new Date().getTime() % 1000,
  //   //   'threshold_factor': 25,
  //   //   'continuous_on_bed_duration_minutes': 1.0,
  //   //   'unlock_sitting_alarm_duration_minutes': 1.0,
  //   //   'unlock_falling_alarm_duration_minutes': 1.0,
  //   //   'sosPeakThreshold': 25.0,
  //   //   'points_threshold_in': 3.0
  //   // }
  //   console.log(data, 'data')
  // }
  // catch (e) {
  //   console.error('[PY ERROR]', e)
  // }


  // try {
  //   const r1 = await callPy('cal_cop_fromData', {data : new Array(10).fill(new Array(1024).fill(0))})
  //   // const r2 = await callPy('add_and_scale', { a: 1, b: 2, scale: 10 })
  //   console.log('[PY] add =>', r1)
  //   console.log('[PY] add_and_scale =>', r2)
  // } catch (e) {
  //   console.error('[PY ERROR]', e)
  // }
  // try {
  //   const a = await demo(matrix)
  //   await demo(matrix)
  //   await demo(matrix)
  //   await demo(matrix)
  //   await demo(matrix)
  //   await demo(matrix)
  //   await demo(matrix)
  //   await demo(matrix)
  // } catch (e) {
  //   console.log(e)
  // }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  // 清理自动更新定时器
  cleanupUpdater()
  // 清理 Vite 开发服务器子进程
  if (viteProcess) {
    viteProcess.kill()
    viteProcess = null
  }
  // 清理 serialServer 子进程（占用端口 19245 + 19999）
  if (apiChild) {
    apiChild.kill()
    apiChild = null
  }
  if (pythonAiChild) {
    pythonAiChild.kill()
    pythonAiChild = null
  }
})

// 兜底：确保进程退出时强制清理所有子进程
app.on('will-quit', () => {
  if (apiChild && !apiChild.killed) {
    apiChild.kill('SIGKILL')
    apiChild = null
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill('SIGKILL')
    viteProcess = null
  }
  if (pythonAiChild && !pythonAiChild.killed) {
    pythonAiChild.kill('SIGKILL')
    pythonAiChild = null
  }
})
