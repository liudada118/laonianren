/**
 * 统一CSV到串口二进制帧转换脚本
 * 
 * 从用户提供的CSV原始数据中提取所有评估类型的传感器数据，
 * 生成可供虚拟串口模拟器使用的二进制帧文件（hex文本格式）。
 * 
 * 支持的评估类型：
 *   - 握力（grip）: HL_data(256值) → 两帧130字节 [order][type][128字节]
 *   - 起坐（sitstand）: sit_data(1024值) → 1024字节帧; foot1_data(4096值) → 4096字节帧
 *   - 站立（standing）: foot1~foot4_data(各4096值) → 4096字节帧
 *   - 步态（gait）: foot1~foot4_data(各4096值) → 4096字节帧
 * 
 * 帧格式说明：
 *   - 握力帧(130字节): [order(1B)][type(1B)][data(128B)]
 *     - order: 1=前半帧(last), 2=后半帧(next)
 *     - type: 1=左手(HL), 2=右手(HR)
 *     - CSV中256值分为两帧: 前128值→order=1, 后128值→order=2
 *   - 坐垫帧(1024字节): 直接映射1024个值
 *   - 脚垫帧(4096字节): 直接映射4096个值
 *   - 所有帧之间用分隔符 AA 55 03 99 分隔
 */
const fs = require('fs');
const path = require('path');

const DELIMITER = Buffer.from([0xAA, 0x55, 0x03, 0x99]);

// CSV文件路径
const CSV_DIR = '/home/ubuntu/upload';
const OUTPUT_DIR = path.join(__dirname, '..', 'upload_data');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * 使用状态机解析CSV行（处理引号内的逗号）
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * 解析数据字段中的值数组
 */
