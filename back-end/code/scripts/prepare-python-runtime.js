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
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  })

  if (result.error) throw result.error
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

  // Anaconda/conda base 兼容：conda 把 OpenSSL/ffi/sqlite/lzma 等系统 DLL 放在
  // <base>/Library/bin（python.org 标准布局没有此目录，DLL 就在 DLLs/ 或根目录）。
  // 若不拷这些，生成的 runtime 会缺 _ssl/_ctypes/_sqlite3/_bz2/_lzma/_tkinter。
  // python.org base 下 Library/bin 不存在，此步自动 no-op，不影响通用性。
  const condaLibraryBin = path.join(basePythonDir, 'Library', 'bin')
  if (fs.existsSync(condaLibraryBin)) {
    const neededDlls = [
      'libssl-3-x64.dll', 'libcrypto-3-x64.dll',            // _ssl, _hashlib
      'ffi-7.dll', 'ffi-8.dll', 'ffi.dll', 'libffi-8.dll',  // _ctypes
      'sqlite3.dll',                                         // _sqlite3
      'libbz2.dll',                                          // _bz2
      'liblzma.dll',                                         // _lzma
      'tcl86t.dll', 'tk86t.dll',                             // _tkinter
      'zlib.dll', 'libexpat.dll',                            // zlib / pyexpat 兜底
    ]
    let copied = 0
    for (const dll of neededDlls) {
      const src = path.join(condaLibraryBin, dll)
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(runtimeDir, dll))
        copied += 1
      }
    }
    console.log(`[prepare-python-runtime] conda base detected, copied ${copied} system DLLs from Library/bin`)
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
      [
        'import json, sys',
        'import fastapi, uvicorn, multipart',
        'import numpy, pandas, cv2, scipy, skimage, seaborn, matplotlib',
        'import openai',
        'import reportlab',
        'from PIL import Image',
        'print(json.dumps({"executable": sys.executable, "prefix": sys.prefix, "base_prefix": sys.base_prefix}))',
      ].join('; '),
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
