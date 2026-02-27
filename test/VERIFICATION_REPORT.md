# JS 算法验证报告

**验证日期**: 2026-02-27  
**数据来源**: Python 原始数据 + Python 生成的报告 (PDF/JSON)  
**验证目标**: 对比 JS 版本算法与 Python 版本的输出一致性  
**分支**: `Algorithm` (基于 `laonianren2`)

---

## 1. 验证总览

| 算法模块 | 验证项数 | 通过 | 失败 | 通过率 | 严重程度 |
|---------|---------|------|------|--------|---------|
| 站立算法 (Standing) | 44 | 3 | 41 | **6.8%** | **严重** |
| 握力算法 (Grip) | 24 | 2 | 22 | **8.3%** | **严重** |
| 起坐算法 (Sit-Stand) | 15 | 15 | 0 | **100.0%** | 正常 |
| 步态算法 (Gait) | 23 | 20 | 3 | **87.0%** | 轻微 |
| **总计** | **106** | **40** | **66** | **37.7%** | - |

---

## 2. 站立算法 (Standing) - 严重偏差

### 2.1 问题汇总

站立算法存在 **系统性偏差**，几乎所有指标都与 Python 结果不一致。核心问题集中在以下几个方面：

#### 问题1: COP 轨迹计算偏差巨大

| 指标 | JS 值 | Python 值 | 偏差 |
|------|-------|-----------|------|
| path_length | 813.25 | 102.38 | 694% |
| contact_area | 125.48 | 6.52 | 1824% |
| avg_velocity | 41.37 | 5.21 | 694% |
| delta_y | 10.36 | 1.34 | 672% |

**根因分析**: JS 版本的 COP 计算可能在坐标系转换（旋转、镜像）上与 Python 不一致，导致 COP 轨迹路径长度和速度被严重放大。`preprocessOriginData` 函数中的 `rotate90ccw`、`mirroredHorizon`、`mirroredVertical` 参数组合可能与 Python 预处理不匹配。

#### 问题2: 足弓特征检测错误

| 指标 | JS 值 | Python 值 |
|------|-------|-----------|
| 左脚 area_index | 0.0108 | 0.347 |
| 左脚 area_type | 高足弓(high arch) | 扁平足(flat foot) |
| 右脚 area_type | 高足弓(high arch) | 扁平足(flat foot) |
| 左脚 staheli_ratio | null | 1.662 |

**根因分析**: 
- `detectHeelForFrame` 中左右脚分离逻辑（左半/右半矩阵）可能与 Python 的分离方式不同
- `divideXRegions` 的 4 区域划分比例 (3:4:4:4) 可能与 Python 不一致
- `calculateRegionAreas` 中 area_index 的阈值判定 (0.21/0.26) 与 Python 不同
- 连通域检测 (BFS) 替代 cv2.connectedComponents 可能存在边界行为差异

#### 问题3: 脚部尺寸和面积严重偏小

| 指标 | JS 值 | Python 值 | 偏差 |
|------|-------|-----------|------|
| left_length | 2.9 | 18.3 | 84% |
| left_width | 2.2 | 14.1 | 84% |
| left_area_cm2 | 0.98 | 101.92 | 99% |

**根因分析**: `largestComponentPointsMulti` 函数可能没有正确识别出完整的脚部区域，导致检测到的面积极小。

### 2.2 修复建议

1. **COP 预处理对齐**: 仔细对比 Python 的 `preprocess_data_array` 函数与 JS 的 `preprocessOriginData`，确保旋转和镜像操作完全一致
2. **连通域检测验证**: 对单帧数据分别用 Python cv2 和 JS BFS 做连通域检测，对比结果
3. **足弓分区验证**: 输出中间结果（section_coords），与 Python 逐步对比
4. **坐标系统一**: 确认 64x64 矩阵的行列方向定义一致

---

## 3. 握力算法 (Grip) - 严重偏差

### 3.1 问题汇总

#### 问题1: 力值未经 ADC 转换 (最关键)

JS 算法中 `forceTimeSeries` 的计算（第201-210行）**直接累加传感器 ADC 原始值**，没有调用已定义的 `adcToForceSinglePoint()` 函数进行 ADC→力(N) 的转换。

```javascript
// 当前代码 (错误):
for (let j = a; j < b; j++) s += arr[i][j];  // 直接累加 ADC 值

// 应该改为:
for (let j = a; j < b; j++) s += adcToForceSinglePoint(arr[i][j]);  // ADC 转力
```

