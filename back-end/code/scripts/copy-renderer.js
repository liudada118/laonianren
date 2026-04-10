const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, '..', '..', 'front-end', 'dist');
const destDir = path.join(root, 'renderer-build');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function emptyDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isSymbolicLink()) {
      const real = fs.readlinkSync(from);
      fs.symlinkSync(real, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

if (!fs.existsSync(srcDir)) {
  console.error(`[copy-renderer] Source not found: ${srcDir}`);
  process.exit(1);
}

emptyDir(destDir);
copyDir(srcDir, destDir);
console.log(`[copy-renderer] Copied ${srcDir} -> ${destDir}`);
