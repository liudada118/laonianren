
/**
 * 串口设备配置
 * 
 * 设备类型（共7种）：
 *   - HL（左手手套）、HR（右手手套）：波特率 921600，130/146 字节帧，帧内类型位区分左右
 *   - sit（起坐垫）：波特率 1000000，1024 字节帧
 *   - foot1~foot4（脚垫）：波特率 3000000，4096 字节帧，AT指令获取MAC地址区分编号
 * 
 * 识别流程：
 *   1. 枚举所有串口
 *   2. 对每个串口依次尝试候选波特率 [921600, 1000000, 3000000]
 *   3. 双重验证：先检测分隔符 AA 55 03 99，再验证帧长度是否匹配该波特率对应的设备类型
 *   4. 根据探测到的波特率确定设备大类
 *   5. 手套通过帧内类型位（1=HL, 2=HR）细分；脚垫通过 AT 指令获取 MAC 地址查映射表细分
 */

// 波特率 → 设备大类映射
const BAUD_DEVICE_MAP = {
  921600: 'hand',    // 手套（HL/HR 由帧内类型位区分）
  1000000: 'sit',    // 起坐垫
  3000000: 'foot',   // 脚垫（foot1-4 由 MAC 地址区分）
}

const constantObj = {
  splitArr: [0xaa, 0x55, 0x03, 0x99],
  order: {
    1: 'last',
    2: 'next'
  },
  type: {
    1: 'HL',
    2: 'HR',
  },
  backendAddress: 'https://sensor.bodyta.com',
  BAUD_DEVICE_MAP,
}

module.exports = constantObj