function parseDataValues(dataStr) {
  if (!dataStr) return [];
  dataStr = dataStr.trim().replace(/^["'\s]+|["'\s]+$/g, '');
  if (dataStr.startsWith('[')) dataStr = dataStr.slice(1);
  if (dataStr.endsWith(']')) dataStr = dataStr.slice(0, -1);
  if (!dataStr.trim()) return [];
  
  return dataStr.split(',').map(v => {
    const num = parseInt(v.trim(), 10);
    return isNaN(num) ? 0 : Math.max(0, Math.min(255, num));
  });
}

/**
 * 将Buffer数组写为hex文本格式的bin文件
 * 格式与现有bin文件一致：每帧数据 + 分隔符 AA 55 03 99
 */
function writeHexBin(frames, outputPath) {
  const buffers = [];
  for (const frame of frames) {
    buffers.push(frame);
    buffers.push(DELIMITER);
  }
  
  const combined = Buffer.concat(buffers);
  const hexParts = [];
  for (let i = 0; i < combined.length; i++) {
    hexParts.push(combined[i].toString(16).padStart(2, '0').toUpperCase());
  }
  
  fs.writeFileSync(outputPath, hexParts.join(' '), 'utf-8');
  return frames.length;
}

/**
 * 解析通用CSV文件
 */
function parseCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  const headerLine = lines[0].replace(/^\ufeff/, '');
  const headers = parseCSVLine(headerLine);
  
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = fields[idx] || '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

// ═══════════════════════════════════════════════════════════════
// 1. 握力数据转换
// ═══════════════════════════════════════════════════════════════
function convertGrip(csvPath) {
  console.log('\n=== 转换握力数据 ===');
  const { rows } = parseCSV(csvPath);
  
  const leftFrames = [];
  const rightFrames = [];
  
  for (const row of rows) {
    const hlData = parseDataValues(row['HL_data']);
    const hrData = parseDataValues(row['HR_data']);
    
    if (hlData.length === 256) {
      // 前128值 → order=1(last帧), 后128值 → order=2(next帧)
      // 帧格式: [order][type][128字节数据]
      const frame1 = Buffer.alloc(130);
      frame1[0] = 1; // order = 1 (last)
      frame1[1] = 1; // type = 1 (HL/左手)
      for (let i = 0; i < 128; i++) frame1[i + 2] = hlData[i];
      
      const frame2 = Buffer.alloc(130);
      frame2[0] = 2; // order = 2 (next)
      frame2[1] = 1; // type = 1 (HL/左手)
      for (let i = 0; i < 128; i++) frame2[i + 2] = hlData[128 + i];
      
      leftFrames.push(frame1);
      leftFrames.push(frame2);
    }
    
    if (hrData.length === 256) {
      const frame1 = Buffer.alloc(130);
      frame1[0] = 1; // order = 1 (last)
      frame1[1] = 2; // type = 2 (HR/右手)
      for (let i = 0; i < 128; i++) frame1[i + 2] = hrData[i];
      
      const frame2 = Buffer.alloc(130);
      frame2[0] = 2; // order = 2 (next)
      frame2[1] = 2; // type = 2 (HR/右手)
      for (let i = 0; i < 128; i++) frame2[i + 2] = hrData[128 + i];
      
      rightFrames.push(frame1);
      rightFrames.push(frame2);
    }
  }
  
  // 左手和右手数据写入同一个串口（因为实际硬件中左右手通过同一串口传输，由type位区分）
  // 但在虚拟串口模式下，leftHand和rightHand是分开的设备
  const leftCount = writeHexBin(leftFrames, path.join(OUTPUT_DIR, 'left_hand.bin'));
  const rightCount = writeHexBin(rightFrames, path.join(OUTPUT_DIR, 'right_hand.bin'));
  
  console.log(`  左手: ${leftCount} 帧 (${leftCount / 2} 组完整256值矩阵)`);
  console.log(`  右手: ${rightCount} 帧 (${rightCount / 2} 组完整256值矩阵)`);
}

// ═══════════════════════════════════════════════════════════════
// 2. 起坐数据转换
// ═══════════════════════════════════════════════════════════════
function convertSitstand(csvPath) {
  console.log('\n=== 转换起坐数据 ===');
  const { rows } = parseCSV(csvPath);
  
  const seatFrames = [];
  const foot1Frames = [];
  
  for (const row of rows) {
    const sitData = parseDataValues(row['sit_data']);
    const foot1Data = parseDataValues(row['foot1_data']);
    
    if (sitData.length === 1024) {
      const frame = Buffer.alloc(1024);
      for (let i = 0; i < 1024; i++) frame[i] = sitData[i];
      seatFrames.push(frame);
    }
    
    if (foot1Data.length === 4096) {
      const frame = Buffer.alloc(4096);
      for (let i = 0; i < 4096; i++) frame[i] = foot1Data[i];
      foot1Frames.push(frame);
    }
  }
  
  const seatCount = writeHexBin(seatFrames, path.join(OUTPUT_DIR, 'seat.bin'));
  const foot1Count = writeHexBin(foot1Frames, path.join(OUTPUT_DIR, 'foot1_sitstand.bin'));
  
  console.log(`  坐垫: ${seatCount} 帧 (1024字节/帧)`);
  console.log(`  脚垫1(起坐): ${foot1Count} 帧 (4096字节/帧)`);
}

// ═══════════════════════════════════════════════════════════════
// 3. 站立/步态数据转换（4路脚垫）
// ═══════════════════════════════════════════════════════════════
function convertFootData(csvPath, label) {
  console.log(`\n=== 转换${label}数据 ===`);
  const { rows } = parseCSV(csvPath);
  
  const footFrames = { foot1: [], foot2: [], foot3: [], foot4: [] };
  
  for (const row of rows) {
    for (const footName of ['foot1', 'foot2', 'foot3', 'foot4']) {
      const data = parseDataValues(row[`${footName}_data`]);
      if (data.length === 4096) {
        const frame = Buffer.alloc(4096);
        for (let i = 0; i < 4096; i++) frame[i] = data[i];
        footFrames[footName].push(frame);
      }
    }
  }
  
  const suffix = label === '步态' ? '' : '_standing';
  for (const [footName, frames] of Object.entries(footFrames)) {
    const count = writeHexBin(frames, path.join(OUTPUT_DIR, `${footName}${suffix}.bin`));
    console.log(`  ${footName}: ${count} 帧 (4096字节/帧)`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════
function main() {
  console.log('CSV到串口二进制帧转换工具');
  console.log('输入目录:', CSV_DIR);
  console.log('输出目录:', OUTPUT_DIR);
  
  // 查找CSV文件
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
  console.log(`\n找到 ${files.length} 个CSV文件:`);
  
  let gripCSV, sitstandCSV, standingCSV, gaitCSV;
  
  for (const f of files) {
    if (f.includes('grip')) {
      gripCSV = path.join(CSV_DIR, f);
      console.log(`  握力: ${f}`);
    } else if (f.includes('sitstand')) {
      sitstandCSV = path.join(CSV_DIR, f);
      console.log(`  起坐: ${f}`);
    } else if (f.includes('standing')) {
      standingCSV = path.join(CSV_DIR, f);
      console.log(`  站立: ${f}`);
    } else if (f.includes('gait')) {
      gaitCSV = path.join(CSV_DIR, f);
      console.log(`  步态: ${f}`);
    }
  }
  
  // 转换各类型数据
  if (gripCSV) convertGrip(gripCSV);
  if (sitstandCSV) convertSitstand(sitstandCSV);
  if (standingCSV) convertFootData(standingCSV, '站立');
  if (gaitCSV) convertFootData(gaitCSV, '步态');
  
  // 汇总
  console.log('\n=== 转换完成 ===');
  const binFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.bin'));
  console.log(`生成 ${binFiles.length} 个bin文件:`);
  for (const f of binFiles) {
    const size = fs.statSync(path.join(OUTPUT_DIR, f)).size;
    console.log(`  ${f}: ${(size / 1024).toFixed(1)} KB`);
  }
}

main();
