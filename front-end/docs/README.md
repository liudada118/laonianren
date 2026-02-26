# 老年人检测系统 - 项目文档

## 目录结构

```
my_project/
├── docs/                          # 文档目录
│   ├── README.md                  # 本文件
│   ├── api_contract.md            # 接口契约文档
│   ├── architecture.mmd           # 系统架构图 (Mermaid 源文件)
│   ├── architecture.png           # 系统架构图 (PNG)
│   ├── dataflow.mmd               # 数据流时序图 (Mermaid 源文件)
│   └── dataflow.png               # 数据流时序图 (PNG)
├── src/                           # 前端源码
│   ├── App.jsx                    # 路由入口
│   ├── main.jsx                   # 应用入口
│   ├── index.css                  # 全局样式
│   ├── pages/                     # 页面组件
│   │   ├── Login.jsx              # 登录页
│   │   ├── Dashboard.jsx          # 仪表盘
│   │   ├── AssessmentHistory.jsx  # 历史记录
│   │   ├── HistoryReportView.jsx  # 历史报告查看
│   │   └── assessment/            # 四大评估页面
│   │       ├── GripAssessment.jsx
│   │       ├── SitStandAssessment.jsx
│   │       ├── StandingAssessment.jsx
│   │       └── GaitAssessment.jsx
│   ├── components/                # 可复用组件
│   │   ├── ui/                    # 基础 UI 组件
│   │   ├── three/                 # Three.js 3D 组件
│   │   ├── report/                # 报告展示组件
│   │   ├── layout/                # 布局组件
│   │   ├── charts/                # 图表组件
│   │   ├── gait/                  # 步态可视化
│   │   └── debug/                 # 调试工具
│   ├── contexts/                  # React Context
│   │   ├── AssessmentContext.jsx   # 评估全局状态
│   │   └── ThemeContext.jsx        # 主题管理
│   ├── hooks/                     # 自定义 Hooks
│   │   ├── useDevice.js           # 设备连接/模拟
│   │   ├── usePressureScene.js    # 压力场景
│   │   └── useWebSocket.js        # WebSocket 通信
│   ├── lib/                       # 核心库
│   │   ├── SerialService.js       # 脚垫串口 (64×64, 3Mbaud)
│   │   ├── GloveSerialService.js  # 手套串口 (16×16, 921600baud)
│   │   ├── gripReportGenerator.js # 握力报告生成
│   │   ├── sitstandReportGenerator.js
│   │   ├── gaitReportGenerator.js
│   │   ├── footpad-sdk/           # 脚垫 SDK
│   │   ├── pressure-sensor/       # 压力传感器库
│   │   └── ...
│   └── assets/                    # 数据资源
├── public/                        # 静态资源 (图片、3D模型等)
├── server/                        # 后端服务
│   └── index.js                   # Express + WebSocket 服务
├── build/                         # 构建配置
├── package.json                   # 项目依赖
├── vite.config.js                 # Vite 配置
├── tailwind.config.js             # Tailwind CSS 配置
└── postcss.config.js              # PostCSS 配置
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 启动后端服务（可选）
pnpm server

# 同时启动前后端
pnpm start
```

## 文档说明

- **[接口契约文档](api_contract.md)**: REST API、WebSocket 协议、串口通信协议的完整定义
- **[系统架构图](architecture.png)**: 从用户层到硬件层的完整系统架构
- **[数据流时序图](dataflow.png)**: 设备连接→数据采集→报告生成的完整数据流
