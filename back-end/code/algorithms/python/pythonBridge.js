const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  getPackagedPythonBinary,
  getPackagedPythonEnv,
} = require('../../util/pythonRuntime');

const DEFAULT_TIMEOUT_MS = parseInt(process.env.PY_TIMEOUT_MS, 10) || 180000;
const PY_PROBE_TIMEOUT_MS = parseInt(process.env.PY_PROBE_TIMEOUT_MS, 10) || 20000;
const RESULT_START = '__PY_RESULT_START__';
const RESULT_END = '__PY_RESULT_END__';

let selectedPythonCmd = null;
let selectedPythonEnv = null;
let selectedBridgeScript = null;

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

function getResourceBase() {
  return process.env.resourcesPath || process.resourcesPath || '';
}

function isPackagedMode() {
  const flag = String(process.env.isPackaged || '').toLowerCase();
  return flag === 'true' || flag === '1';
}

function getBridgeScript() {
  if (selectedBridgeScript) return selectedBridgeScript;

  const resourceBase = getResourceBase();
  const candidates = [];
  if (process.env.PYTHON_BRIDGE_SCRIPT) {
    candidates.push(process.env.PYTHON_BRIDGE_SCRIPT);
  }
  if (resourceBase) {
    candidates.push(path.join(resourceBase, 'algorithms', 'python', 'bridge.py'));
  }
  candidates.push(path.join(__dirname, 'bridge.py'));
  candidates.push(path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'bridge.py'));

  selectedBridgeScript = candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates[0];
  if (!selectedBridgeScript || !fs.existsSync(selectedBridgeScript)) {
    console.warn(`[Python] bridge.py not found, tried: ${candidates.join(' | ')}`);
  }
  return selectedBridgeScript;
}

function probePython(cmd, env = process.env) {
  const parts = parseCmdParts(cmd);
  if (!parts.cmd) return { ok: false, reason: 'empty command' };

  const probeCode = [
    'import sys',
    'import numpy,pandas,cv2,scipy,matplotlib,seaborn,skimage,reportlab',
    'from PIL import Image',
    'print(sys.version.split()[0])',
    'print(numpy.__version__)',
  ].join(';');

  const result = spawnSync(parts.cmd, [...parts.args, '-c', probeCode], {
    timeout: PY_PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: 'utf8',
    env,
  });

  if (result.error) {
    return { ok: false, reason: result.error.message };
  }
  return {
    ok: result.status === 0,
    reason: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
  };
}

function getProjectVenvPython() {
  const isWin = process.platform === 'win32';
  return path.resolve(
    __dirname,
    '..',
    '..',
    'python',
    'venv',
    isWin ? 'Scripts' : 'bin',
    isWin ? 'python.exe' : 'python',
  );
}

function getLegacyProjectPython() {
  if (process.platform !== 'win32') return null;
  const candidate = path.resolve(__dirname, '..', '..', 'python', 'Python311', 'python.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

function getPythonCmd() {
  if (selectedPythonCmd) return selectedPythonCmd;

  const resourceBase = getResourceBase();
  const packagedEnv = getPackagedPythonEnv({ baseEnv: process.env, resourceBase });

  if (process.env.PYTHON_CMD) {
    const probe = probePython(process.env.PYTHON_CMD, packagedEnv);
    if (probe.ok) {
      selectedPythonCmd = process.env.PYTHON_CMD;
      selectedPythonEnv = packagedEnv;
      console.log(`[Python] using PYTHON_CMD: ${selectedPythonCmd}`);
      return selectedPythonCmd;
    }
    console.warn(`[Python] ignoring invalid PYTHON_CMD: ${process.env.PYTHON_CMD} -> ${probe.reason}`);
  }

  const packagedPython = getPackagedPythonBinary(resourceBase);
  if (packagedPython) {
    const probe = probePython(packagedPython, packagedEnv);
    if (probe.ok) {
      selectedPythonCmd = packagedPython;
      selectedPythonEnv = packagedEnv;
      console.log(`[Python] using bundled runtime: ${selectedPythonCmd}`);
      return selectedPythonCmd;
    }
    console.error(`[Python] bundled runtime probe failed: ${packagedPython} -> ${probe.reason}`);
  }

  if (isPackagedMode()) {
    throw new Error(`Bundled Python runtime not found or missing dependencies: ${packagedPython || path.join(resourceBase || '<resources>', 'python', 'runtime')}`);
  }

  const devCandidates = [
    getProjectVenvPython(),
    getLegacyProjectPython(),
    ...(process.platform === 'win32' ? ['python', 'python3', 'py -3', 'py'] : ['python3', 'python']),
  ].filter(Boolean);

  for (const candidate of devCandidates) {
    const probe = probePython(candidate, packagedEnv);
    if (!probe.ok) continue;
    selectedPythonCmd = candidate;
    selectedPythonEnv = packagedEnv;
    console.log(`[Python] using dev runtime: ${selectedPythonCmd}`);
    return selectedPythonCmd;
  }

  selectedPythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  selectedPythonEnv = packagedEnv;
  console.warn(`[Python] falling back to default command: ${selectedPythonCmd}`);
  return selectedPythonCmd;
}

function getPythonEnv(extraEnv = {}) {
  return {
    ...(selectedPythonEnv || getPackagedPythonEnv({ baseEnv: process.env, resourceBase: getResourceBase() })),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    MPLBACKEND: 'Agg',
    ...extraEnv,
  };
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

    const inputData = JSON.stringify({ func: funcName, params });

    let pythonCmd;
    try {
      pythonCmd = getPythonCmd();
    } catch (err) {
      fail(err);
      return;
    }

    const bridgeScript = getBridgeScript();
    if (!bridgeScript || !fs.existsSync(bridgeScript)) {
      fail(new Error(`Python bridge.py not found: ${bridgeScript}`));
      return;
    }

    console.log(
      `[Python] 调用 ${funcName}, 输入数据大小: ${(inputData.length / 1024).toFixed(1)}KB, cmd: ${pythonCmd}, bridge: ${bridgeScript}`,
    );

    const cmdParts = parseCmdParts(pythonCmd);
    const spawnCmd = cmdParts.cmd;
    const spawnArgs = [...cmdParts.args, bridgeScript];

    let child;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: getPythonEnv(),
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
      console.error(`[Python] stdin 写入错误: ${err.message}`);
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
          console.error(`[Python] stdin.write 回调错误: ${writeErr.message}`);
          return;
        }
        try {
          child.stdin.end();
        } catch (endErr) {
          console.error(`[Python] stdin.end 错误: ${endErr.message}`);
        }
      });
    } catch (writeErr) {
      fail(new Error(`Failed to write to Python stdin: ${writeErr.message}`));
    }
  });
}

module.exports = { callPython };
