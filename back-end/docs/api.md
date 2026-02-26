# API 接口说明（中文）

## 总览
- HTTP（串口服务）：`http://localhost:19245`
- HTTP（Backend）：`http://localhost:3000`
- WebSocket：`ws://localhost:19999`

## 约定
- 通用返回：`HttpResult` => `{ code: number, message: string, data: any }`
- 除非特别说明，请求体为 `application/json`
- 部分接口在代码中没有显式 `res` 返回（已标注）

---

# 一、串口服务 API（端口 19245）

`GET /`
- 说明：健康检查
- 返回：`Hello World!`

`GET /OneStep/:name`
- 说明：预览/下载 `OneStep` 目录下的 PDF
- 路径参数：`name`（文件名，禁止路径分隔符）
- 返回：`application/pdf`
- 备注：非法文件名 400；越权 403；不存在 404

`POST /bindKey`
- 说明：绑定设备密钥（占位）
- Body：`{ "key": string }`
- 返回：`HttpResult`（code 0/1）

`GET /serialCache`
- 说明：读取 `serial.txt` 缓存的密钥与机构名
- 返回：`HttpResult`，`data` 形如 `{ hasCache: boolean, key?, orgName?, updatedAt? }`

`POST /serialCache`
- 说明：保存密钥与机构名到 `serial.txt`
- Body：`{ "key": string, "orgName": string }`
- 返回：`HttpResult`（保存后的对象）

`POST /uploadCanvas`
- 说明：上传热力图并生成 PDF 报告
- Content-Type：`multipart/form-data`
- 表单字段：`file`（必填）、`date`（必填）、`collectName`、`age`、`gender`、`userId`、`filename`
- 返回：`HttpResult`，`data` 为 `{ file, body, absolutePath }`
- 备注：依赖 `POST /getDbHeatmap` 写入的 `pdfArrData`

`POST /uploadCanvas_old`
- 说明：历史占位接口
- Body：`{ "key": string }`
- 返回：`HttpResult`（code 0/1）

`POST /selectSystem`
- 说明：选择系统类型并初始化 DB
- Query：`file`
- 返回：**当前代码未返回响应**

`GET /getSystem`
- 说明：获取系统配置/当前系统类型
- 返回：`HttpResult`（解密后的配置对象）
- 备注：代码中会强制 `result.value = 'foot'`

`GET /getPort`
- 说明：获取串口列表
- 返回：`HttpResult`

`GET /connPort`
- 说明：一键连接串口并开始解析
- 返回：`HttpResult`（端口列表）

`POST /startCol`
- 说明：开始采集
- Body：`{ fileName, name, collectName, date, colName, select, assessmentId }`
- 返回：`HttpResult`（成功或错误）
- 备注：没有匹配传感器时返回错误提示

`POST /setActiveMode`
- 说明：设置当前评估模式（控制 WS 只发送对应传感器数据，存库也仅存该数据）
- Body：`{ mode, assessmentId }`
  - `mode`：1 左手、2 右手、3 起坐、4 静态、5 步道
  - `assessmentId`：本次评估的时间戳（可选）
- 返回：`HttpResult`
- 备注：
  - 映射关系：  
    1 → `HL`  
    2 → `HR`  
    3 → `sit`, `foot1`  
    4 → `foot1`  
    5 → `foot1`, `foot2`, `foot3`, `foot4`

`GET /endCol`
- 说明：停止采集
- 返回：`HttpResult`

`GET /getColHistory`
- 说明：获取采集历史（按 date 最新）
- 返回：`HttpResult`，`data` 为 `{ date, timestamp, name, select }[]`
- 备注：会推送 WebSocket `{ sitData: {} }`

`POST /downlaod`
- 说明：导出 CSV（接口名拼写保留）
- Body：`{ fileArr: string[] }`
- 返回：`HttpResult`
- 备注：`fileArr` 为空时 code=555

`POST /delete`
- 说明：删除指定条目
- Body：`{ fileArr: string[] }`
- 返回：`HttpResult`

`POST /changeDbName`
- 说明：重命名日期
- Body：`{ oldDate, newDate }`
- 返回：`HttpResult`

