# 老年人筛查系统MAC 架构文档

**版本**: 2.0
**最后更新**: 2026-03-12 16:00
**作者**: Manus AI

## 更新日志
| 日期 | 分支 | 类型 | 描述 |
|---|---|---|---|
| 2026-03-12 16:00 | hand | 修复缺陷 | 修复第二次进入握力评估时清零失效。根因：clearGripBaseline未清除gloveLatestData缓存，导致第二次进入时用旧数据作为基线。修复：(1)clearGripBaseline同时清除gloveLatestData；(2)tareGrip增加时间戳新鲜度检查(2s)，拒绝过期数据；(3)异步重试机制等待新鲜数据到达。修改文件：serialServer.js。 |
| 2026-03-12 15:30 | hand | 修复缺陷 | 修复右手(HR)清零基线无法记录的问题。新增 gloveLatestData 缓存按HL/HR分别存储最新帧数据，修改 tareGrip 优先从缓存读取基线，修改 parseData 补充被覆盖的另一只手数据。修改文件：serialServer.js。 |
| 2026-03-09 10:06 | ld | 修复缺陷 | 修正主页Dashboard评估卡片设备数量提示：起坐50→2（坐垫+脚垫1）、静态站立4→1（脚垫1）。修改文件：Dashboard.jsx。 |
| 2026-03-09 10:05 | ld | 新增功能 | 三个评估模式（起坐/静态站立/步态）3D场景启用缩放控制并扩大缩放范围（PressureScene3D.js、FootpadScene.js、InsoleScene.jsx）。 |
| 2026-03-09 10:04 | ld | 新增功能 | 起坐和静态站立前端展示增加脚垫数据左右对调（usePressureScene.js增加flipLR、FootAnalysis.js的parseFrameData增加额外flipLR）。 |
| 2026-03-09 10:03 | ld | 修复缺陷 | 修正后端脚垫翻转方向为上下翻转（flipFoot64x64Vertical，行顺序反转）实现左右对调。修改文件：serialServer.js。 |
| 2026-03-09 10:02 | ld | 新增功能 | 后端对所有脚垫(foot1-4)的64×64矩阵数据做水平镜像翻转（左右对调）。修改文件：serialServer.js。 |
| 2026-03-09 10:01 | ld | 修复缺陷 | 修复起坐评估中foot1脚垫只渲染左上区域的问题（跨模式footBuffers污染），增加模式感知的脚垫过滤。修改文件：usePressureScene.js。 |
| 2026-03-09 09:58 | ld | 修复缺陷 | 起坐评估坐垫脚垫帧率修复：去除重复帧并使用真实时间戳。修改文件：serialServer.js。 |
| 2026-03-09 09:55 | ld | 修复缺陷 | 修复同名患者同日评估历史记录被覆盖的问题。修改文件：historyService.js。 |
| 2026-03-09 09:52 | ld | 修复缺陷 | 修复rescanPort关闭已断开串口时Port is not open崩溃。修改文件：serialServer.js。 |
| 2026-03-09 09:50 | ld | 修复缺陷 | 修复步态分析analyze_gait_cycle中cycle_start为None导致的TypeError。修改文件：generate_gait_report.py。 |
| 2026-03-09 09:48 | ld | 修复缺陷 | 修复searchHistory/getRecord非Promise导致.then is not a function错误。修改文件：BackendBridge.js。 |
| 2026-03-09 09:45 | ld | 新增功能 | 重写PDF导出：使用html2canvas+jsPDF生成真实PDF文件，支持单报告和整体报告导出。修改文件：pdfExport.jsx。 |
| 2026-03-09 09:40 | ld | 新增功能 | 实现5个功能：设备掉线重连、单报告PDF导出、整体报告PDF导出、历史一键删除、步态评估报告优化。 |
| 2026-03-09 17:40 | test | 新增功能+优化重构 | 静态站立评估3项改进：(1) 进入评估后弹窗提示“请踩上，10秒后自动结束”；(2) COP轨迹与置信椭圆坐标自适应（根据散点+椭圆范围动态计算坐标轴，图表高度从380/400增大到520，椭圆图改为全宽布局）；(3) 综合评估移到报告最前面；额外修复评估时间持续增加bug。修改文件：StandingAssessment.jsx、StandingReport.jsx。 |
| 2026-03-09 17:20 | test | 新增功能+修复缺陷 | 起坐能力评估4项改进：(1) Dashboard和SitStandAssessment新增“请起坐 5 次”弹窗提示；(2) 修正报告测试时间持续增加Bug（用useMemo缓存fallbackDate）；(3) 取消站立帧数/坐姿帧数展示，仅保留采样率小字；(4) 力时间曲线合并为单图并添加足底/坐垫图例标识。修改文件：Dashboard.jsx、SitStandAssessment.jsx、SitStandReport.jsx。 |
| 2026-03-09 16:46 | test | 优化重构 | 握力评估左侧可视化区域实时更新：设备连接后无论是否在采集，左侧面板的压力曲线、统计数据、正态分布图均实时变化。修改文件：GripAssessment.jsx。 |
| 2026-03-09 16:50 | test | 优化重构 | 握力报告GripReport布局调整：(1)先图后数据，图表移到数据表格前面；(2)总帧数移至底部小字显示；(3)时间范围改为简洁总时长格式；(4)总面积单位mm²改为cm²；(5)删除报告末尾重复的力占比分析图。修改文件：GripReport.jsx。 |
| 2026-03-09 16:34 | test | 新增功能 | 握力评估新增两个提示弹窗：(1) Dashboard点击握力评估前弹窗提示"请带好手套并且手指平铺"，确认后才进入；(2) 进入GripAssessment页面后自动弹窗提示"用最大握力握3次"。修改文件：Dashboard.jsx、GripAssessment.jsx。 |
| 2026-03-04 | 修复缺陷 | 修复静态站立评估报告4个问题：(1)平衡分析左右脚压力比硬编码50/50→用峰值帧真实压力计算；(2)COP压力中心轨迹显示“暂无数据”→在one_step_render_data.py中额外调用calculate_cop_trajectories提取轨迹坐标；(3)COP置信椭圆宽度/高度全为0→后端通过scipy计算椭圆参数并返回前端；(4)COP轨迹图为空→同(2)。修改文件：one_step_render_data.py、StandingReport.jsx。 |
| 2026-03-04 | 修复缺陷 | 修复步态报告Gait Average Summary左右脚热力图大小不一致。根因：analyze_gait_and_plot中左右脚的canvas大小独立计算，当左脚bounding box比右脚小时，导致imshow的extent不同，显示比例不一致。修复：统一左右脚的canvas大小为max(l_h,r_h)和max(l_w,r_w)。 |
| 2026-03-04 | 性能优化 | 注释掉算法中前端未使用的base64图片生成，大幅减小render_data体积。起坐算法：注释全部5个images字段（前端已用heatmap_data+cop_data通过Canvas渲染）；步态算法：注释5个前端已用ECharts数值数据渲染的图片，保留3个必需的base64图片。同时跳过对应的matplotlib绘图函数调用，加速算法执行。 |
| 2026-03-04 | 修复缺陷 | 修复历史记录413 Payload Too Large错误。根因：serialServer.js中存在两行express.json()中间件，第一行无limit（默认100KB）先执行，导致第二行的limit:'50mb'永远不生效。修复：删除无limit的express.json()，合并为一行limit:'200mb'。 |
| 2026-03-04 | 修复缺陷 | 修复两个严重Bug：(1) completeAssessment中saveAssessmentSession发送的数据包含巨大的原始传感器data字段，导致第二个评估后请求体超限，历史记录只保存1/4；(2) 从Dashboard点击查看报告进入评估页面时，reportData状态变量初始化为null未从assessments恢复，导致显示"暂无报告数据"。修改5个文件：AssessmentContext.jsx + 4个评估页面。 |
| 2026-03-04 | 数据升级 | 所有评估的串口模拟数据全部替换为用户提供的CSV原始采集数据：握力（左手2512帧/右手1982帧）、起坐（坐垫489帧/脚垫489帧）、站立（4路脚垫各341帧）、步态（4路脚垫各210帧）。新增统一转换工具 csv_to_all_bins.js。 |
| 2026-03-04 | 修复缺陷 | 修复 init.db 和 foot.db 中 matrix 表缺少 timestamp 和 select 列的问题，该 Bug 导致所有采集数据无法写入数据库，CSV导出/回放/报告生成全部失效。同时修复 ensureMatrixNameColumn 函数增加对这两列的自动检查和修复。 |
| 2026-03-04 | 新增功能 | 新增4路脚垫数据模拟支持，从用户提供的CSV原始数据提取foot1~foot4独立二进制帧文件，测试通过率从98%提升到100%。 |
| 2026-03-04 | 新增功能 | 新增综合端到端测试 e2e_comprehensive_test.js（49个用例，100%通过率），覆盖登录/连接/4个评估采集/报告生成/CSV导出/历史记录CRUD/数据库回放/WebSocket验证。 |
| 2026-03-03 | 优化重构 | 移除所有报告组件中的假数据 fallback（generateMockReport、静态 JSON 文件加载），确保报告数据全部来自真实采集；删除 public 下 gait_report_data、grip_report_data、sitstand_report_data 假数据目录（含 60 个文件）。 |
| 2026-03-03 | 修复缺陷 | 修复 serialServer.js 第 3151 行语法错误（130 帧块与 1024 帧块括号不匹配），由旧设备类型清理时嵌套结构处理不当导致。 |
| 2026-03-03 | 优化重构 | 清理旧设备类型（BODY/bed/car/endi 等），移除 CH340 直接标记逻辑，统一通过波特率探测识别设备（921600→HL/HR, 1000000→sit, 3000000→foot1-4）。 |
| 2026-03-03 | 修复缺陷 | 修复握力评估报告中超长小数问题（合并 handReport 分支）。 |
| 2026-03-03 | 新增功能 | 补充 Python 后端起坐报告输出字段，对齐前端 SitStandReport 所需数据（合并 sitStandReport 分支）。 |
| 2026-03-03 | 修复缺陷 | 将外部 HDR 环境贴图（studio_small_03_1k.hdr）下载到本地，消除 3D 场景对外部网络的依赖。 |
| 2026-03-03 | 优化重构 | 将评估报告算法从 frontendReport 目录替换为 algorithms 目录，统一算法调用路径。 |
| 2026-03-03 | 修复缺陷 | 修复 GripAssessment、StandingAssessment 缺少 viewReport state 处理导致 Dashboard "查看报告"跳转后不显示报告的 Bug。 |
| 2026-03-03 | 修复缺陷 | 修复所有评估页面（握力/起坐/站立/步态）采集按钮与文字标签分离导致点击无响应的 UX Bug。 |
| 2026-03-03 | 修复缺陷 | 修复 GripAssessment handleClose 中 gloveService.disconnect() 未 await 的异步问题。 |
| 2026-03-03 | 修复缺陷 | 修复 HistoryReportView 中 SitStandReport 和 GaitReportContent 缺少 onClose 回调导致报告页面无法返回的问题。 |
| 2026-03-03 | 新增功能 | 添加完全模拟用户点击操作的端到端测试脚本和串口模拟器。 |
| 2026-03-03 | 新增功能 | 在 test 分支中添加了基于 electron-ui 的端到端测试架构。 |
| 2026-03-01 | 初始化 | 创建初始架构文档。 |

