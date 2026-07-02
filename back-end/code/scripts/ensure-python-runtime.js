const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..');
const pythonDir = path.join(backendDir, 'python');
const venvDir = path.join(pythonDir, 'venv');
const requirementsPath = path.join(pythonDir, 'requirements-electron.txt');
const stampPath = path.join(venvDir, '.requirements-electron.sha256');

const isWin = process.platform === 'win32';
const venvPython = path.join(venvDir, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
const bootstrapCandidates = isWin ? ['py', 'python'] : ['python3', 'python'];

const requiredImports = [
  ['numpy', 'numpy'],
  ['pandas', 'pandas'],
  ['scipy', 'scipy'],
  ['matplotlib', 'matplotlib'],
  ['cv2', 'opencv-python'],
  ['PIL', 'Pillow'],
  ['reportlab', 'reportlab'],
];

const algorithmModules = [
  'gait_render_data',
  'generate_gait_report',
  'sit_stand_render_data',
  'generate_sit_stand_pdf_v3',
  'one_step_render_data',
  'glove_render_data',
];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: backendDir,
    stdio: options.stdio || 'pipe',
    windowsHide: true,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
    },
  });
}

function commandExists(command) {
  const result = run(command, ['--version']);
  return !result.error && result.status === 0;
}

function resolveBootstrapPython() {
  if (process.env.PYTHON_EXECUTABLE) return process.env.PYTHON_EXECUTABLE;
  if (process.env.PYTHON) return process.env.PYTHON;
  return bootstrapCandidates.find(commandExists) || null;
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureVenv() {
  if (fs.existsSync(venvPython)) return;

  const bootstrapPython = resolveBootstrapPython();
  if (!bootstrapPython) {
    throw new Error('No Python runtime found. Install Python 3.10+ or set PYTHON_EXECUTABLE.');
  }

  console.log('[build:python] Creating Python virtual environment...');
  const result = run(bootstrapPython, ['-m', 'venv', venvDir], { stdio: 'inherit' });
  if (result.status !== 0 || result.error) {
    throw new Error(`Failed to create Python venv: ${result.error?.message || result.status}`);
  }
}

function findMissingImports() {
  const code = `
import importlib.util
mods = ${JSON.stringify(requiredImports.map(([moduleName]) => moduleName))}
missing = [m for m in mods if importlib.util.find_spec(m) is None]
print("\\n".join(missing))
`;
  const result = run(venvPython, ['-c', code]);
  if (result.status !== 0 || result.error) {
    throw new Error(`Failed to inspect Python runtime: ${result.stderr || result.error?.message || result.status}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function installRequirements(reason) {
  console.log(`[build:python] Installing Python dependencies (${reason})...`);
  const result = run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath], { stdio: 'inherit' });
  if (result.status !== 0 || result.error) {
    throw new Error(`Failed to install Python dependencies: ${result.error?.message || result.status}`);
  }
}

function verifyPipEnvironment() {
  const result = run(venvPython, ['-m', 'pip', 'check']);
  if (result.status !== 0 || result.error) {
    throw new Error(`Python dependency conflict detected: ${result.stdout || result.stderr || result.error?.message || result.status}`);
  }
}

function verifyAlgorithmImports() {
  const code = `
import sys
from pathlib import Path

base = Path(${JSON.stringify(path.join(pythonDir, 'app'))}).resolve()
sys.path.insert(0, str(base))
sys.path.insert(0, str(base / 'algorithms'))

modules = ${JSON.stringify(algorithmModules)}
for module_name in modules:
    __import__(module_name)
print("ok")
`;
  const result = run(venvPython, ['-c', code]);
  if (result.status !== 0 || result.error) {
    throw new Error(`Python algorithm import check failed: ${result.stderr || result.stdout || result.error?.message || result.status}`);
  }
}

function main() {
  if (process.env.SKIP_PYTHON_RUNTIME_CHECK === '1') {
    console.log('[build:python] SKIP_PYTHON_RUNTIME_CHECK=1, skipping.');
    return;
  }

  if (!fs.existsSync(requirementsPath)) {
    throw new Error(`Missing requirements file: ${requirementsPath}`);
  }

  ensureVenv();

  const currentHash = hashFile(requirementsPath);
  const installedHash = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : '';
  const missingBeforeInstall = findMissingImports();

  if (currentHash !== installedHash || missingBeforeInstall.length > 0) {
    const missingPackages = missingBeforeInstall.map((moduleName) => {
      const match = requiredImports.find(([name]) => name === moduleName);
      return match ? match[1] : moduleName;
    });
    const reason = missingPackages.length > 0
      ? `missing ${missingPackages.join(', ')}`
      : 'requirements changed';
    installRequirements(reason);
    fs.writeFileSync(stampPath, currentHash, 'utf8');
  }

  const missingAfterInstall = findMissingImports();
  if (missingAfterInstall.length > 0) {
    throw new Error(`Python runtime still missing modules: ${missingAfterInstall.join(', ')}`);
  }

  verifyPipEnvironment();
  verifyAlgorithmImports();
  console.log('[build:python] Python runtime dependencies are ready.');
}

try {
  main();
} catch (err) {
  console.error(`[build:python] ${err.message}`);
  process.exit(1);
}
