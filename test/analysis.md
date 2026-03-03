# 项目分析报告

## 1. 项目入口

- **主进程入口**: `back-end/code/index.js`

## 2. 后端功能

- **API 路由**: 
  - 框架: Express
  - 主要文件: `back-end/code/server/serialServer.js`
  - 端点: 
    - `GET /`: 服务状态检查
    - `GET /OneStep/:name`: 获取一步测试数据
    - `POST /bindKey`: 绑定密钥
    - `GET /serialCache`, `POST /serialCache`: 串口缓存操作
    - `POST /uploadCanvas`: 上传画布数据
    - `POST /getHandPdf`, `POST /getSitAndFootPdf`, `POST /getFootPdf`: 生成报告
    - `GET /getPort`, `/connPort`: 串口操作
    - `POST /startCol`, `GET /endCol`: 数据采集控制
    - `POST /api/history/*`: 历史记录的增删查改
- **WebSocket**: 
  - 端口: `19999`
  - 主要文件: `back-end/code/server/serialServer.js`
  - 功能: 实时广播传感器数据和设备状态
- **数据库**: 
  - 类型: SQLite
  - 主要文件: `util/db.js`
- **端口**: 
  - 后端 API: `19245`
  - WebSocket: `19999`
  - 前端开发服务器: `5173`
- **硬件依赖**: 
  - `serialport`: 用于与串口设备通信

## 3. 前端 UI

- **框架**: React + Vite
- **路由**: 
  - 框架: `react-router-dom`
  - 主要文件: `front-end/src/App.jsx`
  - 页面: 
    - `/`: 登录页
    - `/dashboard`: 主面板
    - `/assessment/grip`: 握力评估
    - `/assessment/sitstand`: 起坐评估
    - `/assessment/standing`: 站立评估
    - `/assessment/gait`: 步态评估
    - `/history`: 历史记录
    - `/history/report`: 历史报告查看
- **UI 框架**: `tailwindcss`
- **可视化**: `echarts`, `three.js`

## 4. 构建与测试

- **构建命令**: `npm run build` (在 `back-end/code` 目录下)
- **测试**: 需要搭建 `electron-ui` 测试环境，并生成相应的测试脚本。
