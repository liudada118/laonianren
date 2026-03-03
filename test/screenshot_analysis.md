# 测试分析

## 截图分析
T01 截图显示的是 DevTools 页面而不是应用 UI。需要在测试中获取正确的窗口（非 DevTools 窗口）。

## MODE_TYPE_MAP
- 1: ['HL', 'HR'] - 握力评估
- 11: ['HL'] - 握力左手
- 12: ['HR'] - 握力右手
- 2: ['HL', 'HR']
- 3: ['sit', 'foot1'] - 起坐评估
- 4: ['foot1'] - 静态站立
- 5: ['foot1', 'foot2', 'foot3', 'foot4'] - 步态评估

重置模式应传 null 而非 0。

## 测试结果 (第一轮)
- 21/23 通过
- T18 (getColHistory) 超时 - 已知后端 Bug
- T21 (setActiveMode=0) 失败 - mode=0 不在 MODE_TYPE_MAP 中，应传 null

## 需要修复
1. 截图获取正确窗口
2. T21 传 null 重置
3. 增加更多 UI 页面测试（用户要求）
