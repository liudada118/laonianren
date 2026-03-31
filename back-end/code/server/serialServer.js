

const express = require('express')
const os = require('os')
const fs = require('fs')
const path = require('path')
const cors = require('cors');
const WebSocket = require("ws");
const HttpResult = require('./HttpResult')
const { SerialPort, DelimiterParser } = require('serialport')
const { getPort } = require('../util/serialport')
const { splitArr, BAUD_DEVICE_MAP } = require('../util/config');
const constantObj = require('../util/config');
const { bytes4ToInt10 } = require('../util/parseData');
const { initDb, dbLoadCsv, deleteDbData, dbGetData, getCsvData, changeDbName, changeDbDataName } = require('../util/db');
const { hand } = require('../util/line');
// const { callPy } = require('../pyWorker');  // [已迁移到JS算法] Python子进程不再需要
const { callAlgorithm } = require('../algorithms');
const { decryptStr } = require('../util/aes_ecb');
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

function flipFoot64x64Vertical(arr) {
  if (!Array.isArray(arr) || arr.length !== 4096) return arr
  const size = 64
  const out = new Array(arr.length)
  for (let r = 0; r < size; r++) {
    const srcRowStart = (size - 1 - r) * size
    const dstRowStart = r * size
    for (let c = 0; c < size; c++) {
      out[dstRowStart + c] = arr[srcRowStart + c]
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


/**
 * 对 64x64 脚垫数据进行去噪滤波（低压力置零 + 小连通域移除）
 * 与前端 denoiseMatrix 逻辑一致，但操作一维数组
 */
function denoiseFootData(arr, threshold, minArea) {
  if (!Array.isArray(arr) || arr.length !== 4096) return arr
  const size = 64
  // 步骤1：低压力置零
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < threshold) arr[i] = 0
  }
  // 步骤2：BFS 连通域分析，移除小区域
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
      for (const dr of dirs) {
        const nr = r + dr
        if (nr < 0 || nr >= size) continue
        for (const dc of dirs) {
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
    if (component.length < minArea) {
      for (const ci of component) arr[ci] = 0
    }
  }
  return arr
}

/**
 * 对 64x64 脚垫数据进行坏线补值（检测异常低值行/列，用相邻行/列插值修复）
 * 支持连续 1~2 行/列坏线
 */
function zeroLineRepair64x64(arr, badThresh, goodThresh) {
  if (!Array.isArray(arr) || arr.length !== 4096) return arr
  const ROWS = 64, COLS = 64

  // 计算每行和每列的总和
  const rowSums = new Float32Array(ROWS)
  const colSums = new Float32Array(COLS)
  for (let r = 0; r < ROWS; r++) {
    let total = 0
    for (let c = 0; c < COLS; c++) total += arr[r * COLS + c]
    rowSums[r] = total
  }
  for (let c = 0; c < COLS; c++) {
    let total = 0
    for (let r = 0; r < ROWS; r++) total += arr[r * COLS + c]
    colSums[c] = total
  }

  // 修复坏行
  for (let r = 1; r < ROWS - 1; r++) {
    if (rowSums[r] >= badThresh) continue
    if (rowSums[r - 1] > goodThresh && rowSums[r + 1] > goodThresh) {
      for (let c = 0; c < COLS; c++) {
        arr[r * COLS + c] = (arr[(r - 1) * COLS + c] + arr[(r + 1) * COLS + c]) / 2
      }
    } else if (r + 2 < ROWS && rowSums[r + 1] < badThresh &&
               rowSums[r - 1] > goodThresh && rowSums[r + 2] > goodThresh) {
      for (let c = 0; c < COLS; c++) {
        const vPrev = arr[(r - 1) * COLS + c]
        const vNext = arr[(r + 2) * COLS + c]
        arr[r * COLS + c]       = vPrev * 2 / 3 + vNext * 1 / 3
        arr[(r + 1) * COLS + c] = vPrev * 1 / 3 + vNext * 2 / 3
      }
      r++
    }
  }

  // 修复坏列
  for (let c = 1; c < COLS - 1; c++) {
    if (colSums[c] >= badThresh) continue
    if (colSums[c - 1] > goodThresh && colSums[c + 1] > goodThresh) {
      for (let r = 0; r < ROWS; r++) {
        arr[r * COLS + c] = (arr[r * COLS + (c - 1)] + arr[r * COLS + (c + 1)]) / 2
      }
    } else if (c + 2 < COLS && colSums[c + 1] < badThresh &&
               colSums[c - 1] > goodThresh && colSums[c + 2] > goodThresh) {
      for (let r = 0; r < ROWS; r++) {
        const vPrev = arr[r * COLS + (c - 1)]
        const vNext = arr[r * COLS + (c + 2)]
        arr[r * COLS + c]       = vPrev * 2 / 3 + vNext * 1 / 3
        arr[r * COLS + (c + 1)] = vPrev * 1 / 3 + vNext * 2 / 3
      }
      c++
    }
  }
  return arr
}

/**
 * 根据当前评估模式对脚垫数据应用滤波和坏线补值
 * @param {number[]} arr - 4096 长度一维数组
 * @param {string} mode - 'standing' 或 'gait'
 */
function applyFootFilter(arr, mode, footType) {
  const cfg = footFilterConfig[mode]
  if (!cfg) { console.log('[applyFootFilter] no cfg for mode:', mode); return arr }
  if (cfg.filterEnabled) {
    denoiseFootData(arr, cfg.filterThreshold, cfg.filterMinArea)
  }
  if (cfg.optimizeEnabled) {
    if (mode === 'gait') {
      // 步道模式：坏线补值由前端 GaitCanvas 在合并后处理
    } else {
      // 静态模式：单个 64×64 做坏线补值
      zeroLineRepair64x64(arr, cfg.optimizeBad, cfg.optimizeGood)
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
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

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
    llmApiKey: payload.llmApiKey || '',
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

// ─── 脚垫滤波/优化参数（前端可通过 API 实时调节，静态和步道分开） ───
let footFilterConfig = {
  // 静态评估 (mode=4, foot1)
  standing: {
    filterEnabled: true,     // 去噪滤波开关
    filterThreshold: 12,     // 低压力阈值
    filterMinArea: 15,       // 最小连通域面积
    optimizeEnabled: true,   // 坏线补值开关
    optimizeBad: 40,         // 坏线总和阈值
    optimizeGood: 100,       // 正常行/列总和阈值
  },
  // 步道评估 (mode=5, foot1-4)
  gait: {
    filterEnabled: true,
    filterThreshold: 15,
    filterMinArea: 20,
    optimizeEnabled: true,
    optimizeBad: 40,
    optimizeGood: 100,
  },
}

// ─── 步道传感器缓存（用于合并 64×256 坏线补值） ───
const gaitFootCache = { foot1: null, foot2: null, foot3: null, foot4: null }

/**
 * 将 4 个 64×64 传感器合并为 64×256，做坏线补值，再拆回 4 个 64×64
 */
function zeroLineRepairMerged(badThresh, goodThresh) {
  const ZERO = new Array(4096).fill(0)
  const f1 = gaitFootCache.foot1 || ZERO
  const f2 = gaitFootCache.foot2 || ZERO
  const f3 = gaitFootCache.foot3 || ZERO
  const f4 = gaitFootCache.foot4 || ZERO
  
  const ROWS = 64, COLS = 256
  // 合并为 64×256：每个 64×64 传感器先顺时针旋转 90 度（与前端一致），再按列拼接
  // 顺时针旋转 90°：newRow = col, newCol = 63 - row
  const merged = new Array(ROWS * COLS).fill(0)
  const parts = [f1, f2, f3, f4]
  for (let p = 0; p < 4; p++) {
    const colOffset = p * 64
    for (let row = 0; row < 64; row++) {
      for (let col = 0; col < 64; col++) {
        const newRow = col
        const newCol = 63 - row
        merged[newRow * COLS + colOffset + newCol] = parts[p][row * 64 + col]
      }
    }
  }
  
  // 确定有数据的传感器列范围（用于行总和计算，避免全0传感器拉低行总和）
  const activeParts = []
  if (gaitFootCache.foot1) activeParts.push(0)
  if (gaitFootCache.foot2) activeParts.push(1)
  if (gaitFootCache.foot3) activeParts.push(2)
  if (gaitFootCache.foot4) activeParts.push(3)
  
  // 计算每行总和：只累加有数据的传感器列范围
  const rowSums = new Float32Array(ROWS)
  for (let r = 0; r < ROWS; r++) {
    let total = 0
    for (const p of activeParts) {
      const colStart = p * 64
      const colEnd = colStart + 64
      for (let c = colStart; c < colEnd; c++) total += merged[r * COLS + c]
    }
    rowSums[r] = total
  }
  
  // 计算每列总和（正常计算，跨所有行）
  const colSums = new Float32Array(COLS)
  for (let c = 0; c < COLS; c++) {
    let total = 0
    for (let r = 0; r < ROWS; r++) total += merged[r * COLS + c]
    colSums[c] = total
  }
  
  let repairedRows = 0, repairedCols = 0
  
  // 修复坏行（只补 1~2 行）
  for (let r = 1; r < ROWS - 1; r++) {
    if (rowSums[r] >= badThresh) continue
    if (rowSums[r - 1] > goodThresh && rowSums[r + 1] > goodThresh) {
      for (let c = 0; c < COLS; c++) {
        merged[r * COLS + c] = (merged[(r - 1) * COLS + c] + merged[(r + 1) * COLS + c]) / 2
      }
      repairedRows++
    } else if (r + 2 < ROWS && rowSums[r + 1] < badThresh &&
               rowSums[r - 1] > goodThresh && rowSums[r + 2] > goodThresh) {
      for (let c = 0; c < COLS; c++) {
        const vPrev = merged[(r - 1) * COLS + c]
        const vNext = merged[(r + 2) * COLS + c]
        merged[r * COLS + c]       = vPrev * 2 / 3 + vNext * 1 / 3
        merged[(r + 1) * COLS + c] = vPrev * 1 / 3 + vNext * 2 / 3
      }
      repairedRows += 2
      r++
    }
  }
  
  // 修复坏列（只补 1~2 列，不跳过边界，与前端完全一致）
  for (let c = 1; c < COLS - 1; c++) {
    if (colSums[c] >= badThresh) continue
    if (colSums[c - 1] > goodThresh && colSums[c + 1] > goodThresh) {
      for (let r = 0; r < ROWS; r++) {
        merged[r * COLS + c] = (merged[r * COLS + (c - 1)] + merged[r * COLS + (c + 1)]) / 2
      }
      repairedCols++
    } else if (c + 2 < COLS && colSums[c + 1] < badThresh &&
               colSums[c - 1] > goodThresh && colSums[c + 2] > goodThresh) {
      for (let r = 0; r < ROWS; r++) {
        const vPrev = merged[r * COLS + (c - 1)]
        const vNext = merged[r * COLS + (c + 2)]
        merged[r * COLS + c]       = vPrev * 2 / 3 + vNext * 1 / 3
        merged[r * COLS + (c + 1)] = vPrev * 1 / 3 + vNext * 2 / 3
      }
      repairedCols += 2
      c++
    }
  }
  
  // 诊断日志：只打印有值的行和列
  if (!global._colDiagCount) global._colDiagCount = 0
  if (global._colDiagCount < 3) {
    global._colDiagCount++
    const nonZeroRows = []
    for (let r = 0; r < ROWS; r++) if (rowSums[r] > 0) nonZeroRows.push(`r${r}=${rowSums[r].toFixed(0)}`)
    const nonZeroCols = []
    for (let c = 0; c < COLS; c++) if (colSums[c] > 0) nonZeroCols.push(`c${c}=${colSums[c].toFixed(0)}`)
    console.log('[rowSums>0] %s', nonZeroRows.join(', '))
    console.log('[colSums>0] %s', nonZeroCols.join(', '))
  }
  if (repairedRows || repairedCols) {
    console.log('[zeroLineRepairMerged] 修复了 %d 行, %d 列', repairedRows, repairedCols)
  }
  
  // 逆时针旋转 90° 拆回 4 个 64×64，只写回有真实缓存的传感器
  // 逆时针 90°（顺时针的逆操作）：origRow = 63 - newCol, origCol = newRow
  const cacheKeys = ['foot1', 'foot2', 'foot3', 'foot4']
  for (let p = 0; p < 4; p++) {
    if (!gaitFootCache[cacheKeys[p]]) continue
    const target = parts[p]
    const colOffset = p * 64
    for (let newRow = 0; newRow < 64; newRow++) {
      for (let newCol = 0; newCol < 64; newCol++) {
        const origRow = 63 - newCol
        const origCol = newRow
        target[origRow * 64 + origCol] = merged[newRow * COLS + colOffset + newCol]
      }
    }
  }
}



// 手套分包缓存：按 sensorType 缓存 packet1 数据（参考 serial_parser_two.py）
const glovePacket1Cache = {}

// 手套最新数据缓存：按 HL/HR 分别存储最新完整帧数据
// 解决左右手共用同一串口 path 导致 dataMap[path] 的 type/arr 被交替覆盖的问题
let gloveLatestData = { HL: null, HR: null }

// 握力清零基线：记录清零时刻的传感器值，后续数据减去基线（负值归零）
let gripBaseline = { HL: null, HR: null }

/**
 * 校验四元数合法性（参考 serial_parser_two.py 的 quaternion 属性）
 * @param {number[]} q - [w, x, y, z]
 * @returns {number[]|null} - 合法返回 q，否则返回 null
 */
function validateQuaternion(q) {
  if (!q || !Array.isArray(q) || q.length !== 4) return null
  if (q.some(v => !Number.isFinite(v))) return null
  const mag = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3])
  if (mag < 0.5 || mag > 2.0) return null
  return q
}
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

// 波特率 → 期望的帧长度集合（分隔符切割后的数据帧字节数）
// 用于波特率检测时双重验证：先检测分隔符，再验证帧长度是否匹配
const BAUD_EXPECTED_FRAME_LENGTHS = {
  921600:  [130, 146, 18],  // 手套: 130/146字节帧 + 18字节IMU帧
  1000000: [1024],          // 起坐垫: 1024字节帧
  3000000: [4096],          // 脚垫: 4096字节帧
}

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

/**
 * 从 buffer 中提取分隔符切割后的第一个完整帧的长度
 * 返回帧长度，或 -1 表示未找到完整帧
 */
function extractFrameLength(buffer, sequence) {
  if (!buffer || buffer.length < sequence.length) return -1
  // 找到第一个分隔符的位置
  let firstDelim = -1
  for (let i = 0; i <= buffer.length - sequence.length; i++) {
    let match = true
    for (let j = 0; j < sequence.length; j++) {
      if (buffer[i + j] !== sequence[j]) { match = false; break }
    }
    if (match) { firstDelim = i; break }
  }
  if (firstDelim < 0) return -1
  // 从第一个分隔符后找第二个分隔符
  const dataStart = firstDelim + sequence.length
  for (let i = dataStart; i <= buffer.length - sequence.length; i++) {
    let match = true
    for (let j = 0; j < sequence.length; j++) {
      if (buffer[i + j] !== sequence[j]) { match = false; break }
    }
    if (match) {
      return i - dataStart  // 两个分隔符之间的数据长度就是帧长度
    }
  }
  return -1  // 只找到一个分隔符，没有完整帧
}

async function detectBaudRate(path, timeoutMs = 1500, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[baud] ${path} retry #${attempt}`)
      await new Promise(r => setTimeout(r, 500))
    }
    for (let i = 0; i < BAUD_CANDIDATES.length; i++) {
      const baudRate = BAUD_CANDIDATES[i]
      const expectedLengths = BAUD_EXPECTED_FRAME_LENGTHS[baudRate] || []

      const result = await new Promise((resolve) => {
        let cache = Buffer.alloc(0)
        let timer = null
        let port = null
        let resolved = false
        let delimiterFound = false

        const cleanup = (result) => {
          if (resolved) return
          resolved = true
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
          // 限制缓存大小，保留足够的数据用于帧长度检测（最大帧 4096 + 分隔符开销）
          if (cache.length > 12288) {
            cache = cache.slice(-12288)
          }
          // 第一步：检测分隔符
          if (!delimiterFound && bufferContainsSequence(cache, splitArr)) {
            delimiterFound = true
            console.log(`[baud] ${path} @${baudRate} delimiter found, checking frame length...`)
          }
          // 第二步：检测帧长度是否匹配
          if (delimiterFound) {
            const frameLen = extractFrameLength(cache, splitArr)
            if (frameLen > 0) {
              if (expectedLengths.includes(frameLen)) {
                console.log(`[baud] ${path} @${baudRate} frame length ${frameLen} matches!`)
                cleanup('match')
              } else {
                console.log(`[baud] ${path} @${baudRate} frame length ${frameLen} does NOT match expected ${JSON.stringify(expectedLengths)}`)
                cleanup('mismatch')
              }
            }
            // 帧长度还没提取到，继续等待更多数据
          }
        }

        const onError = (err) => {
          console.log(`[baud] ${path} @${baudRate} error:`, err?.message || err)
          cleanup('error')
        }

        try {
          port = new SerialPort({ path, baudRate, autoOpen: true })
          port.on('data', onData)
          port.on('error', onError)
        } catch (e) {
          console.log(`[baud] ${path} @${baudRate} open failed:`, e?.message || e)
          cleanup('error')
          return
        }

        timer = setTimeout(() => {
          if (delimiterFound) {
            // 找到了分隔符但没来得及验证帧长度，也算通过（兼容旧逻辑）
            console.log(`[baud] ${path} @${baudRate} delimiter found but frame length not verified (timeout), accepting`)
            cleanup('match')
          } else {
            cleanup('timeout')
          }
        }, timeoutMs)
      })

      // 每次尝试后等待端口锁释放（macOS 需要时间释放文件锁）
      await new Promise(r => setTimeout(r, 300))

      if (result === 'match') return baudRate
      // mismatch/error/timeout 继续尝试下一个波特率
    }
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
  if (data && data.key) {
    res.json(new HttpResult(0, { hasCache: true, ...data }, 'success'))
    return
  }
  res.json(new HttpResult(0, { hasCache: false }, 'empty'))
})

app.post('/serialCache', (req, res) => {
  try {
    const { key, orgName, llmApiKey } = req.body || {}
    if (!key) {
      res.json(new HttpResult(1, {}, 'missing key'))
      return
    }
    const saved = writeSerialCache({ key, orgName, llmApiKey })
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
    let leftImuArr = null
    let rightImuArr = null
    let bestRow = null
    let matchedDate = null
    let matchedTimestamp = null
    let tsNum = Number(rawTimestamp)

    if (leftAssessmentId || rightAssessmentId) {
      // ===== 新逻辑：分别从两个 assessmentId 中提取 HL / HR 数据 =====
      console.log('[getHandPdf] 使用分离模式: leftId=%s, rightId=%s', leftAssessmentId, rightAssessmentId)

      if (leftAssessmentId) {
        const { dataArr: leftDataArr, rotateArr: leftRotateArr, rows: leftRows } = await dbGetData({
          db: currentDb,
          params: [leftAssessmentId],
          byAssessmentId: true
        })
        if (leftRows && leftRows.length) {
          const leftKeys = Object.keys(leftDataArr || {})
          console.log('[getHandPdf] 左手assessmentId=%s, rows=%d, keys=%s', leftAssessmentId, leftRows.length, JSON.stringify(leftKeys))
          leftKeys.forEach(k => console.log('[getHandPdf]   key=%s frames=%d', k, (leftDataArr[k] || []).length))
          const lk = leftKeys.find((k) => k === 'HL' || /left|lhand|handl/i.test(k))
          leftArr = lk ? leftDataArr[lk] : null
          leftImuArr = lk && leftRotateArr ? leftRotateArr[lk] : null
          // 如果 HL 没找到，尝试取第一个可用的数据（可能只有一种设备类型）
          if (!leftArr && leftKeys.length > 0) {
            leftArr = leftDataArr[leftKeys[0]]
            leftImuArr = leftRotateArr ? leftRotateArr[leftKeys[0]] : null
          }
          if (!bestRow) bestRow = leftRows[0]
          console.log('[getHandPdf] 左手最终: key=%s, frames=%d, imuFrames=%d', lk || leftKeys[0], leftArr ? leftArr.length : 0, leftImuArr ? leftImuArr.length : 0)
        }
      }

      if (rightAssessmentId) {
        const { dataArr: rightDataArr, rotateArr: rightRotateArr, rows: rightRows } = await dbGetData({
          db: currentDb,
          params: [rightAssessmentId],
          byAssessmentId: true
        })
        if (rightRows && rightRows.length) {
          const rightKeys = Object.keys(rightDataArr || {})
          console.log('[getHandPdf] 右手assessmentId=%s, rows=%d, keys=%s', rightAssessmentId, rightRows.length, JSON.stringify(rightKeys))
          rightKeys.forEach(k => console.log('[getHandPdf]   key=%s frames=%d', k, (rightDataArr[k] || []).length))
          const rk = rightKeys.find((k) => k === 'HR' || /right|rhand|handr/i.test(k))
          rightArr = rk ? rightDataArr[rk] : null
          rightImuArr = rk && rightRotateArr ? rightRotateArr[rk] : null
          // 如果 HR 没找到，尝试取第一个可用的数据
          if (!rightArr && rightKeys.length > 0) {
            rightArr = rightDataArr[rightKeys[0]]
            rightImuArr = rightRotateArr ? rightRotateArr[rightKeys[0]] : null
          }
          if (!bestRow) bestRow = rightRows[0]
          console.log('[getHandPdf] 右手最终: key=%s, frames=%d, imuFrames=%d', rk || rightKeys[0], rightArr ? rightArr.length : 0, rightImuArr ? rightImuArr.length : 0)
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

      const { dataArr, rotateArr, rows } = await dbGetData({
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
      leftImuArr = leftKey && rotateArr ? rotateArr[leftKey] : null
      rightImuArr = rightKey && rotateArr ? rotateArr[rightKey] : null
    }

    if (!leftArr && !rightArr) {
      res.json(new HttpResult(1, {}, 'no hand data'))
      return
    }

    // 清洗 IMU 数据：null 项替换为单位四元数 [1,0,0,0]，确保长度与 sensor_data 一致
    function cleanImuData(imuArr, sensorArr) {
      if (!imuArr || !sensorArr || imuArr.length !== sensorArr.length) return null
      // 检查是否有任何有效 IMU 数据
      const hasAnyImu = imuArr.some(q => q !== null && Array.isArray(q))
      if (!hasAnyImu) return null
      return imuArr.map(q => (q !== null && Array.isArray(q)) ? q : [1, 0, 0, 0])
    }

    const leftImuCleaned = cleanImuData(leftImuArr, leftArr)
    const rightImuCleaned = cleanImuData(rightImuArr, rightArr)
    console.log('[getHandPdf] IMU诊断: leftArr=%d, leftImuArr=%d, leftImuCleaned=%s, rightArr=%d, rightImuArr=%d, rightImuCleaned=%s',
      leftArr ? leftArr.length : 0,
      leftImuArr ? leftImuArr.length : 0,
      leftImuCleaned ? `有效(${leftImuCleaned.length}帧)` : 'null',
      rightArr ? rightArr.length : 0,
      rightImuArr ? rightImuArr.length : 0,
      rightImuCleaned ? `有效(${rightImuCleaned.length}帧)` : 'null'
    )
    // 如果有 IMU 数据，打印第一帧样本
    if (leftImuArr && leftImuArr.length > 0) {
      const firstValid = leftImuArr.find(q => q !== null)
      console.log('[getHandPdf] 左手IMU样本: first=%s, nullCount=%d/%d',
        JSON.stringify(firstValid), leftImuArr.filter(q => q === null).length, leftImuArr.length)
    }

    let leftRenderResult = null
    let rightRenderResult = null
    try {
      leftRenderResult = leftArr
        ? await callAlgorithm('generate_grip_render_report', {
            sensor_data: leftArr,
            hand_type: '左手',
            imu_data: leftImuCleaned,
          })
        : null
      rightRenderResult = rightArr
        ? await callAlgorithm('generate_grip_render_report', {
            sensor_data: rightArr,
            hand_type: '右手',
            imu_data: rightImuCleaned,
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

    // 用于去重：记录上一帧的数据签名（JSON字符串），跳过完全相同的连续帧
    let lastStandSig = null
    let lastSitSig = null
    // 记录最后一个有效帧，用于离线时补齐（确保两传感器时间范围一致）
    let lastStandArr = null
    let lastSitArr = null

    rows.forEach((row) => {
      let dataObj = {}
      try {
        dataObj = JSON.parse(row.data || '{}')
      } catch {}

      const ts = formatTimestamp(row.timestamp)
      let standHasData = false
      let sitHasData = false

      if (standKey && dataObj[standKey]) {
        const d = dataObj[standKey]
        const arr = Array.isArray(d) ? d : d.arr
        if (Array.isArray(arr)) {
          standHasData = true
          lastStandArr = arr
          // 去重：跳过与上一帧完全相同的数据（低帧率设备的重复帧）
          const sig = JSON.stringify(arr)
          if (sig !== lastStandSig) {
            standData.push(arr)
            standTimes.push(ts)
            lastStandSig = sig
          }
        }
      }
      if (sitKey && dataObj[sitKey]) {
        const d = dataObj[sitKey]
        const arr = Array.isArray(d) ? d : d.arr
        if (Array.isArray(arr)) {
          sitHasData = true
          lastSitArr = arr
          // 去重：跳过与上一帧完全相同的数据
          const sig = JSON.stringify(arr)
          if (sig !== lastSitSig) {
            sitData.push(arr)
            sitTimes.push(ts)
            lastSitSig = sig
          }
        }
      }

      // 不补帧：保持数据真实性
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
        stand_times: standTimes,
        sit_times: sitTimes,
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
  ensureHistoryTable(currentDb)
  // 波特率由 detectBaudRate 自动探测，默认保持 1000000
  baudRate = 1000000
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
  // 波特率由 detectBaudRate 自动探测
  baudRate = 1000000

  const { db } = initDb(file, dbPath)
  currentDb = db
  ensureMatrixNameColumn(currentDb)
  ensureHistoryTable(currentDb)

  res.json(new HttpResult(0, result, '获取设备列表成功'));
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

// 重新扫描串口（掉线重连）
// 清理已断开的串口，重新扫描并连接新发现的设备
app.get('/rescanPort', async (req, res) => {
  try {
    console.log('[rescanPort] 开始重新扫描串口...')
    // 1. 清理已断开的串口
    const deadPaths = []
    for (const path of Object.keys(parserArr)) {
      const item = parserArr[path]
      if (!item || !item.port || !item.port.isOpen) {
        deadPaths.push(path)
        if (item && item.port) {
          // 只有端口仍然 open 时才调用 close，避免 "Port is not open" 错误
          if (item.port.isOpen) {
            try { item.port.close((err) => { if (err) console.warn('[rescanPort] close error:', path, err.message); }); } catch (e) {}
          }
          // 移除所有事件监听器，防止后续 error 事件导致崩溃
          try { item.port.removeAllListeners(); } catch (e) {}
        }
        delete parserArr[path]
        delete dataMap[path]
      }
    }
    console.log('[rescanPort] 清理已断开串口:', deadPaths.length, '个', deadPaths)

    // 2. 重新调用 connectPort，它会跳过已连接的串口（parserArr[path] 存在且 isOpen）
    const ports = await connectPort()
    console.log('[rescanPort] 重新扫描完成，当前连接:', Object.keys(parserArr).length, '个串口')

    res.json(new HttpResult(0, { cleaned: deadPaths, ports }, '重新扫描完成'));
  } catch (e) {
    console.error('[rescanPort] 失败:', e)
    res.json(new HttpResult(1, {}, '重新扫描失败: ' + e.message));
  }
})

// 寮€濮嬮噰闆?
app.post('/startCol', async (req, res) => {
  try {
    const { fileName, select, name, collectName, date } = req.body
    console.log('[startCol] 收到请求: assessmentId=%s, sampleType=%s, colName=%s, 当前activeSendTypes=%s',
      req.body?.assessmentId, req.body?.sampleType || req.body?.sample_type, req.body?.colName, JSON.stringify(activeSendTypes))
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

    // 原始逻辑：检查 file 类型是否有对应的在线设备
    const lengthByFile = sensorArr.filter((a) => a && a.includes(file)).length
    // 新增逻辑：检查 activeSendTypes 中的类型是否有对应的在线设备
    const lengthBySendTypes = activeSendTypes && activeSendTypes.length
      ? sensorArr.filter((a) => a && activeSendTypes.includes(a)).length
      : 0
    const canStart = lengthByFile > 0 || lengthBySendTypes > 0
    console.log('[startCol] sensorArr=%s, file=%s, lengthByFile=%d, activeSendTypes=%s, lengthBySendTypes=%d, canStart=%s',
      JSON.stringify(sensorArr), file, lengthByFile, JSON.stringify(activeSendTypes), lengthBySendTypes, canStart)
    if (canStart) {
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
    console.log('[setActiveMode] 收到请求: mode=%s, 当前activeSendTypes=%s', mode, JSON.stringify(activeSendTypes))
    const result = applyActiveMode(mode)
    if (!result) {
      res.json(new HttpResult(1, {}, 'invalid mode'))
      return
    }
    console.log('[setActiveMode] 切换完成: activeSendTypes=%s, activeSampleType=%s', JSON.stringify(activeSendTypes), activeSampleType)
    res.json(new HttpResult(0, result, 'success'))
  } catch (e) {
    res.json(new HttpResult(1, {}, 'setActiveMode failed'))
  }
})

// ─── 脚垫滤波/优化参数 API ───
app.post('/setFootFilter', (req, res) => {
  try {
    const { mode, config } = req.body || {}
    if (!mode || !config || !footFilterConfig[mode]) {
      res.json(new HttpResult(1, {}, 'invalid mode, must be "standing" or "gait"'))
      return
    }
    // 合并更新（只更新传入的字段）
    Object.assign(footFilterConfig[mode], config)
    console.log(`[setFootFilter] ${mode} 参数已更新:`, JSON.stringify(footFilterConfig[mode]))
    res.json(new HttpResult(0, footFilterConfig[mode], 'success'))
  } catch (e) {
    console.error('[setFootFilter] error:', e)
    res.json(new HttpResult(1, {}, 'setFootFilter failed'))
  }
})

app.get('/getFootFilter', (req, res) => {
  res.json(new HttpResult(0, footFilterConfig, 'success'))
})


// 握力传感器清零：记录当前 HL/HR 的传感器值作为基线
// 修复：采用异步重试机制，等待左右手数据都就绪后再记录基线
// 解决左右手共用串口、数据交替到达导致某只手基线偶尔缺失的时序问题
app.post('/tareGrip', async (req, res) => {
  try {
    const MAX_WAIT = 5000   // 最多等待 5 秒（HR 的 Packet1 经常丢失，需要更长时间等待完整帧）
    const INTERVAL = 100    // 每 100ms 检查一次
    const startTime = Date.now()

    // 尝试从 gloveLatestData 和 dataMap 中读取 HL/HR 基线
    // 只使用最近 FRESHNESS_MS 内的新鲜数据，避免用旧数据作为基线
    const FRESHNESS_MS = 5000  // 数据新鲜度窗口 5 秒（配合等待时间）
    function tryRecordBaseline() {
      let taredCount = 0
      const now = Date.now()
      // 优先从 gloveLatestData 缓存读取（左右手独立存储，不会被覆盖）
      // 接受 128 或 256 字节的数据作为基线
      // HR 的 Packet1 在硬件层面系统性丢失，几乎永远只有 128 字节
      // 基线和实际数据长度一致（都是 128），减基线就能正确清零
      const MIN_ARR_LEN = 128
      if (!gripBaseline.HL && gloveLatestData.HL && gloveLatestData.HL.arr
          && gloveLatestData.HL.arr.length >= MIN_ARR_LEN
          && (now - gloveLatestData.HL.stamp) < FRESHNESS_MS) {
        gripBaseline.HL = [...gloveLatestData.HL.arr]
        taredCount++
        console.log('[tareGrip] HL 基线已记录(从缓存), 长度=%d, 平均值=%.1f, 数据年龄=%dms', gloveLatestData.HL.arr.length, gloveLatestData.HL.arr.reduce((a, b) => a + b, 0) / gloveLatestData.HL.arr.length, now - gloveLatestData.HL.stamp)
      } else if (!gripBaseline.HL && gloveLatestData.HL && gloveLatestData.HL.arr) {
        console.log('[tareGrip] HL 缓存数据不合格: 长度=%d(需要>=%d), 年龄=%dms(需要<%d)', gloveLatestData.HL.arr.length, MIN_ARR_LEN, now - gloveLatestData.HL.stamp, FRESHNESS_MS)
      }
      if (!gripBaseline.HR && gloveLatestData.HR && gloveLatestData.HR.arr
          && gloveLatestData.HR.arr.length >= MIN_ARR_LEN
          && (now - gloveLatestData.HR.stamp) < FRESHNESS_MS) {
        gripBaseline.HR = [...gloveLatestData.HR.arr]
        taredCount++
        console.log('[tareGrip] HR 基线已记录(从缓存), 长度=%d, 平均值=%.1f, 数据年龄=%dms', gloveLatestData.HR.arr.length, gloveLatestData.HR.arr.reduce((a, b) => a + b, 0) / gloveLatestData.HR.arr.length, now - gloveLatestData.HR.stamp)
      } else if (!gripBaseline.HR && gloveLatestData.HR && gloveLatestData.HR.arr) {
        console.log('[tareGrip] HR 缓存数据不合格: 长度=%d(需要>=%d), 年龄=%dms(需要<%d)', gloveLatestData.HR.arr.length, MIN_ARR_LEN, now - gloveLatestData.HR.stamp, FRESHNESS_MS)
      }
      // 回退到 dataMap（兼容旧逻辑，同样接受 128 或 256 字节）
      if (!gripBaseline.HL || !gripBaseline.HR) {
        Object.keys(dataMap).forEach((key) => {
          const item = dataMap[key]
          if (!item || !item.type || !item.stamp) return
          if ((now - item.stamp) >= FRESHNESS_MS) return  // 跳过过期数据
          if (!gripBaseline.HL && item.type === 'HL' && item.arr && item.arr.length >= MIN_ARR_LEN) {
            gripBaseline.HL = [...item.arr]
            taredCount++
            console.log('[tareGrip] HL 基线已记录(仍ataMap), 长度=%d', item.arr.length)
          }
          if (!gripBaseline.HR && item.type === 'HR' && item.arr && item.arr.length >= MIN_ARR_LEN) {
            gripBaseline.HR = [...item.arr]
            taredCount++
            console.log('[tareGrip] HR 基线已记录(仍ataMap), 长度=%d', item.arr.length)
          }
        })
      }
      return taredCount
    }

    // 先清除旧基线，避免残留
    gripBaseline.HL = null
    gripBaseline.HR = null

    // 首次尝试
    tryRecordBaseline()

    // 如果两只手都已记录，直接返回
    if (gripBaseline.HL && gripBaseline.HR) {
      console.log('[tareGrip] 清零完成(首次), HL=✓, HR=✓')
      res.json(new HttpResult(0, { taredCount: 2, HL: true, HR: true }, '清零成功'))
      return
    }

    // 否则进入等待重试循环，等待另一只手的数据到达
    console.log('[tareGrip] 首次未全部就绪, HL=%s HR=%s, 开始等待重试...', gripBaseline.HL ? '✓' : '✗', gripBaseline.HR ? '✓' : '✗')
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        tryRecordBaseline()
        if ((gripBaseline.HL && gripBaseline.HR) || (Date.now() - startTime >= MAX_WAIT)) {
          clearInterval(timer)
          resolve()
        }
      }, INTERVAL)
    })

    const taredCount = (gripBaseline.HL ? 1 : 0) + (gripBaseline.HR ? 1 : 0)
    console.log('[tareGrip] 清零完成(等待%dms), 已记录 %d 个设备基线, HL=%s, HR=%s', Date.now() - startTime, taredCount, gripBaseline.HL ? '✓' : '✗', gripBaseline.HR ? '✓' : '✗')
    res.json(new HttpResult(0, { taredCount, HL: !!gripBaseline.HL, HR: !!gripBaseline.HR }, '清零成功'))
  } catch (e) {
    console.error('[tareGrip] 错误:', e)
    res.json(new HttpResult(1, {}, '清零失败: ' + e.message))
  }
})

// 清除握力基线（退出握力评估时调用）
// 同时清除 gloveLatestData 缓存，避免第二次进入时用旧数据作为基线
app.post('/clearGripBaseline', (req, res) => {
  gripBaseline.HL = null
  gripBaseline.HR = null
  gloveLatestData.HL = null
  gloveLatestData.HR = null
  console.log('[clearGripBaseline] 基线和手套缓存已清除')
  res.json(new HttpResult(0, {}, '基线已清除'))
})

/// 停止采集
app.get('/endCol', async (req, res) => {
  console.log('[endCol] 收到请求: 当前assessmentId=%s', activeAssessmentId)
  colFlag = false
  // 停止采集时立即刷入缓冲区剩余数据
  flushStorageBuffer()
  res.json(new HttpResult(0, 'success', '停止采集'));
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

// ─── 导出采集数据为CSV并返回下载链接 ───
app.post('/exportCsv', async (req, res) => {
  try {
    const { assessmentId, sampleType, assessmentIds } = req.body || {}

    // 支持多个 assessmentId（如握力左右手）
    const ids = Array.isArray(assessmentIds) && assessmentIds.length
      ? assessmentIds.filter(Boolean)
      : assessmentId ? [assessmentId] : []

    if (!ids.length) {
      res.json(new HttpResult(1, {}, 'missing assessmentId'))
      return
    }

    // 查询所有匹配的行
    let allRows = []
    for (const aid of ids) {
      const rows = await new Promise((resolve, reject) => {
        const sql = sampleType
          ? 'SELECT * FROM matrix WHERE assessment_id=? AND sample_type=?'
          : 'SELECT * FROM matrix WHERE assessment_id=?'
        const params = sampleType ? [aid, String(sampleType)] : [aid]
        currentDb.all(sql, params, (err, data) => {
          if (err) return reject(err)
          resolve(data || [])
        })
      })
      allRows = allRows.concat(rows)
    }

    if (!allRows.length) {
      res.json(new HttpResult(1, {}, 'no data found'))
      return
    }

    // 解析所有行，收集所有数据 key
    const keySet = new Set()
    const parsedRows = allRows.map(row => {
      try {
        const obj = JSON.parse(row.data || '{}')
        Object.keys(obj).forEach(k => keySet.add(k))
        return obj
      } catch {
        return {}
      }
    })
    const dataKeys = Array.from(keySet)

    // 构建 CSV 表头
    const headers = ['timestamp', 'date', 'assessment_id', 'sample_type']
    dataKeys.forEach(key => {
      headers.push(`${key}_pressure`, `${key}_area`, `${key}_max`, `${key}_min`, `${key}_avg`, `${key}_data`)
    })

    // 构建 CSV 行
    const csvLines = [headers.join(',')]
    allRows.forEach((row, idx) => {
      const rowObj = parsedRows[idx] || {}
      const line = [
        row.timestamp || '',
        (row.date || '').replace(/,/g, ' '),
        (row.assessment_id || '').replace(/,/g, ' '),
        row.sample_type || '',
      ]
      dataKeys.forEach(key => {
        const item = rowObj[key]
        const arr = Array.isArray(item) ? item : (item && item.arr ? item.arr : null)
        if (Array.isArray(arr)) {
          const pressure = arr.reduce((a, b) => a + b, 0)
          const area = arr.filter(v => v > 0).length
          const max = Math.max(...arr)
          const positives = arr.filter(v => v > 0)
          const min = positives.length ? Math.min(...positives) : 0
          const avg = area > 0 ? (pressure / area).toFixed(2) : '0'
          // 用双引号包裹 data 数组，防止逗号干扰
          line.push(pressure, area, max, min, avg, `"${JSON.stringify(arr)}"`)
        } else {
          line.push('', '', '', '', '', '')
        }
      })
      csvLines.push(line.join(','))
    })

    const csvContent = csvLines.join('\n')

    // 生成文件名
    const safeId = ids.join('_').replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 80)
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    const fileName = `export_${safeId}_${ts}.csv`

    // 确保 data 目录存在
    const csvDir = path.join(storageBase, 'data')
    if (!fs.existsSync(csvDir)) {
      fs.mkdirSync(csvDir, { recursive: true })
    }
    const csvFilePath = path.join(csvDir, fileName)
    fs.writeFileSync(csvFilePath, '\uFEFF' + csvContent, 'utf-8')  // BOM for Excel
    console.log('[exportCsv] CSV exported:', csvFilePath, 'rows:', allRows.length)

    res.json(new HttpResult(0, {
      fileName,
      filePath: csvFilePath,
      rowCount: allRows.length,
      dataKeys,
    }, 'export success'))
  } catch (e) {
    console.error('[exportCsv] failed:', e)
    res.json(new HttpResult(1, {}, 'exportCsv failed: ' + e.message))
  }
})

// ─── CSV 文件下载 ───
app.get('/downloadCsvFile/:name', (req, res) => {
  try {
    const rawName = req.params.name || ''
    const safeName = rawName.replace(/[\\/]/g, '').replace(/[\x00-\x1F<>:"|?*]/g, '')
    if (!safeName || !safeName.endsWith('.csv')) {
      res.status(400).send('Invalid file name')
      return
    }
    const csvDir = path.join(storageBase, 'data')
    const filePath = path.join(csvDir, safeName)
    const resolvedPath = path.resolve(filePath)
    const resolvedBase = path.resolve(csvDir) + path.sep
    if (!resolvedPath.startsWith(resolvedBase)) {
      res.status(403).send('Forbidden')
      return
    }
    if (!fs.existsSync(resolvedPath)) {
      res.status(404).send('File not found')
      return
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}"`)
    res.sendFile(resolvedPath, (err) => {
      if (err && !res.headersSent) {
        res.status(err.statusCode || 500).send('Download failed')
      }
    })
  } catch (e) {
    console.error('[downloadCsvFile] failed:', e)
    if (!res.headersSent) res.status(500).send('Server Error')
  }
})

// 鍒犻櫎鏁版嵁搴撴煇涓枃浠??
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
  // 波特率由 detectBaudRate 自动探测
  baudRate = 1000000
  const { db } = initDb(file, dbPath)
  currentDb = db
  ensureMatrixNameColumn(currentDb)
  ensureHistoryTable(currentDb)
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



// ==================== 历史记录模块 ====================

/**
 * 确保 assessment_history 表存在
 */
function ensureHistoryTable(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS assessment_history (
      id TEXT PRIMARY KEY,
      patient_name TEXT,
      patient_gender TEXT,
      patient_age INTEGER,
      patient_weight REAL,
      institution TEXT,
      assessments TEXT,
      date TEXT,
      date_str TEXT,
      updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `, (err) => {
    if (err) console.error('[History] 创建 assessment_history 表失败:', err)
    else console.log('[History] assessment_history 表已就绪')
  })
}

// 初始化历史记录表
ensureHistoryTable(currentDb)

/**
 * POST /api/history/save
 * 保存或更新一条评估记录
 * Body: { patientInfo: { name, gender, age, weight }, institution, assessments: { grip: {...}, ... } }
 */
app.post('/api/history/save', (req, res) => {
  try {
    const { patientInfo, institution, assessments } = req.body || {}
    if (!patientInfo || !patientInfo.name) {
      return res.json(new HttpResult(1, {}, 'missing patientInfo.name'))
    }

    const now = new Date()
    const dateStr = formatDateStr(now)

    // 查找今天同一患者的记录
    currentDb.get(
      'SELECT * FROM assessment_history WHERE patient_name = ? AND date_str = ?',
      [patientInfo.name, dateStr],
      (err, existingRow) => {
        if (err) {
          console.error('[History] 查询失败:', err)
          return res.json(new HttpResult(1, {}, 'database error'))
        }

        if (existingRow) {
          // 更新已有记录：合并 assessments
          let existingAssessments = {}
          try { existingAssessments = JSON.parse(existingRow.assessments || '{}') } catch {}

          for (const [type, data] of Object.entries(assessments || {})) {
            if (data && data.completed) {
              existingAssessments[type] = {
                completed: true,
                report: data.report || null,
                completedAt: now.toISOString(),
              }
            }
          }

          currentDb.run(
            'UPDATE assessment_history SET assessments = ?, updated_at = ?, patient_age = ?, patient_weight = ?, patient_gender = ? WHERE id = ?',
            [JSON.stringify(existingAssessments), now.toISOString(), patientInfo.age, patientInfo.weight, patientInfo.gender, existingRow.id],
            function (err2) {
              if (err2) {
                console.error('[History] 更新失败:', err2)
                return res.json(new HttpResult(1, {}, 'update failed'))
              }
              res.json(new HttpResult(0, { id: existingRow.id, updated: true }, 'success'))
            }
          )
        } else {
          // 创建新记录
          const id = generateHistoryId()
          const assessmentData = {}
          for (const [type, data] of Object.entries(assessments || {})) {
            assessmentData[type] = {
              completed: data?.completed || false,
              report: data?.completed ? (data.report || null) : null,
              completedAt: data?.completed ? now.toISOString() : null,
            }
          }

          currentDb.run(
            `INSERT INTO assessment_history (id, patient_name, patient_gender, patient_age, patient_weight, institution, assessments, date, date_str, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, patientInfo.name, patientInfo.gender, patientInfo.age, patientInfo.weight, institution || '', JSON.stringify(assessmentData), now.toISOString(), dateStr, now.toISOString()],
            function (err2) {
              if (err2) {
                console.error('[History] 插入失败:', err2)
                return res.json(new HttpResult(1, {}, 'insert failed'))
              }
              res.json(new HttpResult(0, { id, updated: false }, 'success'))
            }
          )
        }
      }
    )
  } catch (e) {
    console.error('[History] save error:', e)
    res.json(new HttpResult(1, {}, 'save failed'))
  }
})

/**
 * POST /api/history/list
 * 搜索+分页查询历史记录
 * Body: { keyword, date, page, pageSize }
 */
app.post('/api/history/list', (req, res) => {
  try {
    const { keyword, date, page = 1, pageSize = 10 } = req.body || {}

    let countSql = 'SELECT COUNT(*) as total FROM assessment_history WHERE 1=1'
    let dataSql = 'SELECT * FROM assessment_history WHERE 1=1'
    const params = []

    if (keyword) {
      const likeClause = ' AND (patient_name LIKE ? OR institution LIKE ?)'
      countSql += likeClause
      dataSql += likeClause
      params.push(`%${keyword}%`, `%${keyword}%`)
    }

    if (date) {
      const dateClause = ' AND date_str LIKE ?'
      countSql += dateClause
      dataSql += dateClause
      // 支持 YYYY-MM-DD 或 YYYY/MM/DD 格式
      const normalizedDate = date.replace(/-/g, '/')
      params.push(`%${normalizedDate}%`)
    }

    dataSql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'

    // 先查总数
    currentDb.get(countSql, params, (err, countRow) => {
      if (err) {
        console.error('[History] count error:', err)
        return res.json(new HttpResult(1, {}, 'query failed'))
      }

      const total = countRow?.total || 0
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // 再查数据
      currentDb.all(dataSql, [...params, pageSize, offset], (err2, rows) => {
        if (err2) {
          console.error('[History] list error:', err2)
          return res.json(new HttpResult(1, {}, 'query failed'))
        }

        const items = (rows || []).map(row => ({
          id: row.id,
          patientName: row.patient_name,
          patientGender: row.patient_gender,
          patientAge: row.patient_age,
          patientWeight: row.patient_weight,
          institution: row.institution,
          assessments: safeParseJSON(row.assessments),
          date: row.date,
          dateStr: row.date_str,
          updatedAt: row.updated_at,
        }))

        res.json(new HttpResult(0, { items, total, totalPages, page }, 'success'))
      })
    })
  } catch (e) {
    console.error('[History] list error:', e)
    res.json(new HttpResult(1, {}, 'list failed'))
  }
})

/**
 * POST /api/history/get
 * 获取单条历史记录
 * Body: { id }
 */
app.post('/api/history/get', (req, res) => {
  try {
    const { id } = req.body || {}
    if (!id) {
      return res.json(new HttpResult(1, {}, 'missing id'))
    }

    currentDb.get('SELECT * FROM assessment_history WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('[History] get error:', err)
        return res.json(new HttpResult(1, {}, 'query failed'))
      }

      if (!row) {
        return res.json(new HttpResult(1, {}, 'record not found'))
      }

      const record = {
        id: row.id,
        patientName: row.patient_name,
        patientGender: row.patient_gender,
        patientAge: row.patient_age,
        patientWeight: row.patient_weight,
        institution: row.institution,
        assessments: safeParseJSON(row.assessments),
        date: row.date,
        dateStr: row.date_str,
        updatedAt: row.updated_at,
      }

      res.json(new HttpResult(0, record, 'success'))
    })
  } catch (e) {
    console.error('[History] get error:', e)
    res.json(new HttpResult(1, {}, 'get failed'))
  }
})

/**
 * POST /api/history/delete
 * 删除单条历史记录
 * Body: { id }
 */
app.post('/api/history/delete', (req, res) => {
  try {
    const { id } = req.body || {}
    if (!id) {
      return res.json(new HttpResult(1, {}, 'missing id'))
    }

    currentDb.run('DELETE FROM assessment_history WHERE id = ?', [id], function (err) {
      if (err) {
        console.error('[History] delete error:', err)
        return res.json(new HttpResult(1, {}, 'delete failed'))
      }
      res.json(new HttpResult(0, { deleted: this.changes }, 'success'))
    })
  } catch (e) {
    console.error('[History] delete error:', e)
    res.json(new HttpResult(1, {}, 'delete failed'))
  }
})

/**
 * POST /api/history/clear
 * 清空所有历史记录
 */
app.post('/api/history/clear', (req, res) => {
  try {
    currentDb.run('DELETE FROM assessment_history', function (err) {
      if (err) {
        console.error('[History] clear error:', err)
        return res.json(new HttpResult(1, {}, 'clear failed'))
      }
      res.json(new HttpResult(0, { deleted: this.changes }, 'success'))
    })
  } catch (e) {
    console.error('[History] clear error:', e)
    res.json(new HttpResult(1, {}, 'clear failed'))
  }
})

// 工具函数
function generateHistoryId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

function formatDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}/${m}/${d}`
}

function safeParseJSON(str) {
  try { return JSON.parse(str || '{}') } catch { return {} }
}

// ==================== 历史记录模块结束 ====================


const httpServer = app.listen(port, () => {
  process.send?.({ type: 'ready', port });
  console.log(`Example app listening on port ${port}`)
})


const server = new WebSocket.Server({ port: 19999 });

// 进程退出时清理所有端口和连接
function cleanupAndExit() {
  console.log('[cleanup] 正在关闭所有服务...')
  // 关闭所有串口
  Object.keys(parserArr).forEach((path) => {
    const item = parserArr[path]
    if (item && item.port && item.port.isOpen) {
      try { item.port.close() } catch (e) { /* ignore */ }
    }
  })
  // 关闭 WebSocket 服务器 (端口 19999)
  try {
    server.clients.forEach((ws) => ws.terminate())
    server.close()
  } catch (e) { /* ignore */ }
  // 关闭 Express HTTP 服务器 (端口 19245)
  try { httpServer.close() } catch (e) { /* ignore */ }
  // 清除定时器
  if (playtimer) clearInterval(playtimer)
  console.log('[cleanup] 清理完成')
  process.exit(0)
}

// 监听父进程发送的退出信号
process.on('SIGTERM', cleanupAndExit)
process.on('SIGINT', cleanupAndExit)
// 父进程断开时自动退出（防止孤儿进程）
process.on('disconnect', cleanupAndExit)

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
    port.pipe(parser);
  } catch (e) {
    console.log(e, "e");
  }
  return port
}

/**
 * 带重试的串口连接，解决 macOS 上 Cannot lock port 问题
 * detectBaudRate 关闭端口后，系统可能还未释放文件锁，立即重新打开会失败
 * 此函数会自动重试最多 maxRetries 次，每次间隔 retryDelay ms
 */
async function newSerialPortLinkWithRetry({ path, parser, baudRate = 1000000, maxRetries = 3, retryDelay = 500 }) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[port] ${path} retry #${attempt} after ${retryDelay}ms`)
      await new Promise(r => setTimeout(r, retryDelay))
    }
    const port = newSerialPortLink({ path, parser, baudRate })
    if (port) {
      // 检查端口是否真正打开成功
      const opened = await new Promise((resolve) => {
        if (port.isOpen) {
          resolve(true)
          return
        }
        const onOpen = () => {
          port.off('error', onErr)
          resolve(true)
        }
        const onErr = (err) => {
          port.off('open', onOpen)
          if (err && /lock|unavailable|EBUSY/i.test(err.message)) {
            console.log(`[port] ${path} lock error on attempt ${attempt}:`, err.message)
            resolve(false)
          } else {
            // 其他错误不影响端口打开
            resolve(true)
          }
        }
        port.once('open', onOpen)
        port.once('error', onErr)
        // 超时保护
        setTimeout(() => {
          port.off('open', onOpen)
          port.off('error', onErr)
          resolve(port.isOpen)
        }, 2000)
      })
      if (opened) {
        console.log(`[port] ${path} opened successfully` + (attempt > 0 ? ` (after ${attempt} retries)` : ''))
        return port
      }
      // 打开失败，关闭后重试
      try { if (port.isOpen) port.close() } catch (e) {}
    }
  }
  console.log(`[port] ${path} failed to open after ${maxRetries} retries`)
  return null
}

/**
 * 
 * @param {Array} parserArr 
 * @param {object} objs 
 * @returns 瑙ｆ瀽钃濈墮鍒嗗寘鏁版嵁
 */
function parseData(parserArr, objs) {

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

      // 手套设备（HL/HR）跳过 dataMap 的 arr，统一由下方 gloveLatestData 处理
      // 原因：左右手共用一个串口，Packet1 会覆盖 dataItem.type 但不更新 dataItem.arr，
      // 导致 type 和 arr 不匹配，清零基线被错误应用。
      if (data.type === 'HL' || data.type === 'HR') {
        // 仅记录串口在线状态，不使用 data.arr
        const dataStamp = new Date().getTime() - data.stamp
        if (dataStamp < 1000) {
          // 标记串口在线，具体数据由 gloveLatestData 提供
        } else {
          // 串口超时，不做处理，由下方 gloveLatestData 判断
        }
      } else {
        // 非手套设备：保持原有逻辑
        let blueArr = data.arr && data.arr.length ? data.arr : []
        const dataStamp = new Date().getTime() - data.stamp
        json[data.type] = {}
        if (dataStamp < 1000) {
          json[data.type].status = 'online'
          json[data.type].arr = blueArr
          json[data.type].rotate = data.rotate
          json[data.type].stamp = data.stamp
          json[data.type].HZ = data.HZ
          if (data.cop) json[data.type].cop = data.cop
          if (data.breatheData) json[data.type].cop = data.breatheData
        } else {
          json[data.type].status = 'offline'
        }
      }
    } else {
      if (data && data.type) {
        json[data.type] = {}
        json[data.type].status = 'offline'
      }
    }

  })

  // 手套数据统一从 gloveLatestData 获取（保证 type 和 arr 一致性）
  // gloveLatestData 在 Packet2 合并时同步写入，type/arr/stamp 始终匹配
  if (!global._lastGloveDebugTs) global._lastGloveDebugTs = 0
  const _shouldDebugLog = (Date.now() - global._lastGloveDebugTs) > 2000
  ;['HL', 'HR'].forEach((gloveType) => {
    const cached = gloveLatestData[gloveType]
    if (!cached) {
      // 没有缓存数据，设为离线
      if (!json[gloveType]) json[gloveType] = { status: 'offline' }
      return
    }
    const dataStamp = new Date().getTime() - cached.stamp
    json[gloveType] = {}
    if (dataStamp < 1000) {
      // 应用清零基线：用对应手的基线减去对应手的数据（type/arr 保证一致）
      let arr = cached.arr && cached.arr.length ? [...cached.arr] : []
      if (gripBaseline[gloveType] && arr.length) {
        const base = gripBaseline[gloveType]
        if (_shouldDebugLog) {
          const avgBefore = arr.reduce((a, b) => a + b, 0) / arr.length
          const avgBase = base.reduce((a, b) => a + b, 0) / base.length
          console.log('[parseData] %s 减基线: arrLen=%d, baseLen=%d, avgBefore=%.1f, avgBase=%.1f', gloveType, arr.length, base.length, avgBefore, avgBase)
        }
        arr = arr.map((v, i) => {
          const diff = v - (base[i] || 0)
          return diff > 0 ? diff : 0
        })
        if (_shouldDebugLog) {
          const avgAfter = arr.reduce((a, b) => a + b, 0) / arr.length
          console.log('[parseData] %s 减基线后: avgAfter=%.1f', gloveType, avgAfter)
        }
      } else if (_shouldDebugLog && arr.length) {
        console.log('[parseData] %s 无基线, 直接推送原始数据, avg=%.1f', gloveType, arr.reduce((a, b) => a + b, 0) / arr.length)
      }
      json[gloveType].status = 'online'
      json[gloveType].arr = arr
      json[gloveType].rotate = cached.rotate
      json[gloveType].stamp = cached.stamp
      json[gloveType].HZ = cached.HZ
    } else {
      json[gloveType].status = 'offline'
    }
  })
  if (_shouldDebugLog) global._lastGloveDebugTs = Date.now()

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

  // ============================================================
  // 阶段一：通过分隔符 + 帧长度双重验证，通过波特率探测确定每个端口的设备类型
  // 关键：每次只打开一个端口，探测完关闭后再探测下一个，避免 CH340 驱动端口锁冲突
  // ============================================================
  const baudDetectResults = {}  // path -> detectedBaud
  console.log('[phase1] Starting baud rate detection for', ports.length, 'ports')
  for (let i = 0; i < ports.length; i++) {
    const { path } = ports[i]
    let detectedBaud = null
    if (process.env.VIRTUAL_SERIAL_TEST === 'true') {
      try {
        const baudMap = JSON.parse(process.env.VIRTUAL_BAUD_MAP || '{}')
        detectedBaud = baudMap[path] || null
      } catch (e) {}
      console.log('[TEST] Skipping detectBaudRate for', path, '-> using', detectedBaud || baudRate)
    } else {
      detectedBaud = await detectBaudRate(path)
    }
    baudDetectResults[path] = detectedBaud
    console.log('[phase1]', path, '=>', detectedBaud || 'null (will use default ' + baudRate + ')')
    // 探测完后等待端口完全释放，再探测下一个
    await new Promise(r => setTimeout(r, 500))
  }
  console.log('[phase1] Detection complete:', JSON.stringify(baudDetectResults))

  // 探测全部完成后，等待一段时间确保所有端口锁彻底释放
  await new Promise(r => setTimeout(r, 1000))

  // ============================================================
  // 阶段二：根据探测结果逐个打开端口并建立连接
  // ============================================================
  console.log('[phase2] Starting port connections')
  for (let i = 0; i < ports.length; i++) {

      const portInfo = ports[i]

      const { path } = portInfo
      const detectedBaud = baudDetectResults[path]
      let portBaudRate = detectedBaud || baudRate

      const parserItem = parserArr[path] = parserArr[path] ? parserArr[path] : {}
      const dataItem = dataMap[path] = dataMap[path] ? dataMap[path] : {}
      parserItem.baudRate = portBaudRate
      parserItem.parser = new DelimiterParser({ delimiter: splitBuffer })

    const { parser } = parserItem

      if (!(parserItem.port && parserItem.port.isOpen)) {
        console.log('[baud]', path, '=>', portBaudRate, detectedBaud ? '(detected)' : '')
        // 根据探测到的波特率自动设置设备大类
        const deviceCategory = BAUD_DEVICE_MAP[portBaudRate]
        if (deviceCategory) {
          if (deviceCategory === 'sit') {
            dataItem.type = 'sit'
            dataItem.premission = true
          } else if (deviceCategory === 'foot') {
            dataItem.type = 'foot'
          }
          console.log('[device]', path, '=>', deviceCategory, '(by baud', portBaudRate, ')')
        }
        // 使用带重试的端口连接
        const port = await newSerialPortLinkWithRetry({ path, parser: parserItem.parser, baudRate: portBaudRate })
        if (!port) {
          console.log('[port] ' + path + ' skipped: unable to open port')
          continue
        }

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

            // 根据波特率确定的设备大类进行处理
            const deviceCat = BAUD_DEVICE_MAP[parserItem.baudRate]
            if (deviceCat === 'hand' || deviceCat === 'sit') {
              // 手套和起坐垫：获取到 MAC 即确认授权
              dataItem.premission = true
            } else if (deviceCat === 'foot') {
              // 脚垫：通过 MAC 地址查映射表确定 foot1-4
              const mappedType = getTypeFromSerialCache(uniqueId)
              if (mappedType) {
                dataItem.type = String(mappedType).trim()
                dataItem.premission = true
                console.log(`[foot] ${path} MAC=${uniqueId} => ${dataItem.type}`)
              } else {
                // MAC 未在本地缓存中，尝试从服务器查询
                try {
                  const response = await fetch(`${constantObj.backendAddress}/device-manage/device/getDetail/${uniqueId}`)
                  if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`)
                  }
                  const result = await response.json()
                  if (result.data) {
                    dataItem.type = JSON.parse(result.data.typeInfo)[0]
                    dataItem.premission = true
                  } else {
                    dataItem.premission = false
                  }
                } catch (err) {
                  console.log('[foot] 服务器查询失败:', err.message)
                  dataItem.premission = false
                }
              }
            } else {
              dataItem.premission = true
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
          if (!global._18count) global._18count = 0
          global._18count++
          if (global._18count <= 5) console.log('[IMU-DEBUG] 收到18字节帧(独立IMU)! count=%d', global._18count)
          const length = pointArr.length
          const arr = pointArr.splice(2, length)
          dataItem.rotate = bytes4ToInt10(arr)
        }
        // Packet1: 130字节 = 2(order+type) + 128(sensor前半)
        // 参考 serial_parser_two.py: 缓存 packet1，等待 packet2 到达后合并
        // 注意：不覆盖 dataItem.type 和 dataItem.stamp，避免 type/arr 不匹配
        // （Packet1 只有前半数据，完整数据在 Packet2 到达时才合并写入）
        else if (pointArr.length == 130) {
          const orderByte = pointArr[0]       // 包顺序位: 应为 1
          const sensorType = pointArr[1]      // 1=HL, 2=HR
          const sensorData = pointArr.slice(2)  // 128 字节 sensor 前半

          // 追踪日志：每个 Packet1 的到达
          if (!global._p1LogCount) global._p1LogCount = 0
          global._p1LogCount++
          if (global._p1LogCount <= 20) {
            console.log('[glove-P1] #%d order=%d type=%d path=%s cacheKeys=%s',
              global._p1LogCount, orderByte, sensorType, path,
              JSON.stringify(Object.keys(glovePacket1Cache)))
          }

          // 仅缓存 Packet1 数据，不修改 dataItem（等 Packet2 到达后再统一更新）
          glovePacket1Cache[sensorType] = {
            data: sensorData,
            stamp: new Date().getTime(),
          }
        } else if (pointArr.length == 1024) {
          // 1024字节帧 = 起坐垫 (sit)，32x32 矩阵
          if (!dataItem.type) {
            dataItem.type = 'sit'
          }
          const matrix = hand(pointArr)

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


        // 1025字节帧已删除（旧设备类型 car-back/car-sit/bed 不再使用）

        // Packet2: 146字节 = 2(order+type) + 128(sensor后半) + 16(IMU)
        // 参考 serial_parser_two.py: 到达时立即与缓存的 packet1 合并
        } else if (pointArr.length == 146) {
          const orderByte = pointArr[0]       // 包顺序位: 应为 2
          const sensorType = pointArr[1]      // 1=HL, 2=HR
          const sensorData = pointArr.slice(2, 130)  // 中间 128 字节 = sensor 后半
          const imuRaw = pointArr.slice(130)          // 最后 16 字节 = IMU

          dataItem.type = constantObj.type[sensorType] || dataItem.type
          const stamp = new Date().getTime()
          dataItem.stamp = stamp

          // 与缓存的 Packet1 合并为完整 256 字节 sensor 数据
          const cached = glovePacket1Cache[sensorType]
          let fullFrame = false

          // 追踪日志：每个 Packet2 的到达和合并状态
          if (!global._p2LogCount) global._p2LogCount = 0
          global._p2LogCount++
          if (global._p2LogCount <= 20) {
            console.log('[glove-P2] #%d order=%d type=%d path=%s cached=%s cacheKeys=%s',
              global._p2LogCount, orderByte, sensorType, path,
              cached ? 'YES(len=' + cached.data.length + ',age=' + (stamp - cached.stamp) + 'ms)' : 'NO',
              JSON.stringify(Object.keys(glovePacket1Cache)))
          }

          if (cached) {
            dataItem.arr = [...cached.data, ...sensorData]
            delete glovePacket1Cache[sensorType]
            fullFrame = true  // 256 字节完整帧
          } else {
            dataItem.arr = sensorData  // 128 字节不完整帧（Packet1 缓存丢失）
            console.log('[glove] Packet1缓存丢失, sensorType=%d, 只有%d字节, cacheKeys=%s',
              sensorType, sensorData.length, JSON.stringify(Object.keys(glovePacket1Cache)))
          }

          // 解析并校验四元数
          const rawQuat = bytes4ToInt10(imuRaw)
          dataItem.rotate = validateQuaternion(rawQuat) || rawQuat

          // 写入 gloveLatestData 缓存（接受 128 或 256 字节）
          // HR 的 Packet1 在硬件层面系统性丢失，几乎永远只有 128 字节
          // 如果只接受 256 字节，HR 将永远无法清零
          const gloveType = constantObj.type[sensorType]
          if (gloveType) {
            gloveLatestData[gloveType] = {
              type: gloveType,
              arr: [...dataItem.arr],
              rotate: dataItem.rotate,
              stamp: stamp,
              HZ: dataItem.HZ,
              port: path,
            }
          }

          // 帧率计算
          if (sendDataLength < 30) {
            sendDataLength++
          }
          if (oldTimeObj[dataItem.type]) {
            dataItem.HZ = stamp - oldTimeObj[dataItem.type]
            if (!MaxHZ && sendDataLength >= 30) {
              MaxHZ = Math.floor(1000 / dataItem.HZ)
              HZ = MaxHZ
              if (!activeSendTypes || !activeSendTypes.length) {
                playtimer = setInterval(() => {
                  colAndSendData()
                }, 1000 / HZ)
              }
              sendDataLength = 0
            }
          }
          oldTimeObj[dataItem.type] = stamp
          // 手套 HZ 打印（每秒最多打印一次）
          if (dataItem.HZ) {
            if (!global._gloveHzLogTs) global._gloveHzLogTs = {}
            const now = Date.now()
            if (!global._gloveHzLogTs[dataItem.type] || now - global._gloveHzLogTs[dataItem.type] > 1000) {
              global._gloveHzLogTs[dataItem.type] = now
              console.log('[glove-HZ] %s: %dms (%d Hz), fullFrame=%s, arrLen=%d',
                dataItem.type, dataItem.HZ, Math.round(1000 / dataItem.HZ), fullFrame, dataItem.arr ? dataItem.arr.length : 0)
            }
          }
          maybeLockSensorHz()
          if (activeSendTypes && activeSendTypes.includes(dataItem.type)) {
            updateSendTimerForActiveTypes()
          }
        } else if (pointArr.length == 4096) {
          // 4096字节帧 = 脚垫 (foot/foot1-4)，64x64 矩阵
          dataItem.premission = true
          if (!dataItem.type) {
            dataItem.type = 'foot'
          }
          zeroBelowThreshold(pointArr, 8)
          removeSmallIslands64x64(pointArr, 12)
          // 对脚垫数据做上下翻转（沿水平轴翻转行顺序，实现左右对调）
          const flippedArr = flipFoot64x64Vertical(pointArr)
          // 根据当前评估模式应用滤波和坏线补值（数据源头处理，同时影响前端显示、数据库存储和 Python 算法）
          // 优先根据 activeSampleType 判断，兜底根据传感器类型判断（foot1-4 为 gait，foot 为 standing）
          let filterMode = activeSampleType === '4' ? 'standing' : (activeSampleType === '5' ? 'gait' : null)
          if (!filterMode) {
            // 兜底：根据 dataItem.type 推断
            if (['foot1','foot2','foot3','foot4'].includes(dataItem.type)) {
              filterMode = 'gait'
            } else if (dataItem.type === 'foot') {
              filterMode = 'standing'
            }
          }
          if (filterMode) {
            applyFootFilter(flippedArr, filterMode, dataItem.type)
          } else {
            console.log('[坏线补值] filterMode为null, activeSampleType=%s, type=%s, typeof=%s', activeSampleType, dataItem.type, typeof activeSampleType)
          }
          dataItem.arr = flippedArr
          if (dataItem.type === 'foot' && lastFootPointArr.length) {
            dataItem.cop = await callAlgorithm('realtime_server', { sensor_data: flippedArr, data_prev: lastFootPointArr })
          }
          lastFootPointArr = flippedArr
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

        // 4097/144/51字节帧已删除（旧设备类型 endi/carAir/ECU 不再使用）
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

  // 娓門除鍙戦€佹暟鎹畾鏃跺櫒
  clearInterval(playtimer)

  // 清除手套数据缓存
  gloveLatestData.HL = null
  gloveLatestData.HR = null

  // 灰唇z娓門除鎺?
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
  // 统一解析所有设备数据（直接传引用，parseData 只读不写，无需深拷贝）
  obj = parseData(parserArr, dataMap)

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
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS matrix (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT,
        timestamp INTEGER,
        date TEXT,
        "select" TEXT,
        name TEXT,
        assessment_id TEXT,
        sample_type TEXT
      )
    `, (createErr) => {
      if (createErr) {
        console.error('CREATE TABLE matrix failed:', createErr)
      }
    })

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
      const hasTimestamp = rows.some((r) => r.name === 'timestamp')
      if (!hasTimestamp) {
        db.run('ALTER TABLE matrix ADD COLUMN timestamp INTEGER', (e) => {
          if (e) console.error('ALTER TABLE add timestamp failed:', e)
        })
      }
      const hasSelect = rows.some((r) => r.name === 'select')
      if (!hasSelect) {
        db.run('ALTER TABLE matrix ADD COLUMN "select" TEXT', (e) => {
          if (e) console.error('ALTER TABLE add select failed:', e)
        })
      }
    })
  })
}

