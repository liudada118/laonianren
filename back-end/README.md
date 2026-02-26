# 老年人检测系统 — 项目归档目录

本目录包含该 Electron 项目的全部源代码、架构图和接口契约文档，按以下结构组织：

```
Back-end/
├── README.md                          # 本文件 — 目录说明
├── code/                              # 项目完整源代码
│   ├── index.js                       # Electron 主进程入口
│   ├── preload.js                     # 渲染进程预加载脚本
│   ├── pyWorker.js                    # Python Worker 通信模块
│   ├── package.json                   # Node.js 项目配置
│   ├── server/                        # Node.js 后端服务
│   │   ├── serialServer.js            #   串口服务 + HTTP API + WebSocket
│   │   ├── HttpResult.js              #   统一响应格式
│   │   └── equipMap.js                #   设备映射表
│   ├── util/                          # 工具模块
│   │   ├── config.js                  #   常量与传感器配置
│   │   ├── db.js                      #   SQLite 数据库操作
│   │   ├── serialport.js              #   串口连接与数据解析
│   │   ├── parseData.js               #   字节数据解析
│   │   ├── aes_ecb.js                 #   AES-ECB 加解密
│   │   ├── line.js                    #   矩阵变换与坐标映射
│   │   ├── getWinConfig.js            #   硬件指纹获取
│   │   ├── getServer.js               #   服务端密钥查询
│   │   └── time.js                    #   时间戳格式化
│   ├── python/app/                    # Python 数据分析服务
│   │   ├── server.py                  #   Python 服务入口 (JSON-RPC)
│   │   ├── requirements.txt           #   Python 依赖
│   │   ├── staticFoot/                #   静态站立分析模块
│   │   ├── foot/                      #   步态分析模块
│   │   ├── hand/                      #   握力分析模块
│   │   ├── sitAndfoot/                #   起坐分析模块
│   │   └── frontendReport/            #   前端报告渲染数据模块
│   ├── scripts/                       # 构建与开发脚本
│   │   ├── start-electron.js          #   启动 Electron
│   │   └── copy-renderer.js           #   复制前端构建产物
│   └── ...                            # 其他配置与资源文件
├── docs/                              # 文档
│   ├── project_documentation.md       # 项目架构与代码分析文档
│   └── api.md                         # 接口契约文档 (HTTP + WebSocket)
└── assets/                            # 资源文件
    └── architecture.png               # 系统架构图
```

## 快速导航

| 文档 | 路径 | 说明 |
| :--- | :--- | :--- |
| 项目分析文档 | `docs/project_documentation.md` | 项目概述、架构设计、技术栈、核心模块分析、数据流程 |
| 接口契约文档 | `docs/api.md` | 全部 HTTP API 和 WebSocket 消息的详细说明 |
| 系统架构图 | `assets/architecture.png` | 各模块间的关系与数据流向 |
| 项目源代码 | `code/` | 完整的 Electron + Node.js + Python 源代码 |
