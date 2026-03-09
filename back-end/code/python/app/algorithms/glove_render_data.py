"""
握力评估 - 前端渲染数据封装模块
====================================
导入 get_glove_info_from_csv.py 的计算逻辑，
将计算结果拆分为独立方法，供前端各可视化组件分别调用。

总入口方法: generate_grip_report(sensor_data, hand_type, times=None, imu_data=None)

数据流: [N, 256]数组 → Python计算 → 结构化dict → 前端ECharts渲染
对应前端组件: GripReport.jsx
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from get_glove_info_from_csv import process_glove_data_from_content


# ============================================================
# 总入口方法 (类似 generate_foot_pressure_report)
# ============================================================

def generate_grip_report(sensor_data, hand_type, times=None, imu_data=None):
    """
    握力评估总入口 - 接收 [N, 256] 传感器数组，返回全部分析结果

    Args:
        sensor_data (list[list] | np.ndarray): 传感器数据，shape [N, 256]
            每帧为长度256的一维数组（已校准ADC值）
        hand_type (str): '左手' 或 '右手'，决定传感器索引映射
        times (list[float] | None): 时间戳数组，shape [N]，单位秒
            如果为None，自动按0.01s间隔生成
        imu_data (list[list] | None): IMU四元数数据，shape [N, 4]
            如果为None，不计算欧拉角和角速度

    Returns:
        dict: 完整分析结果，结构如下:
            {
                'handType': str,
                'hand': str,
                'totalFrames': int,
                'timeRange': str,
                'peakInfo': { 'peak_force', 'peak_time' },
                'timeAnalysis': [{'label', 'value'}],
                'fingers': [{'name','key','force','area','adc','points'}],
                'totalForce': float,
                'totalArea': int,
                'times': [float],
                'forceTimeSeries': { 'thumb':[], ..., 'total':[] },
                'eulerData': { 'roll':[], 'pitch':[], 'yaw':[] },
                'angularVelocity': [float],
            }
    """
    import tempfile

    # 将数组转换为CSV文本格式，复用现有的 process_glove_data_from_content
    csv_content = _arrays_to_glove_csv(sensor_data, times, imu_data)

    tmp_dir = tempfile.mkdtemp(prefix='grip_render_')
    result = process_glove_data_from_content(csv_content, hand_type, output_dir=tmp_dir)
    # 移除 pdf_path，前端不需要
    result.pop('pdf_path', None)
    return result


def _arrays_to_glove_csv(sensor_data, times=None, imu_data=None):
    """
    将数组数据转换为手套CSV文本格式（内部适配函数）

    Args:
        sensor_data: [N, 256] 传感器数据
        times: [N] 时间戳（可选）
        imu_data: [N, 4] IMU四元数（可选）

    Returns:
        str: CSV文本内容
    """
    import io
    import csv

    n_frames = len(sensor_data)

    # 构建header
    headers = ['sensor_data_calibrated', 'relative_time']
    if imu_data is not None:
        headers.append('imu_data_calibrated')

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)

    for i in range(n_frames):
        # sensor_data 转为字符串格式 "[1.0, 2.0, ...]"
        row_data = sensor_data[i]
        if hasattr(row_data, 'tolist'):
            row_data = row_data.tolist()
        sensor_str = '[' + ','.join(str(v) for v in row_data) + ']'

        # 时间戳
        t = times[i] if times is not None else i * 0.01

        row = [sensor_str, str(t)]

        # IMU数据
        if imu_data is not None:
            imu_row = imu_data[i]
            if hasattr(imu_row, 'tolist'):
                imu_row = imu_row.tolist()
            imu_str = '[' + ','.join(str(v) for v in imu_row) + ']'
            row.append(imu_str)

        writer.writerow(row)

    return output.getvalue()


# ============================================================
# 以下为拆分方法，每个方法对应前端一个可视化区域
# 入参均为 generate_grip_report 的返回值 result
# ============================================================


def get_overview(result):
    """
    【渲染区域】基本信息卡片 (GripReport.jsx #overview)
    返回: {
        'handType': str,       # '左手' 或 '右手'
        'totalFrames': int,    # 总帧数
        'timeRange': str,      # 时间范围 (如 '0.000s ~ 10.500s')
        'totalForce': float,   # 总握力 (N)
        'totalArea': int,      # 总接触面积
        'peakInfo': dict|None, # 峰值信息 { 'peak_force', 'peak_time' }
    }
    """
    return {
        'handType': result.get('handType'),
        'totalFrames': result.get('totalFrames'),
        'timeRange': result.get('timeRange'),
        'totalForce': result.get('totalForce'),
        'totalArea': result.get('totalArea'),
        'peakInfo': result.get('peakInfo'),
    }


def get_time_analysis(result):
    """
    【渲染区域】时间分析表格 (GripReport.jsx #time-analysis)
    包含抓握开始时间、峰值力时间、到达峰值耗时、抖动检测等

    返回: list[dict]
        每个元素: { 'label': str, 'value': str }
    前端渲染: 表格或卡片列表
    """
    return result.get('timeAnalysis', [])


def get_finger_data(result):
    """
    【渲染区域】峰值帧各部位数据表 (GripReport.jsx #peak-data)
    6个部位(拇指/食指/中指/无名指/小指/手掌)的力、面积等

    返回: list[dict]
        每个元素: {
            'name': str,    # 中文名 (大拇指/食指/...)
            'key': str,     # 英文key (thumb/index_finger/...)
            'force': float, # 力值 (N)
            'area': int,    # 接触面积
            'adc': int,     # ADC值
            'points': str,  # 有效点/总点 (如 '24/30')
        }
    前端渲染: 数据表格
    """
    return result.get('fingers', [])


def get_force_time_series(result):
    """
    【渲染区域】力-时间曲线 (GripReport.jsx #force-curve)
    7条线: 5个手指 + 手掌 + 总力

    返回: {
        'times': [float],           # 时间轴(秒), 已降采样到~500点
        'forceTimeSeries': {
            'thumb': [float],
            'index_finger': [float],
            'middle_finger': [float],
            'ring_finger': [float],
            'little_finger': [float],
            'palm': [float],
            'total': [float],
        }
    }
    前端渲染: ECharts 多线折线图
    """
    return {
        'times': result.get('times', []),
        'forceTimeSeries': result.get('forceTimeSeries', {}),
    }


def get_force_time_echarts_option(result):
    """
    【渲染区域】力-时间曲线 - 直接生成 ECharts option
    方便前端直接传入 ECharts 实例

    返回: dict (ECharts option 配置)
    """
    times = result.get('times', [])
    fts = result.get('forceTimeSeries', {})

    colors = ['#0066CC', '#0891B2', '#059669', '#D97706', '#9333EA', '#DC2626', '#1F2937']
    names = ['拇指', '食指', '中指', '无名指', '小指', '手掌', '总力']
    keys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm', 'total']

    series = []
    for i, key in enumerate(keys):
        values = fts.get(key, [])
        series.append({
            'name': names[i],
            'type': 'line',
            'data': list(zip(times, values)),
            'smooth': True,
            'symbol': 'none',
            'lineStyle': {'width': 1.5 if key != 'total' else 2.5, 'color': colors[i]},
        })

    return {
        'legend': {'data': names},
        'xAxis': {'type': 'value', 'name': '时间 (s)'},
        'yAxis': {'type': 'value', 'name': '力 (N)'},
        'series': series,
        'tooltip': {'trigger': 'axis'},
    }


def get_force_distribution(result):
    """
    【渲染区域】力分布堆叠图 + 饼图 (GripReport.jsx #force-stack, #pie)
    各部位力占比

    返回: list[dict]
        每个元素: {
            'name': str,    # 中文名
            'key': str,     # 英文key
            'force': float, # 力值 (N)
            'ratio': float, # 占比 (0~1)
        }
    前端渲染: ECharts 堆叠面积图 / 饼图
    """
    fingers = result.get('fingers', [])
    total = result.get('totalForce', 0)
    if total <= 0:
        total = sum(f.get('force', 0) for f in fingers) or 1

    return [
        {
            'name': f['name'],
            'key': f['key'],
            'force': f['force'],
            'ratio': round(f['force'] / total, 4),
        }
        for f in fingers
    ]


def get_euler_data(result):
    """
    【渲染区域】手部姿态欧拉角 (GripReport.jsx #euler)
    3条线: Roll(横滚) / Pitch(俯仰) / Yaw(偏航)

    返回: {
        'times': [float],
        'roll': [float],   # 横滚角(°)
        'pitch': [float],  # 俯仰角(°)
        'yaw': [float],    # 偏航角(°)
    }
    前端渲染: ECharts 三线折线图
    """
    euler = result.get('eulerData', {})
    return {
        'times': result.get('times', []),
        'roll': euler.get('roll', []),
        'pitch': euler.get('pitch', []),
        'yaw': euler.get('yaw', []),
    }


def get_euler_echarts_option(result): 
    """
    【渲染区域】欧拉角 - 直接生成 ECharts option

    返回: dict (ECharts option 配置)
    """
    times = result.get('times', [])
    euler = result.get('eulerData', {})

    configs = [
        ('横滚 (Roll)', 'roll', '#E74C3C'),
        ('俯仰 (Pitch)', 'pitch', '#27AE60'),
        ('偏航 (Yaw)', 'yaw', '#3498DB'),
    ]

    series = []
    for name, key, color in configs:
        values = euler.get(key, [])
        series.append({
            'name': name,
            'type': 'line',
            'data': list(zip(times, values)),
            'smooth': True,
            'symbol': 'none',
            'lineStyle': {'width': 1.5, 'color': color},
        })

    return {
        'legend': {'data': [c[0] for c in configs]},
        'xAxis': {'type': 'value', 'name': '时间 (s)'},
        'yAxis': {'type': 'value', 'name': '角度 (°)'},
        'series': series,
        'tooltip': {'trigger': 'axis'},
    }


def get_angular_velocity_data(result):
    """
    【渲染区域】角速度曲线 + 抖动检测 (GripReport.jsx #angular)

    返回: {
        'times': [float],
        'angularVelocity': [float],  # 角速度(°/s)
    }
    前端渲染: ECharts 折线图, 可叠加抖动阈值线
    """
    return {
        'times': result.get('times', []),
        'angularVelocity': result.get('angularVelocity', []),
    }


# ============================================================
# 测试入口
# ============================================================

if __name__ == '__main__':
    from pprint import pprint

    # ========== 在这里粘贴你的测试数据 ==========
    # sensor_data: [N, 256] 传感器数据
    sensor_data = [
        # [v0, v1, ..., v255],  # 第1帧
        # [v0, v1, ..., v255],  # 第2帧
        [5,0,0,34,42,16,28,31,31,41,33,33,35,32,24,0,20,0,0,34,36,17,29,34,37,29,29,31,40,34,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,47,20,3,0,0,0,0,0,0,0,0,0,2,29,23,0,0,12,0,26,34,19,25,27,23,31,40,29,35,45,32,0,3,18,1,35,48,26,33,36,29,41,58,37,44,60,37,0,4,0,0,26,1,18,49,35,40,30,5,33,53,28,21,0,23,0,0,30,25,2,33,32,27,36,27,36,32,2,2,0],
        [4,0,0,35,42,15,27,32,31,41,33,33,35,32,24,0,21,0,0,35,36,17,29,34,37,30,30,32,40,34,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,48,19,3,0,0,0,0,0,0,0,0,0,2,29,23,0,0,5,0,27,34,18,26,28,23,31,40,30,35,45,31,0,3,18,1,36,48,25,33,36,29,41,58,39,44,60,37,0,5,0,0,26,1,17,49,36,40,30,5,34,53,28,5,0,25,0,0,31,25,2,33,32,27,35,27,36,32,2,2,0]
        
    ]
    hand_type = '右手'  # 或 '左手'

    # times: [N] 时间戳（可选，None则自动按0.01s间隔生成）
    times = None

    # imu_data: [N, 4] IMU四元数（可选，None则不计算欧拉角/角速度）
    imu_data = None
    # ============================================

    assert len(sensor_data) > 0, "请先粘贴 sensor_data 数据"

    print("=" * 60)
    print("握力评估 - 测试")
    print(f"输入 sensor_data: [{len(sensor_data)}, {len(sensor_data[0])}]")
    print(f"hand_type: {hand_type}")
    print("=" * 60)

    result = generate_grip_report(sensor_data, hand_type, times=times, imu_data=imu_data)

    print("\n--- get_overview ---")
    pprint(get_overview(result))

    print("\n--- get_time_analysis ---")
    pprint(get_time_analysis(result))

    print("\n--- get_finger_data ---")
    pprint(get_finger_data(result))

    print("\n--- get_force_time_series ---")
    fts = get_force_time_series(result)
    print(f"  times length: {len(fts['times'])}")
    print(f"  series keys: {list(fts['forceTimeSeries'].keys())}")

    print("\n--- get_force_distribution ---")
    pprint(get_force_distribution(result))

    print("\n--- get_euler_data ---")
    ed = get_euler_data(result)
    print(f"  times length: {len(ed['times'])}")
    print(f"  roll length: {len(ed['roll'])}")

    print("\n--- get_angular_velocity_data ---")
    avd = get_angular_velocity_data(result)
    print(f"  times length: {len(avd['times'])}")
    print(f"  angularVelocity length: {len(avd['angularVelocity'])}")
