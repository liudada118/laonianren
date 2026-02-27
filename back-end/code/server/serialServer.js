

const express = require('express')
const os = require('os')
const fs = require('fs')
const path = require('path')
const cors = require('cors');
const WebSocket = require("ws");
const HttpResult = require('./HttpResult')
const { SerialPort, DelimiterParser } = require('serialport')
const { getPort } = require('../util/serialport')
const { blue, splitArr } = require('../util/config');
const constantObj = require('../util/config');
const { bytes4ToInt10 } = require('../util/parseData');
const { initDb, dbLoadCsv, deleteDbData, dbGetData, getCsvData, changeDbName, changeDbDataName } = require('../util/db');
const { hand, jqbed, endiSit, endiBack } = require('../util/line');
// const { callPy } = require('../pyWorker');  // [已迁移到JS算法] Python子进程不再需要
const { callAlgorithm } = require('../algorithms');
const { decryptStr } = require('../util/aes_ecb');
const { default: axios } = require('axios');
const module2 = require('../util/aes_ecb')
const multer = require('multer')


console.log('userData from env:', typeof process.env.isPackaged);

let { isPackaged, appPath } = process.env
isPackaged = isPackaged == 'true'
const app = express()
const userDataDir =
  typeof process.env.userData === 'string' && process.env.userData.trim()
    ? process.env.userData.trim()
    : null
const resourcesBase =
  process.env.resourcesPath ||
  process.resourcesPath ||
  (appPath ? path.dirname(appPath) : __dirname)
const storageBase = isPackaged ? (userDataDir || resourcesBase) : path.join(__dirname, '..')

let pdfDir = path.join(storageBase, 'OneStep')
let uploadDir = path.join(storageBase, 'img')
if (!fs.existsSync(pdfDir)) {
  fs.mkdirSync(pdfDir, { recursive: true })
}
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '')
    const tempName = `${Date.now()}-${Math.floor(Math.random() * 1e9)}${ext}`
    cb(null, tempName)
  },
})
const upload = multer({ storage })

function sanitizeFilename(name) {
  if (typeof name !== 'string') return ''
  let safe = name.trim()
  // disallow path traversal
  safe = safe.replace(/[\\/]/g, '')
  // remove control chars and Windows reserved chars: <>:"/\\|?*
  safe = safe.replace(/[\x00-\x1F<>:"|?*]/g, '')
  // trim trailing dots/spaces (Windows)
  safe = safe.replace(/[.\s]+$/g, '')
  return safe
}

function buildReportBaseName({ assessmentId, name, sampleType, fallback }) {
  const idStr = assessmentId ? String(assessmentId) : ''
  const nameStr = name ? String(decodeField(name)).trim() : ''
  const sampleDigits = sampleType ? String(sampleType).replace(/\D/g, '') : ''
  const parts = []
  if (idStr) parts.push(idStr)
  if (nameStr) parts.push(nameStr)
  if (sampleDigits) parts.push(sampleDigits)
  let raw = parts.join('_')
  // if (sampleDigits === '4') raw += 'OneStepReport'
  if (!raw) raw = fallback ? String(fallback) : ''
  const safe = sanitizeFilename(raw)
  return safe || sanitizeFilename(String(fallback || 'report')) || 'report'
}

function pickName(dbName, reqName) {
  const a = decodeField(dbName)
  const b = decodeField(reqName)
  const aStr = typeof a === 'string' ? a.trim() : ''
  const bStr = typeof b === 'string' ? b.trim() : ''
  return aStr || bStr || ''
}

function fixMojibake(value) {
  if (typeof value !== 'string') return value
  if (/[\u3400-\u9FFF]/.test(value)) return value
  try {
    const buf = Buffer.from(value, 'latin1')
    const utf = buf.toString('utf8')
    // If the roundtrip matches, it's likely latin1-decoded UTF-8 and should be fixed
    if (Buffer.from(utf, 'utf8').equals(buf)) {
      return utf
    }
  } catch { }
  return value
}

function decodeMaybeUri(value) {
  if (typeof value !== 'string') return value
  let result = value
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(result)
      if (decoded === result) break
      result = decoded
    } catch {
      break
    }
  }
  return result
}

function decodeField(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }
  if (typeof value !== 'string') return value
  return decodeMaybeUri(fixMojibake(value))
}

function normalizeAssessmentId(value) {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  return str ? str : null
}

async function resolveAssessmentContext(db, req, rawTimestamp) {
  let assessmentId = normalizeAssessmentId(
    req?.body?.assessmentId ?? req?.query?.assessmentId
  )
  const tsNum = Number(rawTimestamp)
  let matchedDate = null
  let matchedTimestamp = null

  const pickRow = async (sql, params) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err)
        resolve(row || null)
      })
    })

  if (Number.isFinite(tsNum)) {
    let row = await pickRow(
      "select date, timestamp, assessment_id from matrix WHERE timestamp = ?",
      [tsNum]
    )
    if (!row) {
      row = await pickRow(
        "select date, timestamp, assessment_id from matrix ORDER BY ABS(timestamp - ?) ASC LIMIT 1",
        [tsNum]
      )
    }
    if (row) {
      matchedDate = row.date || null
      matchedTimestamp = row.timestamp || null
      if (!assessmentId) assessmentId = normalizeAssessmentId(row.assessment_id)
    }
  } else if (rawTimestamp) {
    const row = await pickRow(
      "select date, timestamp, assessment_id from matrix WHERE date = ? ORDER BY timestamp DESC LIMIT 1",
      [String(rawTimestamp)]
    )
    if (row) {
      matchedDate = row.date || null
      matchedTimestamp = row.timestamp || null
      if (!assessmentId) assessmentId = normalizeAssessmentId(row.assessment_id)
    }
  }

  return { assessmentId, matchedDate, matchedTimestamp, tsNum }
}

function flipFoot64x64Horizontal(arr) {
  if (!Array.isArray(arr) || arr.length !== 4096) return arr
  const size = 64
  const out = new Array(arr.length)
  for (let r = 0; r < size; r++) {
    const rowStart = r * size
    for (let c = 0; c < size; c++) {
      out[rowStart + c] = arr[rowStart + (size - 1 - c)]
    }
  }
  return out
}

function zeroBelowThreshold(arr, threshold) {
  if (!Array.isArray(arr)) return arr
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < threshold) arr[i] = 0
  }
  return arr
}

function removeSmallIslands64x64(arr, minSize = 9) {
  if (!Array.isArray(arr) || arr.length !== 4096) return arr
  const size = 64
  const visited = new Array(arr.length).fill(false)
  const dirs = [-1, 0, 1]
  for (let idx = 0; idx < arr.length; idx++) {
    if (visited[idx] || arr[idx] <= 0) continue
    const stack = [idx]
    const component = []
    visited[idx] = true
    while (stack.length) {
      const cur = stack.pop()
      component.push(cur)
      const r = Math.floor(cur / size)
      const c = cur - r * size
      for (let dr of dirs) {
        const nr = r + dr
        if (nr < 0 || nr >= size) continue
        for (let dc of dirs) {
          const nc = c + dc
          if (nc < 0 || nc >= size) continue
          if (dr === 0 && dc === 0) continue
          const ni = nr * size + nc
          if (!visited[ni] && arr[ni] > 0) {
            visited[ni] = true
            stack.push(ni)
          }
        }
      }
    }
    if (component.length < minSize) {
      for (let i = 0; i < component.length; i++) {
        arr[component[i]] = 0
      }
    }
  }
  return arr
}


function parseSerialTypeMap(raw) {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return {}
  let text = raw.trim()
  if (!text) return {}

  if (text.includes('"key"') && text.includes('"orgName"')) {
    const keyIdx = text.indexOf('"key"')
    if (keyIdx !== -1) {
      const afterKey = text.slice(keyIdx)
      const colonIdx = afterKey.indexOf(':')
      if (colonIdx !== -1) {
        let rest = afterKey.slice(colonIdx + 1)
        const orgIdx = rest.indexOf('"orgName"')
        if (orgIdx !== -1) rest = rest.slice(0, orgIdx)
        rest = rest.replace(/^[\s,]+/, '').replace(/[\s,]+$/, '')
        if (
          (rest.startsWith('"') && rest.endsWith('"')) ||
          (rest.startsWith("'") && rest.endsWith("'"))
        ) {
          rest = rest.slice(1, -1)
        }
        text = rest.trim()
      }
    }
  }

  const tryParse = (value) => {
    try {
      const obj = JSON.parse(value)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
    } catch { }
    return null
  }

  let obj = tryParse(text)
  if (obj) return obj

  const normalized = text.replace(/'/g, '"')
  obj = tryParse(normalized)
  if (obj) return obj

  const map = {}
  normalized.split(/[,;\n]+/).forEach((part) => {
    const m = part.match(/^\s*"?([^":=]+)"?\s*[:=]\s*"?([^"]+)"?\s*$/)
    if (m) {
      map[m[1].trim()] = m[2].trim()
    }
  })
  return map
}

function getTypeFromSerialCache(uniqueId) {
  if (!uniqueId) return null
  const cache = readSerialCache()
  const map = parseSerialTypeMap(cache && cache.key)
  const target = String(uniqueId).trim().toUpperCase()
  for (const key of Object.keys(map || {})) {
    if (String(key).trim().toUpperCase() === target) {
      return map[key]
    }
  }
  return null
}

function normalizeActiveTypes(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    const list = value.map((v) => String(v).trim()).filter(Boolean)
    return list.length ? list : null
  }
  if (typeof value === 'string') {
    const list = value
      .split(/[,;\s]+/)
      .map((v) => v.trim())
      .filter(Boolean)
    return list.length ? list : null
  }
  return null
}

function filterDataByTypes(data, types) {
  if (!types || !Array.isArray(types) || !types.length) return data
  if (!data || typeof data !== 'object') return data
  const out = {}
  types.forEach((type) => {
    if (data[type]) out[type] = data[type]
  })
  return out
}


const ORIGIN = 'https://sensor.bodyta.com';

// 1) 鎵€鏈夊疄闄呰姹傝嚜鍔ㄥ甫涓?CORS 澶?
// app.use(cors({
//   origin: ORIGIN,        // 涓嶈兘鏄?*
//   credentials: true,
//   methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
//   allowedHeaders: ['Content-Type','Authorization','X-Requested-With'],
//   maxAge: 600,
// }));

// // 2) 缁熶竴澶勭悊棰勬锛涢『甯︽敮鎸?PNA锛堝叕缃戦〉闈?-> 鏈湴/鍐呯綉锛?
// app.options('*', (req, res) => {
//   if (req.header('Access-Control-Request-Private-Network') === 'true') {
//     res.setHeader('Access-Control-Allow-Private-Network', 'true');
//   }
//   // 鎶婂父瑙?CORS 棰勬澶翠篃鍥炰笂锛堟湁浜涚幆澧冮渶瑕佹樉寮忚繑鍥烇級
//   res.setHeader('Access-Control-Allow-Origin', ORIGIN);
//   res.setHeader('Access-Control-Allow-Credentials', 'true');
//   res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
//   res.sendStatus(204);
// });


app.use(cors());
app.use(express.json());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// serial.txt cache
const serialPath = (() => {
  if (isPackaged) {
    const base = appPath ? path.dirname(appPath) : (process.resourcesPath || __dirname)
    return path.join(base, 'serial.txt')
  }
  return path.join(__dirname, '../serial.txt')
})()

function readSerialCache() {
  try {
    if (!fs.existsSync(serialPath)) return null
    const raw = fs.readFileSync(serialPath, 'utf-8').trim()
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return { key: raw }
    }
  } catch {
    return null
  }
}

