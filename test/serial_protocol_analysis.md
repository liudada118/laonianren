# 串口协议分析结果

## 1. 分隔符
- `AA 55 03 99` (splitArr: [0xaa, 0x55, 0x03, 0x99])
- 所有设备数据帧均以此分隔符分割

## 2. 设备类型与帧长度

| 设备类型 | 帧长度(字节) | 波特率 | 数据格式 |
|---------|-------------|--------|---------|
| 左手 HL | 130 (分包x2) | 1000000 | order(1字节) + type(1字节) + 128字节矩阵 |
| 右手 HR | 130 (分包x2) | 1000000 | order(1字节) + type(1字节) + 128字节矩阵 |
| 右手 HR | 146 (含四元数) | 1000000 | 130字节 + 16字节四元数 |
| 坐垫 sit | 1024 | 1000000 | 32x32 矩阵 |
| 脚垫 foot | 4096 | 3000000 | 64x64 矩阵 |

## 3. 手部数据帧结构 (130字节)
- byte[0] = order: 1=第一帧(last), 2=第二帧(next)
- byte[1] = type: 1=左手(HL), 2=右手(HR)
- byte[2..129] = 128字节压力矩阵数据
- 两帧合并后得到 256 字节 (16x16 矩阵)

## 4. 手部数据帧结构 (146字节) - 含四元数
- byte[0] = order: 1=第一帧, 2=第二帧
- byte[1] = type: 1=左手, 2=右手
- byte[2..129] = 128字节压力矩阵
- byte[130..145] = 16字节四元数 (rotate)

## 5. 坐垫数据 (1024字节)
- 直接是 32x32 = 1024 字节的压力矩阵
- 经过 hand() 函数变换后使用
- type 默认为 'sit'

## 6. 脚垫数据 (4096字节)
- 直接是 64x64 = 4096 字节的压力矩阵
- type 默认为 'foot'
- 波特率 3000000
- 需要通过 AT 指令获取 MAC 地址来区分 foot1/foot2/foot3/foot4

## 7. 脚垫 MAC 地址获取
- 连接后发送 "AT\r\n"
- 设备返回: "HC32F460 Unique ID:<mcuID>--Versions:<version> --company: JQ"
- 通过 serialCache 中的 MAC->type 映射确定是 foot1/foot2/foot3/foot4

## 8. 后端已有虚拟串口支持
环境变量:
- VIRTUAL_SERIAL_TEST=true: 启用虚拟串口测试模式
- VIRTUAL_PORT_LIST: JSON数组，虚拟串口路径列表
- VIRTUAL_BAUD_MAP: JSON对象，路径->波特率映射
- VIRTUAL_MAC_MAP: JSON对象，端口名->MAC信息映射

## 9. 真实数据分析

### 右手数据 (pasted_file_oLXL0f_右手.txt)
- 分隔符 AA 55 03 99 后跟 01 02 (order=1, type=2=右手)
- 或 02 02 (order=2, type=2=右手)
- 帧长度 130 字节 (不含分隔符)
- 末尾有 16 字节四元数: E0 0C 79 BC E7 9D 30 BF 4B 4D 27 3F 4E 37 9F BE

### 左手数据 (pasted_file_vHa4wi_左手.txt)
- 分隔符 AA 55 03 99 后跟 01 01 (order=1, type=1=左手)
- 或 02 01 (order=2, type=1=左手)
- 帧长度 130 字节
- 末尾有 16 字节四元数: EB B6 7A 3F 93 0F E2 BD 7C 96 6F 3D 86 C0 22 3E

### 坐垫数据 (pasted_file_zFUbJF_坐垫.txt)
- 分隔符 AA 55 03 99 后跟数据
- 帧长度约 1024 字节

### 脚垫数据 (pasted_file_lqFkMs_脚垫.txt)
- 分隔符 AA 55 03 99 后跟数据
- 帧长度约 4096 字节

## 10. WebSocket 数据推送
- 后端通过 WebSocket 向前端推送 JSON 数据
- 格式: { "HL": { status, arr, rotate, stamp, HZ }, "HR": {...}, "sit": {...}, "foot1": {...} }