## 1. 概述

本项目是一个基于 Electron 的桌面应用程序，用于老年人肌少症、步态、平衡等能力的筛查与评估。系统通过连接多种压力传感器硬件（握力计、坐垫、步道等），实时采集数据，进行算法分析，并生成详细的评估报告。

### 1.1. 整体架构图

![系统架构图](docs/architecture_diagram.png)

### 1.2. 技术栈

| 层次 | 技术 | 主要库/框架 | 职责 |
|---|---|---|---|
| **桌面应用容器** | Electron | `electron`, `electron-builder` | 提供跨平台（Windows, macOS）的桌面应用外壳，管理窗口和主进程。 |
| **前端/UI** | React | `react`, `vite`, `tailwindcss`, `echarts`, `three.js` | 构建用户界面，包括数据可视化（图表、3D模型）、设备连接、评估流程控制。 |
| **后端/主服务** | Node.js | `express`, `ws`, `serialport`, `sqlite3` | 核心业务逻辑，包括：HTTP API 服务、WebSocket 实时通信、串口设备数据采集、数据库管理。 |
| **算法/数据处理** | JavaScript (Node.js) & Python | `numpy`, `scipy`, `matplotlib` | 执行核心算法，包括信号处理、峰值检测、COP计算、报告数据生成等。 |
| **数据库** | SQLite | `sqlite3` | 存储历史评估数据、用户配置等。 |