function writeSerialCache(payload) {
  const data = {
    key: payload.key || '',
    orgName: payload.orgName || '',
    updatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(serialPath, JSON.stringify(data, null, 2), 'utf-8')
  return data
}


let dbPath = path.join(__dirname, '../db')
let pdfPath = path.join(__dirname, "../OneStep");
let imgPath = path.join(__dirname, '../img')

console.log(isPackaged, appPath, 'app.isPackaged')

if (isPackaged) {
  if (os.platform() == 'darwin') {
    // filePath = '../..' + '/db'
    // filePath = path.join(app.getAppPath(), 'Resources/db',);
    dbPath = path.join(__dirname, '../../db')
    csvPath = path.join(__dirname, '../../data')
    nameTxt = path.join(__dirname, '../../config.txt')
    console.log(dbPath, path.join(appPath, 'Resources/db',))
    // nameTxt = 
    // csvPath = '../..' + '/data'
    // nameTxt = '../..' + "/config.txt";
  } else {

    dbPath = 'resources' + '/db'
    csvPath = 'resources' + '/data'
    pdfPath = 'resources' + "/OneStep";
    imgPath = 'resources' + '/img'
    nameTxt = 'resources' + "/config.txt";

    console.log(dbPath, path.join(appPath, 'Resources/db',))
  }

}

const port = 19245

function resolveConfigPath() {
  const candidates = [
    path.join(dbPath, 'config.txt'),
    path.join(__dirname, '../config.txt'),
    path.join(process.cwd(), 'config.txt'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  return candidates[0]
}

const configPath = resolveConfigPath()
const config = fs.readFileSync(configPath, 'utf-8',)
const result = JSON.parse(decryptStr(config))
console.log(result)
// 褰撳墠鐨勮蒋浠剁郴缁?, 褰撳墠鐨勬尝鐗圭巼
var file = result.value, baudRate = 1000000, parserArr = {}, dataMap = {},
  // 鍙戦€丠Z , 涓插彛鏈€澶z, 閲囬泦寮€鍏?, 閲囬泦鍛藉悕 , 鍘嗗彶鏁版嵁寮€鍏?, 鍘嗗彶鎾斁寮€鍏?, 鏁版嵁鎾斁绱㈠紩 , 鍥炴斁瀹氭椂鍣?, 淇濆瓨鏁版嵁鏈€澶Z
  HZ = 30, MaxHZ, colFlag = false, colName, historyFlag = false, historyPlayFlag = false, playIndex = 0, colTimer, colMaxHZ, colplayHZ, playtimer
let splitBuffer = Buffer.from(splitArr);
let linkIngPort = [], currentDb, macInfo = {}, selectArr = []
let activeSendTypes = null
let activeAssessmentId = null
let activeSampleType = null
let currentSendIntervalMs = null
const DEFAULT_SEND_MS = 80
const MIN_SEND_INTERVAL_MS = 5
const HZ_CACHE_UPDATE_MS = 500
const MODE_TYPE_MAP = {
  1: ['HL', 'HR'],      // 握力评估页面进入时：推送双手数据（用于显示连接状态）
  11: ['HL'],            // 握力评估-左手采集：只推送左手数据
  12: ['HR'],            // 握力评估-右手采集：只推送右手数据
  2: ['HL', 'HR'],
  3: ['sit', 'foot1'],
  4: ['foot1'],
  5: ['foot1', 'foot2', 'foot3', 'foot4'],
}
let sensorHzCache = {}
let sensorHzLocked = false
let sensorTypeSignature = ''
let lastHzCacheUpdateTs = 0

function getConnectedTypes() {
  const types = new Set()
  Object.keys(dataMap).forEach((key) => {
    const item = dataMap[key]
    const parser = parserArr[key]
    if (!item || !item.type) return
    if (!parser || !parser.port || !parser.port.isOpen) return
    if (item.premission === false) return
    types.add(item.type)
  })
  return Array.from(types).sort()
}

function updateSensorTypeSignature() {
  const types = getConnectedTypes()
  const signature = types.join('|')
  if (signature !== sensorTypeSignature) {
    sensorTypeSignature = signature
    sensorHzLocked = false
    sensorHzCache = {}
    lastHzCacheUpdateTs = 0
  }
  return types
}

function getTypeHz(type) {
  let hz = null
  Object.keys(dataMap).forEach((key) => {
    const item = dataMap[key]
    const parser = parserArr[key]
    if (!item || item.type !== type) return
    if (!parser || !parser.port || !parser.port.isOpen) return
    const ms = Number(item.HZ)
    if (!Number.isFinite(ms) || ms <= 0) return
    if (hz === null || ms < hz) hz = ms
  })
  return hz
}

function maybeLockSensorHz() {
  const now = Date.now()
  if (now - lastHzCacheUpdateTs < HZ_CACHE_UPDATE_MS) return
  const types = updateSensorTypeSignature()
  if (!types.length) return
  const next = {}
  for (let i = 0; i < types.length; i++) {
    const type = types[i]
    const hz = getTypeHz(type)
    if (!hz) return
    next[type] = Math.max(MIN_SEND_INTERVAL_MS, hz)
  }
  const changed = Object.keys(next).some((key) => next[key] !== sensorHzCache[key])
  if (changed || !sensorHzLocked) {
    sensorHzCache = next
    sensorHzLocked = true
    // console.log('[hz] locked', sensorHzCache)
  }
  lastHzCacheUpdateTs = now
}

function resetSensorHzCache() {
  sensorHzCache = {}
  sensorHzLocked = false
  sensorTypeSignature = ''
  lastHzCacheUpdateTs = 0
}
const ALGOR = 'algor', HANDLE = 'handle'
var algorData, control_command, controlMode = ALGOR, oldControlMode = '', feedbackAirIndex = [1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
let lastRealtimeLogTs = 0
let colPersonName = ''
// 閫夋嫨鏁版嵁搴撴暟鎹?
let historyDbArr;
let lastFootPointArr = [], pdfArrData = [], pdfReportName = '', pdfReport = '', pdfReportSex = ''
let pdfReportMeta = { assessmentId: '', name: '', sampleType: '', fallback: '' }

function getActiveSendIntervalMs() {
  if (!activeSendTypes || !Array.isArray(activeSendTypes) || !activeSendTypes.length) return null
  updateSensorTypeSignature()
  if (sensorHzLocked && sensorHzCache && Object.keys(sensorHzCache).length) {
    let min = null
    for (let i = 0; i < activeSendTypes.length; i++) {
      const type = activeSendTypes[i]
      const ms = Number(sensorHzCache[type])
      if (!Number.isFinite(ms) || ms <= 0) continue
      if (min === null || ms < min) min = ms
    }
    if (min !== null) return min
  }
  let min = null
  Object.keys(dataMap).forEach((key) => {
    const item = dataMap[key]
    if (!item || !item.type || !activeSendTypes.includes(item.type)) return
    let ms = Number(item.HZ)
    if (!Number.isFinite(ms) || ms <= 0) return
    if (min === null || ms < min) min = ms
  })
  return min
}

let _updateTimerDebounce = null
let _lastTimerUpdateTs = 0
const TIMER_DEBOUNCE_MS = 500      // 防抖间隔：500ms内不重复触发
const TIMER_THRESHOLD_MS = 10      // 间隔变化阈值：变化<10ms不重建定时器

function updateSendTimerForActiveTypes() {
  // 如果定时器还没启动，立即执行一次
  if (!playtimer) {
    _doUpdateSendTimer()
    _lastTimerUpdateTs = Date.now()
    return
  }
  // 防抖：避免每帧数据到达都重建定时器
  if (_updateTimerDebounce) return
  const now = Date.now()
  // 如果距离上次更新不到 TIMER_DEBOUNCE_MS，跳过
  if (now - _lastTimerUpdateTs < TIMER_DEBOUNCE_MS) return
  _updateTimerDebounce = setTimeout(() => {
    _updateTimerDebounce = null
    _lastTimerUpdateTs = Date.now()
    _doUpdateSendTimer()
  }, TIMER_DEBOUNCE_MS)
}

function _doUpdateSendTimer() {
  const interval = getActiveSendIntervalMs()
  if (!activeSendTypes || !Array.isArray(activeSendTypes) || !activeSendTypes.length) return
  const ms = Math.max(MIN_SEND_INTERVAL_MS, Math.floor(interval ?? DEFAULT_SEND_MS))
  // 如果定时器已运行且间隔变化小于阈值，不重建
  if (playtimer && currentSendIntervalMs !== null && Math.abs(ms - currentSendIntervalMs) < TIMER_THRESHOLD_MS) return
  if (playtimer) {
    clearInterval(playtimer)
  }
  currentSendIntervalMs = ms
  playtimer = setInterval(() => {
    colAndSendData()
  }, ms)
  // console.log('[timer] send interval updated to', ms, 'ms')
}

function resetSendTimer() {
  if (playtimer) {
    clearInterval(playtimer)
  }
  playtimer = null
  currentSendIntervalMs = null
}

function setActiveSendTypes(types, sampleType = undefined) {
  activeSendTypes = types
  if (sampleType !== undefined) {
    activeSampleType = sampleType
  }
  resetSendTimer()
  if (activeSendTypes && activeSendTypes.length) {
    updateSendTimerForActiveTypes()
  }
}

function applyActiveMode(mode) {
  if (mode === null || mode === undefined || mode === '') {
    setActiveSendTypes(null, null)
    return { activeTypes: null, sampleType: null }
  }
  const modeNum = parseInt(mode, 10)
  const types = MODE_TYPE_MAP[modeNum]
  if (!types) return null
  // mode 11/12 是握力评估的左/右手子模式，sampleType 仍用 '1'
  const sampleType = (modeNum === 11 || modeNum === 12) ? '1' : String(modeNum)
  setActiveSendTypes(types, sampleType)
  return { activeTypes: types, sampleType }
}

const BAUD_CANDIDATES = [921600, 1000000, 3000000]

function bufferContainsSequence(buffer, sequence) {
  if (!buffer || buffer.length < sequence.length) return false
  for (let i = 0; i <= buffer.length - sequence.length; i++) {
    let match = true
    for (let j = 0; j < sequence.length; j++) {
      if (buffer[i + j] !== sequence[j]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

async function detectBaudRate(path, timeoutMs = 800) {
  for (let i = 0; i < BAUD_CANDIDATES.length; i++) {
    const baudRate = BAUD_CANDIDATES[i]
    const ok = await new Promise((resolve) => {
      let cache = Buffer.alloc(0)
      let timer = null
      let port = null

      const cleanup = (result) => {
        if (timer) clearTimeout(timer)
        if (port) {
          port.off('data', onData)
          port.off('error', onError)
          if (port.isOpen) {
            port.close(() => resolve(result))
            return
          }
        }
        resolve(result)
      }

      const onData = (data) => {
        cache = Buffer.concat([cache, Buffer.from(data)])
        if (cache.length > 1024) {
          cache = cache.slice(-1024)
        }
        if (bufferContainsSequence(cache, splitArr)) {
          cleanup(true)
        }
      }

      const onError = () => cleanup(false)

      try {
        port = new SerialPort({ path, baudRate, autoOpen: true })
        port.on('data', onData)
        port.on('error', onError)
      } catch (e) {
        cleanup(false)
        return
      }

      timer = setTimeout(() => cleanup(false), timeoutMs)
    })

    if (ok) return baudRate
  }
  return null
}


//瀵规瘮鏁版嵁
let leftDbArr, rightDbArr;


const { db } = initDb(file, dbPath)
currentDb = db
ensureMatrixNameColumn(currentDb)

console.log(__dirname, dbPath, '__dirname')

app.get('/', (req, res) => {
  res.send('Hello World!')
})

// GET /OneStep/<filename> -> send pdf file
app.get('/OneStep/:name', (req, res) => {
  try {
    const rawName = req.params.name || ''
    const decodedName = decodeURIComponent(rawName)
    const safeName = decodedName.replace(/[\\/]/g, '')
    if (!safeName || safeName !== decodedName) {
      res.status(400).send('Invalid file name')
      return
    }
    const filePath = path.join(pdfDir, safeName)
    const resolvedPath = path.resolve(filePath)
    const resolvedBase = path.resolve(pdfDir) + path.sep
    if (!resolvedPath.startsWith(resolvedBase)) {
      res.status(403).send('Forbidden')
      return
    }
    const ext = path.extname(safeName).toLowerCase()
    let contentType = 'application/octet-stream'
    if (ext === '.pdf') contentType = 'application/pdf'
    else if (ext === '.mp4') contentType = 'video/mp4'
    else if (ext === '.json') contentType = 'application/json'
    else if (ext === '.png') contentType = 'image/png'
    res.setHeader('Content-Type', contentType)
    if (ext === '.pdf') {
      res.setHeader('Content-Disposition', 'inline')
    }
    res.sendFile(resolvedPath, (err) => {
      if (err) {
        res.status(err.statusCode || 404).send('Not Found')
      }
    })
  } catch (e) {
    res.status(500).send('Server Error')
  }
})

// async function demo(matrix) {
//   // 鏋勯€犱竴鏉?1024 闀垮害鐨勬祴璇曟暟鎹?

//   // console.log(matrix)
//   // const data = new Array(10).fill(new Array(1024).fill(50)); // 鍙互鏀惧鏉?
//   // const res = await callPy('cal_cop_fromData', { data : matrix });
//   const res = await callPy('cal_cop_fromData', { data: matrix });
//   // console.log(res);
//   console.log(res, new Date().getTime()); // { left: [...], right: [...] }
// }


// async function main() {
//   const data1 = await getCsvData('D:/jqtoolsWin - 鍓湰/python/app/闈欐€佹暟鎹泦1.csv')

//   const matrix = data1.map((a) => JSON.parse(a.data))
//   await demo(matrix)
//   await demo(matrix)
//   await demo(matrix)
//   await demo(matrix)
//   await demo(matrix)
//   await demo(matrix)
//   await demo(matrix)
// }

// main()


// 缁戝畾瀵嗛挜
app.post('/bindKey', (req, res) => {
  console.log(req.body.key)
  try {

    const { key } = req.body;

    res.json(new HttpResult(0, {}, '缁戝畾鎴愬姛'));
  } catch {
    res.json(new HttpResult(1, {}, '缁戝畾澶辫触'));
  }

})

// serial.txt cache APIs
app.get('/serialCache', (req, res) => {
  const data = readSerialCache()
  if (data && data.key && data.orgName) {
    res.json(new HttpResult(0, { hasCache: true, ...data }, 'success'))
    return
  }
  res.json(new HttpResult(0, { hasCache: false }, 'empty'))
})

app.post('/serialCache', (req, res) => {
  try {
    const { key, orgName } = req.body || {}
    if (!key || !orgName) {
      res.json(new HttpResult(1, {}, 'missing key or orgName'))
      return
    }
    const saved = writeSerialCache({ key, orgName })
    res.json(new HttpResult(0, saved, 'success'))
  } catch (err) {
    res.json(new HttpResult(1, {}, 'save failed'))
  }
})

app.post('/uploadCanvas', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.json(new HttpResult(1, {}, 'missing file'));
      return
    }
    if (typeof req.body.filename === 'string') req.body.filename = decodeField(req.body.filename)
    if (typeof req.body.collectName === 'string') req.body.collectName = decodeField(req.body.collectName)
    if (typeof req.body.date === 'string') req.body.date = decodeField(req.body.date)
    console.log('[uploadCanvas]', {
      collectName: req.body.collectName,
      age: req.body.age,
      gender: req.body.gender,
    })
    const requestedDate =
      (typeof req.body.date === 'string' && req.body.date.trim()) ||
      (typeof req.query.date === 'string' && req.query.date.trim()) ||
      ''
    const sanitizedRequested = sanitizeFilename(requestedDate)
    const resolvedName = pickName(pdfReportMeta.name, req.body.collectName)
    const baseName = buildReportBaseName({
      assessmentId: pdfReportMeta.assessmentId || req.body.assessmentId,
      name: resolvedName,
      sampleType: pdfReportMeta.sampleType || req.body.sample_type || req.body.sampleType,
      fallback: sanitizedRequested || requestedDate
    })
    if (!baseName) {
      fs.unlinkSync(req.file.path)
      res.json(new HttpResult(1, {}, 'missing date'));
      return
    }
    const finalName = `${baseName}.png`
    const newPath = path.join(uploadDir, finalName)
    fs.renameSync(req.file.path, newPath)
    req.file.filename = finalName
    req.file.path = newPath
    req.file.destination = uploadDir
    const absolutePath = path.resolve(req.file.path)
    const name = `${pdfPath}/${baseName}`
    console.log(pdfArrData[0], name, `${imgPath}/${baseName}.png`)
    // [已迁移] PDF生成功能待后续用JS实现，目前跳过
    const pdf = await callAlgorithm('generate_foot_pressure_report', {
      data_array: pdfArrData,
      name: name,
      heatmap_png_path: `${imgPath}/${baseName}.png`,
      user_name: resolvedName,
      user_age: req.body.age,
      user_gender: req.body.gender,
      user_id: req.body.userId || 9527,
    })
    res.json(new HttpResult(0, { file: req.file, body: req.body, absolutePath }, 'success'));
  } catch {
    res.json(new HttpResult(1, {}, 'upload failed'));
  }
})

app.post('/getHandPdf' , async (req , res) => {
  try {
    const rawTimestamp =
      req.body?.timestamp ??
      req.body?.time ??
      req.body?.date ??
      req.query?.timestamp ??
      req.query?.time ??
      req.query?.date ??
      ''

    // 新方式：前端传入 leftAssessmentId 和 rightAssessmentId，分别查询左右手数据
    const leftAssessmentId = normalizeAssessmentId(req.body?.leftAssessmentId)
    const rightAssessmentId = normalizeAssessmentId(req.body?.rightAssessmentId)

    let leftArr = null
    let rightArr = null
    let bestRow = null
    let matchedDate = null
    let matchedTimestamp = null
    let tsNum = Number(rawTimestamp)

    if (leftAssessmentId || rightAssessmentId) {
      // ===== 新逻辑：分别从两个 assessmentId 中提取 HL / HR 数据 =====
      console.log('[getHandPdf] 使用分离模式: leftId=%s, rightId=%s', leftAssessmentId, rightAssessmentId)

      if (leftAssessmentId) {
        const { dataArr: leftDataArr, rows: leftRows } = await dbGetData({
          db: currentDb,
          params: [leftAssessmentId],
          byAssessmentId: true
        })
        if (leftRows && leftRows.length) {
          const leftKeys = Object.keys(leftDataArr || {})
          const lk = leftKeys.find((k) => k === 'HL' || /left|lhand|handl/i.test(k))
          leftArr = lk ? leftDataArr[lk] : null
          // 如果 HL 没找到，尝试取第一个可用的数据（可能只有一种设备类型）
          if (!leftArr && leftKeys.length > 0) {
            leftArr = leftDataArr[leftKeys[0]]
          }
          if (!bestRow) bestRow = leftRows[0]
          console.log('[getHandPdf] 左手数据: key=%s, frames=%d', lk || leftKeys[0], leftArr ? leftArr.length : 0)
        }
      }

      if (rightAssessmentId) {
        const { dataArr: rightDataArr, rows: rightRows } = await dbGetData({
          db: currentDb,
          params: [rightAssessmentId],
          byAssessmentId: true
        })
        if (rightRows && rightRows.length) {
          const rightKeys = Object.keys(rightDataArr || {})
          const rk = rightKeys.find((k) => k === 'HR' || /right|rhand|handr/i.test(k))
          rightArr = rk ? rightDataArr[rk] : null
          // 如果 HR 没找到，尝试取第一个可用的数据
          if (!rightArr && rightKeys.length > 0) {
            rightArr = rightDataArr[rightKeys[0]]
          }
          if (!bestRow) bestRow = rightRows[0]
          console.log('[getHandPdf] 右手数据: key=%s, frames=%d', rk || rightKeys[0], rightArr ? rightArr.length : 0)
        }
      }

      matchedDate = bestRow?.date || null
      matchedTimestamp = bestRow?.timestamp || null
    } else {
      // ===== 旧逻辑兼容：使用单个 assessmentId 或 timestamp 查询 =====
      const resolved = await resolveAssessmentContext(currentDb, req, rawTimestamp)
      const assessmentId = resolved.assessmentId
      matchedDate = resolved.matchedDate
      matchedTimestamp = resolved.matchedTimestamp
      tsNum = resolved.tsNum || tsNum

      if (!assessmentId) {
        res.json(new HttpResult(1, {}, 'missing assessment_id'))
        return
      }

      const { dataArr, rows } = await dbGetData({
        db: currentDb,
        params: [assessmentId],
        byAssessmentId: true
      })

      if (!rows || !rows.length) {
        res.json(new HttpResult(1, {}, 'no data for assessment_id'))
        return
      }

      const targetTs = Number(matchedTimestamp ?? tsNum)
      bestRow = Array.isArray(rows) && rows.length
        ? rows.reduce((best, row) => {
            const t = Number(row?.timestamp)
            if (!Number.isFinite(t)) return best
            if (!best) return row
            const bestT = Number(best?.timestamp)
            if (!Number.isFinite(bestT)) return row
            return Math.abs(t - targetTs) < Math.abs(bestT - targetTs) ? row : best
          }, null)
        : null
      const keys = Object.keys(dataArr || {})
      const leftKey = keys.find((k) => k === 'HL' || /left|lhand|handl/i.test(k))
      const rightKey = keys.find((k) => k === 'HR' || /right|rhand|handr/i.test(k))

      leftArr = leftKey ? dataArr[leftKey] : null
      rightArr = rightKey ? dataArr[rightKey] : null
    }

    if (!leftArr && !rightArr) {
      res.json(new HttpResult(1, {}, 'no hand data'))
      return
    }

    let leftRenderResult = null
    let rightRenderResult = null
    try {
      leftRenderResult = leftArr
        ? await callAlgorithm('generate_grip_render_report', {
            sensor_data: leftArr,
            hand_type: '左手',
          })
        : null
      rightRenderResult = rightArr
        ? await callAlgorithm('generate_grip_render_report', {
            sensor_data: rightArr,
            hand_type: '右手',
          })
        : null
    } catch (e) {
      console.error('generate_grip_render_report failed:', e)
    }
    res.json(
      new HttpResult(
        0,
        {
          date: matchedDate || bestRow?.date || rawTimestamp,
          timestamp: matchedTimestamp ?? tsNum,
          render_data: {
            left: leftRenderResult,
            right: rightRenderResult,
            activeHand: leftRenderResult ? 'left' : 'right',
          },
        },
        'success'
      )
    )
  } catch (e) {
    console.error(e)
    res.json(new HttpResult(1, {}, 'getHandPdf failed'))
  }
})

app.post('/getSitAndFootPdf', async (req, res) => {
  try {
    const rawTimestamp =
      req.body?.timestamp ??
      req.body?.time ??
      req.body?.date ??
      req.query?.timestamp ??
      req.query?.time ??
      req.query?.date ??
      ''

    const { assessmentId, matchedDate, matchedTimestamp, tsNum } =
      await resolveAssessmentContext(currentDb, req, rawTimestamp)

    if (!assessmentId) {
      res.json(new HttpResult(1, {}, 'missing assessment_id'))
      return
    }

    const sampleType = '3'
    const rows = await new Promise((resolve, reject) => {
      currentDb.all(
        "select * from matrix WHERE assessment_id=? AND sample_type=?",
        [assessmentId, sampleType],
        (err, data) => {
          if (err) return reject(err)
          resolve(data || [])
        }
      )
    })

    console.log(rows)

    if (!rows || !rows.length) {
      res.json(new HttpResult(1, {}, 'no data for assessment_id'))
      return
    }

    const targetTs = Number(matchedTimestamp ?? tsNum)
    const bestRow = rows.reduce((best, row) => {
      const t = Number(row?.timestamp)
      if (!Number.isFinite(t)) return best
      if (!best) return row
      const bestT = Number(best?.timestamp)
      if (!Number.isFinite(bestT)) return row
      return Math.abs(t - targetTs) < Math.abs(bestT - targetTs) ? row : best
    }, null)

    const firstObj = (() => {
      try {
        return JSON.parse(rows[0].data || '{}')
      } catch {
        return {}
      }
    })()
    const keys = Object.keys(firstObj || {})

    const pickKey = (list, regexes) => {
      for (const k of list) {
        if (keys.includes(k)) return k
      }
      for (const re of regexes) {
        const found = keys.find((k) => re.test(k))
        if (found) return found
      }
      return null
    }

    const sitKey = pickKey(
      ['sit'],
      [/sit/i]
    )
    const standKey = pickKey(
      ['foot1'],
      [/foot1/i, /foot/i, /stand/i, /back/i]
    )

    const formatTimestamp = (ts) => {
      const d = new Date(ts)
      const pad = (n, len = 2) => String(n).padStart(len, '0')
      return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(d.getMilliseconds(), 3)}`
    }

    const standData = []
    const standTimes = []
    const sitData = []
    const sitTimes = []

    rows.forEach((row) => {
      let dataObj = {}
      try {
        dataObj = JSON.parse(row.data || '{}')
      } catch {}
      if (standKey && dataObj[standKey]) {
        const d = dataObj[standKey]
        const arr = Array.isArray(d) ? d : d.arr
        if (Array.isArray(arr)) {
          standData.push(arr)
          standTimes.push(formatTimestamp(row.timestamp))
        }
      }
      if (sitKey && dataObj[sitKey]) {
        const d = dataObj[sitKey]
        const arr = Array.isArray(d) ? d : d.arr
        if (Array.isArray(arr)) {
          sitData.push(arr)
          sitTimes.push(formatTimestamp(row.timestamp))
        }
      }
    })

    if (!standData.length || !sitData.length) {
      res.json(new HttpResult(1, { keys }, 'missing stand or sit data'))
      return
    }

    const resolvedName = pickName(
      bestRow ? bestRow.name : '',
      req.body?.collectName || req.body?.userName || ''
    )

    console.log('[getSitAndFootPdf] frame lengths:', {
      standFrames: standData.length,
      sitFrames: sitData.length,
      standFrameSize: Array.isArray(standData[0]) ? standData[0].length : null,
      sitFrameSize: Array.isArray(sitData[0]) ? sitData[0].length : null,
      standTimes: standTimes.length,
      sitTimes: sitTimes.length
    })

    let renderData = null
    try {
      renderData = await callAlgorithm('generate_sit_stand_render_report', {
        stand_data: standData,
        sit_data: sitData,
        username: resolvedName || req.body?.collectName || req.body?.userName || 'user',
      })
    } catch (e) {
      console.error('generate_sit_stand_render_report failed:', e)
    }

    res.json(
      new HttpResult(
        0,
        {
          date: matchedDate || bestRow?.date || rawTimestamp,
          timestamp: matchedTimestamp ?? tsNum,
          render_data: renderData,
        },
        'success'
      )
    )
  } catch (e) {
    console.error(e)
    res.json(new HttpResult(1, {}, 'getSitAndFootPdf failed'))
  }
})

app.post('/getFootPdf', async (req, res) => {
  try {
    const rawTimestamp =
      req.body?.timestamp ??
      req.body?.time ??
      req.body?.date ??
      req.query?.timestamp ??
      req.query?.time ??
      req.query?.date ??
      ''

    const { assessmentId, matchedDate, matchedTimestamp, tsNum } =
      await resolveAssessmentContext(currentDb, req, rawTimestamp)

    if (!assessmentId) {
      res.json(new HttpResult(1, {}, 'missing assessment_id'))
      return
    }

    const sampleTypeRaw = '5'
    const rows = await new Promise((resolve, reject) => {
      currentDb.all(
        "select * from matrix WHERE assessment_id=? AND sample_type=?",
        [assessmentId, sampleTypeRaw],
        (err, data) => {
          if (err) return reject(err)
          resolve(data || [])
        }
      )
    })

    if (!rows || !rows.length) {
      res.json(new HttpResult(1, {}, 'no data for assessment_id'))
      return
    }

    const targetTs = Number(matchedTimestamp ?? tsNum)
    const bestRow = rows.reduce((best, row) => {
      const t = Number(row?.timestamp)
      if (!Number.isFinite(t)) return best
      if (!best) return row
      const bestT = Number(best?.timestamp)
      if (!Number.isFinite(bestT)) return row
      return Math.abs(t - targetTs) < Math.abs(bestT - targetTs) ? row : best
    }, null)

    const formatTimestamp = (ts) => {
      const d = new Date(ts)
      const pad = (n, len = 2) => String(n).padStart(len, '0')
      return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(d.getMilliseconds(), 3)}`
    }

    const data1 = []
    const data2 = []
    const data3 = []
    const data4 = []
    const t1 = []
    const t2 = []
    const t3 = []
    const t4 = []

    const requiredKeys = ['foot1', 'foot2', 'foot3', 'foot4']
    rows.forEach((row) => {
      let dataObj = {}
      try {
        dataObj = JSON.parse(row.data || '{}')
      } catch {}
      const v1 = dataObj.foot1?.arr || dataObj.foot1
      const v2 = dataObj.foot2?.arr || dataObj.foot2
      const v3 = dataObj.foot3?.arr || dataObj.foot3
      const v4 = dataObj.foot4?.arr || dataObj.foot4
      if (
        Array.isArray(v1) && Array.isArray(v2) &&
        Array.isArray(v3) && Array.isArray(v4)
      ) {
        data1.push(v1)
        data2.push(v2)
        data3.push(v3)
        data4.push(v4)
        const ts = formatTimestamp(row.timestamp)
        t1.push(ts)
        t2.push(ts)
        t3.push(ts)
        t4.push(ts)
      }
    })

    if (!data1.length || !data2.length || !data3.length || !data4.length) {
      res.json(new HttpResult(1, { keys: requiredKeys }, 'missing foot data'))
      return
    }

    const bodyWeightKg = Number(req.body?.body_weight_kg ?? req.body?.bodyWeightKg ?? 80)

    // try {
    //   const csvEscape = (value) => {
    //     const s = value === null || value === undefined ? '' : String(value)
    //     const escaped = s.replace(/"/g, '""')
    //     return `"${escaped}"`
    //   }
    //   const lines = []
    //   lines.push('time1,time2,time3,time4,foot1,foot2,foot3,foot4')
    //   const n = Math.min(data1.length, data2.length, data3.length, data4.length, t1.length, t2.length, t3.length, t4.length)
    //   for (let i = 0; i < n; i++) {
    //     lines.push([
    //       csvEscape(t1[i]),
    //       csvEscape(t2[i]),
    //       csvEscape(t3[i]),
    //       csvEscape(t4[i]),
    //       csvEscape(JSON.stringify(data1[i])),
    //       csvEscape(JSON.stringify(data2[i])),
    //       csvEscape(JSON.stringify(data3[i])),
    //       csvEscape(JSON.stringify(data4[i]))
    //     ].join(','))
    //   }
    //   fs.writeFileSync(csvPathOut, lines.join('\n'), 'utf-8')
    //   console.log(csvPathOut)
    // } catch (e) {
    //   console.error('write foot csv failed', e)
    // }

    console.log('[getFootPdf] frame lengths:', {
      d1: data1.length,
      d2: data2.length,
      d3: data3.length,
      d4: data4.length,
      t1: t1.length,
      t2: t2.length,
      t3: t3.length,
      t4: t4.length
    })

    let renderData = null

    // 调用 Python 步道算法（包含完整的去噪、对齐、分析和图片生成）
    try {
      // 将 4 路数据转换为 Python 算法需要的格式
      // board_data: 每块板的数据是 "[v0,v1,...,v4095]" 格式的字符串数组
      const boardData = [
        data1.map(arr => JSON.stringify(arr)),
        data2.map(arr => JSON.stringify(arr)),
        data3.map(arr => JSON.stringify(arr)),
        data4.map(arr => JSON.stringify(arr)),
      ]
      const boardTimes = [t1, t2, t3, t4]

      console.log('[getFootPdf] 调用 Python 步道算法...')
      renderData = await callAlgorithm('generate_gait_render_report', {
        board_data: boardData,
        board_times: boardTimes,
      })

      if (renderData) {
        console.log('[getFootPdf] Python 步道算法成功')
      }
    } catch (e) {
      console.error('[getFootPdf] Python 步道算法失败:', e.message)
    }

    res.json(
      new HttpResult(
        0,
        {
          date: matchedDate || bestRow?.date || rawTimestamp,
          timestamp: matchedTimestamp ?? tsNum,
          render_data: renderData
        },
        'success'
      )
    )
  } catch (e) {
    console.error(e)
    res.json(new HttpResult(1, {}, 'getFootPdf failed'))
  }
})

app.post('/uploadCanvas_old', (req, res) => {
  console.log(req)
  try {

    const { key } = req.body;

    res.json(new HttpResult(0, {}, '缁戝畾鎴愬姛'));
  } catch {
    res.json(new HttpResult(1, {}, '缁戝畾澶辫触'));
  }

})

/**
 * 1. 閫夋嫨绯荤粺
 * 2. 鍒濆鍖栨暟鎹簱
 * 3. 鍏抽棴涓插彛
 * */
app.post('/selectSystem', (req, res) => {
  file = req.query.file;
  const { db } = initDb(file, dbPath)
  currentDb = db
  ensureMatrixNameColumn(currentDb)
  if (blue.includes(file)) {
    baudRate = 921600
  } else {
    baudRate = 1000000
  }
})

// 鏌ヨ绯荤粺鍒楄〃鍜屽綋鍓嶇郴缁?
app.get('/getSystem', async (req, res) => {

  const config = fs.readFileSync(configPath, 'utf-8',)
  const result = JSON.parse(decryptStr(config))
  result.value = 'foot'

  // const result = {
  //   value: "bed",
  //   typeArr: ["bed", "hand", 'foot', 'bigHand']
  // }
  baudRate = constantObj.baudRateObj[result.value] ? constantObj.baudRateObj[result.value] : 1000000

  const { db } = initDb(file, dbPath)
  currentDb = db
  ensureMatrixNameColumn(currentDb)

  res.json(new HttpResult(0, result, '鑾峰彇璁惧鍒楄〃鎴愬姛'));
})

// 鏌ヨ涓插彛
app.get('/getPort', async (req, res) => {
  let ports, portsRes
  if (process.env.VIRTUAL_SERIAL_TEST === 'true') {
    try {
      portsRes = JSON.parse(process.env.VIRTUAL_PORT_LIST || '[]')
    } catch (e) {
      portsRes = []
    }
  } else {
    ports = await SerialPort.list()
    portsRes = getPort(ports)
  }
  res.json(new HttpResult(0, portsRes, '鑾峰彇璁惧鍒楄〃鎴愬姛'));
})

// 涓€閿繛鎺?
app.get('/connPort', async (req, res) => {
  try {
    let port = await connectPort()
    res.json(new HttpResult(0, port, '杩炴帴鎴愬姛'));

  } catch {
    res.json(new HttpResult(1, {}, '杩炴帴澶辫触'));
  }

})

// 寮€濮嬮噰闆?
app.post('/startCol', async (req, res) => {
  try {
    const { fileName, select, name, collectName, date } = req.body
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'assessmentId')) {
      const v = req.body.assessmentId
      activeAssessmentId = v === null || v === undefined || v === '' ? null : String(v)
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sampleType') || Object.prototype.hasOwnProperty.call(req.body || {}, 'sample_type')) {
      const v = req.body.sampleType ?? req.body.sample_type
      activeSampleType = v === null || v === undefined || v === '' ? null : String(v)
    }
    selectArr = select
    if (typeof req.body.fileName === 'string') req.body.fileName = decodeField(req.body.fileName)
    if (typeof req.body.name === 'string') req.body.name = decodeField(req.body.name)
    if (typeof req.body.collectName === 'string') req.body.collectName = decodeField(req.body.collectName)
    if (typeof req.body.date === 'string') req.body.date = decodeField(req.body.date)
    if (typeof req.body.colName === 'string') req.body.colName = decodeField(req.body.colName)

    const sensorArr = Object.keys(dataMap).map((a) => dataMap[a].type)

    const length = sensorArr.filter((a) => a.includes(file)).length
    console.log(sensorArr, file, length)
    if (length > 0) {
      colFlag = true
      colName = (req.body.date || req.body.colName || '')
      colPersonName = req.body.fileName || req.body.name || req.body.collectName || ''
      res.json(new HttpResult(0, port, 'start collection'));
    } else {
      res.json(new HttpResult(0, 'please select sensor type', 'error'));
    }

  } catch {

  }

})

// 璁剧疆褰撳墠璇勪及妯″紡锛堟帶鍒?WS 鍙戦€佷笌瀛樺偍鐨勬暟鎹被鍨嬶級
app.post('/setActiveMode', (req, res) => {
  try {
    const { mode } = req.body || {}
    const result = applyActiveMode(mode)
    if (!result) {
      res.json(new HttpResult(1, {}, 'invalid mode'))
      return
    }
    res.json(new HttpResult(0, result, 'success'))
  } catch (e) {
    res.json(new HttpResult(1, {}, 'setActiveMode failed'))
  }
})


// 鍋滄閲囬泦
app.get('/endCol', async (req, res) => {
  colFlag = false
  res.json(new HttpResult(0, 'success', '鍋滄閲囬泦'));
})

// 鑾峰彇鏁版嵁搴撴墍鏈夊瓨鍙栧垪琛?
app.get('/getColHistory', async (req, res) => {
  // const selectQuery =
  //   "select DISTINCT date,timestamp, `select` from matrix ORDER BY timestamp DESC LIMIT ?,?";

  const selectQuery = `
  SELECT m.assessment_id, m.date, m.timestamp, m.name, m.\`select\`
  FROM matrix m
  INNER JOIN (
    SELECT COALESCE(NULLIF(assessment_id,''), date) AS grp, MAX(timestamp) AS max_ts
    FROM matrix
    GROUP BY grp
  ) t
  ON COALESCE(NULLIF(m.assessment_id,''), m.date) = t.grp AND m.timestamp = t.max_ts
  ORDER BY m.timestamp DESC
  LIMIT ?, ?
`;

  const params = [0, 500];

  historyFlag = true

  currentDb.all(selectQuery, params, (err, rows) => {
    if (err) {
      console.error(err);
    } else {

      let jsonData;
      let sitTimeArr = rows;
      console.log(rows, '1111')
      let timeArr = rows;


      jsonData = JSON.stringify({
        timeArr: timeArr,
        // index: nowIndex,
        sitData: new Array(4096).fill(0),
      });

      res.json(new HttpResult(0, timeArr, 'success'));

      // socketSendData(server, jsonData)


    }
  });
  socketSendData(server, JSON.stringify({ sitData: {} }))
})

// app.post('/changeSelect', async (req, res) => {
//   try {
//     const { select } = req.body
//     selectArr = select
//     console.log(first)
//     // if (!selectArr.length) {
//     //   res.json(new HttpResult(555, '璇烽€夋嫨鍏堟暟鎹?, 'error'));
//     // }
//     // const params = selectArr;
//     // const data = await dbLoadCsv({ db: currentDb, params, file, isPackaged })
//     // res.json(new HttpResult(0, data, '涓嬭浇'));
//   } catch {

//   }
// })

// 涓嬭浇鎴恈sv
app.post('/downlaod', async (req, res) => {
  try {
    const { fileArr, assessmentIds } = req.body || {}
    const params = (assessmentIds && assessmentIds.length) ? assessmentIds : fileArr
    if (!params || !params.length) {
      res.json(new HttpResult(555, 'missing data', 'error'));
      return
    }
    const data = await dbLoadCsv({
      db: currentDb,
      params,
      file,
      isPackaged,
      byAssessmentId: true
    })
    res.json(new HttpResult(0, data, '涓嬭浇'));
  } catch {

  }
})

// 鍒犻櫎鏁版嵁搴撴煇涓枃浠?
app.post('/delete', async (req, res) => {
  try {
    const { fileArr } = req.body

    const params = fileArr;
    const data = await deleteDbData({ db: currentDb, params })
    console.log(data)
    res.json(new HttpResult(0, data, '鍒犻櫎鎴愬姛'));
  } catch {

  }
})

app.post('/changeDbName', async (req, res) => {
  try {
    const { newDate, oldDate } = req.body

    console.log([newDate, oldDate])
    const data = await changeDbName({ db: currentDb, params: [newDate, oldDate] })
    console.log(data)
    res.json(new HttpResult(0, data, '鍒犻櫎鎴愬姛'));
  } catch {

  }
})

// 鑾峰彇鏁版嵁搴撴煇涓椂闂寸殑鎵€鏈夋暟鎹?
app.post('/getDbHistory', async (req, res) => {
  const rawTimestamp =
    req.body?.assessmentId ??
    req.body?.time ??
    req.body?.date ??
    req.query?.assessmentId ??
    req.query?.time ??
    req.query?.date ??
    ''

  const { assessmentId } = await resolveAssessmentContext(currentDb, req, rawTimestamp)
  if (!assessmentId) {
    res.json(new HttpResult(1, {}, 'missing assessment_id'))
    return
  }

  const { length, pressArr, areaArr, rows, dataArr } = await dbGetData({
    db: currentDb,
    params: [assessmentId],
    byAssessmentId: true
  })

  const data = { length, pressArr, areaArr, dataArr }

  historyDbArr = rows
  colMaxHZ = 1000 / (historyDbArr[1].timestamp - historyDbArr[0].timestamp)
  colplayHZ = colMaxHZ
  historyFlag = true
  playIndex = 0

  if (dataArr['foot']) {
    // const peak_frame = await callPy("get_peak_frame", { sensor_data: dataArr['foot'] })
    // console.log(peak_frame)
    const copData = await callAlgorithm("replay_server", { sensor_data: dataArr['foot'] })
    copData.length = length
    res.json(new HttpResult(0, copData, 'success'));
    return
  }

  res.json(new HttpResult(0, data, 'success'));
})

app.post('/getDbHeatmap', async (req, res) => {
  try {
    const rawTimestamp =
      req.body?.timestamp ??
      req.body?.time ??
      req.body?.date ??
      req.query?.timestamp ??
      req.query?.time ??
      req.query?.date ??
      ''

    const { assessmentId, matchedDate, matchedTimestamp, tsNum } =
      await resolveAssessmentContext(currentDb, req, rawTimestamp)

    if (!assessmentId) {
      res.json(new HttpResult(1, {}, 'missing assessment_id'))
      return
    }

    const sampleType = '4'
    const rows = await new Promise((resolve, reject) => {
      currentDb.all(
        "select * from matrix WHERE assessment_id=? AND sample_type=?",
        [assessmentId, sampleType],
        (err, data) => {
          if (err) return reject(err)
          resolve(data || [])
        }
      )
    })

    if (!rows || !rows.length) {
      res.json(new HttpResult(1, {}, 'no data for assessment_id'))
      return
    }

    const targetTs = Number(matchedTimestamp ?? tsNum)
    const bestRow = rows.reduce((best, row) => {
      const t = Number(row?.timestamp)
      if (!Number.isFinite(t)) return best
      if (!best) return row
      const bestT = Number(best?.timestamp)
      if (!Number.isFinite(bestT)) return row
      return Math.abs(t - targetTs) < Math.abs(bestT - targetTs) ? row : best
    }, null)

    pdfReportMeta = {
      assessmentId: bestRow?.assessment_id || '',
      name: pickName(bestRow?.name || '', req.body?.collectName || req.body?.userName || ''),
      sampleType: bestRow?.sample_type || sampleType,
      fallback: matchedDate || bestRow?.date || rawTimestamp
    }

    const dataArr = {}
    rows.forEach((row) => {
      let dataObj = {}
      try {
        dataObj = JSON.parse(row.data || '{}')
      } catch {}
      Object.keys(dataObj).forEach((key) => {
        const item = dataObj[key]
        const arr = Array.isArray(item) ? item : item?.arr
        if (!Array.isArray(arr)) return
        if (!dataArr[key]) dataArr[key] = []
        dataArr[key].push(arr)
      })
    })

    if (dataArr['foot'] || dataArr['foot1']) {
      const sensor = dataArr['foot'] || dataArr['foot1']
      pdfArrData = sensor
      let renderData = null
      try {
        renderData = await callAlgorithm('generate_standing_render_report', {
          data_array: sensor,
          fps: Number(req.body?.fps ?? 42),
          threshold_ratio: Number(req.body?.threshold_ratio ?? 0.8),
        })
      } catch (e) {
        console.error('generate_standing_render_report failed:', e)
      }
      res.json(new HttpResult(0, { render_data: renderData }, 'success'))
      return
    }

    res.json(new HttpResult(0, {}, 'error'))
  } catch (e) {
    console.error(e)
    res.json(new HttpResult(1, {}, 'getDbHeatmap failed'))
  }
})

app.post('/getContrastData', async (req, res) => {
  const { left, right } = req.body

  const params = [left];
  const params1 = [right]

  const { length: lengthL, pressArr: pressArrL, areaArr: areaArrL, rows: rowsL } = await dbGetData({
    db: currentDb,
    params,
    byAssessmentId: true
  })
  const { length, pressArr, areaArr, rows } = await dbGetData({
    db: currentDb,
    params: params1,
    byAssessmentId: true
  })

  leftDbArr = rowsL
  rightDbArr = rows

  const data = { left: { length: lengthL, pressArr: pressArrL, areaArr: areaArrL, }, right: { length, pressArr, areaArr, } }

  socketSendData(server, JSON.stringify({
    contrastData: { left: JSON.parse(leftDbArr[0].data), right: JSON.parse(rightDbArr[0].data) },
    // index: playIndex,
    // timestamp: JSON.parse(historyDbArr[playIndex].timestamp)
  }))

  res.json(new HttpResult(0, data, 'success'));

})


app.post('/changeDbDataName', async (req, res) => {
  const { oldName, newName } = req.body

  changeDbDataName({ db: currentDb, params: [oldName, newName] })
})

// 鍙栨秷鎾斁
app.post('/cancalDbPlay', async (req, res) => {
  // 灏嗗洖鏀緁lag缃负false 骞朵笖灏嗗綋鍓嶆暟鎹暟缁勭疆涓虹┖
  historyFlag = false
  historyDbArr = null

  if (colTimer) {
    console.log('clean', colTimer)
    clearInterval(colTimer)
  }

  res.json(new HttpResult(0, {}, 'success'));
})

// 寮€濮嬫挱鏀?
app.post('/getDbHistoryPlay', async (req, res) => {


  if (historyDbArr) {


    if (playIndex == historyDbArr.length - 1) {
      playIndex = 0
    }
    // 鎾斁flag鎵撳紑
    historyPlayFlag = true

    if (colTimer) {
      clearInterval(colTimer)
    }

    socketSendData(server, JSON.stringify({ playEnd: true }))

    colTimer = setInterval(() => {
      if (historyPlayFlag && historyDbArr) {

        socketSendData(server, JSON.stringify({
          sitDataPlay: JSON.parse(historyDbArr[playIndex].data),
          index: playIndex,
          timestamp: JSON.parse(historyDbArr[playIndex].timestamp)
        }))
        if (playIndex < historyDbArr.length - 1) {
          playIndex++
        } else {
          console.log(colTimer)
          historyPlayFlag = false
          socketSendData(server, JSON.stringify({ playEnd: false }))
          clearInterval(colTimer)
        }
      }
    }, 1000 / colplayHZ)
    res.json(new HttpResult(0, {}, 'success'));

  } else {
    res.json(new HttpResult(1, 'missing replay range', 'error'));
  }
})

// 淇敼鎾斁閫熷害
app.post('/changeDbplaySpeed', async (req, res) => {
  const { speed } = req.body
  // historyPlayFlag = true
  colplayHZ = colMaxHZ * speed
  if (historyPlayFlag) {
    if (colTimer) {
      clearInterval(colTimer)
    }
    colTimer = setInterval(() => {
      if (historyPlayFlag) {

        socketSendData(server, JSON.stringify({
          sitData: JSON.parse(historyDbArr[playIndex].data),
          index: playIndex,
          timestamp: JSON.parse(historyDbArr[playIndex].timestamp)
        }))
        if (playIndex < historyDbArr.length - 1) {
          playIndex++
        } else {
          socketSendData(server, JSON.stringify({ playEnd: false }))
          historyPlayFlag = false
          clearInterval(colTimer)
        }
      }
    }, 1000 / (colplayHZ))
  }

  res.json(new HttpResult(0, {}, 'success'));
})

// 淇敼绯荤粺绫诲瀷
app.post('/changeSystemType', async (req, res) => {
  const { system } = req.body
  file = system
  baudRate = constantObj.baudRateObj[system] ? constantObj.baudRateObj[system] : 1000000
  const { db } = initDb(file, dbPath)
  currentDb = db
  ensureMatrixNameColumn(currentDb)
  console.log(baudRate)
  // stopPort()
  socketSendData(server, JSON.stringify({ sitData: {} }))

  res.json(new HttpResult(0, { optimalObj: result.optimalObj[file], maxObj: result.maxObj[file] }, 'success'));
})


// 鍙栨秷鎾斁
app.post('/getDbHistoryStop', async (req, res) => {
  historyPlayFlag = false
  res.json(new HttpResult(0, {}, 'success'));
})

// 鑾峰彇鏌愪釜鏃堕棿鐨勬暟鎹殑鏌愪釜绱㈠紩鏁版嵁
app.post('/getDbHistoryIndex', async (req, res) => {
  const { index } = req.body

  if (!historyDbArr) {
    res.json(new HttpResult(555, 'missing replay range', 'error'));
    return
  }

  playIndex = index
  socketSendData(server, JSON.stringify({
    sitData: JSON.parse(historyDbArr[playIndex].data),
    index: playIndex,
    timestamp: JSON.parse(historyDbArr[playIndex].timestamp)
  }))
  res.json(new HttpResult(0, historyDbArr[index], 'success'));
})

// 璇诲彇csv
app.post('/getCsvData', async (req, res) => {
  const { fileName } = req.body
  const data = getCsvData(fileName)
  console.log(data)
  csvArr = data
  res.json(new HttpResult(0, data, 'success'));
})

function portWirte(port) {
  return new Promise((resolve, reject) => {
    // const command = 'AT\r\n';
    const command = Buffer.from('41542B4E414D453D45535033320d0a', 'hex')

    port.write(command, err => {
      if (err) {
        return console.error('err2:', err.message);
      }
      // console.log('send:', command.trim());
      // resolve(command.trim())

      console.log('send:', 11);
      resolve(11)
    });
  })
}

function sendMacCommand(port, path, baudRate, parserItem) {
  if (!port) return
  const run = () => {
    if (baudRate === 3000000) {
      if (parserItem?.macTimer) return
      const sendOnce = () => {
        portWirte(port)
          .then(() => {
            sendMacNum++
            console.log(`[sendAT] ${path} total=${sendMacNum} success=${successNum}`)
          })
          .catch((err) => {
            console.log(`[sendAT] ${path} failed`, err)
          })
      }
      sendOnce()
      parserItem.macTimer = setInterval(() => {
        if (parserItem.macReady) {
          clearInterval(parserItem.macTimer)
          parserItem.macTimer = null
          return
        }
        sendOnce()
      }, 300)
      return
    }

    const times = baudRate === 921600 ? 1 : 3
    for (let i = 0; i < times; i++) {
      setTimeout(() => {
        portWirte(port)
          .then(() => {
            sendMacNum++
            console.log(`[sendAT] ${path} total=${sendMacNum} success=${successNum}`)
          })
          .catch((err) => {
            console.log(`[sendAT] ${path} failed`, err)
          })
      }, i * 120)
    }
  }
  if (port.isOpen) {
    run()
  } else {
    port.once('open', run)
  }
}

app.get('/sendMac', async (req, res) => {

  if (Object.keys(parserArr).length) {
    const task = []
    for (let i = 0; i < Object.keys(parserArr).length; i++) {
      const key = Object.keys(parserArr)[i]
      const port = parserArr[key].port

      // const command = 'AT\r\n';
      // port.write(command, err => {
      //   if (err) {
      //     return console.error('err2:', err.message);
      //   }
      //   console.log('send:', command.trim());

      // });

      // task.push(portWirte(port))
    }
    const results = await Promise.all(task);
    sendMacNum++
    console.log('sendTotal:', sendMacNum, '-----', 'success:', successNum)
    res.json(new HttpResult(0, {}, 'send success'));
  } else {
    res.json(new HttpResult(0, {}, '璇峰厛杩炴帴涓插彛'));
  }
})

app.post('/getSysconfig', async (req, res) => {
  const { config } = req.body
  // const data = getCsvData(fileName)
  const result = JSON.stringify(config)

  let str = module2.encStr(`${result}`);
  const data = str
  //   console.log(data)
  // csvArr = data
  res.json(new HttpResult(0, data, 'success'));
})

// 鏌ユ壘pyConfig
app.get('/getPyConfig', async (req, res) => {

  const obj = await callAlgorithm('getParam')
  res.json(new HttpResult(0, obj, 'success'));
})

app.post('/changePy', async (req, res) => {
  const { path, value } = req.body
  let object = {}
  object[path] = JSON.parse(value)
  console.log(object, 'object')
  const obj = await callAlgorithm('setParam', { obj: object })
  res.json(new HttpResult(0, obj, 'success'));
})

// 璁＄畻cop 
// let arr = []
// app.post('/getCop', async (req, res) => {
//   const { MatrixList } = req.body
//   // console.log(MatrixList)
//   const data = await callPy('cal_cop_fromData', { data: MatrixList })
//   // console.log(data)
//   // csvArr = data

//   // arr.push({ MatrixList, data })
//   // fs.writeFile('D:/jqtoolsWin - 鍓湰/server/data.txt', JSON.stringify(arr), 'utf8', (err) => {
//   //   if (err) {
//   //     console.error('杩藉姞澶辫触:', err);
//   //   } else {
//   //     console.log('杩藉姞鎴愬姛');
//   //   }
//   // });
//   res.json(new HttpResult(0, data, 'success'));
// })



app.listen(port, () => {
  process.send?.({ type: 'ready', port });
  console.log(`Example app listening on port ${port}`)
})


const server = new WebSocket.Server({ port: 19999 });

server.on("open", function open() {
  console.log("connected");
});

server.on("close", function close() {
  console.log("disconnected");
});

server.on("connection", function connection(ws, req) {
  const ip = req.connection.remoteAddress;
  const port = req.connection.remotePort;
  const clientName = ip + port;
  console.log("%s is connected", clientName);

  socketSendData(server, JSON.stringify({}))

  ws.on("message", (msg) => {
    let text = ''
    if (Buffer.isBuffer(msg)) {
      text = msg.toString('utf8')
    } else if (typeof msg === 'string') {
      text = msg
    } else {
      return
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      return
    }
    if (payload && payload.clearActiveTypes) {
      setActiveSendTypes(null, null)
    }
    const incomingMode =
      payload?.mode ??
      payload?.current ??
      payload?.activeMode ??
      payload?.activeModeId ??
      payload?.activeModeType
    if (incomingMode !== undefined) {
      applyActiveMode(incomingMode)
    } else {
      const incoming =
        payload?.activeTypes ??
        payload?.activeType ??
        payload?.filterTypes ??
        payload?.filterType ??
        payload?.onlyTypes ??
        payload?.onlyType
      if (incoming !== undefined) {
        const types = normalizeActiveTypes(incoming)
        setActiveSendTypes(types)
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'sampleType')) {
      const v = payload.sampleType
      activeSampleType = v === null || v === undefined || v === '' ? null : String(v)
      if (activeSendTypes && activeSendTypes.length) {
        resetSendTimer()
        updateSendTimerForActiveTypes()
      }
    }
  });
});

/**
 * 
 * @param {obj} server websocket鏈嶅姟鍣?
 * @param {JSON} data 鍙戦€佺殑鏁版嵁
 */
const socketSendData = (server, data) => {
  server.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * 灏嗕覆鍙ｈ窡 parser杩炴帴璧锋潵
 */
const newSerialPortLink = ({ path, parser, baudRate = 1000000 }) => {
  let port
  console.log(path, baudRate)
  try {
    port = new SerialPort(
      {
        path,
        baudRate: baudRate,
        autoOpen: true,
      },
      function (err) {
        console.log(err, "err");
      }
    );
    //绠￠亾娣诲姞瑙ｆ瀽鍣?
    port.pipe(parser);
  } catch (e) {
    console.log(e, "e");
  }
  return port
}

/**
 * 
 * @param {Array} parserArr 
 * @param {object} objs 
 * @returns 瑙ｆ瀽钃濈墮鍒嗗寘鏁版嵁
 */
function parseData(parserArr, objs, type) {

  let json = {}
    Object.keys(objs).forEach((key) => {
      const obj = parserArr[key]
      const data = objs[key]
      if (!obj || !obj.port || !obj.port.isOpen) {
        if (data && data.type) {
          json[data.type] = { status: 'offline' }
        }
        return
      }
      if (obj.port.isOpen) {
      let blueArr = []
      // console.log(data.type)
      if (data.type && (data.type == 'HL' || data.type == 'HR')) {

        const { order } = constantObj
        const lastData = data[order[1]]
        const nextData = data[order[2]]

        if (lastData && lastData.length && nextData && nextData.length) {
          blueArr = [...lastData, ...nextData]
        }
      }
      else if (type == 'blue') {
        const { order } = constantObj
        const lastData = data[order[1]]
        const nextData = data[order[2]]

        if (lastData && lastData.length && nextData && nextData.length) {
          blueArr = [...lastData, ...nextData]
        }
      } else if (type == 'highHZ') {
        blueArr = data.arr
      }
      // 褰撳墠鏃堕棿鎴充笌鍙戞暟鎹椂闂存埑涔嬪樊
      const dataStamp = new Date().getTime() - data.stamp
      json[data.type] = {}

      // 鏍规嵁鍙戦€佹椂闂翠笌鏈€鏂版椂闂存埑鐨勫樊鍊? 鍒ゆ柇璁惧鐨勫湪绂荤嚎鐘舵€?
      if (dataStamp < 1000) {

        json[data.type].status = 'online'
        // console.log(first)
        // if (data.type.includes(file)) json[data.type].arr = blueArr
        json[data.type].arr = blueArr
        json[data.type].rotate = data.rotate
        json[data.type].stamp = data.stamp
        json[data.type].HZ = data.HZ
        if (data.cop) json[data.type].cop = data.cop
        if (data.breatheData) json[data.type].cop = data.breatheData
        // json[data.type].stampDiff = new Date().getTime() - data.stamp
      } else {
        json[data.type].status = 'offline'
      }
    } else {
      json[data.type] = {}
      json[data.type].status = 'offline'
    }

  })
  if (json.foot) {
    if (!json.foot4) {
      json.foot4 = json.foot
    }
    delete json.foot
  }
  return json
}

/**
 * 杩炴帴鎴愬姛骞朵笖鍙戦€佹暟鎹?
 * @returns 
 * 
 */

var sendMacNum = 0, successNum = 0, sendDataLength = 0
const oldTimeObj = {}
async function connectPort() {
  macInfo = {}
  let ports
  if (process.env.VIRTUAL_SERIAL_TEST === 'true') {
    // 测试模式：使用虚拟串口列表
    try {
      ports = JSON.parse(process.env.VIRTUAL_PORT_LIST || '[]')
      console.log('[TEST] Using virtual serial ports:', ports.length)
    } catch (e) {
      ports = []
      console.error('[TEST] Failed to parse VIRTUAL_PORT_LIST:', e.message)
    }
  } else {
    ports = await SerialPort.list()
    ports = getPort(ports)
  }
  console.log(ports, 'ports')
  // 鍒涘缓骞惰繛鎺ユ暟鎹€氶亾骞朵笖璁剧疆鍥炶皟
  for (let i = 0; i < ports.length; i++) {

      const portInfo = ports[i]




      const { path } = portInfo
      const manufacturer = (portInfo.manufacturer || '').toLowerCase()
      const friendlyName = (portInfo.friendlyName || '').toLowerCase()
      const isCh340 = friendlyName.includes('ch340')
      let portBaudRate = baudRate
      if (manufacturer.includes('wch.cn')) {
        portBaudRate = 921600
      }
    // parserArr[path]
      const parserItem = parserArr[path] = parserArr[path] ? parserArr[path] : {}
      const dataItem = dataMap[path] = dataMap[path] ? dataMap[path] : {}
      if (isCh340) {
        dataItem.type = 'sit'
        parserItem.typeLocked = true
      }
      parserItem.baudRate = portBaudRate
      // parserItem 
      parserItem.parser = new DelimiterParser({ delimiter: splitBuffer })

    const { parser } = parserItem

    // if()

      if (!(parserItem.port && parserItem.port.isOpen)) {
        let detectedBaud = null
        if (process.env.VIRTUAL_SERIAL_TEST === 'true') {
          // 测试模式：从环境变量获取预设波特率
          try {
            const baudMap = JSON.parse(process.env.VIRTUAL_BAUD_MAP || '{}')
            detectedBaud = baudMap[path] || null
          } catch (e) {}
          console.log('[TEST] Skipping detectBaudRate for', path, '-> using', detectedBaud || portBaudRate)
        } else {
          detectedBaud = await detectBaudRate(path)
        }
        if (detectedBaud) {
          portBaudRate = detectedBaud
        }
        console.log('[baud]', path, '=>', portBaudRate, detectedBaud ? '(detected)' : '')
        parserItem.baudRate = portBaudRate
        const port = newSerialPortLink({ path, parser: parserItem.parser, baudRate: portBaudRate })

      // linkIngPort.push(port)

      // port.open(err => {
      //   if (err) {
      //     return console.error('err1:', err.message);
      //   }
      //   console.log('open');

      //   // 鍙戦€?AT 鎸囦护
      //   const command = 'AT\r\n';
      //   port.write(command, err => {
      //     if (err) {
      //       return console.error('err2:', err.message);
      //     }
      //     console.log('宸插彂閫?', command.trim());
      //   });
      // });

      // const command = 'AT\r\n';
      // const command = Buffer.from('41542B4E414D453D45535033320d0a', 'hex')
      // port.write(command, err => {
      //   if (err) {
      //     return console.error('err2:', err.message);
      //   }
      //   console.log('send:', 22);
      //   sendMacNum++
      // });

      parserItem.port = port
      // connection established -> send AT to query device info
      if (process.env.VIRTUAL_SERIAL_TEST === 'true' && portBaudRate === 3000000) {
        // 测试模式：直接从虚拟串口名推断MAC和type，跳过AT指令
        const virtualMacMap = JSON.parse(process.env.VIRTUAL_MAC_MAP || '{}');
        const portName = path.split('/').pop().replace('_app', '');
        const macEntry = virtualMacMap[portName];
        if (macEntry) {
          const uniqueId = macEntry.mac;
          const version = 'C40510';
          console.log(`[TEST] Auto-assigning MAC for ${path}: ${uniqueId}`);
          successNum++;
          parserItem.macReady = true;
          macInfo[path] = { uniqueId, version };
          const mappedType = getTypeFromSerialCache(uniqueId);
          if (mappedType) {
            dataItem.type = String(mappedType).trim();
            dataItem.premission = true;
            console.log(`[TEST] Auto-assigned type=${dataItem.type} for ${path}`);
          }
          if (Object.keys(macInfo).length == ports.length) {
            socketSendData(server, JSON.stringify({ macInfo }));
          }
        }
      } else {
        sendMacCommand(port, path, portBaudRate, parserItem)
      }
      parser.on("data", async function (data) {



        let buffer = Buffer.from(data);

        pointArr = new Array();

        if (![18, 1024, 130, 146, 4096].includes(buffer.length)) {
          if (process.env.VIRTUAL_SERIAL_TEST === 'true') {
            console.log('[DEBUG] Unexpected frame length:', buffer.length, 'from', path)
          }
        } else if (process.env.VIRTUAL_SERIAL_TEST === 'true') {
          if (!global._frameLogCount) global._frameLogCount = {};
          if (!global._frameLogCount[path]) global._frameLogCount[path] = 0;
          global._frameLogCount[path]++;
          if (global._frameLogCount[path] <= 3) {
            console.log('[DEBUG] Frame received: len=' + buffer.length + ' from ' + path + ' type=' + (dataItem.type || 'unknown'));
          }
        }

        for (var i = 0; i < buffer.length; i++) {
          pointArr[i] = buffer.readUInt8(i);
        }


        if (buffer.toString().includes('Unique ID')) {
          console.log(buffer.toString())
          const str = buffer.toString()
          if (str.includes('Unique ID')) {

            const uniqueIdMatch = str.match(/Unique ID:\s*([^\s-]+)/);
            const versionMatch = str.match(/Versions:\s*([^\s-]+)/);

            const uniqueId = uniqueIdMatch ? uniqueIdMatch[1] : null;
            const version = versionMatch ? versionMatch[1] : null;

            console.log("Unique ID:", uniqueId);  // 34463730155032138F
            console.log("Versions:", version);    // C40510
            console.log(`[mac] ${path} ${uniqueId || 'n/a'}`)
            successNum++
            parserItem.macReady = true
            if (parserItem.macTimer) {
              clearInterval(parserItem.macTimer)
              parserItem.macTimer = null
            }

            console.log('sendTotal:', sendMacNum, '-----', 'success:', successNum)
            macInfo[path] = {
              uniqueId,
              version
            }

            if (parserItem.typeLocked) {
              dataItem.premission = true
            } else {
              const mappedType = parserItem.baudRate === 921600 ? null : getTypeFromSerialCache(uniqueId)
              if (mappedType) {
                dataItem.type = String(mappedType).trim()
                dataItem.premission = true
              } else {
                try {
                  const response = await axios.get(`${constantObj.backendAddress}/device-manage/device/getDetail/${uniqueId}`)
                  const time = await axios.get(`http://sensor.bodyta.com:8080/rcv/login/getSystemTime`)

                  // ??????
                  if (!response.data.data) {
                    dataItem.premission = false
                  } else {
                    const expireTime = response.data.data.expireTime
                    const nowTime = time.data.time
                    if (nowTime < expireTime) {
                      dataItem.premission = true
                    }
                    dataItem.type = JSON.parse(response.data.data.typeInfo)[0]
                  }
                } catch (err) {
                  console.log(err, 'err')
                }
              }
            }
            if (Object.keys(macInfo).length == ports.length) {
              // console.log(macInfo)
              // return macInfo

              socketSendData(server, JSON.stringify({ macInfo }))
            }
          }
        }
        // console.log(pointArr.length)
        // 闄€铻轰华
        if (pointArr.length == 18) {
          const length = pointArr.length
          const arr = pointArr.splice(2, length)
          dataItem.rotate = bytes4ToInt10(arr)
        }
        // 256鐭╅樀鍒嗗寘
        else if (pointArr.length == 130) {
          // 瑙ｆ瀽鍖呮暟鎹? 绫诲瀷+鍓嶅悗甯х被鍨?128鐭╅樀
          const length = pointArr.length
          const order = pointArr[0]
          const type = pointArr[1]
          // console.log(constantObj.type[type], order, path, pointArr.length, new Date().getTime())

          const arr = pointArr.splice(2, length)
          const orderName = constantObj.order[order]
          // 鍓嶅悗甯ц祴鍊?绫诲瀷璧嬪€?
          dataItem[orderName] = arr
            dataItem.type = constantObj.type[type]
            dataItem.stamp = new Date().getTime()
          } else if (pointArr.length == 1024) {
          // ret
          // if (!dataItem.premission) return
          // dataItem.type = 'hand'
          // dataItem[path]
            if (!dataItem.type) {
              dataItem.type = 'sit'
            }
            let matrix
          if (dataItem.type == 'hand' || dataItem.type == 'sit') {
            matrix = hand(pointArr)
          } else if (dataItem.type == 'bed') {
            matrix = jqbed(pointArr)
          } else if (dataItem.type == 'car-back') {
            matrix = jqbed(pointArr)
          } else {
            matrix = pointArr
          }

          // 璁惧鍨嬪彿璺熶紶鎰熷櫒绫诲瀷鍖归厤涓?

          dataItem.arr = matrix



          // 濡傛灉鏄剼鍨? 娣诲姞绠楁硶鍖匔OP鏁版嵁
          if (file == 'foot') {
            // console.log(matrix)
            if (!dataItem.arrList) {
              dataItem.arrList = []
            } else {
              if (dataItem.arrList.length < 60) {
                dataItem.arrList.push(matrix)
              } else {
                dataItem.arrList.shift()
                dataItem.arrList.push(matrix)
              }

              // dataItem.cop = await callPy('cal_cop_fromData', { data: dataItem.arrList })
            }

            // console.log(dataItem.cop)
          }


          const stamp = new Date().getTime()
          dataItem.stamp = stamp

          if (oldTimeObj[dataItem.type]) {
            dataItem.HZ = stamp - oldTimeObj[dataItem.type]
            if (dataItem.HZ < 50) {
              return
            }
            if (!MaxHZ && oldTimeObj[dataItem.type]) {
              MaxHZ = Math.floor(1000 / dataItem.HZ)
              HZ = MaxHZ
              console.log('playtimer', HZ)
              if (!activeSendTypes || !activeSendTypes.length) {
                if (playtimer) {
                  clearInterval(playtimer)
                }
                playtimer = setInterval(() => {
                  colAndSendData()
                }, 80)
              }
            }
            // if(!playtimer){
            //      playtimer = setInterval(() => {
            //     colAndSendData()
            //   }, 80)
            // }
          }
          // console.log(stamp, oldTimeObj[dataItem.type],dataItem.HZ,HZ,playtimer)
          // if (!oldTimeObj[dataItem.type]) {
          oldTimeObj[dataItem.type] = dataItem.stamp
          maybeLockSensorHz()
          if (activeSendTypes && activeSendTypes.includes(dataItem.type)) {
            updateSendTimerForActiveTypes()
          }
          // } else {

          // }


        } else if (pointArr.length == 1025) {
          const type = pointArr.shift()
          dataItem.premission = true

          if (!Object.keys(constantObj.typeConfig).includes(String(type))) {
            dataItem.premission = false
            return
          }
          let matrix
            dataItem.type = constantObj.typeConfig[type]

          if (constantObj.typeConfig[type] == 'car-back') {
            matrix = jqbed(pointArr)
          } else if (constantObj.typeConfig[type] == 'car-sit') {
            matrix = jqbed(pointArr)
          } else if (constantObj.typeConfig[type] == 'bed') {
            matrix = jqbed(pointArr)
          }
          dataItem.arr = matrix

          const stamp = new Date().getTime()
          dataItem.stamp = stamp

          if (oldTimeObj[dataItem.type]) {
            dataItem.HZ = stamp - oldTimeObj[dataItem.type]
            if (dataItem.HZ < 50) {
              return
            }
            if (!MaxHZ && oldTimeObj[dataItem.type]) {
              MaxHZ = Math.floor(1000 / dataItem.HZ)
              HZ = MaxHZ
              console.log('playtimer', HZ)
              if (!activeSendTypes || !activeSendTypes.length) {
                if (playtimer) {
                  clearInterval(playtimer)
                }
                playtimer = setInterval(() => {
                  colAndSendData()
                }, 80)
              }
            }
          }

          oldTimeObj[dataItem.type] = dataItem.stamp
          maybeLockSensorHz()
          if (activeSendTypes && activeSendTypes.includes(dataItem.type)) {
            updateSendTimerForActiveTypes()
          }


        }

        else if (pointArr.length == 146) {
          const length = pointArr.length
          const arr = pointArr.splice(length - 16, length)
          // console.log(pointArr[0], pointArr[1])
          
          // dataItem.type = pointArr[1] == 1 ? 'leftHand' : 'rightHand'
          pointArr.splice(0, 2)
          // 涓嬩竴甯ц祴鍊? 鏃堕棿鎴宠祴鍊?鍥涘厓鏁拌祴鍊?

          const stamp = new Date().getTime()

          if (sendDataLength < 30) {
            sendDataLength++
          }
          if (oldTimeObj[dataItem.type]) {
            dataItem.HZ = stamp - oldTimeObj[dataItem.type]
            // console.log(dataItem.HZ , 'hz')
            if (!MaxHZ && sendDataLength == 30) {
              MaxHZ = Math.floor(1000 / dataItem.HZ)
              console.log(MaxHZ)
              HZ = MaxHZ
              if (!activeSendTypes || !activeSendTypes.length) {
                playtimer = setInterval(() => {
                  colAndSendData()
                }, 1000 / HZ)
              }
              sendDataLength = 0
            }
          }
          dataItem.stamp = stamp

          // if (!oldTimeObj[dataItem.type]) {
          oldTimeObj[dataItem.type] = dataItem.stamp
          maybeLockSensorHz()
          if (activeSendTypes && activeSendTypes.includes(dataItem.type)) {
            updateSendTimerForActiveTypes()
          }

          dataItem.next = pointArr
          // const stamp = new Date().getTime()
          dataItem.stamp = stamp
          dataItem.rotate = bytes4ToInt10(arr)
        } else if (pointArr.length == 4096) {
          // if (!dataItem.premission) return
          dataItem.premission = true
            if (!dataItem.type) {
              dataItem.type = 'foot'
            }
          if (!dataItem.premission) {
            dataItem.status = 'expired'
          } else {
            if (parserItem.baudRate === 3000000) {
              zeroBelowThreshold(pointArr, 8)
              removeSmallIslands64x64(pointArr, 12)
            }
            if (dataItem.type == 'endi-sit') {
              dataItem.arr = endiSit(pointArr)
            } else if (dataItem.type == 'endi-back') {
              dataItem.arr = endiBack(pointArr)
            } else if (dataItem.type == 'foot') {
              dataItem.arr = pointArr
              if (lastFootPointArr.length) {
                dataItem.cop = await callAlgorithm('realtime_server', { sensor_data: pointArr, data_prev: lastFootPointArr })
              }

            } else if (dataItem.type === 'foot1' || dataItem.type === 'foot2' || dataItem.type === 'foot3' || dataItem.type === 'foot4') {
              dataItem.arr = flipFoot64x64Horizontal(pointArr)
            } else {
              dataItem.arr = pointArr
            }
            lastFootPointArr = pointArr
          }
          // console.log(444)
          const stamp = new Date().getTime()

          if (sendDataLength < 30) {
            sendDataLength++
          }
          if (oldTimeObj[dataItem.type]) {
            dataItem.HZ = stamp - oldTimeObj[dataItem.type]
            // console.log(dataItem.HZ , 'hz')
            if (!MaxHZ && sendDataLength == 30) {
              MaxHZ = Math.floor(1000 / dataItem.HZ)
              console.log(MaxHZ)
              HZ = MaxHZ
              if (!activeSendTypes || !activeSendTypes.length) {
                playtimer = setInterval(() => {
                  colAndSendData()
                }, 1000 / HZ)
              }
              sendDataLength = 0
            }
          }
          dataItem.stamp = stamp

          // if (!oldTimeObj[dataItem.type]) {
          oldTimeObj[dataItem.type] = dataItem.stamp
          maybeLockSensorHz()
          if (activeSendTypes && activeSendTypes.includes(dataItem.type)) {
            updateSendTimerForActiveTypes()
          }
          // } else {

          // }

          // if (!dataItem.arrList) {
          //   dataItem.arrList = []
          // } else {
          //   if (dataItem.arrList.length < 3) {
          //     dataItem.arrList.push(pointArr)
          //   } else {
          //     dataItem.arrList.shift()
          //     dataItem.arrList.push(pointArr)
          //   }

          //   // dataItem.cop = await callPy('cal_cop_fromData', { data_array: dataItem.arrList })
          //   // console.log(dataItem.arrList, pointArr.length, dataItem.cop)
          // }

        } else if (pointArr.length == 4097) {
          // if (!dataItem.premission) return
          // dataItem.type = 'sit'

          const type = pointArr.shift()
          dataItem.premission = true

          if (!Object.keys(constantObj.typeConfig).includes(String(type))) {
            dataItem.premission = false
            return
          }

          dataItem.type = constantObj.typeConfig[type]

          if (parserItem.baudRate === 3000000) {
            zeroBelowThreshold(pointArr, 5)
            removeSmallIslands64x64(pointArr, 9)
          }

          if (dataItem.type == 'endi-sit') {
            dataItem.arr = endiSit(pointArr)
          } else if (dataItem.type == 'endi-back') {
            dataItem.arr = endiBack(pointArr)
          } else {
            dataItem.arr = pointArr
          }

          const stamp = new Date().getTime()
          if (oldTimeObj[dataItem.type]) {
            dataItem.HZ = stamp - oldTimeObj[dataItem.type]
            if (!MaxHZ) {
              MaxHZ = Math.floor(1000 / dataItem.HZ)
              HZ = MaxHZ
              if (!activeSendTypes || !activeSendTypes.length) {
                playtimer = setInterval(() => {
                  colAndSendData()
                }, 1000 / HZ)
              }
            }
          }
          dataItem.stamp = stamp
          // if (!oldTimeObj[dataItem.type]) {
          oldTimeObj[dataItem.type] = dataItem.stamp
          maybeLockSensorHz()
          if (activeSendTypes && activeSendTypes.includes(dataItem.type)) {
            updateSendTimerForActiveTypes()
          }
          // } else {

          // }

          if (!dataItem.arrList) {
            dataItem.arrList = []
          } else {
            if (dataItem.arrList.length < 3) {
              dataItem.arrList.push(pointArr)
            } else {
              dataItem.arrList.shift()
              dataItem.arrList.push(pointArr)
            }

            // dataItem.cop = await callPy('cal_cop_fromData', { data_array: dataItem.arrList })
            // console.log(dataItem.arrList, pointArr.length, dataItem.cop)
          }

        } else if (pointArr.length == 144) {

          const stamp = new Date().getTime()
          dataItem.stamp = stamp
          dataItem.type = 'carAir'
          // if (!dataItem.premission) {
          //   dataItem.status = 'expired'
          // } else {
          dataItem.arr = pointArr
          // }




          // console.log(444)

          if (sendDataLength < 1) {
            sendDataLength++
          }
          if (oldTimeObj[dataItem.type]) {
            dataItem.HZ = parseInt(1000 / (stamp - oldTimeObj[dataItem.type]))
            if (!MaxHZ && sendDataLength == 1) {
              MaxHZ = dataItem.HZ
              HZ = MaxHZ
              if (!activeSendTypes || !activeSendTypes.length) {
                playtimer = setInterval(() => {
                  colAndSendData()
                }, 87)
              }
              sendDataLength = 0
            }
          }

          oldTimeObj[dataItem.type] = dataItem.stamp
          maybeLockSensorHz()
          if (activeSendTypes && activeSendTypes.includes(dataItem.type)) {
            updateSendTimerForActiveTypes()
          }
          algorData = await callAlgorithm('server', { sensor_data: pointArr })
          if (algorData.control_command) {
            control_command = algorData.control_command
          }
          // console.log(algorData?.frame_count)

        } else if (pointArr.length == 51) {
          // 鏀跺埌ecu鍙戦€佹暟鎹?
          console.log('pointArr', pointArr)
          console.log('buffer', buffer)
          if (pointArr[50] == 1) {

            // 鎵嬪姩妯″紡
            if (pointArr[49] == 1) {

              controlMode = HANDLE

              let max = 24, controlArr = []
              for (let i = 0; i < max; i++) {
                controlArr.push(pointArr[2 * i + 2])
              }


              server.clients.forEach(function each(client) {
                if (port?.isOpen) {

                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ handle: controlArr }));
                  }
                }
              });

            }
            // 鑷姩妯″紡
            else {



              controlMode = ALGOR

              if (oldControlMode == HANDLE && controlMode == ALGOR) {
                await callAlgorithm('resetMessage')
              }

              let max = 24, controlArr = []
              for (let i = 0; i < max; i++) {
                controlArr.push(pointArr[2 * i + 2])
              }


              server.clients.forEach(function each(client) {
                if (port?.isOpen) {

                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ algorFeed: controlArr }));
                  }
                }
              });
            }

            oldControlMode = controlMode
          }
        }


        else if (![18, 1024, 130].includes(pointArr.length)) {

        }
      })
    }

  }

  return ports
}

