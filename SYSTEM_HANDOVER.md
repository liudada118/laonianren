# 肌少症/老年人评估与监测系统交接说明

## 1. 系统用途

这个系统用于对老年人或肌少症相关人群做多模块功能评估，并输出结构化报告与 AI 综合评估建议。

当前核心评估模块有 4 个：

- 握力评估 `grip`
- 起坐能力评估 `sitstand`
- 静态足垫/站立平衡评估 `standing`
- 步道步态评估 `gait`

系统的典型业务链路是：

1. 采集传感器原始数据
2. 前端或 Node 服务将原始数据整理成评估输入
3. Python 算法生成量化报告数据
4. 量化报告在前端展示
5. 同时将结构化报告数据和模块专属 prompt 发给 AI
6. AI 返回“AI 综合评估”
7. AI 综合评估和报告一起保存到历史记录，后续查看历史时不再重复调用大模型


## 2. 主要目录说明

### 前端

路径：`front-end/`

主要职责：

- React + Vite 页面开发
- 采集流程页面
- 报告页面展示
- 调用本地 Node / Python 接口
- 保存历史记录与 AI 建议

重点目录：

- `front-end/src/pages/`
  - 各评估页面入口，例如握力、起坐、站立、步道
- `front-end/src/components/report/`
  - 各类报告组件和 AI 综合评估面板
- `front-end/src/lib/assessmentAi.js`
  - 构建各模块 AI 请求载荷
- `front-end/src/lib/historyService.js`
  - 历史记录保存逻辑
  - 这里已经支持把 `aiReport` 存入历史记录，避免历史查看时再次请求 AI

### 桌面端 / Node 主进程

路径：`back-end/code/`

主要职责：

- Electron 桌面端启动
- 串口通信与采集
- 调用 Python 算法桥接
- 对外提供本地接口

重点目录：

- `back-end/code/index.js`
  - Electron 主入口
- `back-end/code/server/serialServer.js`
  - 串口和设备通信逻辑
- `back-end/code/algorithms/python/bridge.py`
  - Node 与 Python 算法的桥接入口

### Python 算法与 AI 服务

路径：`back-end/code/python/app/algorithms/`

主要职责：

- 读取和处理原始传感器数据
- 输出结构化量化报告
- 提供 Python AI 接口
- 根据不同评估模块构建不同 prompt

重点文件：

- `api_server.py`
  - Python 本地 HTTP 服务
  - 提供各模块 AI 分析接口
- `llm_service.py`
  - 统一 AI 调用逻辑
- `llm_config.py`
  - 读取模型配置
- `prompts/`
  - 不同评估模块的 prompt 定义
- `generate_sit_stand_pdf_v3.py`
  - 起坐评估核心算法和报告数据生成


## 3. 当前启动方式

### 常用开发启动

用户当前常用方式是：

在 `back-end/code/` 目录执行：

```bash
npm start
```

这个启动方式会走 Electron 桌面端流程。

### 前端独立启动

如果只启动前端联调，也可以在 `front-end/` 目录执行：

```bash
npm start
```

这个命令会同时启动：

- Vite 前端开发服务
- Node 本地服务
- Python AI 服务

对应脚本定义在：

- `front-end/package.json`


## 4. AI 分析链路说明

AI 分析不是直接拿原始 CSV 去问模型，而是先做算法量化，再把结构化结果交给大模型。

链路如下：

1. 模块算法先生成结构化报告数据
2. 前端把结构化报告整理成模块专属 AI payload
3. `llm_service.py` 根据模块类型选择对应 prompt
4. Python AI 服务调用配置好的 OpenAI 兼容接口
5. 返回 JSON 格式的 AI 综合评估
6. 前端把该 AI 结果保存进历史记录

当前已经做好的关键点：

- 每个模块使用不同 prompt，避免模块间 prompt 混用
- AI 建议会保存到历史记录，不会在查看历史时重复调用大模型
- 统一增加了 AI 输出约束：
  - 避免围绕精确牛顿值下结论
  - 优先写百分比、趋势、对称性、波动和风险倾向
  - 输出偏“综合判断 + 建议”
  - 控制篇幅为中等，单段目标大约 60 字左右


## 5. 起坐模块目前的重要规则

起坐模块最近做过一轮比较关键的调整。

当前规则是：

