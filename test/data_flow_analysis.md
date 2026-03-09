# 数据流分析笔记

## 关键发现

### 1. 报告数据流转路径
- 评估完成时调用: completeAssessment(type, { completed: true, reportData: xxx }, sensorData)
- AssessmentContext 保存: assessments[type] = { completed: true, report: { completed: true, reportData: xxx }, data: sensorData }
- 后端保存: assessments[type] = { completed: true, report: { completed: true, reportData: xxx }, completedAt: ... }
- HistoryReportView 读取: record.assessments[type].report.reportData

### 2. Dashboard "查看报告" 按钮跳转
- 跳转方式: navigate(item.path, { state: { viewReport: true } })
- GaitAssessment: 支持 viewReportMode (检查 location.state?.viewReport)
- SitStandAssessment: 支持 viewReportMode
- GripAssessment: 不支持 viewReportMode！会回到 idle 状态
- StandingAssessment: 不支持 viewReportMode！会回到 idle 状态

### 3. 历史记录报告查看
- 路径: /history/report?id=xxx&type=grip
- 数据提取: assessmentData?.report?.reportData
- 如果 report 中没有 reportData 字段，则显示 "该评估记录没有保存报告数据"

### 4. 潜在问题
- GripAssessment 和 StandingAssessment 从 Dashboard 点"查看报告"时，不会进入 report 模式
- 历史记录中如果 reportData 为 null（评估完成但报告数据未保存），则无法查看报告
- 每次 completeAssessment 都会触发 saveAssessmentSession，但传入的是当前内存中所有 assessments，可能覆盖之前的数据