// 鍏抽棴姝ｅ湪杩炴帴鐨勪覆鍙?
async function stopPort() {
  // let ports = await SerialPort.list()

  // 鍏抽棴涓插彛
  const portArr = Object.keys(parserArr).map((path) => {
    return parserArr[path].port
  })


  // 鍏抽棴涓插彛,骞朵笖娓呴櫎鏈湴缂撳瓨鏁版嵁
  portArr.forEach((port, index) => {
    if (port?.isOpen) {
      port.close((err) => {
        if (!err) {
          // linkIngPort.splice(index, 1)
          const path = Object.keys(parserArr)[index];
          // parserArr[path] = null;
          delete parserArr[path]
          delete dataMap[path]
          console.log(parserArr, 'delte')
        }
      });
    }
  })

  // 娓呴櫎鍙戦€佹暟鎹畾鏃跺櫒
  clearInterval(playtimer)

  // 灏唄z娓呴櫎鎺?
  MaxHZ = undefined
  resetSensorHzCache()
}

function colAndSendData() {
  // console.log(historyFlag)

  if (!historyFlag && Object.keys(parserArr).length) {
    const obj = sendData()
    // selectArr
    if (selectArr && Object.keys(selectArr).length && obj) {
      for (let i = 0; i < Object.keys(selectArr).length; i++) {
        const key = Object.keys(selectArr)[i]
        if (obj[key]) {
          obj[key].select = selectArr[key]
        }
      }
    }

    if (colFlag && obj && Object.keys(obj).length) {
      storageData(obj)
    }
  }

  // else {
  //   if (historyPlayFlag) {
  //     console.log(historyDbArr[playIndex])
  //     socketSendData(server, JSON.stringify({
  //       sitData: JSON.parse(historyDbArr[playIndex].data),
  //       index: playIndex,
  //       timestamp: JSON.parse(historyDbArr[playIndex].timestamp)
  //     }))
  //     if (playIndex < historyDbArr.length - 1) {
  //       playIndex++
  //     } else {
  //       historyPlayFlag = false
  //     }
  //   }
  // }
}


