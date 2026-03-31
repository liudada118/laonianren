const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const electron = require('electron');

const frontendDir = path.join(__dirname, '..', '..', '..', 'front-end');
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
