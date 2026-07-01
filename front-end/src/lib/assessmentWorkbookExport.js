import * as XLSX from 'xlsx';

const ASSESSMENT_EXPORTS = [
  { key: 'grip', label: '握力评估', sampleType: '1' },
  { key: 'sitstand', label: '起坐能力评估', sampleType: '3' },
  { key: 'standing', label: '静态站立评估', sampleType: '4' },
  { key: 'gait', label: '行走步态评估', sampleType: '5' },
];

function splitAssessmentIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function sanitizeFileName(value) {
  return String(value || '未知')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 80);
}

async function fetchCsvText(backendBridge, fileName) {
  const response = await fetch(backendBridge.getCsvDownloadUrl(fileName));
  if (!response.ok) {
    throw new Error(`下载 ${fileName} 失败: ${response.status}`);
  }
  return response.text();
}

function csvTextToSheet(csvText) {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const workbook = XLSX.read(cleanText, { type: 'string', raw: true });
  const firstSheetName = workbook.SheetNames[0];
  return workbook.Sheets[firstSheetName] || XLSX.utils.aoa_to_sheet([]);
}

function sanitizeSheetName(value) {
  return String(value || 'Sheet')
    .replace(/[\[\]:*?/\\]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 31) || 'Sheet';
}

function makeUniqueSheetName(baseName, usedNames) {
  const cleanBase = sanitizeSheetName(baseName);
  let name = cleanBase;
  let index = 2;
  while (usedNames.has(name)) {
    const suffix = `_${index}`;
    name = `${cleanBase.substring(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  usedNames.add(name);
  return name;
}

function makeUniqueFileName(baseName, usedNames) {
  const safeBase = sanitizeFileName(baseName).replace(/\.xlsx$/i, '') || '评估数据';
  let fileName = `${safeBase}.xlsx`;
  let index = 2;
  while (usedNames.has(fileName)) {
    fileName = `${safeBase}_${index}.xlsx`;
    index += 1;
  }
  usedNames.add(fileName);
  return fileName;
}

function getElectronExportApi() {
  if (typeof window === 'undefined') return null;
  const api = window.electronAPI;
  if (!api?.selectExportDirectory || !api?.writeExportFile) return null;
  return api;
}

async function saveWorkbookToDirectory(workbook, directoryPath, fileName) {
  const api = getElectronExportApi();
  if (!api) {
    throw new Error('当前环境不支持选择文件夹批量导出，请在桌面应用中使用');
  }
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const result = await api.writeExportFile({ directoryPath, fileName, data });
  return result?.path || fileName;
}

async function appendRecordSheets(workbook, record, backendBridge, { usedNames = new Set() } = {}) {
  if (!record) {
    throw new Error('未找到历史记录');
  }

  const skipped = [];
  let exported = 0;

  for (const config of ASSESSMENT_EXPORTS) {
    const assessment = record.assessments?.[config.key];
    const ids = splitAssessmentIds(assessment?.assessmentId);
    if (!ids.length) {
      skipped.push(config.label);
      continue;
    }

    const params = ids.length > 1
      ? { assessmentIds: ids, sampleType: config.sampleType }
      : { assessmentId: ids[0], sampleType: config.sampleType };

    const result = await backendBridge.exportCsv(params);
    if (result?.code !== 0 || !result?.data?.fileName) {
      skipped.push(`${config.label}(${result?.msg || '导出失败'})`);
      continue;
    }

    const csvText = await fetchCsvText(backendBridge, result.data.fileName);
    const sheet = csvTextToSheet(csvText);
    const sheetName = makeUniqueSheetName(config.label, usedNames);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    exported += 1;
  }

  return { exported, skipped };
}

export async function exportAssessmentWorkbook(record, backendBridge) {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const { exported, skipped } = await appendRecordSheets(workbook, record, backendBridge, { usedNames });

  if (!exported) {
    throw new Error('该记录没有可导出的采集数据');
  }

  const patientName = sanitizeFileName(record.patientName);
  const date = sanitizeFileName(record.dateStr || new Date().toISOString().slice(0, 10));
  XLSX.writeFile(workbook, `${patientName}_${date}_四项评估数据.xlsx`);

  return { exported, skipped };
}

export async function exportAssessmentBatchWorkbook(records, backendBridge, options = {}) {
  const validRecords = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!validRecords.length) {
    throw new Error('请先选择要导出的历史记录');
  }
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const api = getElectronExportApi();
  if (!api) {
    throw new Error('当前环境不支持选择文件夹批量导出，请在桌面应用中使用');
  }

  onProgress({ current: 0, total: validRecords.length, message: '请选择导出文件夹', status: 'selecting' });
  const directoryResult = await api.selectExportDirectory();
  if (directoryResult?.canceled || !directoryResult?.path) {
    onProgress({ current: 0, total: validRecords.length, message: '已取消导出', status: 'canceled' });
    return { canceled: true, exported: 0, skipped: [], records: validRecords.length, exportedRecords: 0, directoryPath: '' };
  }

  const directoryPath = directoryResult.path;
  const usedFileNames = new Set();
  const skipped = [];
  const files = [];
  let exported = 0;
  let exportedRecords = 0;

  for (let i = 0; i < validRecords.length; i += 1) {
    const record = validRecords[i];
    const patientName = sanitizeFileName(record.patientName);
    const date = sanitizeFileName(record.dateStr || new Date().toISOString().slice(0, 10));
    const workbook = XLSX.utils.book_new();
    const usedNames = new Set();

    onProgress({
      current: i,
      total: validRecords.length,
      message: `正在导出 ${record.patientName || '未知'} (${i + 1}/${validRecords.length})`,
      status: 'exporting',
      record,
    });

    const result = await appendRecordSheets(workbook, record, backendBridge, { usedNames });
    exported += result.exported;

    if (result.exported > 0) {
      const idPart = sanitizeFileName(record.patientId || record.id || String(i + 1));
      const fileName = makeUniqueFileName(`${patientName}_${date}_${idPart}_四项评估数据`, usedFileNames);
      const filePath = await saveWorkbookToDirectory(workbook, directoryPath, fileName);
      files.push(filePath);
      exportedRecords += 1;
    }

    if (result.skipped.length) {
      skipped.push(`${record.patientName || '未知'}：${result.skipped.join('、')}`);
    }

    onProgress({
      current: i + 1,
      total: validRecords.length,
      message: `已完成 ${record.patientName || '未知'} (${i + 1}/${validRecords.length})`,
      status: 'exporting',
      record,
    });
  }

  if (!exported) {
    throw new Error('所选记录没有可导出的采集数据');
  }

  onProgress({ current: validRecords.length, total: validRecords.length, message: '批量导出完成', status: 'done' });
  return { exported, skipped, records: validRecords.length, exportedRecords, directoryPath, files };
}
