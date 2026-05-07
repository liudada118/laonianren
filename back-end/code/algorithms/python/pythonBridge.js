const { spawn, spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

function loadPythonRuntimeHelpers() {
  try {
    return require('../../util/pythonRuntime')
  } catch (localErr) {
    const runtimeResourceBase = process.env.resourcesPath || process.resourcesPath || ''
    const packagedRuntimeModule = runtimeResourceBase
      ? path.join(runtimeResourceBase, 'app.asar', 'util', 'pythonRuntime.js')
      : ''

    if (packagedRuntimeModule && fs.existsSync(packagedRuntimeModule)) {
      return require(packagedRuntimeModule)
    }

    throw localErr
  }
}

const {
  getPackagedPythonBinary,
  getPackagedPythonEnv,
} = loadPythonRuntimeHelpers()

const resourceBase = process.env.resourcesPath || process.resourcesPath || ''
const DEFAULT_TIMEOUT_MS = parseInt(process.env.PY_TIMEOUT_MS, 10) || 180000
const PY_PROBE_TIMEOUT_MS = parseInt(process.env.PY_PROBE_TIMEOUT_MS, 10) || 20000
const RESULT_START = '__PY_RESULT_START__'
const RESULT_END = '__PY_RESULT_END__'

let _pythonCmd = null
let _pythonEnv = null

function isPackagedRuntime(base = resourceBase) {
  const explicitFlag = String(process.env.isPackaged || '').toLowerCase()
  if (explicitFlag === 'true' || explicitFlag === '1') return true
  if (explicitFlag === 'false' || explicitFlag === '0') return false

  return (
    (typeof base === 'string' && base.includes(`${path.sep}Contents${path.sep}Resources`))
  )
}

function resolveBridgeScript() {
  const localBridge = path.join(__dirname, 'bridge.py')

  if (!resourceBase) {
    return localBridge
  }

  const packagedBridge = path.join(resourceBase, 'algorithms', 'python', 'bridge.py')
  if (fs.existsSync(packagedBridge)) {
    return packagedBridge
  }

  const unpackedBridge = localBridge.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  )
  if (fs.existsSync(unpackedBridge)) {
    return unpackedBridge
  }

  return localBridge
}

function buildPythonEnv(extraEnv = {}, base = resourceBase) {
  return {
    ...getPackagedPythonEnv({ baseEnv: process.env, resourceBase: base }),
    ...extraEnv,
  }
}

function buildSelectedPythonEnv(extraEnv = {}) {
  return {
    ...(_pythonEnv || buildPythonEnv({}, resourceBase)),
    ...extraEnv,
  }
}

function getProjectVenvPython(isWin = process.platform === 'win32') {
  return path.resolve(
    __dirname,
    '..',
    '..',
    'python',
    'venv',
    isWin ? 'Scripts' : 'bin',
    isWin ? 'python.exe' : 'python'
  )
}

function getProjectVenvInfo() {
  const venvDir = path.resolve(__dirname, '..', '..', 'python', 'venv')
  const cfgPath = path.join(venvDir, 'pyvenv.cfg')
  const libDir = path.join(venvDir, 'lib')
  let version = null
  let fullVersion = null
  let home = null
  let executable = null
  let sitePackages = null

  try {
    if (fs.existsSync(cfgPath)) {
      const cfgText = fs.readFileSync(cfgPath, 'utf8')
      const versionMatch = cfgText.match(/^version\s*=\s*([0-9]+(?:\.[0-9]+){1,2})/m)
      if (versionMatch) {
        fullVersion = versionMatch[1]
        version = fullVersion.split('.').slice(0, 2).join('.')
      }
      const homeMatch = cfgText.match(/^home\s*=\s*(.+)$/m)
      if (homeMatch) {
        home = homeMatch[1].trim()
      }
      const executableMatch = cfgText.match(/^executable\s*=\s*(.+)$/m)
      if (executableMatch) {
        executable = executableMatch[1].trim()
      }
    }
  } catch {}

  try {
    if (fs.existsSync(libDir)) {
      const pyLibDir = fs.readdirSync(libDir).find((name) => /^python\d+\.\d+$/.test(name))
      if (pyLibDir) {
        version = version || pyLibDir.replace(/^python/, '')
        const candidate = path.join(libDir, pyLibDir, 'site-packages')
        if (fs.existsSync(candidate)) {
          sitePackages = candidate
        }
      }
    }
  } catch {}

  return { venvDir, version, fullVersion, home, executable, sitePackages }
}

