"""
起坐评估 - 前端渲染数据封装模块
====================================
导入 generate_sit_stand_pdf_v3.py 的计算逻辑，
将计算结果拆分为独立方法，供前端各可视化组件分别调用。

总入口方法: generate_sit_stand_report(stand_data, sit_data, username)

数据流: [N, 4096]/[N, 1024]数组 → Python计算 → 结构化dict → 前端ECharts渲染
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

try:
    from generate_sit_stand_pdf_v3 import generate_report_from_content
except Exception:
    generate_report_from_content = None


# ============================================================
# 总入口方法 (类似 generate_foot_pressure_report)
# ============================================================

def generate_sit_stand_report(stand_data, sit_data, username="用户"):
    """
    起坐评估总入口 - 接收脚垫和坐垫的数组数据，返回全部分析结果

    Args:
        stand_data (list[list] | np.ndarray): 脚垫压力数据，shape [N, 4096]
            每帧为长度4096的一维数组，内部reshape为64×64
        sit_data (list[list] | np.ndarray): 坐垫压力数据，shape [M, 1024]
            每帧为长度1024的一维数组，内部reshape为32×32
        username (str): 用户名

    Returns:
        dict: 包含所有分析指标和base64图片的完整结果，结构如下:
            {
                'duration_stats': {
                    'total_duration': float,
                    'num_cycles': int,
                    'avg_duration': float,
                    'cycle_durations': [float],       # 每个周期的时长
                    'min_cycle_duration': float,      # 最快周期
                    'max_cycle_duration': float,      # 最慢周期
                },
                'stand_frames': int,
                'sit_frames': int,
                'stand_peaks': int,
                'username': str,
                'test_date': str,                     # 测试日期
                'symmetry': {
                    'left_right_ratio': float,        # 左右脚对称性 (%)
                    'left_total': float,              # 左脚总力
                    'right_total': float,             # 右脚总力
                },
                'pressure_stats': {
                    'sit_max': float,                 # 坐垫最大总压力
                    'sit_avg': float,                 # 坐垫平均总压力
                    'foot_max': float,                # 脚垫最大总压力
                    'foot_avg': float,                # 脚垫平均总压力
                    'max_sit_change_rate': float,     # 坐垫最大变化率
                    'max_foot_change_rate': float,    # 脚垫最大变化率
                },
                'cycle_peak_forces': [float],         # 各峰值力
                'images': {
                    'stand_evolution': [{'label', 'sublabel', 'image'}],
                    'stand_cop_left': base64_png,
                    'stand_cop_right': base64_png,
                    'sit_evolution': [{'label', 'image'}],
                    'sit_cop': base64_png,
                },
                'force_curves': {
                    'stand_times': [float],
                    'stand_force': [float],
                    'sit_times': [float],
                    'sit_force': [float],
                    'stand_peaks_idx': [int],
                },
            }
    """
    if callable(generate_report_from_content):
        import tempfile

        # 将数组转换为CSV文本格式，传给 generate_report_from_content
        stand_csv = _array_to_pressure_csv(stand_data)
        sit_csv = _array_to_pressure_csv(sit_data)

        tmp_dir = tempfile.mkdtemp(prefix='sitstand_render_')
        result = generate_report_from_content(
            stand_csv, sit_csv,
            output_dir=tmp_dir, username=username,
        )
        return result
    return _fallback_generate_sit_stand_report(stand_data, sit_data, username)


def _fallback_generate_sit_stand_report(stand_data, sit_data, username):
    from datetime import datetime

    stand = np.asarray(stand_data, dtype=float)
    sit = np.asarray(sit_data, dtype=float)
    if stand.ndim == 1:
        stand = stand.reshape(1, -1)
    if sit.ndim == 1:
        sit = sit.reshape(1, -1)
    if stand.ndim != 2 or sit.ndim != 2:
        raise ValueError('stand_data and sit_data must be 2D arrays')

    if stand.shape[1] < 4096:
        stand = np.pad(stand, ((0, 0), (0, 4096 - stand.shape[1])), mode='constant')
    elif stand.shape[1] > 4096:
        stand = stand[:, :4096]

    if sit.shape[1] < 1024:
        sit = np.pad(sit, ((0, 0), (0, 1024 - sit.shape[1])), mode='constant')
    elif sit.shape[1] > 1024:
        sit = sit[:, :1024]

    stand_force = stand.sum(axis=1)
    sit_force = sit.sum(axis=1)
    stand_times = (np.arange(len(stand_force), dtype=float) * 0.08).tolist()
    sit_times = (np.arange(len(sit_force), dtype=float) * 0.08).tolist()

    # ── 起坐次数检测 ──
    # 策略：优先用坐垫(sit)数据的谷值检测（站起来时坐垫压力骤降，信号特征最明显）
    # 回退：用脚垫(stand)数据的峰值检测（站起来时脚垫压力增大）
    peaks = []
    sit_std = float(np.std(sit_force)) if len(sit_force) > 1 else 0
    sit_range = float(np.max(sit_force) - np.min(sit_force)) if len(sit_force) > 1 else 0
    use_sit = sit_std > 100 and sit_range > 1000  # 坐垫数据有足够的变化幅度

    try:
        from scipy.signal import find_peaks as _find_peaks
        _has_scipy = True
    except ImportError:
        _has_scipy = False

    if use_sit and len(sit_force) >= 3:
        # 方案A：坐垫谷值检测 —— 站起来时坐垫压力降到接近0
        min_dist = max(38, len(sit_force) // 25)  # 起坐周期通常 >= 3秒，38帧 ≈ 3s @12.5Hz
        sit_mean = float(np.mean(sit_force))
        # 站起来时坐垫压力应明显低于均值，用均值的一半作为过滤阈值
        valley_threshold = sit_mean * 0.5
        if _has_scipy:
            # 对 -sit_force 找峰值 = 找 sit_force 的谷值
            prom = max(sit_std * 0.5, sit_range * 0.15)
            valleys, _ = _find_peaks(-sit_force, distance=min_dist, prominence=prom)
            # 过滤：只保留坐垫压力明显低于均值的谷值（真正站起来了）
            peaks = [int(v) for v in valleys if sit_force[v] < valley_threshold]
        else:
            # 简单谷值检测
            for i in range(1, len(sit_force) - 1):
                if sit_force[i] < sit_force[i - 1] and sit_force[i] < sit_force[i + 1]:
                    if sit_force[i] < valley_threshold:
                        if not peaks or (i - peaks[-1]) >= min_dist:
                            peaks.append(i)
        # 末尾检测：如果最后一次站起来后信号结束（没有再坐下），补充最后一个谷值
        if peaks:
            last_peak = peaks[-1]
            tail = sit_force[last_peak:]
            # 在最后一个谷值之后，是否有一次"坐下→站起"的完整周期
            # 即：压力先升高（坐下）再降低（站起）并保持低值直到结束
            if len(tail) > min_dist:
                # 检查是否有一次坐下（压力超过均值）
                had_sit_down = any(float(x) > sit_mean for x in tail)
                if had_sit_down:
                    # 检查末尾是否保持低值（最后站起来了）
                    tail_end = sit_force[-min(20, len(sit_force) // 10):]
                    if float(np.mean(tail_end)) < valley_threshold:
                        # 找到末尾低值区间的起始位置作为最后一个谷值
                        tail_idx = len(sit_force) - 1
                        for i in range(len(sit_force) - 1, last_peak, -1):
                            if sit_force[i] < valley_threshold:
                                tail_idx = i
                            else:
                                break
                        if (tail_idx - last_peak) >= min_dist:
                            peaks.append(tail_idx)
    elif len(stand_force) >= 3:
        # 方案B：脚垫峰值检测 —— 站起来时脚垫压力增大
        min_dist = max(75, len(stand_force) // 15)  # 较大间距避免噪声
        if _has_scipy:
            stand_std = float(np.std(stand_force))
            prom = max(stand_std * 1.5, (float(np.max(stand_force)) - float(np.min(stand_force))) * 0.2)
            _peaks, _ = _find_peaks(stand_force, distance=min_dist, prominence=prom)
            peaks = _peaks.tolist()
        else:
            # 平滑后简单峰值检测
            window = min(15, max(3, len(stand_force) // 30))
            if window % 2 == 0:
                window += 1
            smoothed = np.convolve(stand_force, np.ones(window) / window, mode='same')
            signal_range = float(np.max(smoothed) - np.min(smoothed))
            min_prominence = signal_range * 0.2
            for i in range(1, len(smoothed) - 1):
                if smoothed[i] > smoothed[i - 1] and smoothed[i] > smoothed[i + 1]:
                    left_min = float(np.min(smoothed[max(0, i - min_dist):i])) if i > 0 else smoothed[i]
                    right_min = float(np.min(smoothed[i + 1:min(len(smoothed), i + min_dist + 1)])) if i < len(smoothed) - 1 else smoothed[i]
                    prom = float(smoothed[i]) - max(left_min, right_min)
                    if prom >= min_prominence:
                        if not peaks or (i - peaks[-1]) >= min_dist:
                            peaks.append(i)

    total_duration = float(stand_times[-1] - stand_times[0]) if len(stand_times) >= 2 else 0.0
    num_cycles = len(peaks)
    avg_duration = float(total_duration / num_cycles) if num_cycles > 0 else 0.0

    # 周期时长明细
    cycle_durations = []
    for i in range(len(peaks) - 1):
        d_val = stand_times[peaks[i + 1]] - stand_times[peaks[i]] if peaks[i + 1] < len(stand_times) and peaks[i] < len(stand_times) else 0
        cycle_durations.append(round(d_val, 2))

    # 各周期峰值力 (使用脚垫数据)
    cycle_peak_forces = [round(float(stand_force[p]), 1) for p in peaks if p < len(stand_force)]

    # 左右脚对称性 (脚垫 64x64, 左半:列0-31, 右半:列32-63)
    stand_3d = stand.reshape(-1, 64, 64)
    left_total = float(stand_3d[:, :, :32].sum())
    right_total = float(stand_3d[:, :, 32:].sum())
    symmetry_ratio = (min(left_total, right_total) / max(left_total, right_total) * 100
                      if max(left_total, right_total) > 0 else 0.0)

    # 压力统计
    sit_max_pressure = float(sit_force.max()) if len(sit_force) > 0 else 0
    sit_avg_pressure = float(sit_force.mean()) if len(sit_force) > 0 else 0
    foot_max_pressure = float(stand_force.max()) if len(stand_force) > 0 else 0
    foot_avg_pressure = float(stand_force.mean()) if len(stand_force) > 0 else 0
    sit_force_diff = np.diff(sit_force)
    foot_force_diff = np.diff(stand_force)
    max_sit_rate = float(np.max(np.abs(sit_force_diff))) if len(sit_force_diff) > 0 else 0
    max_foot_rate = float(np.max(np.abs(foot_force_diff))) if len(foot_force_diff) > 0 else 0

    return {
        'duration_stats': {
            'total_duration': round(total_duration, 2),
            'num_cycles': int(num_cycles),
            'avg_duration': round(avg_duration, 2),
            'cycle_durations': cycle_durations,
            'min_cycle_duration': round(min(cycle_durations), 2) if cycle_durations else 0,
            'max_cycle_duration': round(max(cycle_durations), 2) if cycle_durations else 0,
        },
        'stand_frames': int(stand.shape[0]),
        'sit_frames': int(sit.shape[0]),
        'stand_peaks': int(num_cycles),
        'username': username,
        'test_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'symmetry': {
            'left_right_ratio': round(symmetry_ratio, 1),
            'left_total': round(left_total, 0),
            'right_total': round(right_total, 0),
        },
        'pressure_stats': {
            'sit_max': round(sit_max_pressure, 0),
            'sit_avg': round(sit_avg_pressure, 0),
            'foot_max': round(foot_max_pressure, 0),
            'foot_avg': round(foot_avg_pressure, 0),
            'max_sit_change_rate': round(max_sit_rate, 1),
            'max_foot_change_rate': round(max_foot_rate, 1),
        },
        'cycle_peak_forces': cycle_peak_forces,
        'images': {
            'stand_evolution': [],
            'stand_cop_left': None,
            'stand_cop_right': None,
            'sit_evolution': [],
            'sit_cop': None,
        },
        'force_curves': {
            'stand_times': stand_times,
            'stand_force': stand_force.tolist(),
            'sit_times': sit_times,
            'sit_force': sit_force.tolist(),
            'stand_peaks_idx': peaks,
        },
    }


def _array_to_pressure_csv(data_array, fps=None):
    """
    将压力数组转换为CSV文本格式（内部适配函数）

    Args:
        data_array: [N, X] 压力数据（X=4096或1024）
        fps: 采样率（用于生成时间戳），默认None则按帧间隔生成

    Returns:
        str: CSV文本内容（包含 data 和 time 列）
    """
    from datetime import datetime, timedelta

    lines = ['time,data']
    base_time = datetime(2024, 1, 1)
    dt = 1.0 / fps if fps else 0.08  # 默认12.5Hz

    for i, row in enumerate(data_array):
        if hasattr(row, 'tolist'):
            row = row.tolist()
        t = base_time + timedelta(seconds=i * dt)
        time_str = t.strftime('%Y/%m/%d %H:%M:%S:') + f'{t.microsecond:06d}'
        data_str = '[' + ','.join(str(v) for v in row) + ']'
        lines.append(f'{time_str},{data_str}')

    return '\n'.join(lines)


# ============================================================
# 以下为拆分方法，每个方法对应前端一个可视化区域
# 入参均为 generate_sit_stand_report 的返回值 result
# ============================================================


def get_duration_stats(result):
    """
    【渲染区域】基本信息卡片 - 周期统计
    返回: {
        'total_duration': float,  # 总测试时长(秒)
        'num_cycles': int,        # 起坐周期数
        'avg_duration': float,    # 平均周期时长(秒)
        'cycle_durations': [float],  # 每个周期的时长
        'min_cycle_duration': float, # 最快周期
        'max_cycle_duration': float, # 最慢周期
        'stand_frames': int,      # 站立帧数
        'sit_frames': int,        # 坐姿帧数
        'stand_peaks': int,       # 检测到的峰值数
        'username': str,
        'test_date': str,         # 测试日期
    }
    """
    ds = result.get('duration_stats', {})
    return {
        'total_duration': ds.get('total_duration', 0),
        'num_cycles': ds.get('num_cycles', 0),
        'avg_duration': ds.get('avg_duration', 0),
        'cycle_durations': ds.get('cycle_durations', []),
        'min_cycle_duration': ds.get('min_cycle_duration', 0),
        'max_cycle_duration': ds.get('max_cycle_duration', 0),
        'stand_frames': result.get('stand_frames', 0),
        'sit_frames': result.get('sit_frames', 0),
        'stand_peaks': result.get('stand_peaks', 0),
        'username': result.get('username', ''),
        'test_date': result.get('test_date', ''),
    }


def get_symmetry(result):
    """
    【渲染区域】左右脚对称性分析
    返回: {
        'left_right_ratio': float,  # 对称性比值 (%)
        'left_total': float,        # 左脚总力
        'right_total': float,       # 右脚总力
    }
    """
    return result.get('symmetry', {})


def get_pressure_stats(result):
    """
    【渲染区域】压力统计
    返回: {
        'sit_max': float,              # 坐垫最大总压力
        'sit_avg': float,              # 坐垫平均总压力
        'foot_max': float,             # 脚垫最大总压力
        'foot_avg': float,             # 脚垫平均总压力
        'max_sit_change_rate': float,  # 坐垫最大变化率
        'max_foot_change_rate': float, # 脚垫最大变化率
    }
    """
    return result.get('pressure_stats', {})


def get_cycle_peak_forces(result):
    """
    【渲染区域】各周期峰值力
    返回: [float]  # 每个峰值的力值
    """
    return result.get('cycle_peak_forces', [])


def get_stand_evolution_images(result):
    """
    【渲染区域】站立演变热力图 (2×11 网格)
    用于展示一个起坐周期中站立阶段的压力变化过程

    返回: list[dict]
        每个元素: {
            'label': int,     # 行索引 (0=左脚, 1=右脚)
            'sublabel': int,  # 列索引 (0~10, 对应0%~100%周期进度)
            'image': str,     # base64 PNG 图片 (data:image/png;base64,...)
        }
    前端渲染: 2行×11列的图片网格, 直接用 <img src={item.image} />
    """
    return result.get('images', {}).get('stand_evolution', [])


def get_sit_evolution_images(result):
    """
    【渲染区域】坐姿演变热力图 (1×11 网格)
    用于展示坐姿阶段的压力变化过程

    返回: list[dict]
        每个元素: {
            'label': int,  # 列索引 (0~10)
            'image': str,  # base64 PNG 图片
        }
    前端渲染: 1行×11列的图片网格
    """
    return result.get('images', {}).get('sit_evolution', [])


def get_stand_cop_images(result):
    """
    【渲染区域】站立COP轨迹图 (左脚 + 右脚)
    叠加在热力图背景上的COP运动轨迹，不同周期用不同颜色

    返回: {
        'left': str | None,   # 左脚COP base64 PNG
        'right': str | None,  # 右脚COP base64 PNG
    }
    前端渲染: 两张并排的 <img> 图片
    """
    images = result.get('images', {})
    return {
        'left': images.get('stand_cop_left'),
        'right': images.get('stand_cop_right'),
    }


def get_sit_cop_image(result):
    """
    【渲染区域】坐姿COP轨迹图
    坐垫上的压力中心运动轨迹

    返回: str | None  # base64 PNG 图片
    前端渲染: 单张 <img> 图片
    """
    return result.get('images', {}).get('sit_cop')


def get_force_curve_data(result):
    """
    【渲染区域】力-时间曲线 (ECharts 折线图)
    站立和坐姿的总压力随时间变化曲线

    返回: {
        'stand_times': [float],      # 站立时间轴(秒)
        'stand_force': [float],      # 站立总压力值
        'sit_times': [float],        # 坐姿时间轴(秒)
        'sit_force': [float],        # 坐姿总压力值
        'stand_peaks_idx': [int],    # 峰值帧索引(用于标记周期分界)
    }
    前端渲染: ECharts line chart, 建议前端做 LTTB 降采样
    """
    return result.get('force_curves', {})


def get_stand_force_echarts_option(result):
    """
    【渲染区域】站立力-时间曲线 - 直接生成 ECharts option
    方便前端直接传入 ECharts 实例

    返回: dict (ECharts option 配置)
    """
    fc = result.get('force_curves', {})
    times = fc.get('stand_times', [])
    force = fc.get('stand_force', [])
    peaks = fc.get('stand_peaks_idx', [])

    mark_lines = []
    for idx in peaks:
        if idx < len(times):
            mark_lines.append({'xAxis': times[idx]})

    return {
        'xAxis': {'type': 'value', 'name': '时间 (s)'},
        'yAxis': {'type': 'value', 'name': '压力值'},
        'series': [{
            'type': 'line',
            'data': list(zip(times, force)),
            'smooth': True,
            'symbol': 'none',
            'lineStyle': {'width': 1.5},
            'markLine': {
                'data': mark_lines,
                'lineStyle': {'type': 'dashed', 'color': '#E74C3C'},
                'label': {'show': False},
            } if mark_lines else None,
        }],
        'tooltip': {'trigger': 'axis'},
    }


def get_sit_force_echarts_option(result):
    """
    【渲染区域】坐姿力-时间曲线 - 直接生成 ECharts option

    返回: dict (ECharts option 配置)
    """
    fc = result.get('force_curves', {})
    times = fc.get('sit_times', [])
    force = fc.get('sit_force', [])

    return {
        'xAxis': {'type': 'value', 'name': '时间 (s)'},
        'yAxis': {'type': 'value', 'name': '压力值'},
        'series': [{
            'type': 'line',
            'data': list(zip(times, force)),
            'smooth': True,
            'symbol': 'none',
            'lineStyle': {'width': 1.5, 'color': '#3498DB'},
        }],
        'tooltip': {'trigger': 'axis'},
    }


# ============================================================
# 测试入口
# ============================================================

if __name__ == '__main__':
    from pprint import pprint

    # ========== 在这里粘贴你的测试数据 ==========
    # stand_data: [N, 4096] 脚垫压力数据
    stand_data = [
        # [v0, v1, ..., v4095],  # 第1帧
        # [v0, v1, ..., v4095],  # 第2帧
    ]

    # sit_data: [M, 1024] 坐垫压力数据
    sit_data = [
        # [v0, v1, ..., v1023],  # 第1帧
        # [v0, v1, ..., v1023],  # 第2帧
    ]
    # ============================================

    assert len(stand_data) > 0, "请先粘贴 stand_data 数据"
    assert len(sit_data) > 0, "请先粘贴 sit_data 数据"

    print("=" * 60)
    print("起坐评估 - 测试")
    print(f"输入 stand_data: [{len(stand_data)}, {len(stand_data[0])}]")
    print(f"输入 sit_data: [{len(sit_data)}, {len(sit_data[0])}]")
    print("=" * 60)

    try:
        result = generate_sit_stand_report(stand_data, sit_data, username="测试用户")
    except ValueError as e:
        print(f"\n[错误] {e}")
        print("提示: 起坐算法需要足够多帧且包含周期性压力变化（起立-坐下循环）的数据")
        print("      少量帧或无明显周期的数据会导致峰值检测失败")
        sys.exit(1)

    print("\n--- get_duration_stats ---")
    pprint(get_duration_stats(result))

    print("\n--- get_symmetry ---")
    pprint(get_symmetry(result))

    print("\n--- get_pressure_stats ---")
    pprint(get_pressure_stats(result))

    print("\n--- get_cycle_peak_forces ---")
    pprint(get_cycle_peak_forces(result))

    print("\n--- get_stand_evolution_images ---")
    imgs = get_stand_evolution_images(result)
    print(f"  图片数量: {len(imgs)}")
    if imgs:
        print(f"  第一张: label={imgs[0].get('label')}, image长度={len(imgs[0].get('image', ''))}")

    print("\n--- get_sit_evolution_images ---")
    sit_imgs = get_sit_evolution_images(result)
    print(f"  图片数量: {len(sit_imgs)}")

    print("\n--- get_stand_cop_images ---")
    cop_imgs = get_stand_cop_images(result)
    print(f"  left: {'有数据' if cop_imgs.get('left') else 'None'}")
    print(f"  right: {'有数据' if cop_imgs.get('right') else 'None'}")

    print("\n--- get_sit_cop_image ---")
    sit_cop = get_sit_cop_image(result)
    print(f"  sit_cop: {'有数据' if sit_cop else 'None'}")

    print("\n--- get_force_curve_data ---")
    fc = get_force_curve_data(result)
    print(f"  stand_times length: {len(fc.get('stand_times', []))}")
    print(f"  stand_force length: {len(fc.get('stand_force', []))}")
    print(f"  sit_times length: {len(fc.get('sit_times', []))}")
    print(f"  sit_force length: {len(fc.get('sit_force', []))}")
    print(f"  stand_peaks_idx: {fc.get('stand_peaks_idx', [])}")
