const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const pkg = require('./package.json')

const baseBuild = pkg.build || {}
const localArch = process.arch === 'arm64' ? 'arm64' : 'x64'
const baseExtraResources = (baseBuild.extraResources || []).filter((item) => {
  return item && item.from !== 'build' && item.from !== 'python/runtime'
})
const hasBundledVenv = baseExtraResources.some(
  (item) => item && item.from === 'python/venv' && item.to === 'python/venv'
)
const serialSource = path.join(__dirname, 'serial.txt')
const requirementsSource = path.join(__dirname, 'python', 'requirements-electron.txt')
const pythonFrameworkSource = '/Library/Frameworks/Python.framework'
const hasBundledSerial = baseExtraResources.some(
  (item) => item && item.from === 'serial.txt' && item.to === 'serial.txt'
)
const hasBundledRequirements = baseExtraResources.some(
  (item) =>
    item &&
    item.from === 'python/requirements-electron.txt' &&
    item.to === 'python/requirements-electron.txt'
)
const hasBundledPythonFramework = baseExtraResources.some(
  (item) => item && item.from === pythonFrameworkSource && item.to === 'python-runtime/Python.framework'
)
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
  files: runtimeFiles,
  afterPack: async (context) => {
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    execFileSync('node', [path.join(__dirname, 'scripts', 'patch-packaged-python-framework.js'), appPath], {
      stdio: 'inherit',
    })
    execFileSync('node', [path.join(__dirname, 'scripts', 'fix-python-runtime-links.js'), appPath], {
      stdio: 'inherit',
    })
  },
  mac: {
    ...(baseBuild.mac || {}),
    icon: 'renderer-build/logo.png',
    identity: null,
    hardenedRuntime: false,
    target: [
      {
        target: 'dir',
        arch: [localArch],
      },
      {
        target: 'zip',
        arch: [localArch],
      },
      {
        target: 'dmg',
        arch: [localArch],
      },
    ],
  },
  extraResources: [
    ...baseExtraResources,
    ...(!hasBundledVenv
      ? [
          {
            from: 'python/venv',
            to: 'python/venv',
            filter: [
              '**/*',
              '!**/__pycache__/**',
              '!**/.DS_Store',
            ],
          },
        ]
      : []),
    ...(fs.existsSync(serialSource) && !hasBundledSerial
      ? [
          {
            from: 'serial.txt',
            to: 'serial.txt',
          },
        ]
      : []),
    ...(fs.existsSync(requirementsSource) && !hasBundledRequirements
      ? [
          {
            from: 'python/requirements-electron.txt',
            to: 'python/requirements-electron.txt',
          },
        ]
      : []),
    ...(fs.existsSync(pythonFrameworkSource) && !hasBundledPythonFramework
      ? [
          {
            from: pythonFrameworkSource,
            to: 'python-runtime/Python.framework',
          },
        ]
      : []),
  ],
}
