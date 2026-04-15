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

function getPackagedPythonBinary(resourceBase = process.resourcesPath) {
  const home = getPackagedPythonHome(resourceBase)
  if (!home) return null
  return path.join(home, 'bin', `python${PY_VERSION}`)
}

function getPackagedSitePackages(resourceBase = process.resourcesPath) {
  const base = getResourcesBase(resourceBase)
  if (!base || process.platform === 'win32') return null

  const sitePackages = path.join(base, 'python', 'venv', 'lib', `python${PY_VERSION}`, 'site-packages')
  return fs.existsSync(sitePackages) ? sitePackages : null
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
  const sitePackages = getPackagedSitePackages(resourceBase)
  const mplConfigDir = getPackagedMplConfigDir(resourceBase)

  if (pythonHome) {
    env.PYTHONHOME = pythonHome
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
  getPackagedPythonBinary,
  getPackagedSitePackages,
  getPackagedPythonEnv,
}
