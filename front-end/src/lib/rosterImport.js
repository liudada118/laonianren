/**
 * 名单 Excel 解析 - 用于街道快速数据采集导入名单
 * 依赖 SheetJS(xlsx)。支持表头别名自动识别:
 *   固定字段 编号/姓名/地点;若 Excel 还带 性别/年龄/体重 列也自动读入。
 */
import * as XLSX from 'xlsx';

// 字段 -> 可能的表头别名(标准化后做相等/包含匹配)
const HEADER_ALIASES = {
  id: ['编号', '编码', 'id', '序号', '档案号', '档案编号', '编号id'],
  name: ['姓名', '名字', '名称', '人名'],
  region: ['地点', '地区', '所属地区', '区域', '地址', '所在地'],
  gender: ['性别'],
  age: ['年龄'],
  weight: ['体重'],
};

function normalizeHeader(h) {
  return String(h == null ? '' : h)
    .trim()
    .toLowerCase()
    .replace(/[\s（）()]/g, '')
    .replace(/kg/gi, '');
}

function matchField(header) {
  const n = normalizeHeader(header);
  if (!n) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) {
      const na = normalizeHeader(a);
      if (n === na || n.includes(na)) return field;
    }
  }
  return null;
}

function toNumberOrEmpty(v) {
  if (v === '' || v == null) return '';
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : '';
}

function normalizeGender(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^(男|male|m|1)$/i.test(s)) return '男';
  if (/^(女|female|f|2)$/i.test(s)) return '女';
  return s; // 其它原样保留,弹窗里可改
}

/**
 * 解析名单文件
 * @param {File} file - 用户选择的 .xlsx/.xls 文件
 * @returns {Promise<{ list: Array, detected: Object, total: number, sheetName: string }>}
 *   list: [{ id, name, region, gender, age, weight, raw }]
 *   detected: { id: '编号', name: '姓名', ... } 实际识别到的列名
 */
export async function parseRosterFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

  if (!rows.length) return { list: [], detected: {}, total: 0, sheetName };

  // 定位表头行(首个非空行)
  let headerRowIdx = 0;
  while (
    headerRowIdx < rows.length &&
    (rows[headerRowIdx] || []).every((c) => String(c).trim() === '')
  ) {
    headerRowIdx += 1;
  }
  const headerRow = rows[headerRowIdx] || [];

  // 列索引 -> 字段
  const colMap = {};
  const detected = {};
  headerRow.forEach((h, idx) => {
    const field = matchField(h);
    if (field && !(field in detected)) {
      colMap[idx] = field;
      detected[field] = String(h).trim();
    }
  });

  const list = [];
  for (let r = headerRowIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;

    const item = { id: '', name: '', region: '', gender: '', age: '', weight: '', raw: {} };
    headerRow.forEach((h, idx) => {
      const val = row[idx] == null ? '' : String(row[idx]).trim();
      const field = colMap[idx];
      if (field) {
        item[field] = val;
      } else if (h != null && String(h).trim() !== '') {
        item.raw[String(h).trim()] = val;
      }
    });

    item.gender = normalizeGender(item.gender);
    item.age = toNumberOrEmpty(item.age);
    item.weight = toNumberOrEmpty(item.weight);

    // 至少要有姓名或编号才算有效行
    if (item.name === '' && item.id === '') continue;
    list.push(item);
  }

  return { list, detected, total: list.length, sheetName };
}

export default { parseRosterFile };
