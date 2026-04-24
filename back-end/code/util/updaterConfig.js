const fs = require('fs')
const path = require('path')

const pkg = require('../package.json')

const UPDATE_SERVER_URL = 'http://sensor.bodyta.com/evaluate'
const UPDATE_CHANNEL = 'latest'

function getUpdaterCacheDirName() {
  return `${String(pkg.name || 'app').toLowerCase()}-updater`
}

function buildAppUpdateYaml(url = UPDATE_SERVER_URL, channel = UPDATE_CHANNEL) {
  return [
    'provider: generic',
    `url: ${String(url).replace(/\/$/, '')}`,
    `channel: ${channel}`,
    `updaterCacheDirName: ${getUpdaterCacheDirName()}`,
    '',
  ].join('\n')
}

function writeAppUpdateConfig(targetPath, url = UPDATE_SERVER_URL, channel = UPDATE_CHANNEL) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, buildAppUpdateYaml(url, channel), 'utf8')
  return targetPath
}

module.exports = {
  UPDATE_SERVER_URL,
  UPDATE_CHANNEL,
  getUpdaterCacheDirName,
  buildAppUpdateYaml,
  writeAppUpdateConfig,
}
