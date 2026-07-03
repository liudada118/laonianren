/**
 * 历史记录服务 - 基于 localStorage 持久化存储
 * 管理评估记录的增删改查
 */

const STORAGE_KEY = 'sarcopenia_assessment_history';

/**
 * 获取所有历史记录
 */
/**
 * 按 patientId 合并记录：同一编号的多次评估汇总成一条（ID 唯一）。
 * 保留最早一条的基本信息与日期，合并各项 completed 的评估；无 ID 的记录保持独立。
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

export function getHistory() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const raw = data ? JSON.parse(data) : [];
    const merged = mergeByPatientId(raw);
    // 合并后条数减少则写回，清理历史遗留的同 ID 多条记录
    if (merged.length !== raw.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch (e) {
    console.error('读取历史记录失败:', e);
    return [];
  }
}

/**
 * 根据 ID 获取单条记录
 * @param {string} id - 记录 ID
 * @returns {Object|null}
 */
export async function getRecord(id) {
  const history = getHistory();
  return history.find(r => r.id === id) || null;
}

/**
 * 保存一条评估记录
 * @param {Object} record - 评估记录
 * @param {string} record.patientName - 患者姓名
 * @param {string} record.patientGender - 患者性别
 * @param {number} record.patientAge - 患者年龄
 * @param {number} record.patientWeight - 患者体重
 * @param {string} record.assessmentType - 评估类型 (grip|sitstand|standing|gait)
 * @param {Object} record.reportData - 报告数据
 * @param {string} record.institution - 机构名称
 */
export function saveRecord(record) {
  try {
    const history = getHistory();
    const newRecord = {
      id: generateId(),
      ...record,
      date: new Date().toISOString(),
      dateStr: formatDate(new Date()),
    };
    history.unshift(newRecord); // 最新的在前面

    // 最多保存500条记录
    if (history.length > 500) {
      history.length = 500;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return newRecord;
  } catch (e) {
    console.error('保存历史记录失败:', e);
    return null;
  }
}

/**
 * 保存一次完整评估（可能包含多个评估类型）
 * 按患者+日期分组
 */
export function saveAssessmentSession(patientInfo, institution, assessments, sessionId) {
  try {
    const history = getHistory();
    const now = new Date();
    const dateStr = formatDate(now);

    // 优先按 patientId 合并：ID 唯一，同一人的多次评估（含不同会话）汇总成一条。
    // 无 ID 时回退按 sessionId（同一次会话内多次完成更新同一条）。
    const pid = patientInfo.id || '';
    let existingIdx = pid
      ? history.findIndex(r => String(r.patientId || '') === String(pid))
      : (sessionId ? history.findIndex(r => r.sessionId === sessionId) : -1);

    if (existingIdx >= 0) {
      // 更新已有记录
      const existing = history[existingIdx];
      for (const [type, data] of Object.entries(assessments)) {
        if (data.completed) {
          existing.assessments[type] = {
            completed: true,
            report: data.report,
            assessmentId: data.assessmentId || existing.assessments?.[type]?.assessmentId || null,
            completedAt: now.toISOString(),
          };
        }
      }
      existing.updatedAt = now.toISOString();
      history[existingIdx] = existing;
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
      history.unshift(newRecord);
    }

    // 最多保存2000条记录（街道大规模采集）
    if (history.length > 2000) {
      history.length = 2000;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch (e) {
    console.error('保存评估记录失败:', e);
    return false;
  }
}

/**
 * 删除一条记录
 */
export function deleteRecord(id) {
  try {
    const history = getHistory();
    const filtered = history.filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
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
  let records = getHistory();

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
 * 清空所有历史记录
 */
export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 补全/更新某条历史记录中某评估项的报告（用已存原始数据重新生成后写回）。
 * @param {string} recordId 记录 id
 * @param {string} type gait|standing|grip|sitstand
 * @param {Object} reportObj 形如 { completed:true, reportData:<render_data> }
 * @returns {Object|null} 更新后的记录
 */
export function updateRecordReport(recordId, type, reportObj) {
  try {
    const history = getHistory();
    const idx = history.findIndex(r => r.id === recordId);
    if (idx < 0) return null;
    const record = history[idx];
    record.assessments = record.assessments || {};
    record.assessments[type] = {
      ...(record.assessments[type] || {}),
      completed: true,
      report: reportObj,
    };
    record.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return record;
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
