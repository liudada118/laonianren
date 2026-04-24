const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const appPath = process.argv[2]

if (!appPath) {
  console.error('[patch-python-framework] 用法: node scripts/patch-packaged-python-framework.js /path/to/App.app')
  process.exit(1)
}

const resourcesDir = path.join(appPath, 'Contents', 'Resources')
const pythonRootCandidates = [
  path.join(resourcesDir, 'python-runtime', 'Python.framework', 'Versions', '3.11'),
  path.join(resourcesDir, 'python-runtime', 'Versions', '3.11'),
]
const pythonRoot = pythonRootCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'bin', 'python3.11'))
)

if (!pythonRoot) {
  console.log('[patch-python-framework] skip: packaged Python.framework not found')
  process.exit(0)
}

const oldPrefix = '/Library/Frameworks/Python.framework/Versions/3.11'
const changedTargets = new Set()

function ensureOwnerWritable(targetPath) {
  const stats = fs.lstatSync(targetPath)
  if (stats.isSymbolicLink()) return

  const currentMode = stats.mode & 0o777
  const desiredMode = stats.isDirectory()
    ? (currentMode | 0o700)
    : (currentMode | 0o200)

  if (desiredMode !== currentMode) {
    fs.chmodSync(targetPath, desiredMode)
  }
}

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      result.push(fullPath)
      walk(fullPath, result)
      continue
    }
    if (entry.isFile()) {
      result.push(fullPath)
    }
  }
  return result
}

function isMachO(targetPath) {
  try {
    const description = execFileSync('file', ['-b', targetPath], { encoding: 'utf8' }).trim()
    return description.includes('Mach-O')
  } catch {
    return false
  }
}

function parseOtoolLines(targetPath, flag) {
  try {
    const output = execFileSync('otool', [flag, targetPath], { encoding: 'utf8' })
    return output
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function parseDependencies(targetPath) {
  return parseOtoolLines(targetPath, '-L')
    .map((line) => line.split(' (', 1)[0].trim())
    .filter(Boolean)
}

function parseInstallName(targetPath) {
  const lines = parseOtoolLines(targetPath, '-D')
  return lines[0] || null
}

function makeLoaderPath(targetPath, relativeInsideFramework) {
  const destPath = path.join(pythonRoot, relativeInsideFramework)
  let relative = path.relative(path.dirname(targetPath), destPath)
  if (!relative) relative = path.basename(destPath)
  return `@loader_path/${relative.replace(/\\/g, '/')}`
}

function patchDependency(targetPath, oldDependency, relativeInsideFramework) {
  const newDependency = makeLoaderPath(targetPath, relativeInsideFramework)
  execFileSync('install_name_tool', ['-change', oldDependency, newDependency, targetPath], {
    stdio: 'inherit',
  })
  changedTargets.add(targetPath)
}

function patchInstallName(targetPath, relativeInsideFramework) {
  const newInstallName = makeLoaderPath(targetPath, relativeInsideFramework)
  execFileSync('install_name_tool', ['-id', newInstallName, targetPath], {
    stdio: 'inherit',
  })
  changedTargets.add(targetPath)
}

const allTargets = walk(pythonRoot)
  .filter((targetPath) => fs.existsSync(targetPath) && fs.statSync(targetPath).isFile())
  .filter(isMachO)

ensureOwnerWritable(pythonRoot)
for (const targetPath of walk(pythonRoot)) {
  ensureOwnerWritable(targetPath)
}

for (const targetPath of allTargets) {
  const installName = parseInstallName(targetPath)
  if (installName && installName.startsWith(oldPrefix)) {
    const relativeInsideFramework = installName.slice(oldPrefix.length + 1)
    patchInstallName(targetPath, relativeInsideFramework)
  }

  const dependencies = parseDependencies(targetPath)
  for (const dependency of dependencies) {
    if (!dependency.startsWith(oldPrefix)) continue
    const relativeInsideFramework = dependency.slice(oldPrefix.length + 1)
    patchDependency(targetPath, dependency, relativeInsideFramework)
  }
}

for (const signTarget of changedTargets) {
  execFileSync('codesign', ['--force', '--sign', '-', signTarget], {
    stdio: 'inherit',
  })
}

const pythonIntelHelper = path.join(pythonRoot, 'bin', 'python3.11-intel64')
if (fs.existsSync(pythonIntelHelper)) {
  fs.rmSync(pythonIntelHelper, { force: true })
}

const pythonIntelLink = path.join(pythonRoot, 'bin', 'python3-intel64')
try {
  fs.rmSync(pythonIntelLink, { force: true })
} catch {}

const buildConfigDir = path.join(pythonRoot, 'lib', 'python3.11', 'config-3.11-darwin')
if (fs.existsSync(buildConfigDir)) {
  fs.rmSync(buildConfigDir, { recursive: true, force: true })
}

for (const targetPath of walk(pythonRoot)) {
  if (!targetPath.endsWith('.a')) continue
  fs.rmSync(targetPath, { force: true })
}

const versionsDir = path.dirname(pythonRoot)
for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  if (entry.name === '3.11') continue
  fs.rmSync(path.join(versionsDir, entry.name), { recursive: true, force: true })
}

const frameworkSignatureDir = path.join(pythonRoot, '_CodeSignature')
if (fs.existsSync(frameworkSignatureDir)) {
  fs.rmSync(frameworkSignatureDir, { recursive: true, force: true })
}

const pythonAppSignatureDir = path.join(pythonRoot, 'Resources', 'Python.app', 'Contents', '_CodeSignature')
if (fs.existsSync(pythonAppSignatureDir)) {
  fs.rmSync(pythonAppSignatureDir, { recursive: true, force: true })
}

console.log(`[patch-python-framework] patched targets=${changedTargets.size}`)
