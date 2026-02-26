# 动态足底压力与 COP 演化视频生成

本项目通过多块 64x64 足底压力矩阵 CSV 数据，完成时间对齐、去噪、拼接、步态分段与标定，最终生成左右脚对比的仪表盘视频（压力热图 + COP 轨迹 + 负荷/面积/速度曲线）。

## 依赖

- Python 3.8+
- 依赖包：`requirements.txt`
- 本地 FFmpeg（用于导出 mp4）

```bash
pip install -r requirements.txt
```

## 输入数据

每次采集对应 4 个 CSV 文件（1.csv ~ 4.csv），每个 CSV 包含：

- `time`：时间戳（`YYYY/MM/DD HH:MM:SS.mmm`）
- `data`：长度为 4096 的一维数组（64x64 展开）
- `max`：该帧最大压力值

脚本会按文件名数字顺序读取并对齐时间轴，然后将 4 块矩阵拼成一张完整的压力面。

## 处理流程

1. 基础配置  
   - 设置 FFmpeg 路径、中文字体。  
   - 设置 `BODY_WEIGHT_KG` 作为力值标定基准。

2. 时间对齐与数据读取  
   - 解析 `time` 字段。  
   - 以统一时间轴对齐 4 个 CSV（允许一定延迟容差）。  
   - 缺失帧补零。

3. 清理与拼接  
   - 将 4096 数据还原为 64x64。  
   - 过滤低压像素与低变化像素。  
   - 删除弱连通区域或触边噪声。  
   - 拼接 4 块矩阵并旋转到统一方向。

4. 行走区间检测与静止标定  
   - 通过 COP 标准差识别行走区间。  
   - 截取行走前的静止帧，计算 `GLOBAL_K` 用于 ADC->牛顿力标定。

5. 足部识别与步态选择  
   - 统计足部中心，区分左右脚区域。  
   - 识别步态事件，选取左右脚峰值负荷最大的步态。

6. 视频生成  
   - 计算 COP 轨迹、负荷(牛顿)、接触面积、COP 速度。  
   - 生成左右脚对比仪表盘动画并输出 mp4（失败则输出 gif）。

## 关键参数

在 `generate_video_dynamic_pressure_cop_evolution.py` 中修改：

- `plt.rcParams['animation.ffmpeg_path']`：FFmpeg 路径
- `BODY_WEIGHT_KG`：受试者体重（kg）
- `base_dir`：输入数据目录（包含 1~4.csv）

## 运行方式

```bash
python generate_video_dynamic_pressure_cop_evolution.py
```

若 `base_dir` 不存在，脚本会自动生成 `test_data` 作为模拟输入进行流程验证。

## 输出

默认输出在输入数据目录下：

- `gait_dashboard_force.mp4`
- 若 mp4 保存失败，则回退为 `.gif`
