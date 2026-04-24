const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const { execFileSync } = require('child_process')

const projectDir = path.join(__dirname, '..')
const pkg = require(path.join(projectDir, 'package.json'))
const { writeAppUpdateConfig, UPDATE_SERVER_URL, UPDATE_CHANNEL } = require(path.join(projectDir, 'util', 'updaterConfig'))

const version = pkg.version
const productName = (pkg.build && pkg.build.productName) || '肌少症评估系统'
const distDir = path.join(projectDir, 'dist')
const appPath = path.join(distDir, 'mac-arm64', `${productName}.app`)
const appUpdateConfigPath = path.join(appPath, 'Contents', 'Resources', 'app-update.yml')
const releaseDir = path.join(distDir, 'release-arm64')
const zipName = `${productName}-${version}-arm64-signed.zip`
const dmgName = `${productName}-${version}-arm64-signed.dmg`
const zipPath = path.join(releaseDir, zipName)
const dmgPath = path.join(releaseDir, dmgName)
const latestMacYmlPath = path.join(releaseDir, 'latest-mac.yml')
const identity = resolveDeveloperIdIdentity()
const entitlements = path.join(projectDir, 'signing', 'entitlements.mac.plist')
const signScript = path.join(projectDir, 'scripts', 'sign-nested-macos-code.js')
const createDmgScript = path.join(projectDir, 'scripts', 'create-drag-dmg.sh')
const electronBuilder = path.join(projectDir, 'node_modules', '.bin', 'electron-builder')

function fail(message) {
  console.error(`[build-mac-release] ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  console.log(`[build-mac-release] ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd: projectDir,
    stdio: 'inherit',
    ...options,
  })
}

function resolveDeveloperIdIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME

  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const line = output
      .split('\n')
      .find((item) => item.includes('Developer ID Application:'))
    const match = line && line.match(/"([^"]+)"/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function ensureEnv(name) {
  if (!process.env[name]) {
    fail(`缺少环境变量: ${name}`)
  }
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    fail(`${label} 不存在: ${targetPath}`)
  }
}

function sha512Base64(targetPath) {
  return createHash('sha512').update(fs.readFileSync(targetPath)).digest('base64')
}

function buildLatestMacYml() {
  const zipStat = fs.statSync(zipPath)
  const dmgStat = fs.statSync(dmgPath)
  const zipSha = sha512Base64(zipPath)
  const dmgSha = sha512Base64(dmgPath)
  const notePath = path.join(projectDir, 'release-notes', 'mac', `${version}.md`)
  const lines = [
    `version: ${version}`,
    'files:',
    `  - url: ${zipName}`,
    `    sha512: ${zipSha}`,
    `    size: ${zipStat.size}`,
    `  - url: ${dmgName}`,
    `    sha512: ${dmgSha}`,
    `    size: ${dmgStat.size}`,
    `path: ${zipName}`,
    `sha512: ${zipSha}`,
    `releaseDate: '${new Date().toISOString()}'`,
  ]

  if (fs.existsSync(notePath)) {
    const notes = fs.readFileSync(notePath, 'utf8').trim()
    if (notes) {
      lines.push('releaseNotes: |')
      for (const line of notes.split('\n')) {
        lines.push(`  ${line}`)
      }
    }
  }

  fs.writeFileSync(latestMacYmlPath, `${lines.join('\n')}\n`, 'utf8')
  fs.writeFileSync(path.join(distDir, 'latest-mac.yml'), `${lines.join('\n')}\n`, 'utf8')
}

if (process.platform !== 'darwin') {
  fail('该脚本仅支持在 macOS 上运行')
}

if (!identity) {
  fail('未找到 Developer ID Application 证书')
}

ensureEnv('APPLE_API_KEY')
ensureEnv('APPLE_API_KEY_ID')
ensureEnv('APPLE_API_ISSUER')

fs.rmSync(releaseDir, { recursive: true, force: true })
fs.mkdirSync(releaseDir, { recursive: true })

run(electronBuilder, ['--config', 'electron-builder.local.js', '--mac', 'dir', '--arm64'])
ensureExists(appPath, '打包后的 app')
writeAppUpdateConfig(appUpdateConfigPath, UPDATE_SERVER_URL, UPDATE_CHANNEL)

run('node', [signScript, appPath, identity, entitlements])
run('codesign', ['--verify', '--strict', '--verbose=2', appPath])

run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])
run('xcrun', [
  'notarytool',
  'submit',
  zipPath,
  '--key',
  process.env.APPLE_API_KEY,
  '--key-id',
  process.env.APPLE_API_KEY_ID,
  '--issuer',
  process.env.APPLE_API_ISSUER,
  '--wait',
])
run('xcrun', ['stapler', 'staple', appPath])
run('spctl', ['-a', '-vv', appPath])

run('zsh', [createDmgScript, appPath, dmgPath, productName])
run('codesign', ['--force', '--timestamp', '--sign', identity, dmgPath])
run('xcrun', [
  'notarytool',
  'submit',
  dmgPath,
  '--key',
  process.env.APPLE_API_KEY,
  '--key-id',
  process.env.APPLE_API_KEY_ID,
  '--issuer',
  process.env.APPLE_API_ISSUER,
  '--wait',
])
run('xcrun', ['stapler', 'staple', dmgPath])

buildLatestMacYml()

console.log(`[build-mac-release] app: ${appPath}`)
console.log(`[build-mac-release] zip: ${zipPath}`)
console.log(`[build-mac-release] dmg: ${dmgPath}`)
console.log(`[build-mac-release] latest-mac.yml: ${latestMacYmlPath}`)
