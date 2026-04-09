/**
 * Python 算法统一桥接模块
 * ========================
 * 通过 Node.js 子进程调用 Python bridge.py，实现所有算法的统一调用。
 * 自动检测 Python 可执行文件路径，兼容 Windows / macOS / Linux。
 *
 * 用法:
 *   const { callPython } = require('./python/pythonBridge');
 *   const result = await callPython('generate_grip_render_report', { sensor_data, hand_type });
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRIDGE_SCRIPT = path.join(__dirname, 'bridge.py');

// 超时时间（毫秒）
const DEFAULT_TIMEOUT_MS = parseInt(process.env.PY_TIMEOUT_MS, 10) || 180000; // 3分钟

// ─── 自动检测 Python 可执行文件 ───

let _pythonCmd = null;

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
  const normalized = parts.map((p) => {
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      return p.slice(1, -1);
    }
    return p;
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
  });

  return result.status === 0;
}

function getPythonCmd() {
  if (_pythonCmd) return _pythonCmd;

  // 如果环境变量指定了，直接使用
  if (process.env.PYTHON_CMD) {
    const envCmd = process.env.PYTHON_CMD;
    if (probePython(envCmd, true)) {
      _pythonCmd = envCmd;
      console.log(`[Python] 使用环境变量 PYTHON_CMD: ${_pythonCmd}`);
      return _pythonCmd;
    }
    console.warn(`[Python] PYTHON_CMD 不可用或缺少 numpy，忽略: ${envCmd}`);
  }

  const resourceBase = process.resourcesPath;
  const isWin = process.platform === 'win32';

  // 1) 优先项目内 venv（开发环境）
  const localVenvPy = path.resolve(
    __dirname,
    '..',
    '..',
    'python',
    'venv',
    isWin ? 'Scripts' : 'bin',
    isWin ? 'python.exe' : 'python'
  );
  if (fs.existsSync(localVenvPy) && probePython(localVenvPy, true)) {
    _pythonCmd = localVenvPy;
    console.log(`[Python] 使用项目 venv: ${_pythonCmd}`);
    return _pythonCmd;
  }

  // 2) 优先打包内 venv（生产环境）
  if (resourceBase) {
    const packagedVenvPy = path.join(
      resourceBase,
      'python',
      'venv',
      isWin ? 'Scripts' : 'bin',
      isWin ? 'python.exe' : 'python'
    );
    if (fs.existsSync(packagedVenvPy) && probePython(packagedVenvPy, true)) {
      _pythonCmd = packagedVenvPy;
      console.log(`[Python] 使用打包 venv: ${_pythonCmd}`);
      return _pythonCmd;
    }
  }

  // 3) Windows 兼容旧逻辑：Python311 回退
  if (isWin) {
    const localLegacyPy = path.resolve(__dirname, '..', '..', 'python', 'Python311', 'python.exe');
    if (fs.existsSync(localLegacyPy) && probePython(localLegacyPy, true)) {
      _pythonCmd = localLegacyPy;
      console.log(`[Python] 使用项目 Python311: ${_pythonCmd}`);
      return _pythonCmd;
    }

    if (resourceBase) {
      const packagedLegacyPy = path.join(resourceBase, 'python', 'Python311', 'python.exe');
      if (fs.existsSync(packagedLegacyPy) && probePython(packagedLegacyPy, true)) {
        _pythonCmd = packagedLegacyPy;
        console.log(`[Python] 使用打包 Python311: ${_pythonCmd}`);
        return _pythonCmd;
      }
    }
  }

  // 4) 最后回退到系统命令
  const candidates = isWin
    ? ['python', 'python3', 'py -3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      if (!probePython(cmd, true)) {
        continue;
      }
      console.log(`[Python] 检测到可用命令: ${cmd}`);
      _pythonCmd = cmd;
      return _pythonCmd;
    } catch (e) {
      // 这个命令不可用，尝试下一个
    }
  }

  // 都找不到，使用默认值（让后续调用时报出明确错误）
  _pythonCmd = isWin ? 'python' : 'python3';
  console.warn(`[Python] 未检测到带 numpy 的 Python，使用默认: ${_pythonCmd}`);
  return _pythonCmd;
}

/**
 * 调用 Python 算法
 *
 * @param {string} funcName - 函数名 (与 bridge.py 注册的名称一致)
 * @param {object} params - 参数对象
 * @returns {Promise<object>} 算法结果
 */
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
      params: params,
    });

    const pythonCmd = getPythonCmd();
    console.log(`[Python] 调用 ${funcName}, 输入数据大小: ${(inputData.length / 1024).toFixed(1)}KB, cmd: ${pythonCmd}`);

    // 解析命令（支持 "py -3" 这种带参数的命令）
    const cmdParts = parseCmdParts(pythonCmd);
    const spawnCmd = cmdParts.cmd;
    const spawnArgs = [...cmdParts.args, BRIDGE_SCRIPT];

    let child;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          MPLBACKEND: 'Agg',
        },
      });
    } catch (spawnErr) {
      console.error('[Python] 无法启动子进程:', spawnErr.message);
      fail(new Error(`Cannot spawn Python process (cmd: ${pythonCmd}): ${spawnErr.message}`));
      return;
    }

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      console.error(`[Python] ${funcName} 执行超时: ${timeoutMs}ms`);
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
      // 只打印关键错误，忽略 matplotlib/font 警告
      const msg = data.toString().trim();
      if (msg && !msg.includes('UserWarning') && !msg.includes('font') && !msg.includes('Matplotlib')) {
        console.log('[Python stderr]', msg.substring(0, 500));
      }
    });

    // ─── 关键：监听 stdin 的 error 事件，防止 write EOF 导致进程崩溃 ───
    child.stdin.on('error', (err) => {
      console.error(`[Python] stdin 写入错误: ${err.message}`);
      // 不在这里 reject，等 close 事件统一处理
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);

      if (code !== 0 || signal) {
        let errMsg = timedOut
          ? `Python process timed out after ${timeoutMs}ms`
          : `Python process exited with code ${code}${signal ? ` signal ${signal}` : ''}`;
        // 提供更友好的错误提示
        if (code === 9009 || code === 127) {
          errMsg = `Python 命令 "${pythonCmd}" 未找到 (exit code ${code})。请安装 Python3 或设置环境变量 PYTHON_CMD`;
        }
        console.error(`[Python] ${errMsg}`);
        if (stderr) console.error('[Python] stderr:', stderr.substring(0, 2000));
        fail(new Error(`${errMsg}: ${stderr.substring(0, 500)}`));
        return;
      }

      try {
        // 从 stdout 中提取 JSON 结果（使用分隔符）
        const startMarker = '__PY_RESULT_START__';
        const endMarker = '__PY_RESULT_END__';
        const startIdx = stdout.indexOf(startMarker);
        const endIdx = stdout.indexOf(endMarker);

        if (startIdx === -1 || endIdx === -1) {
          console.error('[Python] 未找到结果分隔符');
          console.error('[Python] stdout:', stdout.substring(0, 2000));
          fail(new Error('Python output missing result markers'));
          return;
        }

        const jsonStr = stdout.substring(startIdx + startMarker.length, endIdx).trim();
        const result = JSON.parse(jsonStr);

        if (!result.success) {
          console.error('[Python] 算法返回错误:', result.error);
          fail(new Error(`Python algorithm error: ${result.error}`));
          return;
        }

        console.log(`[Python] ${funcName} 执行成功`);
        settled = true;
        resolve(result.data);
      } catch (e) {
        console.error('[Python] 解析结果失败:', e.message);
        console.error('[Python] stdout:', stdout.substring(0, 2000));
        fail(new Error(`Failed to parse Python output: ${e.message}`));
      }
    });

    child.on('error', (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      console.error('[Python] 子进程错误:', err.message);
      fail(new Error(`Python process error: ${err.message}`));
    });

    // ─── 写入输入数据（安全写入） ───
    try {
      child.stdin.write(inputData, (writeErr) => {
        if (writeErr) {
          console.error('[Python] stdin.write 回调错误:', writeErr.message);
          // 不 reject，等 close 事件
          return;
        }
        try {
          child.stdin.end();
        } catch (endErr) {
          console.error('[Python] stdin.end 错误:', endErr.message);
        }
      });
    } catch (writeErr) {
      console.error('[Python] stdin.write 异常:', writeErr.message);
      fail(new Error(`Failed to write to Python stdin: ${writeErr.message}`));
    }
  });
}

module.exports = { callPython };
