import * as XLSX from 'xlsx';
import { backendBridge } from './BackendBridge';

/**
 * 导入分析：读一份「四项评估数据」导出 xlsx，按北京/广州线序重建每项的原始帧，
 * 交给后端 /generateReportFromRaw 跑同一套算法生成 render_data，
 * 组装成历史记录里的 assessments 结构，可直接用原生报告组件查看。
 *
 * 用法：analyzeImportedWorkbook(file, { region, onProgress }) => { assessments, detectedRegion, done, failed }
 */

// sheet 名匹配（导出时 sheet 名 = 中文 label，批量可能带 _2 后缀）
const SHEET_MATCH = {
  gait: ['行走步态', '步态'],
  standing: ['静态站立', '站立'],
  grip: ['握力'],
  sitstand: ['起坐'],
};

const TYPE_LABEL = { gait: '行走步态', standing: '静态站立', grip: '握力', sitstand: '起坐能力' };
const TYPE_ORDER = ['gait', 'standing', 'grip', 'sitstand'];

function findSheetName(wb, keys) {
  for (const name of wb.SheetNames) {
    if (keys.some(k => name.includes(k))) return name;
  }
  return null;
}

function parseArr(v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v;
  try {
    const a = JSON.parse(String(v));
    return Array.isArray(a) ? a : null;
  } catch {
    return null;
  }
}

// 某列 -> 帧数组列表（无法解析的置为空帧 []）
function colFrames(rows, col) {
  return rows.map(r => {
    const a = parseArr(r[col]);
    return Array.isArray(a) ? a : [];
  });
}