### 1.3. 项目目录结构

项目分为两个主要部分：`front-end` 和 `back-end`。

- **`back-end/code`**: Electron 主进程和后端 Node.js 服务代码。
  - `index.js`: Electron 主进程入口。
  - `server/serialServer.js`: 核心后端服务，处理硬件通信和 API 请求。
  - `algorithms/`: 算法模块，包含 JS 实现和 Python 桥接。
  - `python/`: Python 算法的原始脚本。
  - `db/`: SQLite 数据库文件存放目录。
- **`front-end`**: React 前端应用代码。
  - `src/`: 前端源码目录。
  - `pages/`: 各个页面组件。
  - `components/`: 可复用的 UI 组件。
  - `lib/`: 前端核心逻辑，如与后端的通信桥 `BackendBridge.js`。
  - `contexts/`: React Context，用于全局状态管理。
- **`test`**: 端到端测试目录。
  - `analysis.md`: 项目结构分析报告。
  - `e2e_test.js`: Playwright 端到端测试脚本（脚本模式）。
  - `e2e_full_click_test.js`: 完全模拟用户点击操作的端到端测试脚本。
  - `e2e_comprehensive_test.js`: 综合端到端测试（49个用例），覆盖UI交互+后端API+数据库回放+CSV导出+报告生成。
  - `serial_simulator.js`: 虚拟串口模拟器，使用 socat 创建虚拟串口对并发送真实传感器数据。
  - `serial_protocol_analysis.md`: 串口通信协议分析文档。
  - `screenshots*/`: 各版本测试过程中生成的截图。