function prependPythonPath(env, extraPaths = []) {
  const filtered = extraPaths.filter(Boolean)
  if (!filtered.length) return env

  const current = env.PYTHONPATH || ''
  return {
    ...env,
    PYTHONPATH: [...filtered, current].filter(Boolean).join(path.delimiter),
  }
}

function getHealthyDevPythonCandidates(isWin = process.platform === 'win32') {
  const { version, fullVersion, home, executable } = getProjectVenvInfo()
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir()
  const pyenvVersions = [...new Set([fullVersion, version].filter(Boolean))]
  const pyenvVersionDirs = homeDir
    ? pyenvVersions.map((item) => path.join(homeDir, '.pyenv', 'versions', item))
    : []

  const candidates = [
    getProjectVenvPython(isWin),
    ...(!isWin ? [
      path.resolve(__dirname, '..', '..', 'python', 'venv', 'bin', 'python3'),
      path.resolve(__dirname, '..', '..', 'python', 'venv', 'bin', 'python3.11'),
    ] : []),
    executable,
    ...(home ? [
      path.join(home, isWin ? 'python.exe' : `python${version || '3.11'}`),
      path.join(home, isWin ? 'python.exe' : 'python3'),
      path.join(home, isWin ? 'python.exe' : 'python'),
    ] : []),
    ...pyenvVersionDirs.flatMap((pyenvVersionDir) => [
      path.join(pyenvVersionDir, 'bin', `python${version || '3.11'}`),
      path.join(pyenvVersionDir, 'bin', 'python3'),
      path.join(pyenvVersionDir, 'bin', 'python'),
    ]),
    ...(isWin ? ['python', 'python3', 'py -3', 'py'] : [`python${version || '3.11'}`, 'python3', 'python']),
  ]

  return [...new Set(candidates.filter(Boolean))]
}

function getPackagedVenvPython(base = resourceBase, isWin = process.platform === 'win32') {
  if (!base) return null
  const candidate = path.join(
    base,
    'python',
    'venv',
    isWin ? 'Scripts' : 'bin',
    isWin ? 'python.exe' : 'python'
  )
  return fs.existsSync(candidate) ? candidate : null
}

function getLegacyWindowsPython(base = '') {
  const candidate = base
    ? path.join(base, 'python', 'Python311', 'python.exe')
    : path.resolve(__dirname, '..', '..', 'python', 'Python311', 'python.exe')
  return fs.existsSync(candidate) ? candidate : null
}

function parseCmdParts(cmd) {
  const raw = (cmd || '').trim()
  if (!raw) return { cmd: '', args: [] }

  const unquoted =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw

  if (fs.existsSync(unquoted)) {
    return { cmd: unquoted, args: [] }
  }

  const parts = raw.match(/"[^"]*"|'[^']*'|\S+/g) || []
  const normalized = parts.map((part) => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      return part.slice(1, -1)
    }
    return part
  })

  return { cmd: normalized[0] || '', args: normalized.slice(1) }
}

