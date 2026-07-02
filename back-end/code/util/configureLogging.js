const fs = require('fs')
const path = require('path')

const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

let fileLoggingInstalled = false

/**
 * 把 process.stdout / process.stderr 的输出同时写入一个日志文件。
 * 不改变原有的 console 过滤行为，只是额外 tee 一份到磁盘，方便打包后排查。
 * 主进程写 main.log，serialServer 子进程写 serial.log，[pyai]/[vite]/[updater]
 * 等前缀日志和所有 console.error 都会被记录。
 *
 * @param {{ dir: string, fileName?: string, maxBytes?: number }} options
 * @returns {string|null} 实际写入的日志文件路径，失败返回 null
 */
function initFileLogging(options = {}) {
  const dir = options.dir
  if (!dir || fileLoggingInstalled) return null

  const fileName = options.fileName || 'main.log'
  const maxBytes = options.maxBytes || 3 * 1024 * 1024

  try {
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, fileName)

    // 简单按大小滚动：超过阈值就把旧文件重命名为 *.1，只保留一份历史
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > maxBytes) {
        fs.renameSync(filePath, path.join(dir, `${fileName}.1`))
      }
    } catch (rotateErr) {
      // 滚动失败不影响写入
    }

    const stream = fs.createWriteStream(filePath, { flags: 'a' })
    stream.write(`\n===== session start ${new Date().toISOString()} pid=${process.pid} packaged=${process.env.isPackaged ?? ''} =====\n`)

    for (const channel of ['stdout', 'stderr']) {
      const target = process[channel]
      if (!target || target.__fileTeeInstalled) continue
      const originalWrite = target.write.bind(target)
      target.write = (chunk, encoding, callback) => {
        try {
          stream.write(chunk)
        } catch (writeErr) {
          // 写文件失败不影响正常控制台输出
        }
        return originalWrite(chunk, encoding, callback)
      }
      target.__fileTeeInstalled = true
    }

    fileLoggingInstalled = true
    return filePath
  } catch (err) {
    return null
  }
}

const PROGRESS_PATTERNS = [
  /^\[(getFootPdf|getSitAndFootPdf|getHandPdf)\]/,
  /^\[(Python|pyai|backend|window|vite|updater|start|rescanPort|cleanup)\]/,
  /^API child exited:/,
]

let configured = false

function normalizeLogLevel(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null

  if (['progress', 'minimal', 'default'].includes(raw)) return 'progress'
  if (['0', 'false', 'off', 'none', 'silent'].includes(raw)) return 'silent'
  if (['1', 'error', 'errors'].includes(raw)) return 'error'
  if (['2', 'warn', 'warning', 'warnings'].includes(raw)) return 'warn'
  if (['3', 'info', 'log', 'logs'].includes(raw)) return 'info'
  if (['4', 'debug', 'verbose'].includes(raw)) return 'debug'
  return null
}

function shouldKeepProgressLog(args) {
  const first = typeof args[0] === 'string' ? args[0] : ''
  return PROGRESS_PATTERNS.some((pattern) => pattern.test(first))
}

function configureLogging(defaultLevel = 'progress') {
  if (configured) {
    return normalizeLogLevel(process.env.BACKEND_LOG_LEVEL) || defaultLevel
  }

  configured = true
  const levelName = normalizeLogLevel(process.env.BACKEND_LOG_LEVEL) || defaultLevel
  const level = LOG_LEVELS[levelName] ?? LOG_LEVELS.error
  const noop = () => {}
  const originalLog = console.log.bind(console)
  const originalInfo = console.info.bind(console)

  if (level < LOG_LEVELS.debug) {
    console.debug = noop
  }

  if (levelName === 'progress') {
    console.log = (...args) => {
      if (shouldKeepProgressLog(args)) originalLog(...args)
    }
    console.info = (...args) => {
      if (shouldKeepProgressLog(args)) originalInfo(...args)
    }
  } else if (level < LOG_LEVELS.info) {
    console.log = noop
    console.info = noop
  }
  if (level < LOG_LEVELS.warn) {
    console.warn = noop
  }
  if (level < LOG_LEVELS.error) {
    console.error = noop
  }

  return levelName
}

module.exports = {
  configureLogging,
  initFileLogging,
}
