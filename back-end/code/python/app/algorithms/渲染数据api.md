# 渲染数据 API 文档

> 本文档描述三个前端渲染数据封装模块的使用方式。每个模块对应一个评估类型，提供总入口方法和按可视化区域拆分的数据提取方法。

---

## 目录

- [1. 握力评估 - glove_render_data.py](#1-握力评估)
- [2. 起坐评估 - sit_stand_render_data.py](#2-起坐评估)
- [3. 静态站立评估 - one_step_render_data.py](#3-静态站立评估)
- [4. 通用使用模式](#4-通用使用模式)

---

## 1. 握力评估

**文件**: `algorithms/glove_render_data.py`
**导入源**: `get_glove_info_from_csv.py`
**前端组件**: `GripReport.jsx`

### 总入口

```python
from glove_render_data import generate_grip_report

result = generate_grip_report(sensor_data, hand_type, times=None, imu_data=None)
# sensor_data: list[list] | np.ndarray - shape [N, 256]，传感器ADC数据
# hand_type: str - '左手' 或 '右手'（决定传感器索引映射）
# times: list[float] | None - 时间戳数组 [N]，单位秒（None则按0.01s间隔自动生成）
# imu_data: list[list] | None - IMU四元数 [N, 4]（None则不计算欧拉角/角速度）
```

### 拆分方法一览

| 方法 | 渲染区域 | 前端组件位置 | 返回类型 |
|------|----------|-------------|----------|
| `get_overview(result)` | 基本信息卡片 | #overview | dict |
| `get_time_analysis(result)` | 时间分析表格 | #time-analysis | list[dict] |
| `get_finger_data(result)` | 峰值帧各部位数据表 | #peak-data | list[dict] |
| `get_force_time_series(result)` | 力-时间曲线原始数据 | #force-curve | dict |
| `get_force_time_echarts_option(result)` | 力-时间曲线 ECharts配置 | #force-curve | dict |
| `get_force_distribution(result)` | 力占比(饼图/堆叠图) | #force-stack, #pie | list[dict] |
| `get_euler_data(result)` | 欧拉角原始数据 | #euler | dict |
| `get_euler_echarts_option(result)` | 欧拉角 ECharts配置 | #euler | dict |
| `get_angular_velocity_data(result)` | 角速度+抖动检测 | #angular | dict |

### 各方法返回结构

#### `get_overview(result)`

```json
{
  "handType": "左手",
  "totalFrames": 1747,
  "timeRange": "0.000s ~ 17.460s",
  "totalForce": 58.5,
  "totalArea": 240,
  "peakInfo": { "peak_force": 85.2, "peak_time": 6.340 }
}
```

#### `get_time_analysis(result)`

```json
[
  { "label": "抓握开始时间", "value": "5.040 s" },
  { "label": "峰值力时间", "value": "6.340 s" },
  { "label": "到达峰值耗时", "value": "1.300 s" },
  { "label": "峰值区间开始", "value": "5.800 s" },
  { "label": "峰值区间结束", "value": "8.200 s" },
  { "label": "峰值持续时间", "value": "2.400 s" },
  { "label": "峰值力", "value": "85.20 N" },
  { "label": "检测阈值", "value": "30°/s" },
  { "label": "抖动次数", "value": "2 次" },
  { "label": "平均角速度", "value": "12.50°/s" },
  { "label": "最大角速度", "value": "45.30°/s" }
]
```

#### `get_finger_data(result)`

```json
[
  { "name": "大拇指", "key": "thumb", "force": 12.5, "area": 48, "adc": 320, "points": "24/30" },
  { "name": "食指", "key": "index_finger", "force": 15.3, "area": 52, "adc": 410, "points": "26/30" },
  { "name": "中指", "key": "middle_finger", "force": 13.8, "area": 45, "adc": 380, "points": "22/30" },
  { "name": "无名指", "key": "ring_finger", "force": 8.2, "area": 38, "adc": 260, "points": "19/30" },
  { "name": "小拇指", "key": "little_finger", "force": 4.1, "area": 25, "adc": 150, "points": "12/30" },
  { "name": "手掌", "key": "palm", "force": 4.6, "area": 32, "adc": 180, "points": "16/30" }
]
```

#### `get_force_time_series(result)`

```json
{
  "times": [0.0, 0.035, 0.070, "...约500个采样点"],
  "forceTimeSeries": {
    "thumb": [0.0, 0.1, 0.3, "..."],
    "index_finger": [0.0, 0.2, 0.5, "..."],
    "middle_finger": [0.0, 0.1, 0.4, "..."],
    "ring_finger": [0.0, 0.0, 0.2, "..."],
    "little_finger": [0.0, 0.0, 0.1, "..."],
    "palm": [0.0, 0.0, 0.1, "..."],
    "total": [0.0, 0.4, 1.6, "..."]
  }
}
```

> 前端渲染: ECharts 多线折线图，7条线分别对应5个手指+手掌+总力

#### `get_force_distribution(result)`

```json
[
  { "name": "大拇指", "key": "thumb", "force": 12.5, "ratio": 0.2137 },
  { "name": "食指", "key": "index_finger", "force": 15.3, "ratio": 0.2615 },
  { "name": "中指", "key": "middle_finger", "force": 13.8, "ratio": 0.2359 },
  { "name": "无名指", "key": "ring_finger", "force": 8.2, "ratio": 0.1402 },
  { "name": "小拇指", "key": "little_finger", "force": 4.1, "ratio": 0.0701 },
  { "name": "手掌", "key": "palm", "force": 4.6, "ratio": 0.0786 }
]
```

> 前端渲染: ECharts 饼图 / 堆叠面积图

#### `get_euler_data(result)`

```json
{
  "times": [0.0, 0.035, 0.070, "..."],
  "roll": [2.1, 2.3, 2.5, "..."],
  "pitch": [-5.0, -4.8, -4.6, "..."],
  "yaw": [10.2, 10.1, 10.3, "..."]
}
```

> 前端渲染: ECharts 三线折线图 (Roll/Pitch/Yaw)

#### `get_angular_velocity_data(result)`

```json
{
  "times": [0.0, 0.035, 0.070, "..."],
  "angularVelocity": [5.2, 6.1, 8.3, "..."]
}
```

> 前端渲染: ECharts 折线图，可叠加抖动阈值水平线 (默认30°/s)

---

## 2. 起坐评估

**文件**: `algorithms/sit_stand_render_data.py`
**导入源**: `generate_sit_stand_pdf_v3.py`
**前端组件**: `SitStandAssessment.jsx`

### 总入口

```python
from sit_stand_render_data import generate_sit_stand_report

result = generate_sit_stand_report(stand_data, sit_data, username="用户")
# stand_data: list[list] | np.ndarray - shape [N, 4096]，脚垫压力数据（内部reshape为64×64）
# sit_data: list[list] | np.ndarray - shape [M, 1024]，坐垫压力数据（内部reshape为32×32）
# username: str - 用户名 (默认 "用户")
```

### 拆分方法一览

| 方法 | 渲染区域 | 返回类型 |
|------|----------|----------|
| `get_duration_stats(result)` | 基本信息卡片(周期统计) | dict |
| `get_stand_evolution_images(result)` | 站立演变热力图(2×11网格) | list[dict] |
| `get_sit_evolution_images(result)` | 坐姿演变热力图(1×11网格) | list[dict] |
| `get_stand_cop_images(result)` | 站立COP轨迹图(左右脚) | dict |
| `get_sit_cop_image(result)` | 坐姿COP轨迹图 | str/None |
| `get_force_curve_data(result)` | 力-时间曲线原始数据 | dict |
| `get_stand_force_echarts_option(result)` | 站立力曲线 ECharts配置 | dict |
| `get_sit_force_echarts_option(result)` | 坐姿力曲线 ECharts配置 | dict |

### 各方法返回结构

#### `get_duration_stats(result)`

```json
{
  "total_duration": 26.84,
  "num_cycles": 5,
  "avg_duration": 5.37,
  "stand_frames": 1126,
  "sit_frames": 1126,
  "stand_peaks": 6,
  "username": "用户"
}
```

#### `get_stand_evolution_images(result)`

```json
[
  { "label": 0, "sublabel": 0, "image": "data:image/png;base64,iVBOR..." },
  { "label": 0, "sublabel": 1, "image": "data:image/png;base64,..." },
  "... 共22个元素 (2行×11列, label=0为左脚, label=1为右脚)"
]
```

> 前端渲染: 2行×11列图片网格，直接 `<img src={item.image} />`
> sublabel 0~10 对应周期进度 0%~100%

#### `get_sit_evolution_images(result)`

```json
[
  { "label": 0, "image": "data:image/png;base64,..." },
  { "label": 1, "image": "data:image/png;base64,..." },
  "... 共11个元素"
]
```

> 前端渲染: 1行×11列图片网格

#### `get_stand_cop_images(result)`

```json
{
  "left": "data:image/png;base64,iVBOR...",
  "right": "data:image/png;base64,iVBOR..."
}
```

> 前端渲染: 两张并排 `<img>` 图片，热力图背景+COP轨迹叠加

#### `get_sit_cop_image(result)`

```
"data:image/png;base64,iVBOR..."
```

> 前端渲染: 单张 `<img>` 图片

#### `get_force_curve_data(result)`

```json
{
  "stand_times": [0.0, 0.024, 0.048, "..."],
  "stand_force": [12500, 13200, 14100, "..."],
  "sit_times": [0.0, 0.024, 0.048, "..."],
  "sit_force": [8500, 8600, 8700, "..."],
  "stand_peaks_idx": [42, 210, 378, 546, 714, 882]
}
```

> 前端渲染: ECharts 折线图，建议前端做 LTTB 降采样
> `stand_peaks_idx` 用于在图上标记周期分界线

---

## 3. 静态站立评估

**文件**: `algorithms/one_step_render_data.py`
**导入源**: `OneStep_report.py`
**前端组件**: `StandingReport.jsx`

### 总入口

```python
from one_step_render_data import generate_standing_report

result = generate_standing_report(data_array, fps=42, threshold_ratio=0.8)
# data_array: list[list] | np.ndarray - shape [N, 4096]，足底压力数据（内部reshape为64×64）
# fps: float - 采样率 (默认42Hz)
# threshold_ratio: float - COP计算阈值 (默认0.8)
```

### 拆分方法一览

| 方法 | 渲染区域 | 前端组件位置 | 返回类型 |
|------|----------|-------------|----------|
| `get_arch_overview(result)` | 足弓指标+尺寸+面积 | #overview | dict |
| `get_pressure_distribution(result)` | 前/中/后足压力占比 | #pressure | dict |
| `get_arch_zone_data(result)` | 足弓分区坐标(Canvas) | #arch-zones | dict |
| `get_cop_trajectory_data(result)` | COP距离信息 | #cop-heatmap | dict |
| `get_cop_time_series(result)` | 15项COP平衡参数 | #cop-params | dict |
| `get_cop_metrics(result)` | 左右脚COP统计指标 | 研究用 | dict |
| `get_sway_features(result)` | 摇摆特征 | 研究用 | dict |
| `get_bilateral_pressure_ratio(result)` | 左右脚压力比 | #overview | dict |

### 各方法返回结构

#### `get_arch_overview(result)`

```json
{
  "left": {
    "archIndex": 0.2345,
    "archType": "Normal",
    "clarkeAngle": 42.5,
    "clarkeType": "正常足",
    "staheliRatio": 0.65,
    "length": 25.3,
    "width": 9.8,
    "totalArea": 142.5,
    "forefootArea": 58.2,
    "midfootArea": 32.1,
    "hindfootArea": 52.2
  },
  "right": {
    "archIndex": 0.2512,
    "archType": "Normal",
    "clarkeAngle": 40.8,
    "clarkeType": "正常足",
    "staheliRatio": 0.68,
    "length": 25.1,
    "width": 9.6,
    "totalArea": 138.9,
    "forefootArea": 55.8,
    "midfootArea": 34.5,
    "hindfootArea": 48.6
  }
}
```

> 前端渲染: 左右脚对比表格/卡片

#### `get_pressure_distribution(result)`

```json
{
  "left": {
    "forefoot": 45.2,
    "midfoot": 18.6,
    "hindfoot": 36.2
  },
  "right": {
    "forefoot": 42.8,
    "midfoot": 20.1,
    "hindfoot": 37.1
  }
}
```

> 前端渲染: ECharts 柱状图或饼图，值为百分比(%)

#### `get_arch_zone_data(result)`

```json
{
  "leftSectionCoords": [
    [[x,y], [x,y], "...前足坐标"],
    [[x,y], [x,y], "...中足坐标"],
    [[x,y], [x,y], "...后足坐标"]
  ],
  "rightSectionCoords": ["...同上"],
  "peakFrameFlat": [0, 0, 5, 12, "...共4096个值, 64×64矩阵展平"]
}
```

> 前端渲染: InteractiveArchChart 组件，Canvas 自定义绘制足弓分区

#### `get_cop_trajectory_data(result)`

```json
{
  "distLeftToBoth": 2.35,
  "distRightToBoth": 2.18,
  "leftForward": 0.82
}
```

> 前端渲染: InteractiveCOPChart 组件
> 注意: COP轨迹坐标数组需通过 api_server.py 的 `/analyze-standing` 接口额外提取

#### `get_cop_time_series(result)`

```json
{
  "pathLength": 245.8,
  "contactArea": 1820.5,
  "majorAxis": 18.6,
  "minorAxis": 12.3,
  "lsRatio": 1.51,
  "eccentricity": 0.75,
  "deltaY": 15.2,
  "deltaX": 22.8,
  "maxDisplacement": 12.5,
  "minDisplacement": 0.8,
  "avgVelocity": 8.2,
  "rmsDisplacement": 5.6,
  "stdY": 3.8,
  "stdX": 5.2
}
```

> 前端渲染: 参数表格 + ECharts 速度折线图

| 字段 | 含义 | 单位 |
|------|------|------|
| pathLength | COP轨迹长度 | mm |
| contactArea | COP活动面积 | mm² |
| majorAxis | 最大摇摆幅度 | mm |
| minorAxis | 最小摇摆幅度 | mm |
| lsRatio | 摇摆幅度系数 | - |
| eccentricity | 摇摆均匀性系数 | - |
| deltaY | 左右摇摆幅度 | mm |
| deltaX | 前后摇摆幅度 | mm |
| maxDisplacement | 最大偏心距 | mm |
| minDisplacement | 最小偏心距 | mm |
| avgVelocity | 平均速度 | mm/s |
| rmsDisplacement | RMS位移 | mm |
| stdY | 左右标准差 | mm |
| stdX | 前后标准差 | mm |

#### `get_bilateral_pressure_ratio(result)`

```json
{
  "leftRatio": 48.5,
  "rightRatio": 51.5
}
```

> 前端渲染: 进度条或饼图，值为百分比(%)

---

## 4. 通用使用模式

### 基本用法

```python
# 1. 调用总入口获取完整结果（传入数组，非CSV）
result = generate_grip_report(sensor_data, '左手')  # sensor_data: [N, 256]

# 2. 按需提取各区域数据
overview = get_overview(result)
force_data = get_force_time_series(result)
euler = get_euler_data(result)
```

### 在 api_server.py 中使用

```python
from glove_render_data import generate_grip_report, get_overview, get_force_time_series

@app.post("/analyze-grip-v2")
def analyze_grip_v2(request: GripAnalyzeRequest):
    result = generate_grip_report(request.sensor_data, request.hand_type)
    return {
        "success": True,
        "overview": get_overview(result),
        "forceData": get_force_time_series(result),
        "fingers": get_finger_data(result),
        # ... 按需返回
    }
```

### 直接获取 ECharts 配置

部分方法提供 `*_echarts_option` 变体，返回可直接传入 ECharts 的 option 对象:

```python
# Python 端生成 ECharts option
option = get_force_time_echarts_option(result)

# 前端直接使用
# const chart = echarts.init(dom)
# chart.setOption(pythonResult.forceChartOption)
```

### 数据流总览

```
设备采集 → [N, X] 数组
    │
    ▼
总入口方法 (generate_*_report)
    │  ┌─ 握力:   sensor_data [N, 256] + hand_type
    │  ├─ 起坐:   stand_data [N, 4096] + sit_data [M, 1024]
    │  └─ 站立:   data_array [N, 4096]
    │
    ├── 返回完整 result dict
    │
    ▼
拆分方法 (get_*)
    │
    ├── get_overview()          → 基本信息卡片
    ├── get_*_data()            → 原始数据 (前端自行渲染)
    ├── get_*_images()          → base64图片 (直接<img>展示)
    └── get_*_echarts_option()  → ECharts配置 (直接setOption)
    │
    ▼
FastAPI 序列化为 JSON → 前端 React 组件渲染
```

### 测试方法

每个 render_data.py 都包含 `if __name__ == '__main__'` 测试入口，可直接运行：

```bash
cd algorithms
python one_step_render_data.py    # 静态站立测试
python glove_render_data.py       # 握力测试
python sit_stand_render_data.py   # 起坐测试
```

也可以替换 main 中的测试数据为真实的 `[1, X]` 数组来验证输出。
