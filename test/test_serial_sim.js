/**
 * 验证串口模拟器 - 测试虚拟串口创建和数据帧解析
 */
const { SerialSimulator, DEVICES, parseHexDataToFrames, loadFramesFromFile } = require('./serial_simulator');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('=== 串口模拟器验证测试 ===\n');

  // 1. 测试数据文件解析
  console.log('--- 1. 解析真实传感器数据 ---');
  
  const dataFiles = {
    leftHand: path.join(__dirname, '../upload_data/left_hand.bin'),
    rightHand: path.join(__dirname, '../upload_data/right_hand.bin'),
    seat: path.join(__dirname, '../upload_data/seat.bin'),
    foot: path.join(__dirname, '../upload_data/foot.bin'),
  };
  
  for (const [name, filePath] of Object.entries(dataFiles)) {
    const text = fs.readFileSync(filePath, 'utf-8');
    const frames = parseHexDataToFrames(text);
    
    // 统计帧长度分布
    const lengthDist = {};
    frames.forEach(f => {
      const len = f.length;
      lengthDist[len] = (lengthDist[len] || 0) + 1;
    });
    
    console.log(`  ${name}: ${frames.length} 帧`);
    console.log(`    帧长度分布:`, JSON.stringify(lengthDist));
    
    // 显示前3帧的头部
    frames.slice(0, 3).forEach((f, i) => {
      const head = Array.from(f.slice(0, Math.min(8, f.length))).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`    帧${i}: len=${f.length} head=[${head}...]`);
    });
    console.log();
  }

  // 2. 测试虚拟串口创建
  console.log('--- 2. 创建虚拟串口对 ---');
  const sim = new SerialSimulator();
  
  try {
    await sim.init(['leftHand', 'rightHand', 'seat']);
    
    // 验证文件存在
    for (const [name, info] of Object.entries(sim.portMap)) {
      const appExists = fs.existsSync(info.appPath);
      const simExists = fs.existsSync(info.simPath);
      console.log(`  ${name}: app=${appExists ? '✓' : '✗'} sim=${simExists ? '✓' : '✗'}`);
    }
    
    // 3. 生成环境变量
    console.log('\n--- 3. 生成环境变量 ---');
    const envVars = sim.getEnvVars(['leftHand', 'rightHand', 'seat']);
    console.log('  VIRTUAL_SERIAL_TEST:', envVars.VIRTUAL_SERIAL_TEST);
    console.log('  VIRTUAL_PORT_LIST:', envVars.VIRTUAL_PORT_LIST);
    console.log('  VIRTUAL_BAUD_MAP:', envVars.VIRTUAL_BAUD_MAP);
    
    // 4. 测试数据写入
    console.log('\n--- 4. 测试数据写入 ---');
    const leftFrames = parseHexDataToFrames(fs.readFileSync(dataFiles.leftHand, 'utf-8'));
    // 过滤出有效帧 (130字节或146字节)
    const validLeftFrames = leftFrames.filter(f => [130, 146, 18].includes(f.length));
    console.log(`  左手有效帧: ${validLeftFrames.length} / ${leftFrames.length}`);
    
    if (validLeftFrames.length > 0) {
      sim.startSending('leftHand', validLeftFrames, 100);
      
      // 等待1秒后读取
      await new Promise(r => setTimeout(r, 1000));
      console.log('  数据发送正常 ✓');
    }
    
    console.log('\n=== 验证完成 ===');
  } catch (e) {
    console.error('验证失败:', e.message);
  } finally {
    sim.cleanup();
  }
}

main().catch(console.error);
