const { execSync, spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const electron = require('electron');

const backendDir = path.join(__dirname, '..');
const frontendDir = path.join(__dirname, '..', '..', '..', 'front-end');
const pythonDir = path.join(backendDir, 'python');
const pythonVenvDir = path.join(pythonDir, 'venv');
const requirementsPath = path.join(pythonDir, 'requirements-electron.txt');
const requirementsStampPath = path.join(pythonVenvDir, '.requirements.sha256');
const llmConfigDir = path.join(__dirname, '..', 'python', 'app', 'algorithms');
const llmSettingsPath = path.join(llmConfigDir, 'llm_settings.json');
const llmSettingsExamplePath = path.join(llmConfigDir, 'llm_settings.example.json');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ─── Node.js 依赖检查（来自 ld 分支，更完善） ───

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

// ─── Python 相关（来自 python3 分支） ───

function getVenvPythonPath() {
  if (process.platform === 'win32') {
    return path.join(pythonVenvDir, 'Scripts', 'python.exe');
  }
  return path.join(pythonVenvDir, 'bin', 'python');
}

function commandExists(command) {
  const probe = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return !probe.error;
}

function resolveBootstrapPython() {
  const configured = process.env.PYTHON_EXECUTABLE || process.env.PYTHON;
  if (configured) {
    return configured;
  }

  const candidates = process.platform === 'win32'
    ? ['py', 'python']
    : ['python3', 'python'];

  for (const candidate of candidates) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: false,
  });
  return !result.error && result.status === 0;
}

function computeRequirementsHash() {
  if (!fs.existsSync(requirementsPath)) {
    return '';
  }
  const content = fs.readFileSync(requirementsPath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function ensurePythonDeps() {
  if (process.env.SKIP_PYTHON_BOOTSTRAP === '1') {
    console.log('[start] SKIP_PYTHON_BOOTSTRAP=1, skipping Python dependency bootstrap.');
    return;
  }

  if (!fs.existsSync(requirementsPath)) {
    console.warn(`[start] Missing requirements file: ${requirementsPath}`);
    return;
  }

  const bootstrapPython = resolveBootstrapPython();
  if (!bootstrapPython) {
    console.warn('[start] No Python runtime found for bootstrap.');
    console.warn('[start] Please install Python 3.10+ or set PYTHON_EXECUTABLE.');
    return;
  }

  const venvPython = getVenvPythonPath();
  if (!fs.existsSync(venvPython)) {
    console.log('[start] Creating Python virtual environment...');
    const created = runCommand(bootstrapPython, ['-m', 'venv', pythonVenvDir], backendDir);
    if (!created) {
      console.warn('[start] Failed to create python venv automatically.');
      console.warn('[start] You can create it manually in back-end/code/python.');
      return;
    }
    console.log('[start] Python virtual environment created.');
  }

  const currentHash = computeRequirementsHash();
  const installedHash = fs.existsSync(requirementsStampPath)
    ? fs.readFileSync(requirementsStampPath, 'utf8').trim()
    : '';

  if (currentHash && currentHash === installedHash) {
    console.log('[start] Python dependencies are up to date.');
    return;
  }

  console.log('[start] Installing Python dependencies from requirements.txt...');
  const installed = runCommand(
    venvPython,
    ['-m', 'pip', 'install', '-r', requirementsPath],
    backendDir,
  );

  if (!installed) {
    console.warn('[start] Failed to install Python dependencies automatically.');
    console.warn('[start] Please run pip install manually in back-end/code/python/venv.');
    return;
  }

  if (currentHash) {
    fs.writeFileSync(requirementsStampPath, currentHash, 'utf8');
  }
  console.log('[start] Python dependencies installed.');
}

// ─── LLM 配置文件（来自 python3 分支） ───

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
      model: 'kimi-k2.5',
      thinking: { type: 'disabled' },
    };
    fs.writeFileSync(llmSettingsPath, JSON.stringify(fallback, null, 2), 'utf8');
    console.log('[start] Created llm_settings.json with fallback defaults.');
  } catch (e) {
    console.error('[start] Failed to ensure llm_settings.json:', e.message);
  }
}

// ─── 启动前检查 ───
ensureProjectDeps(backendDir, '后端');
ensureProjectDeps(frontendDir, '前端');
ensureLlmSettingsFile();
ensurePythonDeps();

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
