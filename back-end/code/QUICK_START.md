# 快速启动（给新同事）

这套系统建议直接从 `back-end/code` 启动：

```bash
cd back-end/code
npm install
npm start
```

## 运行前需要安装

1. Node.js 18+（推荐 Node.js 20 LTS）
2. Python 3.10+（推荐 Python 3.11）
3. Git

macOS 建议先执行：

```bash
xcode-select --install
```

## `npm start` 会自动做什么

首次启动时，`back-end/code/scripts/start-electron.js` 会自动处理：

1. 检查并安装 `front-end/node_modules`
2. 自动生成 `back-end/code/python/app/algorithms/llm_settings.json`（来自 `llm_settings.example.json`）
3. 自动创建 `back-end/code/python/venv`
4. 自动安装 Python 依赖（`back-end/code/python/app/algorithms/requirements.txt`）

后续启动会根据 `requirements.txt` 的哈希判断依赖是否变化，没变化就不会重复安装。

## 常见问题

1. Python 没找到  
设置环境变量 `PYTHON_EXECUTABLE` 指向 Python 可执行文件，再执行 `npm start`。

2. 自动安装 Python 依赖失败（网络/权限）  
手动执行：

Windows:
```bash
cd back-end/code/python
venv\Scripts\python.exe -m pip install -r app\algorithms\requirements.txt
```

macOS/Linux:
```bash
cd back-end/code/python
./venv/bin/python -m pip install -r app/algorithms/requirements.txt
```

3. 暂时跳过自动 Python 引导  
可设置 `SKIP_PYTHON_BOOTSTRAP=1` 后再启动（不推荐长期使用）。

## 大模型 API Key 配置

文件位置：

`back-end/code/python/app/algorithms/llm_settings.json`

常用字段：

```json
{
  "api_key": "",
  "base_url": "https://api.moonshot.cn/v1",
  "model": "kimi-k2.5",
  "thinking": { "type": "disabled" }
}
```

不要把真实 `api_key` 提交到 GitHub。