function probePythonResult(cmd, checkRuntimeDeps = false, env = process.env, expectedVersion = null) {
  const parts = parseCmdParts(cmd)
  if (!parts.cmd) return { ok: false, reason: 'empty command' }

  const checks = ['import sys']
  if (expectedVersion) {
    const [major, minor] = String(expectedVersion).split('.').map((item) => parseInt(item, 10))
    if (major && minor) {
      checks.push(`assert sys.version_info[:2] == (${major}, ${minor}), sys.version`)
    }
  }
  if (checkRuntimeDeps) {
    checks.push('import numpy,cv2')
  }
  checks.push('print(sys.version.split()[0])')
  if (checkRuntimeDeps) {
    checks.push('print(numpy.__version__)')
  }
  const probeCode = checks.join(';')

  const result = spawnSync(parts.cmd, [...parts.args, '-c', probeCode], {
    timeout: PY_PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: 'utf8',
    env,
  })

  if (result.error) {
    return {
      ok: false,
      reason: result.error.message,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    }
  }

  const stderr = (result.stderr || '').trim()
  const stdout = (result.stdout || '').trim()
  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
    reason: stderr || stdout || `exit ${result.status}`,
  }
}

function probePython(cmd, checkRuntimeDeps = false, env = process.env, expectedVersion = null) {
  return probePythonResult(cmd, checkRuntimeDeps, env, expectedVersion).ok
}

function getPythonCmd() {
  if (_pythonCmd) return _pythonCmd

  const packagedMode = isPackagedRuntime(resourceBase)
  const packagedEnv = buildPythonEnv({}, resourceBase)
  const isWin = process.platform === 'win32'

  if (process.env.PYTHON_CMD) {
    const envCmd = process.env.PYTHON_CMD
    if (probePython(envCmd, true, packagedEnv)) {
      _pythonCmd = envCmd
      _pythonEnv = packagedEnv
      console.log(`[Python] using PYTHON_CMD: ${_pythonCmd}`)
      return _pythonCmd
    }
    console.warn(`[Python] ignoring invalid PYTHON_CMD: ${envCmd}`)
  }

  const packagedCandidates = [
    getPackagedPythonBinary(resourceBase),
    getPackagedVenvPython(resourceBase, isWin),
    isWin ? getLegacyWindowsPython(resourceBase) : null,
  ].filter(Boolean)

  if (packagedMode) {
    for (const candidate of packagedCandidates) {
      const probe = probePythonResult(candidate, true, packagedEnv)
      if (probe.ok) {
        _pythonCmd = candidate
        _pythonEnv = packagedEnv
        console.log(`[Python] using bundled runtime: ${_pythonCmd}`)
        return _pythonCmd
      }
      console.error(`[Python] bundled runtime probe failed: ${candidate} -> ${probe.reason}`)
    }

    if (packagedCandidates.length > 0) {
      _pythonCmd = packagedCandidates[0]
      _pythonEnv = packagedEnv
      console.error(`[Python] packaged mode fallback to bundled candidate without probe: ${_pythonCmd}`)
      return _pythonCmd
    }

    throw new Error(`Bundled Python runtime not found in packaged app: ${resourceBase || '<unknown>'}`)
  }

  const projectVenvInfo = getProjectVenvInfo()
  const devEnv = prependPythonPath(packagedEnv, [projectVenvInfo.sitePackages])
  for (const candidate of getHealthyDevPythonCandidates(isWin)) {
    const probe = probePythonResult(candidate, true, devEnv, projectVenvInfo.version)
    if (probe.ok) {
      _pythonCmd = candidate
      _pythonEnv = devEnv
      console.log(`[Python] using dev runtime: ${_pythonCmd}`)
      return _pythonCmd
    }
  }

  if (isWin) {
    const localLegacyPy = getLegacyWindowsPython()
    if (localLegacyPy && probePython(localLegacyPy, true, packagedEnv)) {
      _pythonCmd = localLegacyPy
      _pythonEnv = packagedEnv
      console.log(`[Python] using project Python311: ${_pythonCmd}`)
      return _pythonCmd
    }
  }

  const systemCandidates = isWin
    ? ['python', 'python3', 'py -3', 'py']
    : ['python3', 'python']

  for (const candidate of systemCandidates) {
    if (!probePython(candidate, true, packagedEnv)) continue
    _pythonCmd = candidate
    _pythonEnv = packagedEnv
    console.log(`[Python] using system command: ${_pythonCmd}`)
    return _pythonCmd
  }

  _pythonCmd = isWin ? 'python' : 'python3'
  _pythonEnv = packagedEnv
  console.warn(`[Python] falling back to default command: ${_pythonCmd}`)
  return _pythonCmd
}