## 2. 核心模块详解

### 2.1. Electron 主进程 (`back-end/code/index.js`)

主进程是应用的入口点，负责：

1.  **窗口管理**: 创建和管理浏览器窗口 (`BrowserWindow`)。
2.  **生命周期管理**: 处理应用的启动、关闭、激活等事件。通过 `before-quit` 和 `will-quit` 事件确保所有子进程（Vite, serialServer）在应用退出时被正确清理，防止端口占用。
3.  **子进程管理**: 
    - 在开发模式下，启动 Vite 开发服务器。
    - 启动核心后端服务 `serialServer.js` 作为一个独立的 Node.js 子进程 (`child_process.fork`)。这种隔离可以防止后端服务的崩溃影响到整个应用的稳定性。
4.  **预加载脚本 (`preload.js`)**: 通过 `contextBridge` 安全地向渲染进程暴露 Node.js API（目前较少使用）。

### 2.2. 前端架构 (`front-end`)

前端采用 `Vite` + `React` 构建，实现了清晰的组件化和状态管理。

#### 2.2.1. 路由

使用 `react-router-dom`（BrowserRouter 模式）进行页面路由管理，主要页面包括：

- `/`: 登录页
- `/dashboard`: 主面板，评估项目入口
- `/assessment/grip`: 握力评估（支持 `viewReport` state 参数直接显示报告）
- `/assessment/sitstand`: 起坐评估（支持 `viewReport` state 参数直接显示报告）
- `/assessment/standing`: 站立评估（支持 `viewReport` state 参数直接显示报告）
- `/assessment/gait`: 步态评估（支持 `viewReport` state 参数直接显示报告）
- `/history`: 历史记录列表
- `/history/report`: 历史报告查看页

#### 2.2.2. 状态管理

- **`AssessmentContext`**: 全局状态管理中心，负责维护：
  - 用户登录信息。
  - 当前评估对象（患者信息）。
  - 各评估项目的完成状态和报告数据。
  - 全局设备连接状态 (`deviceConnStatus`) 和各传感器的在线状态 (`deviceOnlineMap`)。
- **`useWebSocket` / `BackendBridge.js`**: 封装了与后端 `serialServer.js` 的通信逻辑。

#### 2.2.3. 与后端通信 (`lib/BackendBridge.js`)

`BackendBridge.js` 是前端与后端通信的**唯一入口**，它统一管理了两种通信方式：

- **HTTP API (Express)**: 用于请求-响应模式的操作，如获取历史记录、生成报告、开始/结束采集等。通过 `fetch` 调用 `http://localhost:19245` 上的接口。
- **WebSocket**: 用于从后端接收实时的、推送性质的数据，如传感器实时压力数据、设备连接状态等。连接到 `ws://localhost:19999`。