// if (file == 'sit') {
//   if(playtimer){
//     clearInterval(playtimer)
//   }
//   playtimer = setInterval(() => {
//     colAndSendData()
//   }, 80)
// }


// setInterval(async () => {
//   // console.log(dataMap)
//   const keyArr = Object.keys(dataMap)
//   const equipArr = {}
//   for (let i = 0; i < keyArr.length; i++) {
//     const key = keyArr[i]
//     // console.log(key)
//     // equipArr.push(dataMap[key].type)
//     equipArr[dataMap[key].type] = key
//   }

//   if (Object.keys(equipArr).includes('bed')) {
//     const dataObj = dataMap[equipArr['bed']]

//     // console.log(dataObj.arr, )
//     if (dataObj.arr) {


//       // const data = await callPy('getData', { data: dataObj.arr })
//       // if (data.rate != -1) {
//       //   dataMap[equipArr['bed']].breatheData = data
//       // }


//     }
//     // console.log(dataMap)
//   }
// }, 125);


/**
 * 鍙戦€佹暟鎹粰鍓嶇
 */
function sendData() {
  let obj
  // 统一解析所有设备数据：
  // parseData 对 HL/HR 会自动用 last+next 拼接（不受 type 参数影响）
  // 对其他设备在 highHZ 模式下用 data.arr
  obj = parseData(parserArr, JSON.parse(JSON.stringify({ ...dataMap })), 'highHZ')

  // 根据 activeSendTypes 过滤（按评估模式只推送对应设备数据）
  obj = filterDataByTypes(obj, activeSendTypes)

  // 根据数据类型分离推送：手套用 data，其他用 sitData
  if (obj && Object.keys(obj).length) {
    const payload = {}
    const gloveData = {}
    const otherData = {}
    Object.keys(obj).forEach(key => {
      if (key === 'HL' || key === 'HR') {
        gloveData[key] = obj[key]
      } else {
        otherData[key] = obj[key]
      }
    })
    if (Object.keys(gloveData).length) payload.data = gloveData
    if (Object.keys(otherData).length) payload.sitData = otherData
    if (!payload.data && !payload.sitData) payload.sitData = obj
    socketSendData(server, JSON.stringify(payload))
  }

  // const now = Date.now()
  // if (now - lastRealtimeLogTs >= 1000) {
  //   lastRealtimeLogTs = now
  //   const typeArr = Object.keys(obj || {})
  //   typeArr.forEach((type) => {
  //     let latestStamp = null
  //     Object.keys(dataMap).forEach((key) => {
  //       const item = dataMap[key]
  //       if (item && item.type === type && typeof item.stamp === 'number') {
  //         if (latestStamp === null || item.stamp > latestStamp) {
  //           latestStamp = item.stamp
  //         }
  //       }
  //     })
  //     const objStamp = obj[type] && typeof obj[type].stamp === 'number' ? obj[type].stamp : null
  //     const ageObj = objStamp === null ? 'n/a' : now - objStamp
  //     const ageMap = latestStamp === null ? 'n/a' : now - latestStamp
  //     console.log(`[realtime] type=${type} now=${now} objAge=${ageObj}ms dataMapAge=${ageMap}ms`)
  //   })
  // }

  return obj
}

