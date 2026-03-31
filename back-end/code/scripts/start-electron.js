const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const electron = require('electron');

const frontendDir = path.join(__dirname, '..', '..', '..', 'front-end');
const backendCodeDir = path.join(__dirname, '..');
const pythonDir = path.join(backendCodeDir, 'python');
const pythonVenvDir = path.join(pythonDir, 'venv');
const requirementsPath = path.join(pythonDir, 'app', 'algorithms', 'requirements.txt');
const requirementsStampPath = path.join(pythonVenvDir, '.requirements.sha256');
const llmConfigDir = path.join(__dirname, '..', 'python', 'app', 'algorithms');
const llmSettingsPath = path.join(llmConfigDir, 'llm_settings.json');
const llmSettingsExamplePath = path.join(llmConfigDir, 'llm_settings.example.json');

function ensureFrontendDeps() {
  const nodeModules = path.join(frontendDir, 'node_modules');
  if (fs.existsSync(nodeModules)) {
    console.log('[start] front-end dependencies already installed.');
    return;
  }

  console.log('[start] Installing front-end dependencies...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    execSync(`${npmCmd} install`, {
      cwd: frontendDir,
      stdio: 'inherit',
    });
    console.log('[start] front-end dependencies installed.');
  } catch (e) {
    console.error('[start] Failed to install front-end dependencies:', e.message);
    console.error('[start] Please run `npm install` in front-end manually if needed.');
  }
}

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
    const created = runCommand(bootstrapPython, ['-m', 'venv', pythonVenvDir], backendCodeDir);
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
    backendCodeDir,
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

ensureLlmSettingsFile();
ensureFrontendDeps();
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
