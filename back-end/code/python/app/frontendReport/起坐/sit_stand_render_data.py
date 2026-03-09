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
        dict: 包含所有分析指标和前端渲染数据的完整结果
    """
    if callable(generate_report_from_content):
        import tempfile
        stand_csv = _array_to_pressure_csv(stand_data)
        sit_csv = _array_to_pressure_csv(sit_data)
        tmp_dir = tempfile.mkdtemp(prefix='sitstand_render_')
        result = generate_report_from_content(
            stand_csv, sit_csv,
            output_dir=tmp_dir, username=username,
        )
        return result
    return _fallback_generate_sit_stand_report(stand_data, sit_data, username)


# ============================================================
# Fallback 实现 - 不依赖 generate_report_from_content
# 包含完整的热力图、COP轨迹、周期分析等计算
# ============================================================

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

    # reshape 为 3D 矩阵
    stand_3d = stand.reshape(-1, 64, 64)
    sit_3d = sit.reshape(-1, 32, 32)

    # 基本去噪
    stand_3d[stand_3d <= 4] = 0
    sit_3d[sit_3d <= 10] = 0

    # 旋转脚垫数据（与 generate_sit_stand_pdf_v3 一致）
    stand_3d = np.rot90(np.flip(stand_3d, axis=2), k=1, axes=(1, 2))

    stand_force = stand_3d.sum(axis=(1, 2))
    sit_force = sit_3d.sum(axis=(1, 2))
    stand_times = (np.arange(len(stand_force), dtype=float) * 0.08).tolist()
    sit_times = (np.arange(len(sit_force), dtype=float) * 0.08).tolist()

    # ── 起坐次数检测 ──
    peaks = _detect_peaks(stand_force, sit_force, stand_times)

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

    # 左右脚对称性 (左半:列0-31, 右半:列32-63)
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

    # ── 生成热力图演变数据 ──
    stand_evo_data = _generate_stand_evolution(stand_3d, peaks)
    sit_evo_data = _generate_sit_evolution(sit_3d)

    # ── 生成 COP 轨迹数据 ──
    stand_cop_data = _generate_stand_cop(stand_3d, peaks)
    sit_cop_data = _generate_sit_cop(sit_3d, peaks, sit_force)

    return {
        'duration_stats': {
            'total_duration': round(total_duration, 2),
            'num_cycles': int(num_cycles),
            'avg_duration': round(avg_duration, 2),
            'cycle_durations': cycle_durations,
            'min_cycle_duration': round(min(cycle_durations), 2) if cycle_durations else 0,
            'max_cycle_duration': round(max(cycle_durations), 2) if cycle_durations else 0,
        },
        'stand_frames': int(stand_3d.shape[0]),
        'sit_frames': int(sit_3d.shape[0]),
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
        'heatmap_data': {
            'stand_evolution': stand_evo_data,
            'sit_evolution': sit_evo_data,
        },
        'cop_data': {
            'stand_left': stand_cop_data.get('left'),
            'stand_right': stand_cop_data.get('right'),
            'sit': sit_cop_data,
        },
        'force_curves': {
            'stand_times': stand_times,
            'stand_force': stand_force.tolist(),
            'sit_times': sit_times,
            'sit_force': sit_force.tolist(),
            'stand_peaks_idx': peaks,
        },
    }


# ============================================================
# 峰值检测
# ============================================================

def _detect_peaks(stand_force, sit_force, stand_times):
    """检测起坐周期的峰值/谷值"""
    peaks = []
    sit_std = float(np.std(sit_force)) if len(sit_force) > 1 else 0
    sit_range = float(np.max(sit_force) - np.min(sit_force)) if len(sit_force) > 1 else 0
    use_sit = sit_std > 100 and sit_range > 1000

    try:
        from scipy.signal import find_peaks as _find_peaks
        _has_scipy = True
    except ImportError:
        _has_scipy = False

    if use_sit and len(sit_force) >= 3:
        min_dist = max(38, len(sit_force) // 25)
        sit_mean = float(np.mean(sit_force))
        valley_threshold = sit_mean * 0.5
        if _has_scipy:
            prom = max(sit_std * 0.5, sit_range * 0.15)
            valleys, _ = _find_peaks(-sit_force, distance=min_dist, prominence=prom)
            peaks = [int(v) for v in valleys if sit_force[v] < valley_threshold]
        else:
            for i in range(1, len(sit_force) - 1):
                if sit_force[i] < sit_force[i - 1] and sit_force[i] < sit_force[i + 1]:
                    if sit_force[i] < valley_threshold:
                        if not peaks or (i - peaks[-1]) >= min_dist:
                            peaks.append(i)
        # 末尾检测
        if peaks:
            last_peak = peaks[-1]
            tail = sit_force[last_peak:]
            if len(tail) > min_dist:
                had_sit_down = any(float(x) > sit_mean for x in tail)
                if had_sit_down:
                    tail_end = sit_force[-min(20, len(sit_force) // 10):]
                    if float(np.mean(tail_end)) < valley_threshold:
                        tail_idx = len(sit_force) - 1
                        for i in range(len(sit_force) - 1, last_peak, -1):
                            if sit_force[i] < valley_threshold:
                                tail_idx = i
                            else:
                                break
                        if (tail_idx - last_peak) >= min_dist:
                            peaks.append(tail_idx)
    elif len(stand_force) >= 3:
        min_dist = max(75, len(stand_force) // 15)
        if _has_scipy:
            stand_std = float(np.std(stand_force))
            prom = max(stand_std * 1.5, (float(np.max(stand_force)) - float(np.min(stand_force))) * 0.2)
            _peaks, _ = _find_peaks(stand_force, distance=min_dist, prominence=prom)
            peaks = _peaks.tolist()
        else:
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
                    prom_val = float(smoothed[i]) - max(left_min, right_min)
                    if prom_val >= min_prominence:
                        if not peaks or (i - peaks[-1]) >= min_dist:
                            peaks.append(i)
    return peaks


# ============================================================
# 热力图演变数据生成
# ============================================================

def _smooth_matrix(matrix, upscale=4, sigma=0.6):
    """简单平滑矩阵（不依赖 scipy.ndimage.zoom，使用 numpy 重复采样）"""
    mat = np.array(matrix, dtype=float)
    if np.sum(mat) == 0:
        return mat

    # 简单上采样：每个像素重复 upscale 次
    h, w = mat.shape
    upsampled = np.repeat(np.repeat(mat, upscale, axis=0), upscale, axis=1)

    # 简单高斯平滑（用均值滤波近似）
    try:
        from scipy.ndimage import gaussian_filter
        smoothed = gaussian_filter(upsampled, sigma=sigma * upscale)
    except ImportError:
        # 简单 3x3 均值滤波
        kernel_size = max(3, int(sigma * upscale * 2 + 1))
        if kernel_size % 2 == 0:
            kernel_size += 1
        pad = kernel_size // 2
        padded = np.pad(upsampled, pad, mode='edge')
        smoothed = np.zeros_like(upsampled)
        for i in range(upsampled.shape[0]):
            for j in range(upsampled.shape[1]):
                smoothed[i, j] = padded[i:i + kernel_size, j:j + kernel_size].mean()

    smoothed = np.clip(smoothed, 0, None)

    # 降采样回合理大小（最大 64x64）
    max_dim = 64
    if smoothed.shape[0] > max_dim or smoothed.shape[1] > max_dim:
        scale = max_dim / max(smoothed.shape)
        new_h = max(1, int(smoothed.shape[0] * scale))
        new_w = max(1, int(smoothed.shape[1] * scale))
        # 简单降采样：等间隔取样
        row_idx = np.linspace(0, smoothed.shape[0] - 1, new_h).astype(int)
        col_idx = np.linspace(0, smoothed.shape[1] - 1, new_w).astype(int)
        smoothed = smoothed[np.ix_(row_idx, col_idx)]

    return smoothed


def _get_foot_masks(stand_3d):
    """
    分离左右脚区域
    脚垫 64x64，旋转后：左脚在上半部分(行0-31)，右脚在下半部分(行32-63)
    """
    avg_frame = np.mean(stand_3d, axis=0)
    # 简单二值化
    threshold = np.max(avg_frame) * 0.05
    binary = (avg_frame > threshold).astype(np.uint8)

    h, w = binary.shape
    mid = h // 2

    # 上半部分为左脚，下半部分为右脚
    left_mask = np.zeros_like(binary)
    right_mask = np.zeros_like(binary)
    left_mask[:mid, :] = binary[:mid, :]
    right_mask[mid:, :] = binary[mid:, :]

    # 计算 bounding box [y1, y2, x1, x2]
    def get_bbox(mask):
        ys, xs = np.where(mask > 0)
        if len(ys) == 0:
            return None
        return [int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1]

    l_bbox = get_bbox(left_mask)
    r_bbox = get_bbox(right_mask)

    return left_mask, right_mask, l_bbox, r_bbox


def _generate_stand_evolution(stand_3d, peaks):
    """
    生成站立压力演变热力图数据
    从第一个峰值到第二个峰值之间取11个均匀采样点，
    分别提取左右脚的矩阵数据
    """
    if len(peaks) < 2 or stand_3d.shape[0] < 2:
        return []

    left_mask, right_mask, l_bbox, r_bbox = _get_foot_masks(stand_3d)
    if l_bbox is None or r_bbox is None:
        return []

    # 取第一个完整周期
    start_idx = peaks[0]
    end_idx = peaks[1]
    cycle_len = end_idx - start_idx

    if cycle_len < 5:
        return []

    result = []
    num_samples = 11  # 0%, 10%, ..., 100%

    for foot_label, mask, bbox in [(0, left_mask, l_bbox), (1, right_mask, r_bbox)]:
        for col_idx in range(num_samples):
            # 采样帧索引
            frame_idx = start_idx + int(col_idx * cycle_len / (num_samples - 1))
            frame_idx = min(frame_idx, stand_3d.shape[0] - 1)

            frame = stand_3d[frame_idx] * mask
            # 裁剪到 bbox 区域
            cropped = frame[bbox[0]:bbox[1], bbox[2]:bbox[3]]

            if cropped.size == 0 or np.max(cropped) == 0:
                # 返回空矩阵
                cropped = np.zeros((4, 4))

            # 平滑处理
            smoothed = _smooth_matrix(cropped, upscale=3, sigma=0.5)

            result.append({
                'label': foot_label,
                'sublabel': col_idx,
                'matrix': np.round(smoothed, 1).tolist(),
            })

    return result


def _generate_sit_evolution(sit_3d):
    """
    生成坐姿压力演变热力图数据
    从开始到结束取11个均匀采样点
    """
    n_frames = sit_3d.shape[0]
    if n_frames < 2:
        return []

    result = []
    num_samples = 11

    for col_idx in range(num_samples):
        frame_idx = int(col_idx * (n_frames - 1) / (num_samples - 1))
        frame = sit_3d[frame_idx]

        if np.max(frame) == 0:
            smoothed = np.zeros((4, 4))
        else:
            smoothed = _smooth_matrix(frame, upscale=2, sigma=0.4)

        result.append({
            'label': col_idx,
            'matrix': np.round(smoothed, 1).tolist(),
        })

    return result


# ============================================================
# COP 轨迹数据生成
# ============================================================

def _compute_cop(frame):
    """计算单帧的压力中心 (COP)"""
    total = np.sum(frame)
    if total == 0:
        return None
    rows, cols = frame.shape
    y_coords = np.arange(rows).reshape(-1, 1)
    x_coords = np.arange(cols).reshape(1, -1)
    cop_y = float(np.sum(frame * y_coords) / total)
    cop_x = float(np.sum(frame * x_coords) / total)
    return [round(cop_x, 2), round(cop_y, 2)]


def _generate_stand_cop(stand_3d, peaks):
    """
    生成站立COP轨迹数据
    对每个周期计算 COP 轨迹，分别输出左右脚
    """
    result = {'left': None, 'right': None}

    if len(peaks) < 2 or stand_3d.shape[0] < 2:
        return result

    left_mask, right_mask, l_bbox, r_bbox = _get_foot_masks(stand_3d)

    for foot_name, mask, bbox in [("left", left_mask, l_bbox), ("right", right_mask, r_bbox)]:
        if bbox is None:
            continue

        # 背景矩阵：所有峰值帧的平均
        peak_frames = stand_3d[peaks]
        avg_peak = np.mean(peak_frames, axis=0)
        bg = (avg_peak * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]

        if np.max(bg) == 0:
            continue

        # 平滑背景
        bg_smooth = _smooth_matrix(bg, upscale=3, sigma=0.5)

        # 计算各周期的 COP 轨迹
        trajectories = []
        for i in range(len(peaks) - 1):
            start_idx = peaks[i]
            end_idx = min(peaks[i + 1], stand_3d.shape[0])
            pts = []
            for fi in range(start_idx, end_idx):
                cropped = (stand_3d[fi] * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
                cop = _compute_cop(cropped)
                if cop is not None:
                    # 缩放到平滑后矩阵的坐标系
                    scale_x = bg_smooth.shape[1] / max(1, (bbox[3] - bbox[2]))
                    scale_y = bg_smooth.shape[0] / max(1, (bbox[1] - bbox[0]))
                    pts.append([round(cop[0] * scale_x, 2), round(cop[1] * scale_y, 2)])
            if len(pts) > 1:
                trajectories.append(pts)

        if trajectories:
            result[foot_name] = {
                'bg_matrix': np.round(bg_smooth, 1).tolist(),
                'trajectories': trajectories,
                'bbox': [int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])],
            }

    return result


def _generate_sit_cop(sit_3d, peaks, sit_force):
    """
    生成坐姿COP轨迹数据
    """
    n_frames = sit_3d.shape[0]
    if n_frames < 2 or len(peaks) < 2:
        return None

    # 背景矩阵：所有帧的平均
    avg_frame = np.mean(sit_3d, axis=0)
    if np.max(avg_frame) == 0:
        return None

    bg_smooth = _smooth_matrix(avg_frame, upscale=2, sigma=0.4)

    # 计算各周期的 COP 轨迹
    trajectories = []
    for i in range(len(peaks) - 1):
        start_idx = peaks[i]
        end_idx = min(peaks[i + 1], n_frames)
        pts = []
        for fi in range(start_idx, end_idx):
            cop = _compute_cop(sit_3d[fi])
            if cop is not None:
                # 缩放到平滑后矩阵的坐标系
                scale_x = bg_smooth.shape[1] / 32.0
                scale_y = bg_smooth.shape[0] / 32.0
                pts.append([round(cop[0] * scale_x, 2), round(cop[1] * scale_y, 2)])
        if len(pts) > 1:
            trajectories.append(pts)

    if not trajectories:
        return None

    return {
        'bg_matrix': np.round(bg_smooth, 1).tolist(),
        'trajectories': trajectories,
    }


# ============================================================
# CSV 转换工具
# ============================================================

def _array_to_pressure_csv(data_array, fps=None):
    """
    将压力数组转换为CSV文本格式（内部适配函数）
    """
    from datetime import datetime, timedelta

    lines = ['time,data']
    base_time = datetime(2024, 1, 1)
    dt = 1.0 / fps if fps else 0.08

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
    """【渲染区域】左右脚对称性分析"""
    return result.get('symmetry', {})


def get_pressure_stats(result):
    """【渲染区域】压力统计"""
    return result.get('pressure_stats', {})


def get_cycle_peak_forces(result):
    """【渲染区域】各周期峰值力"""
    return result.get('cycle_peak_forces', [])


def get_stand_evolution_data(result):
    """
    【渲染区域】站立演变热力图 (2×11 网格)
    返回: list[dict] - 每个元素: {label, sublabel, matrix}
    """
    return result.get('heatmap_data', {}).get('stand_evolution', [])


def get_sit_evolution_data(result):
    """
    【渲染区域】坐姿演变热力图 (1×11 网格)
    返回: list[dict] - 每个元素: {label, matrix}
    """
    return result.get('heatmap_data', {}).get('sit_evolution', [])


def get_stand_cop_data(result):
    """
    【渲染区域】站立COP轨迹图 (左脚 + 右脚)
    返回: {left: {bg_matrix, trajectories, bbox}, right: ...}
    """
    cop = result.get('cop_data', {})
    return {
        'left': cop.get('stand_left'),
        'right': cop.get('stand_right'),
    }


def get_sit_cop_data(result):
    """
    【渲染区域】坐姿COP轨迹图
    返回: {bg_matrix, trajectories} | None
    """
    return result.get('cop_data', {}).get('sit')


def get_force_curve_data(result):
    """
    【渲染区域】力-时间曲线 (ECharts 折线图)
    """
    return result.get('force_curves', {})


def get_stand_force_echarts_option(result):
    """【渲染区域】站立力-时间曲线 - 直接生成 ECharts option"""
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
    """【渲染区域】坐姿力-时间曲线 - 直接生成 ECharts option"""
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

    stand_data = []
    sit_data = []

    assert len(stand_data) > 0, "请先粘贴 stand_data 数据"
    assert len(sit_data) > 0, "请先粘贴 sit_data 数据"

    print("=" * 60)
    print("起坐评估 - 测试")
    print(f"输入 stand_data: [{len(stand_data)}, {len(stand_data[0])}]")
    print(f"输入 sit_data: [{len(sit_data)}, {len(sit_data[0])}]")
    print("=" * 60)

    result = generate_sit_stand_report(stand_data, sit_data, username="测试用户")

    print("\n--- get_duration_stats ---")
    pprint(get_duration_stats(result))

    print("\n--- get_symmetry ---")
    pprint(get_symmetry(result))

    print("\n--- get_pressure_stats ---")
    pprint(get_pressure_stats(result))

    print("\n--- get_cycle_peak_forces ---")
    pprint(get_cycle_peak_forces(result))

    print("\n--- get_stand_evolution_data ---")
    evo = get_stand_evolution_data(result)
    print(f"  数据数量: {len(evo)}")
    if evo:
        print(f"  第一个: label={evo[0].get('label')}, matrix shape={len(evo[0].get('matrix', []))}x{len(evo[0].get('matrix', [[]])[0])}")

    print("\n--- get_sit_evolution_data ---")
    sit_evo = get_sit_evolution_data(result)
    print(f"  数据数量: {len(sit_evo)}")

    print("\n--- get_stand_cop_data ---")
    cop = get_stand_cop_data(result)
    print(f"  left: {'有数据' if cop.get('left') else 'None'}")
    print(f"  right: {'有数据' if cop.get('right') else 'None'}")

    print("\n--- get_sit_cop_data ---")
    sit_cop = get_sit_cop_data(result)
    print(f"  sit_cop: {'有数据' if sit_cop else 'None'}")

    print("\n--- get_force_curve_data ---")
    fc = get_force_curve_data(result)
    print(f"  stand_times length: {len(fc.get('stand_times', []))}")
    print(f"  stand_force length: {len(fc.get('stand_force', []))}")
    print(f"  sit_times length: {len(fc.get('sit_times', []))}")
    print(f"  sit_force length: {len(fc.get('sit_force', []))}")
    print(f"  stand_peaks_idx: {fc.get('stand_peaks_idx', [])}")
