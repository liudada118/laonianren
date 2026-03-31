const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const electron = require('electron');

const backendDir = path.join(__dirname, '..');
const frontendDir = path.join(__dirname, '..', '..', '..', 'front-end');
const llmConfigDir = path.join(__dirname, '..', 'python', 'app', 'algorithms');
const llmSettingsPath = path.join(llmConfigDir, 'llm_settings.json');
const llmSettingsExamplePath = path.join(llmConfigDir, 'llm_settings.example.json');
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

function ensureLlmSettingsFile() {
  try {
    if (fs.existsSync(llmSettingsPath)) {
      return;
    }

    if (fs.existsSync(llmSettingsExamplePath)) {
      fs.copyFileSync(llmSettingsExamplePath, llmSettingsPath);
      console.log('[start] Created llm_settings.json from llm_settings.example.json.');
      return;
    }

    const fallback = {
      api_key: '',
      base_url: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2-turbo-preview',
      extra_body: { enable_thinking: false },
    };
    fs.writeFileSync(llmSettingsPath, JSON.stringify(fallback, null, 2), 'utf8');
    console.log('[start] Created llm_settings.json with fallback defaults.');
  } catch (e) {
    console.error('[start] Failed to ensure llm_settings.json:', e.message);
  }
}

// 启动前确保前后端依赖都可用，避免主进程加载时缺模块
ensureProjectDeps(backendDir, '后端');
ensureProjectDeps(frontendDir, '前端');
ensureLlmSettingsFile();

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

console.log('[start] Launching Electron app...');

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
