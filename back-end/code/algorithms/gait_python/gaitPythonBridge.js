/**
 * 步道算法 Python 桥接模块
 * ========================
 * 通过 Node.js 子进程调用 Python 步道算法 (gait_bridge.py)
 *
 * 输入: 4块传感器板数据 + 4块时间戳
 * 输出: 与 gait_render_data.py 一致的结构化结果
 */

const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_SCRIPT = path.join(__dirname, 'gait_bridge.py');

// Python 可执行文件路径（优先使用 python3，回退到 python）
const PYTHON_CMD = process.env.PYTHON_CMD || 'python3';

// 超时时间（毫秒）- 步道算法可能需要较长时间处理
const TIMEOUT_MS = 120000; // 2分钟

/**
 * 调用 Python 步道算法
 *
 * @param {Array<Array<string>>} boardData - 4块板数据，每块是字符串数组
 *   boardData[0] ~ boardData[3] 分别对应 1.csv ~ 4.csv 的 data 列
 *   每个元素是 "[v0, v1, ..., v4095]" 格式的字符串
 * @param {Array<Array<string>>} boardTimes - 4块板时间戳
 *   boardTimes[0] ~ boardTimes[3] 分别对应 1.csv ~ 4.csv 的 time 列
 *   每个元素是 "2025/12/06 17:07:33:840" 格式的时间字符串
 * @returns {Promise<object>} 分析结果
 */
async function callGaitPython(boardData, boardTimes) {
  return new Promise((resolve, reject) => {
    const inputData = JSON.stringify({
      board_data: boardData,
      board_times: boardTimes,
    });

    console.log('[GaitPython] 启动 Python 步道算法...');
    console.log(`[GaitPython] 数据帧数: [${boardData.map(b => b.length).join(', ')}]`);

    const child = spawn(PYTHON_CMD, [BRIDGE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TIMEOUT_MS,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        MPLBACKEND: 'Agg',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      // 只打印关键错误，忽略 matplotlib/font 警告
      const msg = data.toString().trim();
      if (msg && !msg.includes('UserWarning') && !msg.includes('font')) {
        console.log('[GaitPython stderr]', msg.substring(0, 500));
      }
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[GaitPython] 进程退出码: ${code}`);
        console.error('[GaitPython] stderr:', stderr.substring(0, 2000));
        reject(new Error(`Python gait process exited with code ${code}: ${stderr.substring(0, 500)}`));
        return;
      }

      try {
        // 从 stdout 中提取 JSON 结果（使用分隔符）
        const startMarker = '__GAIT_RESULT_START__';
        const endMarker = '__GAIT_RESULT_END__';
        const startIdx = stdout.indexOf(startMarker);
        const endIdx = stdout.indexOf(endMarker);

        if (startIdx === -1 || endIdx === -1) {
          console.error('[GaitPython] 未找到结果分隔符');
          console.error('[GaitPython] stdout:', stdout.substring(0, 2000));
          reject(new Error('Python gait output missing result markers'));
          return;
        }

        const jsonStr = stdout.substring(startIdx + startMarker.length, endIdx).trim();
        const result = JSON.parse(jsonStr);

        if (!result.success) {
          console.error('[GaitPython] 算法返回错误:', result.error);
          reject(new Error(`Python gait algorithm error: ${result.error}`));
          return;
        }

        console.log('[GaitPython] 算法执行成功');
        resolve(result.data);
      } catch (e) {
        console.error('[GaitPython] 解析结果失败:', e.message);
        console.error('[GaitPython] stdout:', stdout.substring(0, 2000));
        reject(new Error(`Failed to parse Python gait output: ${e.message}`));
      }
    });

    child.on('error', (err) => {
      console.error('[GaitPython] 子进程错误:', err.message);
      reject(new Error(`Python gait process error: ${err.message}`));
    });

    // 写入输入数据
    child.stdin.write(inputData);
    child.stdin.end();
  });
}

module.exports = { callGaitPython };
