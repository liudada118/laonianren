const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const frontEndRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontEndRoot, '..');
const pythonRoot = path.join(repoRoot, 'back-end', 'code', 'python');
const apiServerPath = path.join(pythonRoot, 'app', 'algorithms', 'api_server.py');
const apiPort = Number.parseInt(process.env.PYTHON_API_PORT || '8765', 10);

function isUsableCommand(command) {
  const probe = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  return !probe.error;
}

function resolvePythonCommand() {
  const configuredPython = process.env.PYTHON_EXECUTABLE || process.env.PYTHON;
  if (configuredPython) {
    return configuredPython;
  }

  const venvCandidates = process.platform === 'win32'
    ? [path.join(pythonRoot, 'venv', 'Scripts', 'python.exe')]
    : [
        path.join(pythonRoot, 'venv', 'bin', 'python'),
        path.join(pythonRoot, 'venv', 'bin', 'python3'),
      ];

  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const fallbackCommands = process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];

  for (const candidate of fallbackCommands) {
    if (isUsableCommand(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(600);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

if (!fs.existsSync(apiServerPath)) {
  console.error(`[pyserver] Could not find api server: ${apiServerPath}`);
  process.exit(1);
}

const pythonCommand = resolvePythonCommand();
if (!pythonCommand) {
  console.error('[pyserver] No usable Python runtime was found.');
  console.error('[pyserver] Create back-end/code/python/venv or set PYTHON_EXECUTABLE before running npm start.');
  process.exit(1);
}

async function main() {
  if (await isPortInUse(apiPort)) {
    console.warn(`[pyserver] Port ${apiPort} is already in use; skipped starting ${apiServerPath}.`);
    console.warn(`[pyserver] Close the existing process or set PYTHON_API_PORT to another port before starting this server.`);
    setInterval(() => {}, 1 << 30);
    return;
  }

  console.log(`[pyserver] Using Python: ${pythonCommand}`);
  console.log(`[pyserver] Serving API from: ${apiServerPath}`);

  const child = spawn(pythonCommand, [apiServerPath], {
    cwd: frontEndRoot,
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  child.on('error', (error) => {
    console.error(`[pyserver] Failed to start Python API: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(`[pyserver] Failed to start Python API: ${error.message}`);
  process.exit(1);
});