`POST /getDbHistory`
- 说明：获取某日期的全部数据
- Body：`{ time }`
- 返回：`HttpResult`
- 备注：foot 数据会调用 Python `replay_server`

`POST /getDbHeatmap`
- 说明：获取 foot 峰值帧并缓存给 PDF
- Body：`{ time }`
- 返回：`HttpResult`（成功返回 `peak_frame`）
- 备注：会写入全局 `pdfArrData`

`POST /getContrastData`
- 说明：对比两次采集
- Body：`{ left, right }`
- 返回：`HttpResult`（左右数据摘要）
- 备注：推送 WebSocket `{ contrastData: { left, right } }`

`POST /changeDbDataName`
- 说明：重命名记录名称
- Body：`{ oldName, newName }`
- 返回：**当前代码未返回响应**

`POST /cancalDbPlay`
- 说明：取消回放（接口名拼写保留）
- 返回：`HttpResult`

`POST /getDbHistoryPlay`
- 说明：开始历史回放
- 返回：`HttpResult` 或错误
- 备注：推送 `{ playEnd: true }`，回放帧 `{ sitDataPlay, index, timestamp }`，结束 `{ playEnd: false }`

`POST /changeDbplaySpeed`
- 说明：修改回放速度
- Body：`{ speed }`
- 返回：`HttpResult`
- 备注：播放中会改 timer 并推送 `{ sitData, index, timestamp }`

`POST /changeSystemType`
- 说明：切换系统类型
- Body：`{ system }`
- 返回：`HttpResult`（`{ optimalObj, maxObj }`）

`POST /getDbHistoryStop`
- 说明：暂停回放
- 返回：`HttpResult`

`POST /getDbHistoryIndex`
- 说明：跳转回放索引
- Body：`{ index }`
- 返回：`HttpResult`
- 备注：推送 `{ sitData, index, timestamp }`

`POST /getCsvData`
- 说明：读取 CSV 文件
- Body：`{ fileName }`
- 返回：`HttpResult`

`GET /sendMac`
- 说明：发送 MAC 查询
- 返回：`HttpResult`
- 备注：未连接串口时返回“请先连接串口”

`POST /getSysconfig`
- 说明：加密配置对象
- Body：`{ config: object }`
- 返回：`HttpResult`（加密字符串）

`GET /getPyConfig`
- 说明：读取 Python 配置
- 返回：`HttpResult`

`POST /changePy`
- 说明：更新 Python 配置
- Body：`{ path: string, value: string }`（value 为 JSON 字符串）
- 返回：`HttpResult`

---

# 二、Backend API（端口 3000）

`GET /`
- 说明：健康检查
- 返回：`Hello World!`

`GET /getKey`
- 说明：查询设备密钥
- Query：`uuid`
- 返回：`HttpResult`（占位）

`POST /bindKey`
- 说明：绑定设备密钥（占位）
- 返回：**当前代码未返回响应**

---

# 三、WebSocket（端口 19999）

服务端只推送消息，客户端无需发消息（使用 `POST /setActiveMode` 控制发送类型）。

常见消息结构：
- `{}` 初次连接的空包
- `{ data: <object> }` 实时数据（蓝牙分包路径）
- `{ sitData: <object> }` 实时数据（高频路径）或历史索引回放
- `{ sitDataPlay: <array>, index, timestamp }` 历史回放帧
- `{ playEnd: true|false }` 回放开始/结束标记
- `{ macInfo: { [portPath]: { uniqueId, version } } }` MAC 信息
- `{ contrastData: { left: <array>, right: <array> } }` 对比首帧
- `{ handle: <array> }` 手动控制指令
- `{ algorFeed: <array> }` 算法控制指令

---

# 示例

```bash
curl http://localhost:19245/getSystem
```

```bash
curl -X POST http://localhost:19245/getDbHistory \
  -H "Content-Type: application/json" \
  -d "{\"time\":\"2024-01-01\"}"
```

```bash
curl -X POST http://localhost:19245/uploadCanvas \
  -F "file=@heatmap.png" \
  -F "date=2024-01-01" \
  -F "collectName=张三" \
  -F "age=30" \
  -F "gender=male"
```
