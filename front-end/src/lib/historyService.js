/**
 * 历史记录服务 - 基于后端数据库持久化存储
 * 管理评估记录的增删改查
 * 
 * 所有方法均为 async，通过 BackendBridge 调用后端 API
 */

import { backendBridge } from './BackendBridge';

/**
 * 获取所有历史记录（第一页，最多500条）
 * @returns {Promise<Array>}
 */
export async function getHistory() {
  try {
    const result = await backendBridge.listHistory({ page: 1, pageSize: 500 });
    if (result.code === 0 && result.data) {
      return result.data.items || [];
    }
    return [];
  } catch (e) {
    console.error('读取历史记录失败:', e);
    return [];
  }
}

/**
 * 保存一次完整评估（可能包含多个评估类型）
 * 按患者+日期分组，后端会自动合并同一天同一患者的记录
 * @param {object} patientInfo - { name, gender, age, weight }
 * @param {string} institution - 机构名称
 * @param {object} assessments - { grip: { completed, report }, ... }
 * @returns {Promise<boolean>}
 */
export async function saveAssessmentSession(patientInfo, institution, assessments) {
  try {
    const result = await backendBridge.saveHistory({
      patientInfo,
      institution,
      assessments,
    });
    return result.code === 0;
  } catch (e) {
    console.error('保存评估记录失败:', e);
    return false;
  }
}

/**
 * 获取单条历史记录
 * @param {string} id - 记录ID
 * @returns {Promise<object|null>}
 */
export async function getRecord(id) {
  try {
    const result = await backendBridge.getHistory(id);
    if (result.code === 0 && result.data) {
      return result.data;
    }
    return null;
  } catch (e) {
    console.error('获取记录失败:', e);
    return null;
  }
}

/**
 * 删除一条记录
 * @param {string} id - 记录ID
 * @returns {Promise<boolean>}
 */
export async function deleteRecord(id) {
  try {
    const result = await backendBridge.deleteHistory(id);
    return result.code === 0;
  } catch (e) {
    console.error('删除记录失败:', e);
    return false;
  }
}

/**
 * 搜索历史记录（分页）
 * @param {object} params - { keyword, date, page, pageSize }
 * @returns {Promise<{ items: Array, total: number, totalPages: number, page: number }>}
 */
export async function searchHistory({ keyword, date, page = 1, pageSize = 10 }) {
  try {
    const result = await backendBridge.listHistory({ keyword, date, page, pageSize });
    if (result.code === 0 && result.data) {
      return result.data;
    }
    return { items: [], total: 0, totalPages: 0, page };
  } catch (e) {
    console.error('搜索历史记录失败:', e);
    return { items: [], total: 0, totalPages: 0, page };
  }
}

/**
 * 清空所有历史记录
 * @returns {Promise<boolean>}
 */
export async function clearHistory() {
  try {
    const result = await backendBridge.clearHistory();
    return result.code === 0;
  } catch (e) {
    console.error('清空历史记录失败:', e);
    return false;
  }
}

export default {
  getHistory,
  getRecord,
  saveAssessmentSession,
  deleteRecord,
  searchHistory,
  clearHistory,
};
