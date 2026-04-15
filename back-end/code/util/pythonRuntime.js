const fs = require('fs')
const os = require('os')
const path = require('path')

const PY_VERSION = '3.11'

function getResourcesBase(resourceBase = null) {
  return (
    resourceBase ||
    process.env.resourcesPath ||
    process.resourcesPath ||
    ''
  )
}

function getPackagedPythonHome(resourceBase = process.resourcesPath) {
  const base = getResourcesBase(resourceBase)
  if (!base || process.platform === 'win32') return null

  const home = path.join(base, 'python-runtime', 'Versions', PY_VERSION)
  const pythonBin = path.join(home, 'bin', `python${PY_VERSION}`)
  return fs.existsSync(pythonBin) ? home : null
}

function getPackagedRuntimeDir(resourceBase = process.resourcesPath) {
  const base = getResourcesBase(resourceBase)
  if (!base) return null

  const runtimeDir = path.join(base, 'python', 'runtime')
  return fs.existsSync(runtimeDir) ? runtimeDir : null
}

function getPackagedPythonBinary(resourceBase = process.resourcesPath) {
  const home = getPackagedPythonHome(resourceBase)
  if (home) {
    return path.join(home, 'bin', `python${PY_VERSION}`)
  }

  const runtimeDir = getPackagedRuntimeDir(resourceBase)
  if (!runtimeDir) return null

  const candidates = process.platform === 'win32'
    ? [
        path.join(runtimeDir, 'python.exe'),
      ]
    : [
        path.join(runtimeDir, 'bin', `python${PY_VERSION}`),
        path.join(runtimeDir, 'bin', 'python3'),
        path.join(runtimeDir, 'bin', 'python'),
      ]

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function getPackagedSitePackages(resourceBase = process.resourcesPath) {
  const base = getResourcesBase(resourceBase)
  if (!base) return null

  const sitePackages = path.join(base, 'python', 'venv', 'lib', `python${PY_VERSION}`, 'site-packages')
  if (fs.existsSync(sitePackages)) {
    return sitePackages
  }

  const runtimeSitePackages = path.join(base, 'python', 'runtime', 'Lib', 'site-packages')
  return fs.existsSync(runtimeSitePackages) ? runtimeSitePackages : null
}

function getPackagedMplConfigDir(resourceBase = process.resourcesPath) {
  const dir = path.join(os.tmpdir(), 'laonianren-mplconfig')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function prependPathList(existingValue, entry) {
  if (!entry) return existingValue
  if (!existingValue) return entry

  const parts = existingValue.split(path.delimiter).filter(Boolean)
  if (parts.includes(entry)) return existingValue
  return [entry, ...parts].join(path.delimiter)
}

function getPackagedPythonEnv({ baseEnv = process.env, resourceBase = process.resourcesPath } = {}) {
  const env = { ...baseEnv }
  const pythonHome = getPackagedPythonHome(resourceBase)
  const runtimeDir = getPackagedRuntimeDir(resourceBase)
  const sitePackages = getPackagedSitePackages(resourceBase)
  const mplConfigDir = getPackagedMplConfigDir(resourceBase)

  if (pythonHome) {
    env.PYTHONHOME = pythonHome
  } else if (runtimeDir) {
    env.PYTHONHOME = runtimeDir
  }
  if (sitePackages) {
    env.PYTHONPATH = prependPathList(env.PYTHONPATH, sitePackages)
  }
  if (mplConfigDir) {
    env.MPLCONFIGDIR = mplConfigDir
  }

  env.PYTHONNOUSERSITE = '1'
  env.PYTHONDONTWRITEBYTECODE = '1'
  env.PYTHONUTF8 = '1'
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8'
  return env
}

module.exports = {
  PY_VERSION,
  getPackagedPythonHome,
  getPackagedRuntimeDir,
  getPackagedPythonBinary,
  getPackagedSitePackages,
  getPackagedPythonEnv,
}
