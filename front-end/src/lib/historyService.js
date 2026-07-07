/**
 * 历史记录服务 - 双源存储
 *   - 旧数据留在 localStorage(只读，不再写)：保住历史遗留的记录不丢
 *   - 新数据/更新一律写 IndexedDB(GB 级配额)：报告(含大量 base64 图片)不再撑爆 localStorage
 * 读取时合并两源：同 id 以 IndexedDB 为准(override)，墓碑(_deleted)剔除。
 * 所有读写接口均为 async。
 */

import { idbGetAll, idbPut, idbDelete, idbClear } from './idbStore';

const STORAGE_KEY = 'sarcopenia_assessment_history';

/**
 * 按 patientId 合并记录：同一编号的多次评估汇总成一条（ID 唯一）。
 * 保留最新一条(输入需最新在前)的基本信息与日期，合并各项 completed 的评估；无 ID 的记录保持独立。
 */
function mergeByPatientId(history) {
  const result = [];
  const idxById = new Map();
  for (const r of history || []) {
    const pid = String(r.patientId || '');
    if (pid && idxById.has(pid)) {
      const target = result[idxById.get(pid)];
      target.assessments = target.assessments || {};
      for (const [t, d] of Object.entries(r.assessments || {})) {
        if (d?.completed && !target.assessments[t]?.completed) {
          target.assessments[t] = d;
        }
      }
      if (r.updatedAt && (!target.updatedAt || r.updatedAt > target.updatedAt)) target.updatedAt = r.updatedAt;
    } else {
      const copy = { ...r, assessments: { ...(r.assessments || {}) } };
      if (pid) idxById.set(pid, result.length);
      result.push(copy);
    }
  }
  return result;
}

function readLocalStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('读取 localStorage 历史失败:', e);
    return [];
  }
}

/**
 * 获取所有历史记录（合并 localStorage 只读源 + IndexedDB 读写源）
 * @returns {Promise<Array>} 最新在前
 */
export async function getHistory() {
  const rawLS = readLocalStorage();
  let idbAll = [];
  try { idbAll = await idbGetAll(); } catch (e) { idbAll = []; }

  // IndexedDB：分离墓碑与正常记录
  const deleted = new Set();
  const idbMap = new Map();
  for (const r of idbAll) {
    if (!r || !r.id) continue;
    if (r._deleted) { deleted.add(String(r.id)); continue; }
    idbMap.set(String(r.id), r);
  }

  // localStorage 打底 → IndexedDB 同 id 覆盖 → 剔除墓碑
  const byId = new Map();
  for (const r of rawLS) {
    if (!r || !r.id) continue;
    byId.set(String(r.id), r);
  }
  for (const [id, r] of idbMap) byId.set(id, r);
  for (const id of deleted) byId.delete(id);

  const list = Array.from(byId.values());
  // 最新在前：按 updatedAt||date 降序（rosterService/deriveStatusMap 依赖此序）
  list.sort((a, b) => String(b.updatedAt || b.date || '').localeCompare(String(a.updatedAt || a.date || '')));
  return mergeByPatientId(list);
}

/**
 * 根据 ID 获取单条记录
 */
export async function getRecord(id) {
  const history = await getHistory();
  return history.find(r => r.id === id) || null;
}

/**
 * 保存一条评估记录（写 IndexedDB）
 */
export async function saveRecord(record) {
  try {
    const newRecord = {
      id: generateId(),
      ...record,
      date: new Date().toISOString(),
      dateStr: formatDate(new Date()),
    };
    await idbPut(newRecord);
    return newRecord;
  } catch (e) {
    console.error('保存历史记录失败:', e);
    return null;
  }
}

/**
 * 保存一次完整评估（可能包含多个评估类型）——写 IndexedDB
 * 优先按 patientId 合并（更新已有记录，含源自 localStorage 的旧记录 → override 进 IDB）。
 */
