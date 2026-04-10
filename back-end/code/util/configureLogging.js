const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
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
}
