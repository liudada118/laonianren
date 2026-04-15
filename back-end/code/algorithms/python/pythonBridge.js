const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const resourceBase = process.env.resourcesPath || process.resourcesPath || '';
const isPackagedMode = process.env.isPackaged === 'true';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.PY_TIMEOUT_MS, 10) || 180000;
const RESULT_START = '__PY_RESULT_START__';
const RESULT_END = '__PY_RESULT_END__';

let _pythonCmd = null;

function getPackagedRuntimeDir() {
  if (!isPackagedMode || !resourceBase) return '';
  return path.join(resourceBase, 'python', 'runtime');
}

function getPackagedRuntimePython(isWin = process.platform === 'win32') {
  const runtimeDir = getPackagedRuntimeDir();
  if (!runtimeDir) return '';
  return isWin
    ? path.join(runtimeDir, 'python.exe')
    : path.join(runtimeDir, 'bin', 'python');
}

function getBridgeScriptPath() {
  const packagedBridgeScript = isPackagedMode && resourceBase
    ? path.join(resourceBase, 'algorithms', 'python', 'bridge.py')
    : '';
  if (packagedBridgeScript && fs.existsSync(packagedBridgeScript)) {
    return packagedBridgeScript;
  }
  return path.join(__dirname, 'bridge.py');
}

function buildPythonEnv(extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  };
  const runtimeDir = getPackagedRuntimeDir();
  if (runtimeDir && fs.existsSync(runtimeDir)) {
    env.PYTHONHOME = runtimeDir;
    env.PYTHONNOUSERSITE = '1';
  }
  return env;
}

function parseCmdParts(cmd) {
  const raw = (cmd || '').trim();
  if (!raw) return { cmd: '', args: [] };

  const unquoted =
    (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;

  if (fs.existsSync(unquoted)) {
    return { cmd: unquoted, args: [] };
  }

  const parts = raw.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const normalized = parts.map((part) => {
    if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
      return part.slice(1, -1);
    }
    return part;
  });

  return { cmd: normalized[0] || '', args: normalized.slice(1) };
}

function probePython(cmd, checkNumpy = false) {
  const parts = parseCmdParts(cmd);
  if (!parts.cmd) return false;

  const probeCode = checkNumpy
    ? 'import sys,numpy;print(sys.version.split()[0]);print(numpy.__version__)'
    : 'import sys;print(sys.version.split()[0])';

  const result = spawnSync(parts.cmd, [...parts.args, '-c', probeCode], {
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: 'utf8',
    env: buildPythonEnv(),
  });

  return result.status === 0;
}

function getPythonCmd() {
  if (_pythonCmd) return _pythonCmd;

  if (process.env.PYTHON_CMD) {
    const envCmd = process.env.PYTHON_CMD;
    if (probePython(envCmd, true)) {
      _pythonCmd = envCmd;
      console.log(`[Python] using PYTHON_CMD: ${_pythonCmd}`);
      return _pythonCmd;
    }
    console.warn(`[Python] ignoring invalid PYTHON_CMD: ${envCmd}`);
  }

  const isWin = process.platform === 'win32';
  const packagedRuntimePy = getPackagedRuntimePython(isWin);
  if (packagedRuntimePy && fs.existsSync(packagedRuntimePy) && probePython(packagedRuntimePy, true)) {
    _pythonCmd = packagedRuntimePy;
    console.log(`[Python] using bundled runtime: ${_pythonCmd}`);
    return _pythonCmd;
  }

  const localVenvPy = path.resolve(
    __dirname,
    '..',
    '..',
    'python',
    'venv',
    isWin ? 'Scripts' : 'bin',
    isWin ? 'python.exe' : 'python',
  );
  if (fs.existsSync(localVenvPy) && probePython(localVenvPy, true)) {
    _pythonCmd = localVenvPy;
    console.log(`[Python] using project venv: ${_pythonCmd}`);
    return _pythonCmd;
  }

  if (isPackagedMode) {
    throw new Error(`Bundled Python runtime not found or invalid: ${packagedRuntimePy || getPackagedRuntimeDir()}`);
  }

  if (isWin) {
    const localLegacyPy = path.resolve(__dirname, '..', '..', 'python', 'Python311', 'python.exe');
    if (fs.existsSync(localLegacyPy) && probePython(localLegacyPy, true)) {
      _pythonCmd = localLegacyPy;
      console.log(`[Python] using project Python311: ${_pythonCmd}`);
      return _pythonCmd;
    }
  }

  const candidates = isWin
    ? ['python', 'python3', 'py -3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      if (!probePython(cmd, true)) continue;
      _pythonCmd = cmd;
      console.log(`[Python] using system command: ${_pythonCmd}`);
      return _pythonCmd;
    } catch {
    }
  }

  _pythonCmd = isWin ? 'python' : 'python3';
  console.warn(`[Python] falling back to default command: ${_pythonCmd}`);
  return _pythonCmd;
}

