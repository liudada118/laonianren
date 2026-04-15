const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const pkg = require('./package.json')

const baseBuild = pkg.build || {}
const baseExtraResources = (baseBuild.extraResources || []).filter((item) => {
  return item && item.from !== 'build'
})
const serialSource = path.join(__dirname, 'serial.txt')
const requirementsSource = path.join(__dirname, 'python', 'requirements-electron.txt')
const pythonFrameworkSource = '/Library/Frameworks/Python.framework/Versions/3.11'
const nestedSignScript = path.join(__dirname, 'scripts', 'sign-nested-macos-code.js')

function hasResource(fromPath, toPath) {
  return baseExtraResources.some(
    (item) => item && item.from === fromPath && item.to === toPath
  )
}

function resolveDeveloperIdIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME

  try {
    const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
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

const runtimeFiles = [
  'package.json',
  'index.js',
  'preload.js',
  'updater.js',
  'config.txt',
  'logo.ico',
  'footFilterConfig.json',
  'util/**/*',
  'server/**/*',
  'algorithms/**/*',
  'renderer-build/**/*',
  '!dist{,/**}',
  '!build{,/**}',
  '!python{,/**}',
  '!scripts{,/**}',
  '!signing{,/**}',
  '!OneStep{,/**}',
  '!data{,/**}',
  '!db{,/**}',
  '!img{,/**}',
  '!*.md',
  '!*.pdf',
  '!*.zip',
  '!*.dmg',
  '!*.blockmap',
  '!package-lock.json',
  '!dev-app-update.yml',
  '!electron-builder.local.js',
  '!electron-builder.signed.js',
  '!genJqtoolsConfig.js',
  '!index.html',
  '!pyWorker.js',
  '!testPython.js',
  '!e2e.config.json',
  '!data.txt',
  '!**/.DS_Store',
]

module.exports = {
  ...baseBuild,
  productName: baseBuild.productName || '肌少症评估系统',
  directories: {
    ...(baseBuild.directories || {}),
    output: 'dist/signed-arm64',
  },
  files: runtimeFiles,
  afterPack: async (context) => {
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    execFileSync('node', [path.join(__dirname, 'scripts', 'patch-packaged-python-framework.js'), appPath], {
      stdio: 'inherit',
    })
  },
  afterSign: async (context) => {
    const identity = resolveDeveloperIdIdentity()
    if (!identity) {
      console.warn('[afterSign] skip nested code signing: Developer ID Application identity not found')
      return
    }

    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    execFileSync('node', [nestedSignScript, appPath, identity], {
      stdio: 'inherit',
    })
  },
  extraResources: [
    ...baseExtraResources,
    ...(fs.existsSync(serialSource) && !hasResource('serial.txt', 'serial.txt')
      ? [
          {
            from: 'serial.txt',
            to: 'serial.txt',
          },
        ]
      : []),
    ...(fs.existsSync(requirementsSource) &&
    !hasResource('python/requirements-electron.txt', 'python/requirements-electron.txt')
      ? [
          {
            from: 'python/requirements-electron.txt',
            to: 'python/requirements-electron.txt',
          },
        ]
      : []),
    ...(fs.existsSync(pythonFrameworkSource) &&
    !hasResource(pythonFrameworkSource, 'python-runtime/Versions/3.11')
      ? [
          {
            from: pythonFrameworkSource,
            to: 'python-runtime/Versions/3.11',
          },
        ]
      : []),
  ],
  mac: {
    ...(baseBuild.mac || {}),
    icon: 'renderer-build/logo.png',
    hardenedRuntime: true,
    entitlements: 'signing/entitlements.mac.plist',
    entitlementsInherit: 'signing/entitlements.mac.inherit.plist',
    gatekeeperAssess: false,
    target: [
      {
        target: 'dmg',
        arch: ['arm64'],
      },
    ],
  },
}
