const fs = require('fs')
const path = require('path')

function fail(message) {
  console.error(`[fix-python-runtime] ${message}`)
  process.exit(1)
}

const appPath = process.argv[2]

if (!appPath) {
  fail('用法: node scripts/fix-python-runtime-links.js /path/to/App.app')
}

const resourcesDir = path.join(appPath, 'Contents', 'Resources')
const binDir = path.join(resourcesDir, 'python', 'venv', 'bin')
const packagedPythonCandidates = [
  path.join(resourcesDir, 'python-runtime', 'Python.framework', 'Versions', '3.11', 'bin', 'python3.11'),
  path.join(resourcesDir, 'python-runtime', 'Versions', '3.11', 'bin', 'python3.11'),
]
const packagedPython = packagedPythonCandidates.find((candidate) => fs.existsSync(candidate))
const python311Path = path.join(binDir, 'python3.11')
const python3Path = path.join(binDir, 'python3')
const pythonPath = path.join(binDir, 'python')

if (!fs.existsSync(binDir)) {
  fail(`未找到 venv/bin: ${binDir}`)
}

if (!packagedPython) {
  fail(`未找到包内 Python 运行时: ${packagedPythonCandidates.join(' | ')}`)
}

for (const candidate of [pythonPath, python3Path, python311Path]) {
  try {
    fs.rmSync(candidate, { force: true })
  } catch (error) {
    fail(`删除旧文件失败: ${candidate} ${error.message}`)
  }
}

const relativeTarget = path.relative(binDir, packagedPython)

try {
  fs.symlinkSync(relativeTarget, python311Path)
  fs.symlinkSync('python3.11', python3Path)
  fs.symlinkSync('python3.11', pythonPath)
} catch (error) {
  fail(`重建 Python 运行时链接失败: ${error.message}`)
}

console.log(`[fix-python-runtime] python3.11 -> ${relativeTarget}`)
console.log('[fix-python-runtime] rebuilt python/python3/python3.11 symlinks')
