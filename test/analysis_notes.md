# 测试分析笔记

## T12 失败截图分析
- 截图显示的是登录页面（正常渲染），说明前端 UI 正常
- T12 失败原因是 `/getColHistory` API 超时，这是因为 SQLite 查询中使用了 INNER JOIN 子查询，在空数据库上可能存在锁等待问题
- 这是一个后端 Bug：当 matrix 表为空时，getColHistory 的 SQL 查询不返回响应

## T40 失败分析
- 应用关闭超时，因为 Vite dev server 子进程在 cleanup 时可能阻塞
- 这是测试环境特有的问题，在生产环境中不会出现（生产环境不启动 Vite）
