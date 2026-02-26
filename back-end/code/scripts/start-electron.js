const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error(`[start-electron] Electron exited with signal: ${signal}`);
    process.exit(1);
  }
  process.exit(code);
});

