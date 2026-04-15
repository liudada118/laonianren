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

const binDir = path.join(appPath, 'Contents', 'Resources', 'python', 'venv', 'bin')
const python311Path = path.join(binDir, 'python3.11')
const python3Path = path.join(binDir, 'python3')
const pythonPath = path.join(binDir, 'python')

if (!fs.existsSync(binDir)) {
  fail(`未找到 venv/bin: ${binDir}`)
}

let sourceBinary = process.env.PYTHON_RUNTIME_SOURCE || null

try {
  const stat = fs.lstatSync(python311Path)
  if (stat.isSymbolicLink()) {
    sourceBinary = sourceBinary || fs.readlinkSync(python311Path)
  } else if (stat.isFile()) {
    sourceBinary = sourceBinary || python311Path
  }
} catch (error) {
  fail(`读取 python3.11 失败: ${error.message}`)
}

if (!sourceBinary) {
  fail('无法解析 python3.11 源路径')
}

if (!path.isAbsolute(sourceBinary)) {
  sourceBinary = path.resolve(binDir, sourceBinary)
}

if (!fs.existsSync(sourceBinary)) {
  fail(`Python 源二进制不存在: ${sourceBinary}`)
}

for (const candidate of [pythonPath, python3Path, python311Path]) {
  try {
    fs.rmSync(candidate, { force: true })
  } catch (error) {
    fail(`删除旧文件失败: ${candidate} ${error.message}`)
  }
}

try {
  fs.copyFileSync(sourceBinary, python311Path)
  fs.chmodSync(python311Path, 0o755)
  fs.symlinkSync('python3.11', python3Path)
  fs.symlinkSync('python3.11', pythonPath)
} catch (error) {
  fail(`重建 Python 运行时失败: ${error.message}`)
}

console.log(`[fix-python-runtime] source=${sourceBinary}`)
console.log(`[fix-python-runtime] rebuilt ${python311Path}`)
