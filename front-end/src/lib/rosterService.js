/**
 * 名单服务 - 基于 localStorage 持久化导入的评估名单与当前进度
 * 采集状态不在此维护,而是由 deriveStatusMap 从历史记录按 patientId 实时派生。
 */

const STORAGE_KEY = 'sarcopenia_roster';
const CURRENT_KEY = 'sarcopenia_roster_current';

const ASSESSMENT_KEYS = ['grip', 'sitstand', 'standing', 'gait'];

export function getRoster() {
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    return d ? JSON.parse(d) : [];
  } catch (e) {
    console.error('读取名单失败:', e);
    return [];
  }
}

export function saveRoster(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list || []));
    return true;
  } catch (e) {
    console.error('保存名单失败:', e);
    return false;
  }
}

export function clearRoster() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CURRENT_KEY);
  } catch (e) {
    console.error('清空名单失败:', e);
  }
}

export function getCurrentId() {
  try {
    return localStorage.getItem(CURRENT_KEY) || null;
  } catch {
    return null;
  }
}

export function setCurrentId(id) {
  try {
    if (id == null || id === '') localStorage.removeItem(CURRENT_KEY);
    else localStorage.setItem(CURRENT_KEY, String(id));
  } catch (e) {
    console.error('保存当前对象失败:', e);
  }
}

/**
 * 从历史记录按 patientId 派生每个名单对象的完成项数。
 * @param {Array} roster
 * @param {Array} history - historyService.getHistory() 结果(最新在前)
 * @returns {Object} { [id]: { completed:number, total:4, types:string[] } }
 */
export function deriveStatusMap(roster, history) {
  const byId = {};
  for (const rec of history || []) {
    const pid = rec.patientId;
    if (!pid) continue;
    // history 最新在前,取首个遇到的即该 patientId 的最新一次会话
    if (!byId[pid]) byId[pid] = rec;
  }

  const map = {};
  for (const p of roster || []) {
    const rec = byId[p.id];
    const types = [];
    if (rec && rec.assessments) {
      for (const k of ASSESSMENT_KEYS) {
        if (rec.assessments[k] && rec.assessments[k].completed) types.push(k);
      }
    }
    map[p.id] = { completed: types.length, total: ASSESSMENT_KEYS.length, types };
  }
  return map;
}

export default {
  getRoster,
  saveRoster,
  clearRoster,
  getCurrentId,
  setCurrentId,
  deriveStatusMap,
};