- 曲线图仍然保留“坐着开始、坐着结束”的整段原始记录
- 但用于统计和分析的周期，只取中间完整周期
- 头尾两个不完整段不参与完成次数、周期时长和分周期指标

这意味着：

- 图上可以看到完整记录
- 报告统计不会被起始坐姿和结束坐姿误导

目前用户的业务理解是：

- 若要得到 5 个完整周期，应提示受试者完成“起坐 6 次，即 5 个周期”


## 6. 历史记录与 AI 建议保存

历史记录目前主要保存在前端本地 `localStorage` 中。

关键文件：

- `front-end/src/lib/historyService.js`

目前已经支持：

- 保存完整评估记录
- 保存多模块会话
- 将 `aiReport` 写回历史记录
- 后续打开历史报告时直接读取 AI 建议，不重新请求模型


## 7. 开发时需要特别注意的点

### 1. prompt 不能混用

四个评估模块必须使用各自适配的 prompt。

### 2. 不要过度依赖绝对力学数值

由于产品存在代际误差和标定误差，AI 输出尽量不要围绕真实牛顿值或特别细的绝对点值展开。

### 3. 起坐统计和图表是两套语义

- 图表可保留完整原始记录
- 统计只使用完整周期

不要把“图上看到几个峰”直接等同于“有效完成周期数”。

### 4. 历史查看不要重复请求 AI

这一点已经实现，后续改历史功能时不要回退。


## 8. 建议接手顺序

如果新工程师要接手，建议按这个顺序看：

1. 先看 `front-end/src/pages/`，了解页面入口和评估流程
2. 再看 `front-end/src/components/report/`，理解报告如何展示
3. 看 `front-end/src/lib/assessmentAi.js` 和 `historyService.js`
4. 看 `back-end/code/algorithms/python/bridge.py`
5. 看 `back-end/code/python/app/algorithms/api_server.py`
6. 最后按模块进入 `prompts/` 和对应算法文件


## 9. 近期和 AI 相关的改动总结

近期已完成的 AI 相关改动包括：

- 四个模块都补齐了 AI 分析功能
- 各模块采用各自独立 prompt
- AI 结果支持保存到历史记录
- AI 输出统一弱化精确力学数值
- AI 输出统一强调趋势、波动、对称性、稳定性和风险倾向
- AI 输出统一控制为中等篇幅，避免过长或过碎


## 10. 当前 Git 远端

当前仓库远端为：

```text
origin -> https://github.com/liudada118/laonianren.git
```

如果后续需要推送，请先确认本地未误带测试文件、临时输出目录和无关缓存文件。


## 11. 环境准备与复现步骤

这一节是给新开发工程师直接照着复现系统用的。

### 11.1 推荐环境

- Node.js：建议 18 或以上
- npm：随 Node 一起安装即可
- Python：建议 3.10 到 3.12
- 系统：
  - Windows 可直接使用当前项目结构
  - macOS 也可以使用，但 Python 虚拟环境路径不同

### 11.2 仓库拉取

```bash
git clone https://github.com/liudada118/laonianren.git
cd laonianren-github
git checkout python3
```

### 11.3 需要安装什么包

这个项目有三类依赖：

1. Electron / Node 主进程依赖
2. React 前端依赖
3. Python 算法与 AI 服务依赖

#### A. back-end/code 的 npm 依赖

在 `back-end/code` 下执行：

```bash
npm install
```

它会安装 `back-end/code/package.json` 里定义的依赖。

这一层的核心依赖包括：

- `electron`
- `express`
- `serialport`
- `sqlite3`
- `axios`
- `ws`

#### B. front-end 的 npm 依赖

在 `front-end` 下执行：

```bash
npm install
```

它会安装 `front-end/package.json` 里的前端依赖。

核心依赖包括：

- `react`
- `vite`
- `echarts`
- `three`
- `concurrently`
- `express`

说明：

- 你现在从 `back-end/code` 执行 `npm start` 时，`start-electron.js` 会检查 `front-end/node_modules`
- 如果前端依赖还没装，它会尝试自动执行一次 `front-end` 下的 `npm install`
- 但为了稳定复现，仍然建议第一次手动执行一次 `front-end/npm install`

#### C. Python 依赖

Python 依赖文件在：

- `back-end/code/python/app/algorithms/requirements.txt`