这种设计将所有后端交互逻辑集中在一个地方，便于管理和调试。

#### 2.2.4. 数据可视化

- **`ECharts`**: 用于绘制 2D 图表，如压力曲线、柱状图等 (`components/ui/EChart.jsx`)。
- **`Three.js` / `@react-three/fiber`**: 用于渲染 3D 模型，如手部模型、足底压力热力图等 (`components/three/`)。
  - **热力图渲染 (`lib/heatmap.js`)**: 一个核心的自定义模块，实现了将离散的压力点数据通过高斯模糊、颜色映射等技术渲染成平滑的热力图纹理，并应用到 3D 模型上。
  - **脚垫数据前端处理 (`hooks/usePressureScene.js`)**: 起坐/步态评估的脚垫数据处理 hook，包含模式感知的 footBuffers 过滤（防止跨模式数据污染）、`rotateCCW90` 旋转、`flipLR` 水平镜像等变换。
  - **足底分析 (`lib/FootAnalysis.js`)**: 静态站立评估的数据处理模块，`parseFrameData` 对 64×64 矩阵执行 `rot90 → flipLR → flipUD → flipLR` 变换链，`splitLeftRight` 按列 0-31/32-63 划分左右脚。
  - **3D 场景缩放控制**: 三个评估模式的 3D 场景（`PressureScene3D.js`、`FootpadScene.js`、`InsoleScene.jsx`）均启用 `OrbitControls.enableZoom`，支持鼠标滚轮/触控板双指缩放。

### 2.3. 后端服务 (`back-end/code/server/serialServer.js`)

这是整个系统的核心，一个常驻的 Node.js 服务，负责所有与硬件和数据处理相关的任务。

#### 2.3.1. API 服务 (Express)

在端口 `19245` 上提供一个 HTTP/RESTful API 服务，处理前端的请求。主要接口包括：

- `/connPort`: 连接所有串口设备。
- `/startCol`, `/endCol`: 开始和结束数据采集。
- `/getHandPdf`, `/getFootPdf`, ...: 请求生成各项评估报告。
- `/api/history/*`: 增删查改历史评估记录。

#### 2.3.2. 实时通信 (WebSocket)

在端口 `19999` 上运行一个 WebSocket 服务器，用于向所有连接的前端客户端**广播**实时数据：

- **传感器实时数据**: 将从串口收到的原始数据处理后，以固定频率推送给前端，用于实时显示压力变化。
- **设备状态**: 当传感器连接或断开时，立即推送更新后的设备状态。

#### 2.3.3. 硬件交互 (`serialport`)

- 使用 `serialport` 库扫描和连接所有可用的串口设备。
- **设备识别**：统一通过波特率探测（`detectBaudRate`）识别设备类型，不再依赖 CH340 芯片标记。
- **波特率 → 设备映射**（`BAUD_DEVICE_MAP`）：
  - `921600` → 手套（HL/HR），通过 130/146 字节帧内类型位区分左右手。**注意：左右手共用同一串口**，通过 `gloveLatestData` 缓存按 HL/HR 分别存储最新帧数据，解决 `dataMap[path]` 被交替覆盖的问题
  - `1000000` → 起坐垫（sit），1024 字节帧
  - `3000000` → 脚垫（foot1-4），4096 字节帧，通过 AT 指令获取 MAC 地址查映射表细分
- **脚垫数据预处理流程**：对每个 64×64 脚垫帧依次执行 `zeroBelowThreshold(8)` → `removeSmallIslands64x64(12)` → `flipFoot64x64Vertical`（行顺序反转，实现左右对调），确保前端显示方向与实际脚垫物理方向一致。
- 监听每个串口的 `data` 事件，接收传感器发送的原始二进制数据。
- 对原始数据进行解析、分包、校验，转换为数字矩阵。
- **支持的帧类型**：18 字节（陀螺仪）、130 字节（手套分包矩阵）、146 字节（手套分包+四元数）、1024 字节（起坐垫 32×32）、4096 字节（脚垫 64×64）。

#### 2.3.4. 数据库交互 (`sqlite3`)

