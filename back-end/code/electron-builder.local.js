const pkg = require('./package.json')

const baseBuild = pkg.build || {}
const localArch = process.arch === 'arm64' ? 'arm64' : 'x64'

module.exports = {
  ...baseBuild,
  mac: {
    ...(baseBuild.mac || {}),
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
    ],
  },
  extraResources: [
    ...(baseBuild.extraResources || []),
    {
      from: 'python/venv',
      to: 'python/venv',
      filter: [
        '**/*',
        '!**/__pycache__/**',
        '!**/.DS_Store',
      ],
    },
  ],
}