当前核心 Python 包包括：

- `fastapi`
- `uvicorn`
- `numpy`
- `matplotlib`
- `scipy`
- `openai`

### 11.4 Python 虚拟环境安装方式

#### Windows

在仓库根目录执行：

```bash
cd back-end/code/python
python -m venv venv
venv\Scripts\pip install -r app/algorithms/requirements.txt
```

#### macOS

在仓库根目录执行：

```bash
cd back-end/code/python
python3 -m venv venv
venv/bin/pip install -r app/algorithms/requirements.txt
```

说明：

- 当前 `front-end/scripts/run-pyserver.cjs` 会优先寻找 `back-end/code/python/venv`
- Windows 优先找 `venv/Scripts/python.exe`
- macOS 优先找 `venv/bin/python` 或 `venv/bin/python3`
- 所以推荐把虚拟环境就建在这个固定位置，项目会自动识别

### 11.5 大模型配置

AI 服务配置文件读取逻辑在：

- `back-end/code/python/app/algorithms/llm_config.py`

默认优先级是：

1. 环境变量
2. `llm_settings.json`
3. 代码默认值

推荐做法：

1. 复制示例文件
2. 改成自己的 API Key

示例文件：

- `back-end/code/python/app/algorithms/llm_settings.example.json`

建议复制为：

- `back-end/code/python/app/algorithms/llm_settings.json`

然后填写：

- `api_key`
- `base_url`
- `model`

也可以直接用环境变量：

- `MOONSHOT_API_KEY`
- `MOONSHOT_BASE_URL`
- `MOONSHOT_MODEL`

### 11.6 标准启动方式

这是目前用户自己在用、也是当前最推荐的启动方式：

在 `back-end/code` 目录执行：

```bash
cd back-end/code
npm start
```

这条命令会启动 Electron 桌面端入口。

当前链路是：

1. `back-end/code/package.json` 的 `start`
2. 执行 `node scripts/start-electron.js`
3. `start-electron.js` 会检查前端依赖
4. 然后拉起 Electron
5. Electron 再使用前端与本地服务链路

所以对当前项目来说，你要告诉别人：

- 这个系统平时就是从 `back-end/code` 启动
- 常用命令就是 `npm start`

### 11.7 如果只想单独调前端和 Python

如果只是做前端联调，也可以单独启动前端：

```bash
cd front-end
npm start
```

这个命令会同时拉起：

- Vite 前端开发服务
- Node 本地服务
- Python AI 服务

其中 Python AI 服务的启动脚本是：

- `front-end/scripts/run-pyserver.cjs`

### 11.8 复现建议顺序

从零复现时，建议按下面顺序操作：

1. `git clone` 仓库并切到 `python3`
2. 在 `back-end/code` 执行 `npm install`
3. 在 `front-end` 执行 `npm install`
4. 在 `back-end/code/python` 创建 `venv`
5. 安装 `requirements.txt`
6. 配置 `llm_settings.json`
7. 回到 `back-end/code` 执行 `npm start`

### 11.9 常见问题

#### 1. AI 报 Python service not running

通常说明：

- Python 虚拟环境没建好
- Python 依赖没装
- `api_server.py` 没被成功拉起

优先检查：

- `back-end/code/python/venv` 是否存在
- `requirements.txt` 是否已安装
- `llm_settings.json` 是否已配置

#### 2. AI 报 HTTP 500

通常说明：

- Python AI 服务启动了，但模型调用失败
- API Key、Base URL、模型名配置有问题
- 大模型接口可用，但返回内容不符合预期

优先检查：

- `llm_settings.json`
- 网络能否访问模型服务
- Python 控制台报错

#### 3. front-end 能开，但 Electron 启不来

优先检查：

- `back-end/code/node_modules` 是否已安装
- `front-end/node_modules` 是否已安装
- 本机是否支持 Electron 运行

### 11.10 对外说明时可以直接这样说

如果你要把这套系统发给另一个开发工程师，最简洁的说法可以是：

> 这个项目当前标准启动方式是：进入 `back-end/code` 后执行 `npm start`。  
> 首次运行前，需要先安装 `back-end/code` 和 `front-end` 的 npm 依赖，再在 `back-end/code/python` 下创建 `venv` 并安装 `requirements.txt`，最后配置 `llm_settings.json`。
