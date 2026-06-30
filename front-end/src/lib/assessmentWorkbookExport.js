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

export async function exportAssessmentWorkbook(record, backendBridge) {
  if (!record) {
    throw new Error('未找到历史记录');
  }

  const workbook = XLSX.utils.book_new();
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
    XLSX.utils.book_append_sheet(workbook, sheet, config.label.substring(0, 31));
    exported += 1;
  }

  if (!exported) {
    throw new Error('该记录没有可导出的采集数据');
  }

  const patientName = sanitizeFileName(record.patientName);
  const date = sanitizeFileName(record.dateStr || new Date().toISOString().slice(0, 10));
  XLSX.writeFile(workbook, `${patientName}_${date}_四项评估数据.xlsx`);

  return { exported, skipped };
}
