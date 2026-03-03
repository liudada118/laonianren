# V7 测试分析

## T21 截图分析
- 截图显示"详情"按钮仍然是"详情"文字（未变成"收起"），说明点击没有成功触发展开
- 可能原因：测试脚本中的 SCREENSHOT_DIR 没有更新（仍然写入 v6_fixed 目录），所以截图可能是旧的
- 或者：按钮选择器 `button:has-text("详情")` 匹配到了但 click 没有触发 setExpandedRow

## T18 分析
- Playwright click 操作卡在 "performing click action" 阶段
- 这通常意味着 click 触发了导航，Playwright 在等待 navigation settle
- 解决方案：使用 page.waitForTimeout 替代自动等待，或使用 noWaitAfter 选项
