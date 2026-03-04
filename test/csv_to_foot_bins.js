/**
 * 从步态CSV中提取4路脚垫数据，生成独立的二进制数据文件
 * 
 * CSV中每行包含 foot1_data~foot4_data，每个是4096个整数值的数组
 * 转换为串口帧格式：每帧4096字节 + 分隔符 AA 55 03 99
 */
const fs = require('fs');
const path = require('path');

const DELIMITER = Buffer.from([0xAA, 0x55, 0x03, 0x99]);

// 步态CSV文件路径
const GAIT_CSV = path.join(__dirname, '..', 'upload_data', 'gait.csv');
// 站立CSV文件路径（备选）
const STANDING_CSV = path.join(__dirname, '..', 'upload_data', 'standing.csv');

// 输出目录
const OUTPUT_DIR = path.join(__dirname, '..', 'upload_data');

/**
 * 解析CSV文件，提取foot1-foot4的data列
 * CSV格式特殊：foot_data列的值是被引号包裹的JSON数组字符串
 */
function parseFootCSV(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  
  // 解析表头（处理BOM）
  const headerLine = lines[0].replace(/^\ufeff/, '');
  
  // 由于foot_data列包含逗号（在引号内），需要特殊解析
  const result = { foot1: [], foot2: [], foot3: [], foot4: [] };
  
  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (!line) continue;
    
    // 使用状态机解析CSV行（处理引号内的逗号）
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
    
    // 根据表头找到foot_data列的索引
    // 表头: timestamp,date,assessment_id,sample_type,
    //   foot1_pressure(4),foot1_area(5),foot1_max(6),foot1_min(7),foot1_avg(8),foot1_data(9),
    //   foot2_pressure(10),foot2_area(11),foot2_max(12),foot2_min(13),foot2_avg(14),foot2_data(15),
    //   foot3_pressure(16),foot3_area(17),foot3_max(18),foot3_min(19),foot3_avg(20),foot3_data(21),
    //   foot4_pressure(22),foot4_area(23),foot4_max(24),foot4_min(25),foot4_avg(26),foot4_data(27)
    
    const footDataIndices = { foot1: 9, foot2: 15, foot3: 21, foot4: 27 };
    
    for (const [footName, idx] of Object.entries(footDataIndices)) {
      if (idx < fields.length) {
        let dataStr = fields[idx].trim();
        // 移除外层引号和方括号
        dataStr = dataStr.replace(/^["'\s]+|["'\s]+$/g, '');
        if (dataStr.startsWith('[')) dataStr = dataStr.slice(1);
        if (dataStr.endsWith(']')) dataStr = dataStr.slice(0, -1);
        
        const values = dataStr.split(',').map(v => {
          const num = parseInt(v.trim(), 10);
          return isNaN(num) ? 0 : Math.max(0, Math.min(255, num));
        });
        
        if (values.length === 4096) {
          result[footName].push(values);
        } else {
          console.warn(`行${lineIdx}: ${footName} 数据长度=${values.length}，跳过`);
        }
      }
    }
  }
  
  return result;
}

/**
 * 将数值数组转换为二进制帧文件
 * 格式：[4096字节数据][AA 55 03 99分隔符] 循环
 */
function writeFootBin(footData, outputPath) {
  const buffers = [];
  
  for (const frame of footData) {
    const frameBuf = Buffer.alloc(4096);
    for (let i = 0; i < 4096; i++) {
      frameBuf[i] = frame[i] || 0;
    }
    buffers.push(frameBuf);
    buffers.push(DELIMITER);
  }
  
  const combined = Buffer.concat(buffers);
  
  // 写为hex文本格式（与现有foot.bin格式一致）
  const hexParts = [];
  for (let i = 0; i < combined.length; i++) {
    hexParts.push(combined[i].toString(16).padStart(2, '0').toUpperCase());
  }
  
  fs.writeFileSync(outputPath, hexParts.join(' '), 'utf-8');
  console.log(`写入 ${outputPath}: ${footData.length} 帧, ${combined.length} 字节`);
}

// 主流程
function main() {
  // 首先复制用户上传的CSV到upload_data目录
  const uploadDir = '/home/ubuntu/upload';
  const gaitSrc = fs.readdirSync(uploadDir).find(f => f.includes('gait'));
  const standingSrc = fs.readdirSync(uploadDir).find(f => f.includes('standing'));
  
  if (gaitSrc) {
    fs.copyFileSync(path.join(uploadDir, gaitSrc), GAIT_CSV);
    console.log(`复制步态CSV: ${gaitSrc} -> gait.csv`);
  }
  if (standingSrc) {
    fs.copyFileSync(path.join(uploadDir, standingSrc), STANDING_CSV);
    console.log(`复制站立CSV: ${standingSrc} -> standing.csv`);
  }
  
  // 解析步态CSV（用于步态评估的4路脚垫数据）
  console.log('\n=== 解析步态CSV ===');
  const gaitData = parseFootCSV(GAIT_CSV);
  console.log(`foot1: ${gaitData.foot1.length} 帧`);
  console.log(`foot2: ${gaitData.foot2.length} 帧`);
  console.log(`foot3: ${gaitData.foot3.length} 帧`);
  console.log(`foot4: ${gaitData.foot4.length} 帧`);
  
  // 生成4个独立的bin文件
  writeFootBin(gaitData.foot1, path.join(OUTPUT_DIR, 'foot1.bin'));
  writeFootBin(gaitData.foot2, path.join(OUTPUT_DIR, 'foot2.bin'));
  writeFootBin(gaitData.foot3, path.join(OUTPUT_DIR, 'foot3.bin'));
  writeFootBin(gaitData.foot4, path.join(OUTPUT_DIR, 'foot4.bin'));
  
  // 也解析站立CSV（用于站立评估）
  console.log('\n=== 解析站立CSV ===');
  const standingData = parseFootCSV(STANDING_CSV);
  console.log(`foot1: ${standingData.foot1.length} 帧`);
  console.log(`foot2: ${standingData.foot2.length} 帧`);
  console.log(`foot3: ${standingData.foot3.length} 帧`);
  console.log(`foot4: ${standingData.foot4.length} 帧`);
  
  // 站立数据也保存（可选，测试中可以用步态数据代替）
  writeFootBin(standingData.foot1, path.join(OUTPUT_DIR, 'foot1_standing.bin'));
  writeFootBin(standingData.foot2, path.join(OUTPUT_DIR, 'foot2_standing.bin'));
  writeFootBin(standingData.foot3, path.join(OUTPUT_DIR, 'foot3_standing.bin'));
  writeFootBin(standingData.foot4, path.join(OUTPUT_DIR, 'foot4_standing.bin'));
  
  console.log('\n完成！所有脚垫数据文件已生成到', OUTPUT_DIR);
}

main();
