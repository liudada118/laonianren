const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const sourceSerialPath = path.join(projectRoot, 'serial.txt')

function copyFileIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return false
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.copyFileSync(sourcePath, targetPath)
  return true
}

function findPackagedAppDir(targetDir) {
  try {
    const names = fs.readdirSync(targetDir)
    const appName = names.find((name) => name.endsWith('.app'))
    return appName ? path.join(targetDir, appName) : null
  } catch {
    return null
  }
}

function copySerialToTarget(targetDir) {
  let copied = false
  copied = copyFileIfPresent(sourceSerialPath, path.join(targetDir, 'serial.txt')) || copied

  const appDir = findPackagedAppDir(targetDir)
  if (appDir) {
    copied =
      copyFileIfPresent(
        sourceSerialPath,
        path.join(appDir, 'Contents', 'Resources', 'serial.txt')
      ) || copied
  }

  return copied
}

if (!fs.existsSync(distDir)) {
  console.log('[copy-local-runtime] dist directory not found, skip')
  process.exit(0)
}

const targets = fs
  .readdirSync(distDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac-'))
  .map((entry) => path.join(distDir, entry.name))

if (!targets.length) {
  console.log('[copy-local-runtime] no mac output directories found, skip')
  process.exit(0)
}

let copiedAny = false
for (const targetDir of targets) {
  const copied = copySerialToTarget(targetDir)
  if (copied) {
    copiedAny = true
    console.log(`[copy-local-runtime] copied serial.txt -> ${targetDir}`)
  }
}

if (!copiedAny) {
  console.log('[copy-local-runtime] serial.txt not found, skip')
}
