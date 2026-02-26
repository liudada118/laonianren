/**
 * 历史记录服务 - 基于 localStorage 持久化存储
 * 管理评估记录的增删改查
 */

const STORAGE_KEY = 'sarcopenia_assessment_history';

/**
 * 获取所有历史记录
 */
export function getHistory() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('读取历史记录失败:', e);
    return [];
  }
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
export function saveAssessmentSession(patientInfo, institution, assessments) {
  try {
    const history = getHistory();
    const now = new Date();
    const dateStr = formatDate(now);

    // 查找今天同一患者的记录
    let existingIdx = history.findIndex(
      r => r.patientName === patientInfo.name && r.dateStr === dateStr
    );

    if (existingIdx >= 0) {
      // 更新已有记录
      const existing = history[existingIdx];
      for (const [type, data] of Object.entries(assessments)) {
        if (data.completed) {
          existing.assessments[type] = {
            completed: true,
            report: data.report,
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
          completedAt: data.completed ? now.toISOString() : null,
        };
      }

      const newRecord = {
        id: generateId(),
        patientName: patientInfo.name,
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

    // 最多保存200条记录
    if (history.length > 200) {
      history.length = 200;
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
export function searchHistory({ keyword, date, page = 1, pageSize = 10 }) {
  let records = getHistory();

  if (keyword) {
    records = records.filter(r =>
      r.patientName?.includes(keyword) ||
      r.institution?.includes(keyword)
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
};