function ensureMatrixNameColumn(db) {
  db.all("PRAGMA table_info(matrix)", (err, rows) => {
    if (err) {
      console.error('PRAGMA table_info failed:', err)
      return
    }
    const hasName = rows.some((r) => r.name === 'name')
    if (!hasName) {
      db.run('ALTER TABLE matrix ADD COLUMN name TEXT', (e) => {
        if (e) console.error('ALTER TABLE add name failed:', e)
      })
    }
    const hasAssessmentId = rows.some((r) => r.name === 'assessment_id')
    if (!hasAssessmentId) {
      db.run('ALTER TABLE matrix ADD COLUMN assessment_id TEXT', (e) => {
        if (e) console.error('ALTER TABLE add assessment_id failed:', e)
      })
    }
    const hasSampleType = rows.some((r) => r.name === 'sample_type')
    if (!hasSampleType) {
      db.run('ALTER TABLE matrix ADD COLUMN sample_type TEXT', (e) => {
        if (e) console.error('ALTER TABLE add sample_type failed:', e)
      })
    }
  })
}

/**
 * 灏嗘敹鍒扮殑
 */
function storageData(data) {
  const rawAssessmentId = activeAssessmentId
  const parsedAssessmentId = rawAssessmentId !== null && rawAssessmentId !== undefined ? Number(rawAssessmentId) : NaN
  const timestamp = Date.now()
  // const date = saveTime;


  // const newData = Object.keys(data)
  const newData = { ...data }
  for (let i = 0; i < Object.keys(data).length; i++) {
    const key = Object.keys(data)[i]
    if (newData[key].status) delete newData[key].status
  }

  const insertQuery =
    "INSERT INTO matrix (data, timestamp,date ,`select`, name, assessment_id, sample_type) VALUES (?, ?,? ,?, ?, ?, ?)";
  const assessmentId = activeAssessmentId || null
  const sampleType = activeSampleType || null

  currentDb.run(
    insertQuery,
    [JSON.stringify(newData), timestamp, colName, JSON.stringify(selectArr), colPersonName, assessmentId, sampleType],
    function (err) {
      if (err) {
        console.error(err);
        return;
      }
      console.log(`Event inserted with ID ${this.lastID}`);
    }
  );
}

