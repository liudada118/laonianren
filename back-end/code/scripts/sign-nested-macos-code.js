const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function fail(message) {
  console.error(`[sign-nested-code] ${message}`)
  process.exit(1)
}

const appPath = process.argv[2]
const identity = process.argv[3] || process.env.CSC_NAME
const entitlements = process.argv[4] || path.join(__dirname, '..', 'signing', 'entitlements.mac.plist')

if (!appPath) {
  fail('用法: node scripts/sign-nested-macos-code.js /path/to/App.app "Developer ID Application: ..." [entitlements.plist]')
}

if (!identity) {
  fail('缺少签名证书名称')
}

function walk(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(fullPath)
      walk(fullPath, result)
    } else if (entry.isFile()) {
      result.push(fullPath)
    }
  }
  return result
}

function isBundleDir(targetPath) {
  return targetPath.endsWith('.app') || targetPath.endsWith('.framework')
}

function fileDescription(targetPath) {
  try {
    return execFileSync('file', ['-b', targetPath], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function isMachOBinary(targetPath) {
  return fileDescription(targetPath).includes('Mach-O')
}

function shouldSignFile(targetPath) {
  const base = path.basename(targetPath)
  const ext = path.extname(targetPath)
  if (['.dylib', '.so', '.node'].includes(ext)) return true
  if (base === 'Python') return true
  if (base === 'python' || base === 'python3' || base === 'python3.11') return true
  if (base === 'ShipIt' || base === 'chrome_crashpad_handler') return true
  if (targetPath.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`)) return true
  return false
}

function needsRuntime(targetPath) {
  const base = path.basename(targetPath)
  return (
    targetPath.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`) ||
    base === 'python' ||
    base === 'python3' ||
    base === 'python3.11' ||
    base === 'ShipIt' ||
    base === 'chrome_crashpad_handler'
  )
}

function sign(targetPath, { runtime = false, entitlementsFile = null } = {}) {
  const args = ['--force', '--timestamp']
  if (runtime) {
    args.push('--options', 'runtime')
  }
  if (entitlementsFile) {
    args.push('--entitlements', entitlementsFile)
  }
  args.push('--sign', identity, targetPath)
  execFileSync('codesign', args, { stdio: 'inherit' })
}

if (!fs.existsSync(appPath)) {
  fail(`App 不存在: ${appPath}`)
}

const allPaths = walk(appPath)
const fileTargets = allPaths
  .filter((targetPath) => fs.existsSync(targetPath) && fs.statSync(targetPath).isFile())
  .filter(shouldSignFile)
  .filter(isMachOBinary)
  .sort((a, b) => b.length - a.length)

for (const targetPath of fileTargets) {
  sign(targetPath, { runtime: needsRuntime(targetPath) })
}

const bundleTargets = allPaths
  .filter(isBundleDir)
  .sort((a, b) => b.length - a.length)

for (const targetPath of bundleTargets) {
  if (targetPath.endsWith('.app')) {
    sign(targetPath, { runtime: true, entitlementsFile: entitlements })
  } else {
    sign(targetPath)
  }
}

sign(appPath, { runtime: true, entitlementsFile: entitlements })

console.log(`[sign-nested-code] signed files=${fileTargets.length} bundles=${bundleTargets.length}`)
