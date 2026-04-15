const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const backendDir = path.join(__dirname, '..')
const pythonDir = path.join(backendDir, 'python')
const venvDir = path.join(pythonDir, 'venv')
const runtimeDir = path.join(pythonDir, 'runtime')

function getVenvPythonPath() {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`)
  }
}

function runJson(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim())
  }

  return JSON.parse((result.stdout || '').trim())
}

function resetDir(targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(targetDir, { recursive: true })
}

function copyPath(src, dest, { recursive = false } = {}) {
  ensureExists(src, 'Copy source')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (recursive) {
    fs.cpSync(src, dest, {
      recursive: true,
      force: true,
      filter: (entry) => !entry.includes('__pycache__') && !entry.endsWith('.pyc'),
    })
    return
  }
  fs.copyFileSync(src, dest)
}

function writePortablePth(runtimePythonTag) {
  const pthPath = path.join(runtimeDir, `${runtimePythonTag}._pth`)
  const lines = [
    '.',
    'DLLs',
    'Lib',
    'Lib\\site-packages',
    '',
    'import site',
    '',
  ]
  fs.writeFileSync(pthPath, lines.join('\r\n'), 'utf8')
}

function main() {
  const venvPython = getVenvPythonPath()
  const venvSitePackages = path.join(venvDir, 'Lib', 'site-packages')

  ensureExists(venvPython, 'Venv Python')
  ensureExists(venvSitePackages, 'Venv site-packages')

  const runtimeInfo = runJson(
    venvPython,
    [
      '-c',
      'import json, sys; print(json.dumps({"base_prefix": sys.base_prefix, "base_exec_prefix": sys.base_exec_prefix, "major": sys.version_info.major, "minor": sys.version_info.minor, "micro": sys.version_info.micro}))',
    ],
    backendDir,
  )

  const basePythonDir = [runtimeInfo.base_prefix, runtimeInfo.base_exec_prefix].find(
    (candidate) => candidate && fs.existsSync(candidate),
  )
  if (!basePythonDir) {
    throw new Error('Base Python installation directory could not be resolved from the venv')
  }

  const runtimePythonTag = `python${runtimeInfo.major}${runtimeInfo.minor}`
  const topLevelFiles = [
    'python.exe',
    'pythonw.exe',
    'python3.dll',
    `${runtimePythonTag}.dll`,
    'vcruntime140.dll',
    'vcruntime140_1.dll',
    'LICENSE.txt',
  ]
  const topLevelDirs = ['DLLs', 'Lib', 'libs', 'tcl']

  console.log(`[prepare-python-runtime] base Python: ${basePythonDir}`)
  console.log(`[prepare-python-runtime] target runtime: ${runtimeDir}`)

  resetDir(runtimeDir)

  for (const name of topLevelFiles) {
    const src = path.join(basePythonDir, name)
    if (fs.existsSync(src)) {
      copyPath(src, path.join(runtimeDir, name))
    }
  }

  for (const name of topLevelDirs) {
    const src = path.join(basePythonDir, name)
    if (fs.existsSync(src)) {
      copyPath(src, path.join(runtimeDir, name), { recursive: true })
    }
  }

  const runtimeSitePackages = path.join(runtimeDir, 'Lib', 'site-packages')
  fs.rmSync(runtimeSitePackages, { recursive: true, force: true })
  copyPath(venvSitePackages, runtimeSitePackages, { recursive: true })
  writePortablePth(runtimePythonTag)

  const runtimePython = process.platform === 'win32'
    ? path.join(runtimeDir, 'python.exe')
    : path.join(runtimeDir, 'bin', 'python')
  ensureExists(runtimePython, 'Prepared runtime python')

  const verifyInfo = runJson(
    runtimePython,
    [
      '-c',
      'import json, sys; import fastapi, uvicorn, multipart, numpy, pandas, cv2, scipy, skimage; from PIL import Image; print(json.dumps({"executable": sys.executable, "prefix": sys.prefix, "base_prefix": sys.base_prefix}))',
    ],
    backendDir,
  )

  console.log('[prepare-python-runtime] verification ok:', JSON.stringify(verifyInfo))
}

try {
  main()
} catch (err) {
  console.error('[prepare-python-runtime] failed:', err.message)
  process.exit(1)
}
