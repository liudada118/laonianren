const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const electron = require('electron');

const backendDir = path.join(__dirname, '..');
const frontendDir = path.join(__dirname, '..', '..', '..', 'front-end');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function getMissingDirectDeps(projectDir) {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const declaredDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  return Object.keys(declaredDeps).filter((depName) => {
    const depPath = path.join(projectDir, 'node_modules', ...depName.split('/'));
    return !fs.existsSync(depPath);
  });
}

function ensureProjectDeps(projectDir, label) {
  const nodeModules = path.join(projectDir, 'node_modules');
  const missingDeps = getMissingDirectDeps(projectDir);
  const shouldInstall = !fs.existsSync(nodeModules) || missingDeps.length > 0;

  if (!shouldInstall) {
    console.log(`[start] ${label}依赖已就绪`);
    return;
  }

  if (!fs.existsSync(nodeModules)) {
    console.log(`[start] ${label}依赖未安装，正在执行 npm install...`);
  } else {
    console.log(`[start] ${label}存在缺失依赖: ${missingDeps.join(', ')}`);
    console.log(`[start] 正在为${label}执行 npm install...`);
  }

  try {
    execSync(`${npmCmd} install`, {
      cwd: projectDir,
      stdio: 'inherit',
    });
    console.log(`[start] ${label}依赖安装完成`);
  } catch (e) {
    console.error(`[start] ${label}依赖安装失败:`, e.message);
    console.error(`[start] 请手动在 ${projectDir} 执行 npm install`);
  }
}

// 启动前确保前后端依赖都可用，避免主进程加载时缺模块
ensureProjectDeps(backendDir, '后端');
ensureProjectDeps(frontendDir, '前端');

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