export async function saveAssessmentSession(patientInfo, institution, assessments, sessionId) {
  try {
    const history = await getHistory();
    const now = new Date();
    const dateStr = formatDate(now);

    const pid = patientInfo.id || '';
    const existing = pid
      ? history.find(r => String(r.patientId || '') === String(pid))
      : (sessionId ? history.find(r => r.sessionId === sessionId) : null);

    if (existing) {
      // 更新已有记录（保留原 id → IDB 中按同 id 覆盖旧源）
      const updated = { ...existing, assessments: { ...(existing.assessments || {}) } };
      for (const [type, data] of Object.entries(assessments)) {
        if (data.completed) {
          updated.assessments[type] = {
            completed: true,
            report: data.report,
            assessmentId: data.assessmentId || existing.assessments?.[type]?.assessmentId || null,
            completedAt: now.toISOString(),
          };
        }
      }
      updated.updatedAt = now.toISOString();
      await idbPut(updated);
    } else {
      // 创建新记录
      const assessmentData = {};
      for (const [type, data] of Object.entries(assessments)) {
        assessmentData[type] = {
          completed: data.completed || false,
          report: data.completed ? data.report : null,
          assessmentId: data.assessmentId || null,
          completedAt: data.completed ? now.toISOString() : null,
        };
      }
      const newRecord = {
        id: generateId(),
        sessionId: sessionId || generateId(),
        patientName: patientInfo.name,
        patientId: patientInfo.id || '',
        patientRegion: patientInfo.region || '',
        patientGender: patientInfo.gender,
        patientAge: patientInfo.age,
        patientWeight: patientInfo.weight,
        institution: institution || '',
        assessments: assessmentData,
        date: now.toISOString(),
        dateStr,
        updatedAt: now.toISOString(),
      };
      await idbPut(newRecord);
    }
    return true;
  } catch (e) {
    console.error('保存评估记录失败:', e);
    return false;
  }
}

/**
 * 删除一条记录（写墓碑到 IndexedDB，合并时剔除该 id；兼容源自 localStorage 的旧记录）
 */
export async function deleteRecord(id) {
  try {
    await idbDelete(id);
    return true;
  } catch (e) {
    console.error('删除记录失败:', e);
    return false;
  }
}

/**
 * 搜索历史记录
 */
export async function searchHistory({ keyword, date, page = 1, pageSize = 10 }) {
  let records = await getHistory();

  if (keyword) {
    records = records.filter(r =>
      r.patientName?.includes(keyword) ||
      r.institution?.includes(keyword) ||
      String(r.patientId || '').includes(keyword) ||
      r.patientRegion?.includes(keyword)
    );
  }

  if (date) {
    records = records.filter(r => r.dateStr === date || r.dateStr?.includes(date));
  }

  const total = records.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const items = records.slice(start, start + pageSize);

  return { items, total, totalPages, page };
}

/**
 * 清空所有历史记录（清 IndexedDB + 清 localStorage —— 显式操作，两源都清）
 */
export async function clearHistory() {
  try { await idbClear(); } catch (e) { console.error('清空 IndexedDB 失败:', e); }
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { console.error('清空 localStorage 失败:', e); }
}

/**
 * 补全/更新某条历史记录中某评估项的报告（写 IndexedDB；源自 localStorage 的旧记录 override 进 IDB）
 * @returns {Promise<Object|null>} 更新后的记录
 */
export async function updateRecordReport(recordId, type, reportObj) {
  try {
    const history = await getHistory();
    const record = history.find(r => r.id === recordId);
    if (!record) return null;
    const updated = { ...record, assessments: { ...(record.assessments || {}) } };
    updated.assessments[type] = {
      ...(updated.assessments[type] || {}),
      completed: true,
      report: reportObj,
    };
    updated.updatedAt = new Date().toISOString();
    await idbPut(updated);
    return updated;
  } catch (e) {
    console.error('更新历史报告失败:', e);
    return null;
  }
}

// ==================== 工具函数 ====================

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

export default {
  getHistory,
  saveRecord,
  saveAssessmentSession,
  deleteRecord,
  searchHistory,
  clearHistory,
  updateRecordReport,
};