// 把不等长/空帧统一到众数长度（空帧补零），便于后端 np.array
function toUniform(frames) {
  const lens = frames.filter(f => f && f.length).map(f => f.length);
  if (!lens.length) return frames;
  const cnt = {};
  let best = lens[0], bestC = 0;
  for (const l of lens) {
    cnt[l] = (cnt[l] || 0) + 1;
    if (cnt[l] > bestC) { bestC = cnt[l]; best = l; }
  }
  const L = best;
  return frames.map(f => {
    if (!f || !f.length) return new Array(L).fill(0);
    if (f.length === L) return f;
    if (f.length > L) return f.slice(0, L);
    return f.concat(new Array(L - f.length).fill(0));
  });
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

// 毫秒 -> 'YYYY/MM/DD HH:MM:SS:fff'（与采集/算法解析格式一致）
function fmtTime(ms) {
  const d = new Date(Number(ms));
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(d.getMilliseconds(), 3)}`;
}

function colTimes(rows) {
  return rows.map(r => {
    const t = r.timestamp;
    if (t == null || t === '') return '';
    if (typeof t === 'number' || /^\d+$/.test(String(t).trim())) return fmtTime(t);
    return String(t); // 已是日期字符串则原样传
  });
}

// 某列是否含有效帧数据
function colHasData(rows, col) {
  return rows.some(r => {
    const a = parseArr(r[col]);
    return Array.isArray(a) && a.some(v => Number(v) > 0);
  });
}

// 读某 sheet 为对象数组（首行作表头）
function readSheetRows(wb, type) {
  const name = findSheetName(wb, SHEET_MATCH[type]);
  if (!name) return null;
  const sheet = wb.Sheets[name];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.length ? rows : null;
}

/**
 * 自动判断线序：站立/起坐用的那块脚垫，北京=foot4，广州=foot1。
 * 看站立(优先)或起坐 sheet 里哪个 foot 列有数据。
 */
function detectRegion(wb) {
  for (const type of ['standing', 'sitstand']) {
    const rows = readSheetRows(wb, type);
    if (!rows) continue;
    const has4 = colHasData(rows, 'foot4_data');
    const has1 = colHasData(rows, 'foot1_data');
    if (has4 && !has1) return 'beijing';
    if (has1 && !has4) return 'guangzhou';
  }
  return 'guangzhou';
}

// 从文件读 workbook
async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: 'array' });
}

// 仅预览：解析文件，返回检测到的线序与包含的项目（不生成报告）
export async function previewImportedWorkbook(file) {
  const wb = await readWorkbook(file);
  const present = TYPE_ORDER.filter(t => readSheetRows(wb, t));
  return { detectedRegion: detectRegion(wb), present };
}

/**
 * 主流程：解析 + 逐项重建 + 调后端生成 render_data + 组装 assessments
 * @param {File} file
 * @param {object} opts - { region:'beijing'|'guangzhou', username, onProgress(({type,label,index,total,status})) }
 */
export async function analyzeImportedWorkbook(file, opts = {}) {
  const wb = await readWorkbook(file);
  const detectedRegion = detectRegion(wb);
  const region = opts.region || detectedRegion;
  const username = opts.username || '';
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  // 北京线序脚垫 foot4，广州 foot1
  const footCol = region === 'beijing' ? 'foot4_data' : 'foot1_data';
  const footColAlt = region === 'beijing' ? 'foot1_data' : 'foot4_data';

  // 决定该项脚垫用哪列：优先线序列，若线序列无数据而另一列有则回退
  const pickFootCol = (rows) => (colHasData(rows, footCol) || !colHasData(rows, footColAlt)) ? footCol : footColAlt;

  const present = TYPE_ORDER.filter(t => readSheetRows(wb, t));
  const assessments = {};
  const done = [];
  const failed = [];
  let index = 0;

  for (const type of present) {
    index += 1;
    const label = TYPE_LABEL[type];
    onProgress({ type, label, index, total: present.length, status: 'running' });
    try {
      const rows = readSheetRows(wb, type);
      let params = null;
      if (type === 'gait') {
        const ts = colTimes(rows);
        const board_data = [1, 2, 3, 4].map(i => rows.map(r => String(r[`foot${i}_data`] ?? '[]')));
        params = { type: 'gait', board_data, board_times: [ts, ts, ts, ts] };
      } else if (type === 'standing') {
        const col = pickFootCol(rows);
        params = { type: 'standing', region, data_array: toUniform(colFrames(rows, col)), fps: 42, threshold_ratio: 0.8 };
      } else if (type === 'sitstand') {
        const col = pickFootCol(rows);
        const ts = colTimes(rows);
        params = {
          type: 'sitstand',
          stand_data: toUniform(colFrames(rows, col)),
          sit_data: toUniform(colFrames(rows, 'sit_data')),
          stand_times: ts, sit_times: ts, username,
        };
      } else if (type === 'grip') {
        const ts = colTimes(rows);
        const leftArr = colFrames(rows, 'HL_data');
        const rightArr = colFrames(rows, 'HR_data');
        params = { type: 'grip', leftArr, leftTimes: ts, rightArr, rightTimes: ts };
      }

      const resp = await backendBridge.generateReportFromRaw(params);
      const renderData = (resp?.code === 0) ? resp?.data?.render_data : null;
      const ok = renderData && (type !== 'grip' || renderData.left || renderData.right);
      if (!ok) {
        failed.push(`${label}(${resp?.msg || '生成失败'})`);
        onProgress({ type, label, index, total: present.length, status: 'failed' });
        continue;
      }
      if (type === 'grip' && !renderData.activeHand) {
        renderData.activeHand = renderData.left ? 'left' : 'right'; // 与原生 getHandPdf 一致
      }
      assessments[type] = { completed: true, report: { completed: true, reportData: renderData }, assessmentId: null };
      done.push(label);
      onProgress({ type, label, index, total: present.length, status: 'done' });
    } catch (e) {
      console.error(`[importAnalysis] ${type} 失败:`, e);
      failed.push(`${TYPE_LABEL[type]}(${e?.message || '异常'})`);
      onProgress({ type, label, index, total: present.length, status: 'failed' });
    }
  }

  return { assessments, detectedRegion, region, done, failed, present };
}