/**
 * 灏嗘敹鍒扮殑
 */
// 存储写入缓冲区：攒一批再写，减少 SQLite I/O 次数
const storageBuffer = []
const STORAGE_FLUSH_INTERVAL = 200  // 每 200ms 批量写入一次
let storageFlushTimer = null

function storageData(data) {
  const timestamp = Date.now()

  // 构建存储数据（去掉 status 字段）
  const newData = {}
  for (const key of Object.keys(data)) {
    if (!data[key]) continue
    const item = { ...data[key] }
    delete item.status
    newData[key] = item
  }

  const assessmentId = activeAssessmentId || null
  const sampleType = activeSampleType || null

  storageBuffer.push([JSON.stringify(newData), timestamp, colName, JSON.stringify(selectArr), colPersonName, assessmentId, sampleType])

  // 启动批量写入定时器（如果还没启动）
  if (!storageFlushTimer) {
    storageFlushTimer = setTimeout(flushStorageBuffer, STORAGE_FLUSH_INTERVAL)
  }
}

let isFlushingStorage = false  // 事务锁，防止并发写入

function flushStorageBuffer() {
  storageFlushTimer = null
  if (!storageBuffer.length || !currentDb) return

  // 如果上一次事务还在进行中，延迟重试
  if (isFlushingStorage) {
    if (!storageFlushTimer) {
      storageFlushTimer = setTimeout(flushStorageBuffer, STORAGE_FLUSH_INTERVAL)
    }
    return
  }

  isFlushingStorage = true
  const rows = storageBuffer.splice(0)
  const insertQuery = "INSERT INTO matrix (data, timestamp, date, `select`, name, assessment_id, sample_type) VALUES (?, ?, ?, ?, ?, ?, ?)"

  currentDb.serialize(() => {
    currentDb.run('BEGIN TRANSACTION', (err) => {
      if (err) {
        console.error('[storageData] BEGIN error:', err)
        // BEGIN 失败，把数据放回缓冲区，下次重试
        storageBuffer.unshift(...rows)
        isFlushingStorage = false
        return
      }
    })
    for (const row of rows) {
      currentDb.run(insertQuery, row, (err) => {
        if (err) console.error('[storageData] INSERT error:', err)
      })
    }
    currentDb.run('COMMIT', (err) => {
      if (err) {
        console.error('[storageData] COMMIT error:', err)
        // COMMIT 失败时尝试回滚
        currentDb.run('ROLLBACK', () => {
          isFlushingStorage = false
        })
      } else {
        isFlushingStorage = false
      }
      // 如果缓冲区中还有数据（可能是等待期间新积累的），继续刷入
      if (storageBuffer.length && !storageFlushTimer) {
        storageFlushTimer = setTimeout(flushStorageBuffer, STORAGE_FLUSH_INTERVAL)
      }
    })
  })
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
