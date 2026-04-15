/**
 * 自动更新模块
 * 使用 electron-updater 实现应用在线更新
 * 更新服务器: http://sensor.bodyta.com/evaluate
 */
const { autoUpdater } = require('electron-updater')
const { ipcMain, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')

// 更新服务器地址
const UPDATE_SERVER_URL = 'http://sensor.bodyta.com/shroom1'
const UPDATE_INFO_FILE = process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml'

// 更新检查间隔（毫秒）- 默认每30分钟检查一次
const CHECK_INTERVAL = 30 * 60 * 1000

let checkTimer = null
let updaterEnabled = false
let updaterIpcRegistered = false

function buildUpdateInfoUrl() {
  return `${UPDATE_SERVER_URL.replace(/\/$/, '')}/${UPDATE_INFO_FILE}`
}

function probeUrl(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const transport = url.startsWith('https:') ? https : http
    const req = transport.request(url, { method: 'GET' }, (res) => {
      res.resume()
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        statusCode: res.statusCode
      })
    })

    req.on('error', (err) => resolve({ ok: false, error: err.message }))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve({ ok: false, error: 'timeout' })
    })
    req.end()
  })
}

function startAutomaticChecks(mainWindow) {
  // 启动后延迟检查更新（给应用5秒启动时间）
  setTimeout(() => {
    console.log('[updater] 启动后首次检查更新')
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[updater] 启动检查更新失败:', err.message)
    })
  }, 5000)

  // 定时检查更新
  checkTimer = setInterval(() => {
    console.log('[updater] 定时检查更新')
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[updater] 定时检查更新失败:', err.message)
    })
  }, CHECK_INTERVAL)
}

function registerUpdaterIpcHandlers() {
  if (updaterIpcRegistered) return
  updaterIpcRegistered = true

  ipcMain.handle('check-for-update', async () => {
    if (!updaterEnabled) {
      return { success: false, error: 'auto updater is disabled in development mode' }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, data: result }
    } catch (err) {
      console.error('[updater] 检查更新失败:', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('download-update', async () => {
    if (!updaterEnabled) {
      return { success: false, error: 'auto updater is disabled in development mode' }
    }
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      console.error('[updater] 下载更新失败:', err.message)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('install-update', () => {
    if (!updaterEnabled) {
      return { success: false, error: 'auto updater is disabled in development mode' }
    }
    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  })

  ipcMain.handle('get-app-version', () => {
    const { app } = require('electron')
    return {
      version: app.getVersion(),
      updateServerUrl: UPDATE_SERVER_URL,
      updaterEnabled
    }
  })
}

/**
 * 初始化自动更新
 * @param {BrowserWindow} mainWindow - 主窗口实例
 */
function initAutoUpdater(mainWindow) {
  registerUpdaterIpcHandlers()
  updaterEnabled = true

  // 配置更新源
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: UPDATE_SERVER_URL,
    channel: 'latest'
  })

  // 禁用自动下载，让用户确认后再下载
  autoUpdater.autoDownload = false

  // 允许降级（可选）
  autoUpdater.allowDowngrade = false

  // 允许预发布版本（可选）
  autoUpdater.allowPrerelease = false

  // 日志输出
  autoUpdater.logger = {
    info: (...args) => console.log('[updater]', ...args),
    warn: (...args) => console.warn('[updater]', ...args),
    error: (...args) => console.error('[updater]', ...args),
    debug: (...args) => console.log('[updater:debug]', ...args)
  }

  // ====== 事件监听 ======

  // 检查更新时
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] 正在检查更新...')
    sendToRenderer(mainWindow, 'update-status', {
      status: 'checking',
      message: '正在检查更新...'
    })
  })

  // 发现新版本
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] 发现新版本:', info.version)
    sendToRenderer(mainWindow, 'update-status', {
      status: 'available',
      message: `发现新版本 v${info.version}`,
      version: info.version,
      releaseNotes: info.releaseNotes || '',
      releaseDate: info.releaseDate || ''
    })
  })

  // 没有新版本
  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] 当前已是最新版本:', info.version)
    sendToRenderer(mainWindow, 'update-status', {
      status: 'not-available',
      message: '当前已是最新版本',
      version: info.version
    })
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent)
    console.log(`[updater] 下载进度: ${percent}%`)
    sendToRenderer(mainWindow, 'update-status', {
      status: 'downloading',
      message: `正在下载更新: ${percent}%`,
      percent: percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  // 下载完成
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] 更新下载完成:', info.version)
    sendToRenderer(mainWindow, 'update-status', {
      status: 'downloaded',
      message: `v${info.version} 已下载完成，重启即可安装`,
      version: info.version
    })
  })

  // 更新错误
  autoUpdater.on('error', (err) => {
    console.error('[updater] 更新错误:', err.message)
    sendToRenderer(mainWindow, 'update-status', {
      status: 'error',
      message: `更新检查失败: ${err.message}`
    })
  })

  const updateInfoUrl = buildUpdateInfoUrl()
  probeUrl(updateInfoUrl).then((result) => {
    if (!result.ok) {
      const reason = result.statusCode || result.error || 'unknown'
      console.warn(`[updater] 更新源不可用，跳过自动检查: ${updateInfoUrl} (${reason})`)
      return
    }
    startAutomaticChecks(mainWindow)
  })
}

/**
 * 向渲染进程发送消息
 */
function sendToRenderer(win, channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

/**
 * 清理更新定时器
 */
function cleanupUpdater() {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
}

module.exports = {
  initAutoUpdater,
  registerUpdaterIpcHandlers,
  cleanupUpdater
}
