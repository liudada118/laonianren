# 步态报告前端渲染改造方案

## 需要改造的3个部分

### 1. 完整足印与平均步态 (pressureEvolution)
- 后端函数: `plot_dynamic_pressure_evolution()` (line 2081)
- 当前: 生成 2x10 网格热力图 PNG
- 数据: 左右脚各选1步最佳步态，每步10个关键时刻的裁剪帧
- 需要输出:
  - `pressureEvolutionData.left.frames`: 10个裁剪后的2D矩阵
  - `pressureEvolutionData.left.titles`: 10个标题字符串
  - `pressureEvolutionData.right.frames`: 10个裁剪后的2D矩阵
  - `pressureEvolutionData.right.titles`: 10个标题字符串

### 2. 步态平均摘要 (gaitAverage)
- 后端函数: `analyze_gait_and_plot()` (line 1891)
- 当前: 生成左右脚平均热力图 + COP轨迹 PNG
- 数据: 左右脚各自的平均热力图矩阵 + COP轨迹坐标
- 需要输出:
  - `gaitAverageData.left.heatmap`: 2D矩阵 (CANVAS_H x CANVAS_W)
  - `gaitAverageData.left.cops`: [[xs, ys], ...] COP轨迹
  - `gaitAverageData.left.stepCount`: 步数
  - `gaitAverageData.right.heatmap`: 同上
  - `gaitAverageData.right.cops`: 同上
  - `gaitAverageData.right.stepCount`: 步数

### 3. 足印热力图 (footprintHeatmap)
- 后端函数: `plot_all_largest_regions_heatmap()` (line 1775)
- 当前: 生成累积热力图 + FPA角度线 PNG
- 数据: 累积热力图矩阵 + 每步FPA几何数据
- 需要输出:
  - `footprintHeatmapData.heatmap`: 2D矩阵 (H x W)
  - `footprintHeatmapData.fpaLines`: [{angle, heel:[x,y], fore:[x,y], isRight}, ...]

## 前端渲染方案
- 使用 Canvas 2D 绘制热力图
- 实现 jet colormap 映射
- 使用高斯模糊平滑 (CSS filter 或 Canvas OffscreenCanvas)
- COP轨迹用 Canvas path 绘制
- FPA线用 Canvas line 绘制