- 使用 `sqlite3` 库操作 `back-end/code/db/` 目录下的数据库文件。
- `init.db`: 可能用于存储配置信息。
- `foot.db`: 主要数据库，包含 `matrix` 表，用于存储采集的原始数据帧、时间戳、评估ID等。

### 2.4. 算法架构 (`back-end/code/algorithms`)

算法是系统的另一个核心，分为 JS 实现和 Python 实现两部分，以平衡性能和开发效率。

#### 2.4.1. JavaScript 算法

- **位置**: `back-end/code/algorithms/{grip,sitstand,...}`
- **目的**: 对性能要求不是极致，但与 Node.js 服务端逻辑紧密相关的部分，使用 JS 实现可以避免跨语言调用的开销。
- **示例**: `sitstandReportAlgorithm.js` 中包含了起坐周期的峰值检测、时长计算等逻辑。
- **共享模块**: `shared/mathUtils.js` 提供了如 `sum`, `mean`, `std`, `findPeaks` 等通用的数学和信号处理函数。

#### 2.4.2. Python 算法桥 (`pythonBridge.js` & `bridge.py`)

当需要利用 Python 强大的科学计算生态（如 `numpy`, `scipy`）时，通过一个桥接机制来调用 Python 脚本。

- **调用流程**:
  1. `serialServer.js` 调用 `pythonBridge.js` 中的 `callPython(functionName, params)`。
  2. `pythonBridge.js` `fork` 一个 `bridge.py` 子进程。
  3. 通过 `stdin` 将函数名和参数以 JSON 格式发送给 `bridge.py`。
  4. `bridge.py` 解析输入，根据函数名在注册表中查找并执行对应的 Python 函数（这些函数位于 `back-end/code/python/app/algorithms/` 目录下）。
  5. Python 函数执行完毕，将结果以 JSON 格式通过 `stdout` 返回。
  6. `pythonBridge.js` 捕获输出，解析 JSON 并返回结果。

- **优点**: 充分利用了 Python 的算法能力，同时保持了 Node.js 作为主服务的架构。
- **缺点**: 存在进程创建和数据序列化的开销，不适合高频率的实时调用。

## 3. 数据流

### 3.1. 实时数据显示流程

1.  **硬件 -> Node.js**: 传感器通过串口将二进制数据发送给 `serialServer.js`。
2.  **数据解析**: `serialServer.js` 解析数据包，得到压力矩阵。
3.  **广播**: `serialServer.js` 通过 WebSocket (`19999`) 将压力矩阵广播给所有前端客户端。
4.  **前端接收**: `BackendBridge.js` 接收到 WebSocket 消息，触发 `data` 事件。
5.  **UI 更新**: React 组件（如 `GripAssessment.jsx`）监听到事件，更新状态，触发 `Three.js` 或 `ECharts` 重新渲染，展示实时压力变化。

### 3.2. 报告生成流程

1.  **前端触发**: 用户在评估结束后，前端页面调用 `BackendBridge.js` 的报告生成函数（如 `getGripReport`）。
2.  **API 请求**: `BackendBridge.js` 向 `serialServer.js` 的相应 API endpoint (`/getHandPdf`) 发送 HTTP 请求，参数中包含本次评估的数据库记录 ID。
3.  **数据查询**: `serialServer.js` 从 SQLite 数据库中查询出本次评估的所有原始数据帧。
4.  **算法调用**: `serialServer.js` 调用 `pythonBridge.js`，将查询到的数据传递给相应的 Python 报告生成算法（如 `generate_grip_render_report`）。
5.  **Python 计算**: Python 脚本进行复杂的计算（如峰值力、平均力、COP轨迹等），生成结构化的报告数据。
6.  **返回结果**: 结构化数据以 JSON 格式通过 `pythonBridge` -> `serialServer.js` -> HTTP 响应返回给前端。
7.  **前端渲染**: 前端报告页面 (`GripReport.jsx`) 接收到 JSON 数据，将其渲染成用户可见的图表和统计数据。

> **注意**: 所有报告组件（GripReport、SitStandReport、StandingReport、GaitReportContent）在未收到真实采集数据时，会显示"暂无报告数据，请先完成XX评估采集"的提示，不再加载任何假数据或 mock 数据。

## 4. 测试架构

为了确保应用的稳定性和代码质量，项目引入了基于 `Playwright` 的 `electron-ui` 端到端测试框架。测试流程在 `test` 分支中实现，并计划在未来集成到主开发流程中。