async function callPython(funcName, params = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutMs =
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    let forceKillTimer = null;
    let timeoutTimer = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(err);
    };

    const inputData = JSON.stringify({
      func: funcName,
      params,
    });

    let pythonCmd;
    try {
      pythonCmd = getPythonCmd();
    } catch (err) {
      fail(err);
      return;
    }

    console.log(
      `[Python] calling ${funcName}, payload ${(inputData.length / 1024).toFixed(1)}KB, cmd: ${pythonCmd}`,
    );

    const cmdParts = parseCmdParts(pythonCmd);
    const spawnCmd = cmdParts.cmd;
    const spawnArgs = [...cmdParts.args, getBridgeScriptPath()];

    let child;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: buildPythonEnv({
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          MPLBACKEND: 'Agg',
        }),
      });
    } catch (spawnErr) {
      fail(new Error(`Cannot spawn Python process (cmd: ${pythonCmd}): ${spawnErr.message}`));
      return;
    }

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      forceKillTimer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 5000);
      if (typeof forceKillTimer.unref === 'function') {
        forceKillTimer.unref();
      }
    }, timeoutMs);
    if (typeof timeoutTimer.unref === 'function') {
      timeoutTimer.unref();
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      const msg = data.toString().trim();
      if (msg && !msg.includes('UserWarning') && !msg.includes('font') && !msg.includes('Matplotlib')) {
        console.log('[Python stderr]', msg.substring(0, 500));
      }
    });

    child.stdin.on('error', (err) => {
      console.error(`[Python] stdin error: ${err.message}`);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);

      if (code !== 0 || signal) {
        const errMsg = timedOut
          ? `Python process timed out after ${timeoutMs}ms`
          : `Python process exited with code ${code}${signal ? ` signal ${signal}` : ''}`;
        fail(new Error(`${errMsg}: ${stderr.substring(0, 500)}`));
        return;
      }

      try {
        const startIdx = stdout.indexOf(RESULT_START);
        const endIdx = stdout.indexOf(RESULT_END);
        if (startIdx === -1 || endIdx === -1) {
          fail(new Error('Python output missing result markers'));
          return;
        }

        const jsonStr = stdout.substring(startIdx + RESULT_START.length, endIdx).trim();
        const result = JSON.parse(jsonStr);
        if (!result.success) {
          fail(new Error(`Python algorithm error: ${result.error}`));
          return;
        }

        settled = true;
        resolve(result.data);
      } catch (err) {
        fail(new Error(`Failed to parse Python output: ${err.message}`));
      }
    });

    child.on('error', (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      fail(new Error(`Python process error: ${err.message}`));
    });

    try {
      child.stdin.write(inputData, (writeErr) => {
        if (writeErr) {
          return;
        }
        try {
          child.stdin.end();
        } catch {}
      });
    } catch (writeErr) {
      fail(new Error(`Failed to write to Python stdin: ${writeErr.message}`));
    }
  });
}

module.exports = { callPython };
