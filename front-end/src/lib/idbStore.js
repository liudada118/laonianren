/**
 * idbStore - 历史记录的 IndexedDB 存储（零依赖，现场离线可用）
 *
 * 背景：报告(含大量 base64 图片)原本全塞进 localStorage，每 origin 约 100MB 上限，
 * 采集几十人即爆 QuotaExceededError 导致报告存不进去。改为：
 *   - 旧数据留在 localStorage(只读，不再写)
 *   - 新数据/更新一律写这里(IndexedDB，GB 级配额)
 * historyService.getHistory() 读取时合并两源，IndexedDB 按 id 优先。
 *
 * 删除采用 tombstone(墓碑标记 {id,_deleted:true})：因为源自 localStorage 的旧记录
 * 无法从 localStorage 删(只读模型)，用墓碑让 getHistory 合并时把该 id 剔除。
 */

const DB_NAME = 'sarcopenia';
const STORE = 'history';
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error || new Error('打开 IndexedDB 失败'));
  });
  return _dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** 取出 IndexedDB 里的全部记录（含 tombstone 墓碑，交由调用方过滤） */
export async function idbGetAll() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = tx(db, 'readonly').getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[idbStore] idbGetAll 失败，返回空:', e?.message || e);
    return [];
  }
}

/** 写入/覆盖一条记录（keyPath=id） */
export async function idbPut(record) {
  if (!record || !record.id) throw new Error('idbPut: 记录缺少 id');
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').put(record);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/** 删除：写墓碑标记（让 getHistory 合并时把该 id 从两源结果中剔除） */
export async function idbDelete(id, updatedAt) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').put({ id, _deleted: true, updatedAt: updatedAt || new Date().toISOString() });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/** 清空 IndexedDB 里的全部记录 */
export async function idbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