### 4.1. 测试技术栈

| 工具 | 用途 |
|---|---|
| **Playwright** | 核心测试驱动引擎，用于控制 Electron 应用窗口。 |
| **Electron-UI Skill** | Manus AI 的标准化技能，提供项目分析、环境搭建、测试用例生成的自动化流程。 |
| **Xvfb** | 虚拟 X-Window 服务，使得测试可以在无头 (headless) 环境中运行。 |
| **原生 assert** | 用于编写和执行测试断言。 |

### 4.2. 测试流程

1.  **项目分析**: 在 `test/analysis.md` 中记录了对项目入口、前后端路由、API、WebSocket、数据库和UI组件的全面分析结果。
2.  **环境搭建**: 通过 `skills/electron-ui/scripts/setup_env.sh` 脚本自动安装 `Xvfb`、`Playwright` 及相关依赖。
3.  **测试脚本**: `test/e2e_test.js` 是自动生成的端到端测试脚本，覆盖了以下方面：
    - **应用生命周期**: 启动、加载、关闭。
    - **后端连通性**: 检查核心 API (`/`) 和 WebSocket (`ws://localhost:19999`) 是否可达。
    - **UI 导航**: 遍历所有前端路由，并进行截图，确保页面能正常加载。
4.  **执行与报告**: 测试在 `Xvfb` 虚拟桌面中运行，并将截图和结果输出到 `test/screenshots` 目录。

## 5. 项目进度

