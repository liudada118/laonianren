const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const electron = require('electron');

const frontendDir = path.join(__dirname, '..', '..', '..', 'front-end');

// 检查前端依赖是否已安装
function ensureFrontendDeps() {
  const nodeModules = path.join(frontendDir, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    console.log('[start] 前端依赖未安装，正在执行 npm install...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
      execSync(`${npmCmd} install`, {
        cwd: frontendDir,
        stdio: 'inherit',
      });
      console.log('[start] 前端依赖安装完成');
    } catch (e) {
      console.error('[start] 前端依赖安装失败:', e.message);
      console.error('[start] 请手动在 front-end 目录执行 npm install');
    }
  } else {
    console.log('[start] 前端依赖已就绪');
  }
}

// 确保前端依赖
ensureFrontendDeps();

// 启动 Electron（Electron 主进程会自动启动 Vite dev server）
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

console.log('[start] 启动 Electron（将自动启动前端开发服务器）...');

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error(`[start-electron] Electron exited with signal: ${signal}`);
    process.exit(1);
  }
  process.exit(code);
});