| 指标 | JS 值 (Cal数据) | Python 值 | 偏差 |
|------|----------------|-----------|------|
| peakForce | 1727 | 111.50 N | 1449% |
| thumb.force | 660 | 43.00 N | 1435% |
| palm.force | 918 | 7.47 N | 12189% |

#### 问题2: 手指区域分区不一致

| 部位 | JS PART_SLICES | Python 分区 |
|------|---------------|-------------|
| Thumb | [0, 42] (42点) | 12点 |
| Index | [42, 84] (42点) | 12点 |
| Middle | [84, 126] (42点) | 12点 |
| Ring | [126, 168] (42点) | 12点 |
| Little | [168, 210] (42点) | 12点 |
| Palm | [210, 256] (46点) | 72点 |
| **总计** | **256** | **132** |

Python 版本的传感器映射总计只有 132 个有效传感器点（其余 124 个可能是无效/填充区域），而 JS 版本将全部 256 个位置都纳入计算。

#### 问题3: 峰值帧力值计算同样未转换

第280-305行的峰值帧各区域力值计算也是直接累加 ADC 值，未经 `adcToForceSinglePoint` 转换。

### 3.2 修复建议

1. **在 forceTimeSeries 循环中调用 adcToForceSinglePoint()** 进行 ADC→力 转换
2. **统一 PART_SLICES** 与 Python 版本的传感器映射一致
3. **峰值帧力值计算** 也需要经过 ADC 转换
4. **抖动检测** 阈值和窗口参数需要与 Python 对齐

---

## 4. 起坐算法 (Sit-Stand) - 正常

起坐算法的结构验证 **全部通过 (100%)**。

| 验证项 | 结果 |
|--------|------|
| duration_stats 结构完整性 | ✓ |
| 帧数匹配 | ✓ |
| COP 数据生成 | ✓ |
| 力曲线数据生成 | ✓ |
| 演变数据生成 | ✓ |

> 注意: 起坐算法目前仅验证了输出结构的完整性和合理性，未与 Python 数值进行逐项对比（因缺少 Python JSON 报告）。建议后续补充数值精度验证。

---

## 5. 步态算法 (Gait) - 轻微问题

步态算法通过率 **87.0%**，大部分结构和参数合理。

### 5.1 失败项

| 指标 | JS 值 | 合理范围 | 问题 |
|------|-------|---------|------|
| rightStepTime | 8.857s | 0.1-5.0s | 超出正常步态时间范围 |
| crossStepTime | 5.314s | 0.1-5.0s | 超出范围 |
| walkingSpeed | 0.089 m/s | 0.1-3.0 m/s | 低于正常步行速度 |

**根因分析**: 右脚步数检测可能只检测到 1 步（`rightSteps=1`），导致 `rightStepTime = durationS / 1` 偏大。步数检测的阈值计算 `Math.max(5.0, safeMean(rightForce) * 0.25)` 可能对右脚数据不够敏感。

### 5.2 修复建议

1. 优化步数检测阈值，考虑使用自适应阈值
2. 增加步数检测的最小步数保护逻辑
3. 验证左右脚的力序列数据是否正确分配

---

## 6. 总结与优先级

### 修复优先级

| 优先级 | 算法 | 问题 | 影响 |
|--------|------|------|------|
| **P0** | 握力 | forceTimeSeries 未调用 adcToForceSinglePoint | 所有力值偏差 10-100 倍 |
| **P0** | 握力 | PART_SLICES 分区映射不一致 | 手指力分布完全错误 |
| **P1** | 站立 | COP 预处理坐标系不一致 | COP 轨迹指标全部错误 |
| **P1** | 站立 | 连通域检测/足弓分区逻辑差异 | 足弓类型判断错误 |
| **P2** | 步态 | 步数检测阈值不够鲁棒 | 右脚步态参数异常 |

### 验证脚本说明

```
test/
├── verify_standing.js      # 站立算法验证 (vs Python JSON)
├── verify_grip.js          # 握力算法验证 (vs Python PDF 提取数据)
├── verify_sitstand.js      # 起坐算法验证 (结构完整性)
├── verify_gait.js          # 步态算法验证 (结构 + 合理性)
├── run_all_verify.js       # 综合运行脚本
├── standing_verify_result.json
├── grip_verify_result.json
├── sitstand_verify_result.json
├── gait_verify_result.json
└── VERIFICATION_REPORT.md  # 本报告
```

运行方式:
```bash
cd laonianren
node test/run_all_verify.js
```