| 完成日期 | 完成的功能/工作 | 简要说明 |
|---|---|---|
| 2026-03-03 | viewReport 路由 state 支持 | GripAssessment 和 StandingAssessment 现在支持从 Dashboard "查看报告"按钮直接跳转到报告页面，与 SitStandAssessment 和 GaitAssessment 保持一致。 |
| 2026-03-03 | 采集按钮 UX 修复 | 所有 4 个评估页面的采集按钮（开始/结束采集）已将 onClick 事件从 button 移至外层 div 容器，确保点击文字标签也能触发操作。 |
| 2026-03-03 | HistoryReportView onClose 修复 | SitStandReport 和 GaitReportContent 组件在历史报告查看页面中现在有正确的 onClose 回调，支持返回历史记录列表。 |
| 2026-03-03 | 串口模拟测试框架 | 基于 socat 虚拟串口对和真实传感器数据，实现了完整的串口模拟测试框架，支持左右手（921600 baud）、坐垫（1000000 baud）、脚垫（3000000 baud）。 |
| 2026-03-03 | 完全点击测试脚本 | 编写了 23 个完全模拟用户点击操作的端到端测试用例，覆盖登录、设备连接、评估采集、报告查看、历史记录等完整用户流程。 |
| 2026-03-03 | 算法目录统一 | 将四个评估模块（握力/起坐/站立/步态）的报告生成算法从 frontendReport 迁移到 algorithms 目录，统一 server.py 和 bridge.py 的调用路径。 |
| 2026-03-03 | 外部资源本地化 | 将 3D 场景依赖的 HDR 环境贴图从外部 CDN 下载到 public/assets/hdri/ 本地目录，消除网络依赖。 |
| 2026-03-03 | 起坐报告字段补充 | 补充 Python 后端起坐报告输出字段（generate_sit_stand_pdf_v3.py、sit_stand_render_data.py），对齐前端 SitStandReport 组件所需数据。 |
| 2026-03-03 | 握力报告小数修复 | 修复握力评估报告中超长小数显示问题（get_glove_info_from_csv.py、glove_render_data.py、GripReport.jsx）。 |
| 2026-03-03 | 串口设备识别重构 | 移除 CH340 芯片直接标记逻辑，统一通过波特率探测识别设备大类（921600→手套, 1000000→起坐垫, 3000000→脚垫），删除所有旧设备类型（BODY/bed/car/endi/carAir 等）的代码。 |
| 2026-03-03 | 报告假数据清理 | 移除四个报告组件中的假数据 fallback 逻辑和 public 下的静态假数据文件，确保所有报告数据必须来自真实采集。 |
| 2026-03-03 | serialServer.js 语法修复 | 修复 130 帧块与 1024 帧块之间的括号不匹配问题，恢复应用正常启动。 |
| 2026-03-04 | matrix表schema修复 | 修复 init.db/foot.db 中 matrix 表缺少 timestamp 和 select 列的严重 Bug，恢复采集数据写入、CSV导出、回放、报告生成功能。 |
| 2026-03-04 | 综合端到端测试 | 新增 49 个用例的综合测试，覆盖4个评估采集、报告生成、CSV导出、数据库回放、历史记录CRUD、WebSocket验证等全流程。 |
| 2026-03-04 | 4路脚垫数据模拟 | 从CVS原始数据提取foot1~foot4独立二进制帧文件，实现完整的4路脚垫虚拟串口模拟，测试通过率达到100%。 |
| 2026-03-04 | 站立评估COP数据完善 | 在one_step_render_data.py中增加COP轨迹提取、置信椭圆参数计算、左右脚真实压力比例计算，前端StandingReport.jsx优先使用后端计算的椭圆参数和压力比例。 |
| 2026-03-09 16:34 | test | 握力评估操作提示弹窗 | 新增两个用户引导弹窗：Dashboard入口提示"带好手套并手指平铺"、评估页面提示"用最大握力握3次"，提升操作规范性。 |
| 2026-03-09 16:50 | test | 握力报告布局优化 | 先图后数据、总帧数移出显眼位置、时间范围简化为总时长、面积单位改cm²、删除末尾重复图。 |
| 2026-03-09 16:46 | test | 握力评估左侧实时可视化 | 设备连接后左侧面板始终实时显示传感器数据，无需等待采集开始。 |
| 2026-03-09 09:40 | ld | 设备掉线重连与PDF导出 | 实现设备掉线自动重连、单报告PDF导出、整体报告PDF导出（html2canvas+jsPDF）、历史一键删除、步态评估报告优化。 |
| 2026-03-09 09:45 | ld | BackendBridge Promise修复 | 修复searchHistory/getRecord返回值非Promise导致前端.then调用失败。 |
| 2026-03-09 09:48 | ld | 步态分析算法修复 | 修复analyze_gait_cycle中cycle_start为None时的TypeError崩溃。 |
| 2026-03-09 09:50 | ld | 串口重连稳定性 | 修复rescanPort关闭已断开串口时Port is not open崩溃问题。 |
| 2026-03-09 09:52 | ld | 历史记录唯一性 | 修复同名患者同日评估历史记录被覆盖的问题，使用更精确的ID生成策略。 |
| 2026-03-09 09:55 | ld | 起坐帧率修复 | 去除重复帧并使用真实时间戳，修复起坐评估坐垫脚垫帧率异常。 |
| 2026-03-09 09:58 | ld | 起坐脚垫渲染修复 | 修复跨模式footBuffers污染导致起坐评估foot1只渲染左上区域的问题，增加模式感知过滤。 |
| 2026-03-09 10:02 | ld | 脚垫数据左右对调 | 后端对所有脚垫64×64矩阵做flipFoot64x64Vertical翻转，前端起坐/静态站立增加flipLR，实现脚垫数据左右对调。 |
| 2026-03-09 10:05 | ld | 3D场景缩放控制 | 三个评估模式3D场景启用OrbitControls缩放，扩大minDistance/maxDistance范围。 |
| 2026-03-09 10:06 | ld | 主页设备数量修正 | 修正Dashboard评估卡片设备提示：起坐2个（坐垫+脚垫1）、静态站立1个（脚垫1）。 |
| 2026-03-12 15:30 | hand | 右手清零基线修复 | 修复左右手共用串口导致 tareGrip 只能记录一只手基线的问题，新增 gloveLatestData 缓存确保 HL/HR 都能被清零。 |
| 2026-03-12 16:00 | hand | 第二次进入清零失效修复 | 修复退出后重新进入握力评估时清零基线不正确的问题，clearGripBaseline同时清除缓存，tareGrip增加时间戳新鲜度检查和异步重试。 |

## 6. 未来维护与更新

根据用户要求，本文档将作为项目核心参考，并在每次功能优化或架构调整后进行同步更新。

**更新流程**:

1.  完成代码的合并与推送。
2.  **阅读本文档 (`ARCHITECTURE.md`)**。
3.  根据代码变更，修改文档中受影响的部分（如新增API、修改数据流、调整组件等）。
4.  提交并推送更新后的文档。

---
