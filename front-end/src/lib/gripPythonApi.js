/**
 * Python 后端 API 调用模块
 * 开发模式：通过 Vite proxy /pyapi -> http://127.0.0.1:8765
 */

const PYTHON_API_BASE = '/pyapi';

/**
 * 检查 Python 后端是否可用
 */
export async function checkPythonBackend() {
  try {
    const res = await fetch(`${PYTHON_API_BASE}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * 调用 Python 后端分析握力 CSV 数据
 */
export async function analyzeGripCSV(csvContent, handType) {
  const res = await fetch(`${PYTHON_API_BASE}/analyze-grip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      csv_content: csvContent,
      hand_type: handType,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}

/**
 * 调用 Python 后端分析起坐 CSV 数据（文件上传方式，支持大文件）
 * @param {string} standCsv - 脚垫 CSV 文本
 * @param {string} sitCsv - 坐垫 CSV 文本
 */
export async function analyzeSitStandCSV(standCsv, sitCsv, username) {
  const form = new FormData();
  form.append('stand_file', new Blob([standCsv], { type: 'text/csv' }), 'stand.csv');
  form.append('sit_file', new Blob([sitCsv], { type: 'text/csv' }), 'sit.csv');
  form.append('username', username || '用户');

  const res = await fetch(`${PYTHON_API_BASE}/analyze-sitstand`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}

/**
 * 调用 Python 后端生成起坐动态视频（文件上传方式）
 * @param {string} standCsv - 脚垫 CSV 文本
 * @param {string} sitCsv - 坐垫 CSV 文本
 */
/**
 * 调用 Python 后端分析静态站立 CSV 数据（文件上传方式，支持大文件）
 * @param {string} csvContent - CSV 文件文本内容
 * @param {number} fps - 采样率，默认 42
 * @param {number} thresholdRatio - 阈值比例，默认 0.8
 */
export async function analyzeStandingCSV(csvContent, fps = 42, thresholdRatio = 0.8) {
  const form = new FormData();
  form.append('csv_file', new Blob([csvContent], { type: 'text/csv' }), 'standing.csv');
  form.append('fps', String(fps));
  form.append('threshold_ratio', String(thresholdRatio));

  const res = await fetch(`${PYTHON_API_BASE}/analyze-standing`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}

export async function generateSitStandVideo(standCsv, sitCsv) {
  const form = new FormData();
  form.append('stand_file', new Blob([standCsv], { type: 'text/csv' }), 'stand.csv');
  form.append('sit_file', new Blob([sitCsv], { type: 'text/csv' }), 'sit.csv');

  const res = await fetch(`${PYTHON_API_BASE}/generate-sitstand-video`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}

/**
 * 调用 Python 后端分析步态 CSV 数据（4个传感器文件上传）
 * @param {string[]} csvContents - 4 个 CSV 文件文本内容数组 (对应 1.csv ~ 4.csv)
 */
export async function analyzeGaitCSV(csvContents) {
  const form = new FormData();
  csvContents.forEach((csv, i) => {
    form.append(`file${i + 1}`, new Blob([csv], { type: 'text/csv' }), `${i + 1}.csv`);
  });

  const res = await fetch(`${PYTHON_API_BASE}/analyze-gait`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}
