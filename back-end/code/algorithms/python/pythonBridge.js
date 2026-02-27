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

const { spawn, execSync } = require('child_process');
const path = require('path');

const BRIDGE_SCRIPT = path.join(__dirname, 'bridge.py');

// 超时时间（毫秒）
const TIMEOUT_MS = parseInt(process.env.PY_TIMEOUT_MS, 10) || 180000; // 3分钟

// ─── 自动检测 Python 可执行文件 ───

let _pythonCmd = null;

function getPythonCmd() {
  if (_pythonCmd) return _pythonCmd;

  // 如果环境变量指定了，直接使用
  if (process.env.PYTHON_CMD) {
    _pythonCmd = process.env.PYTHON_CMD;
    console.log(`[Python] 使用环境变量 PYTHON_CMD: ${_pythonCmd}`);
    return _pythonCmd;
  }

  // 候选命令列表（按优先级排序）
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? ['python', 'python3', 'py -3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      // 尝试执行 python --version 来验证命令是否可用
      const parts = cmd.split(' ');
      const testArgs = [...parts.slice(1), '--version'];
      const result = execSync(`${parts[0]} ${testArgs.join(' ')}`, {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const version = result.toString().trim();
      console.log(`[Python] 检测到: ${cmd} → ${version}`);
      _pythonCmd = cmd;
      return _pythonCmd;
    } catch (e) {
      // 这个命令不可用，尝试下一个
    }
  }

  // 都找不到，使用默认值（让后续调用时报出明确错误）
  _pythonCmd = isWin ? 'python' : 'python3';
  console.warn(`[Python] 未检测到可用的 Python，使用默认: ${_pythonCmd}`);
  return _pythonCmd;
}

/**
 * 调用 Python 算法
 *
 * @param {string} funcName - 函数名 (与 bridge.py 注册的名称一致)
 * @param {object} params - 参数对象
 * @returns {Promise<object>} 算法结果
 */
async function callPython(funcName, params = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const inputData = JSON.stringify({
      func: funcName,
      params: params,
    });

    const pythonCmd = getPythonCmd();
    console.log(`[Python] 调用 ${funcName}, 输入数据大小: ${(inputData.length / 1024).toFixed(1)}KB, cmd: ${pythonCmd}`);

    // 解析命令（支持 "py -3" 这种带参数的命令）
    const cmdParts = pythonCmd.split(' ');
    const spawnCmd = cmdParts[0];
    const spawnArgs = [...cmdParts.slice(1), BRIDGE_SCRIPT];

    let child;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: TIMEOUT_MS,
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

      if (code !== 0) {
        let errMsg = `Python process exited with code ${code}`;
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