async function callPython(funcName, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeoutMs =
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS
    let timedOut = false
    let forceKillTimer = null
    let timeoutTimer = null

    const fail = (err) => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      reject(err)
    }

    const inputData = JSON.stringify({
      func: funcName,
      params,
    })

    let pythonCmd
    try {
      pythonCmd = getPythonCmd()
    } catch (err) {
      fail(err)
      return
    }

    console.log(
      `[Python] 调用 ${funcName}, 输入数据大小: ${(inputData.length / 1024).toFixed(1)}KB, cmd: ${pythonCmd}`
    )

    const cmdParts = parseCmdParts(pythonCmd)
    const spawnCmd = cmdParts.cmd
    const spawnArgs = [...cmdParts.args, resolveBridgeScript()]

    let child
    try {
      child = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: buildSelectedPythonEnv({
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          MPLBACKEND: 'Agg',
        }),
      })
    } catch (spawnErr) {
      fail(new Error(`Cannot spawn Python process (cmd: ${pythonCmd}): ${spawnErr.message}`))
      return
    }

    timeoutTimer = setTimeout(() => {
      if (settled) return
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {}
      forceKillTimer = setTimeout(() => {
        if (settled) return
        try {
          child.kill('SIGKILL')
        } catch {}
      }, 5000)
      if (typeof forceKillTimer.unref === 'function') {
        forceKillTimer.unref()
      }
    }, timeoutMs)
    if (typeof timeoutTimer.unref === 'function') {
      timeoutTimer.unref()
    }

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
      const msg = data.toString().trim()
      if (msg && !msg.includes('UserWarning') && !msg.includes('font') && !msg.includes('Matplotlib')) {
        console.log('[Python stderr]', msg.substring(0, 500))
      }
    })

    child.stdin.on('error', (err) => {
      console.error(`[Python] stdin 写入错误: ${err.message}`)
    })

    child.on('close', (code, signal) => {
      if (settled) return
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)

      if (code !== 0 || signal) {
        const errMsg = timedOut
          ? `Python process timed out after ${timeoutMs}ms`
          : `Python process exited with code ${code}${signal ? ` signal ${signal}` : ''}`
        fail(new Error(`${errMsg}: ${stderr.substring(0, 500)}`))
        return
      }

      try {
        const startIdx = stdout.indexOf(RESULT_START)
        const endIdx = stdout.indexOf(RESULT_END)
        if (startIdx === -1 || endIdx === -1) {
          fail(new Error('Python output missing result markers'))
          return
        }

        const jsonStr = stdout.substring(startIdx + RESULT_START.length, endIdx).trim()
        const result = JSON.parse(jsonStr)
        if (!result.success) {
          fail(new Error(`Python algorithm error: ${result.error}`))
          return
        }

        settled = true
        resolve(result.data)
      } catch (err) {
        fail(new Error(`Failed to parse Python output: ${err.message}`))
      }
    })

    child.on('error', (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      fail(new Error(`Python process error: ${err.message}`))
    })

    try {
      child.stdin.write(inputData, (writeErr) => {
        if (writeErr) {
          console.error(`[Python] stdin.write 回调错误: ${writeErr.message}`)
          return
        }
        try {
          child.stdin.end()
        } catch (endErr) {
          console.error(`[Python] stdin.end 错误: ${endErr.message}`)
        }
      })
    } catch (writeErr) {
      fail(new Error(`Failed to write to Python stdin: ${writeErr.message}`))
    }
  })
}

module.exports = { callPython }