// 鍋氫竴涓畾鏃跺櫒浠诲姟  鐩戝惉鏄惁瀛樺湪鎰忓鎯呭喌涓插彛鏂紑杩炴帴 鐒跺悗閲嶆柊杩炴帴 
setInterval(() => {
  if (Object.keys(parserArr).length) {
    Object.keys(parserArr).map((path) => {
      const item = parserArr[path]
      if (!item) return
      const port = item.port
      if (!port || !port.isOpen) {
        resetSensorHzCache()
        const reopenBaud = item.baudRate || baudRate
        item.port = new SerialPort(
          {
            path: path,
            baudRate: reopenBaud,
            autoOpen: true,
          },
          function (err) {
            console.log(err, "err");
          }
        );
        //???????
        item.port.pipe(item.parser);
      }
    })

  }

}, 3000)


// setInterval(async () => {

//   const portArr = Object.keys(parserArr).map((path) => {
//     return parserArr[path].port
//   })


//   // 鍏抽棴涓插彛,骞朵笖娓呴櫎鏈湴缂撳瓨鏁版嵁
//   portArr.forEach((port, index) => {
//     // console.log(port.isOpen)
//     if (port?.isOpen) {
//       server.clients.forEach(function each(client) {
//         if (port?.isOpen) {

//           if (algorData?.control_command && controlMode == ALGOR) {
//             const hexStr = algorData.control_command
//               .map(v => v.toString(16).padStart(2, '0'))
//               .join('');

//             // console.log(hexStr);

//             const command = Buffer.from(hexStr, 'hex')
//             console.log('sendCommand', command)
//             port.write(command, err => {
//               if (err) {
//                 return console.error('err2:', err.message);
//               }
//               // console.log('send:', command.trim());
//               // resolve(command.trim())

//               console.log('send:', 11);
//               // resolve(11)
//             });
//           }


//           // const arr = [170, 85, 3, 153];




//           if (client.readyState === WebSocket.OPEN) {
//             client.send(JSON.stringify({ algorData }));
//           }
//         }
//       });
//     }
//   })


// }, 500)


// setInterval(async () => {
//   console.log('first', 111)
//   const pointArr = new Array(144).fill(50)
//   algorData = await callPy('server', { sensor_data: pointArr })
//   // console.log('frame_count:' , algorData?.frame_count)
// }, 2)

