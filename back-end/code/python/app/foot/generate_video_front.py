import os
import ast
import math
import cv2
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.gridspec import GridSpec
import scipy.ndimage
from datetime import datetime

# =================================================================
# 【配置区】FFmpeg 路径 (根据你的环境确认) 、中文显示支持
# =================================================================
_ffmpeg_candidates = [
    # macOS
    r"/Users/imac/Documents/GitHub/jqtoolsWin/python/ffmpeg/ffmpeg",
    # Windows (bundled)
    os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'Python311', 'ffmpeg', 'bin', 'ffmpeg.exe')),
    # Windows (conda)
    r"D:\ProgramData\Anaconda3\envs\cop_env\Library\bin\ffmpeg.exe",
]
for _ff in _ffmpeg_candidates:
    if os.path.exists(_ff):
        plt.rcParams['animation.ffmpeg_path'] = _ff
        break

plt.rcParams['font.sans-serif'] = ['SimSun', 'Arial']
plt.rcParams['axes.unicode_minus'] = False

GLOBAL_K = 1.0  # 默认值，会被校准覆盖
BODY_WEIGHT_KG = 80.0  # 【重要】请在此处设置受试者体重

# =================================================================
# 0. 文件读取函数
# =================================================================

def read_gait_raw_data(file_paths):
    """
    读取原始 CSV 数据并拆分为 8 个独立序列
    输出: data_1, data_2, data_3, data_4, time_1, time_2, time_3, time_4
    """
    # 确保文件按 1.csv, 2.csv, 3.csv, 4.csv 排序
    file_paths.sort(key=lambda x: int(os.path.basename(x).split('.')[0]))
    
    results_data = []
    results_time = []
    
    for fp in file_paths:
        df = pd.read_csv(fp)
        results_data.append(df['data'].tolist())
        results_time.append(df['time'].tolist())
        
    return (results_data[0], results_data[1], results_data[2], results_data[3],
            results_time[0], results_time[1], results_time[2], results_time[3])

# =================================================================
# 1. 基础数据处理 (保持不变)
# =================================================================

def parse_custom_time(time_str):
    # time_str: 时间字符串
    # 返回: 转换后的 pandas.Timestamp

    if isinstance(time_str, str):
        parts = time_str.rsplit(':', 1)
        if len(parts) == 2:
            fixed_str = parts[0] + '.' + parts[1]
            return pd.to_datetime(fixed_str, format='%Y/%m/%d %H:%M:%S.%f')
    return pd.NaT


def align_dataframes(dfs, max_delay_seconds=0.15):
    # dfs: DataFrame 列表, max_delay_seconds: 延迟容忍
    # 返回: 时间轴严格对齐后的 DataFrame 列表

    print("  [时间对齐] 正在解析时间戳并重构时间轴...")
    for i, df in enumerate(dfs):
        df['dt'] = df['time'].apply(parse_custom_time)
        df = df.sort_values('dt').drop_duplicates(subset=['dt'])
        dfs[i] = df
    start_time = max([df['dt'].iloc[0] for df in dfs])
    end_time = min([df['dt'].iloc[-1] for df in dfs])
    diffs = dfs[0]['dt'].diff().dropna()
    avg_interval = diffs.median()
    target_timeline = pd.date_range(start=start_time, end=end_time, freq=avg_interval)
    target_df = pd.DataFrame({'dt': target_timeline})
    aligned_dfs = []
    tolerance_delta = pd.Timedelta(seconds=max_delay_seconds)
    for i, df in enumerate(dfs):
        merged = pd.merge_asof(target_df, df, on='dt', direction='backward', tolerance=tolerance_delta)
        zero_matrix_str = str([0]*4096)
        merged['data'] = merged['data'].fillna(zero_matrix_str)
        merged['max'] = merged['max'].fillna(0)
        aligned_dfs.append(merged)
    return aligned_dfs


def load_and_preprocess_aligned_final(d1, d2, d3, d4, t1, t2, t3, t4):
    # d1, d2, d3, d4: 原始 data 序列列表
    # t1, t2, t3, t4: 对应的时间序列列表
    # 返回: 经过对齐去噪后的三维矩阵 total_matrix

    print(f"1. 正在处理独立序列数据...")
    raw_dfs = [
        pd.DataFrame({'data': d1, 'time': t1, 'max': 0}),
        pd.DataFrame({'data': d2, 'time': t2, 'max': 0}),
        pd.DataFrame({'data': d3, 'time': t3, 'max': 0}),
        pd.DataFrame({'data': d4, 'time': t4, 'max': 0})
    ]
    dfs = align_dataframes(raw_dfs, max_delay_seconds=0.15)
    min_len = len(dfs[0])
    cleaned_tensors = []
    
    for i, df in enumerate(dfs):
        all_frames = []
        for idx in range(len(df)):
            raw_data = df.iloc[idx]['data']
            try:
                if isinstance(raw_data, str):
                    if raw_data.startswith('['):
                         mat = np.array(ast.literal_eval(raw_data), dtype=np.float32)
                    else:
                         mat = np.fromstring(raw_data, sep=',')
                else:
                    mat = np.array(raw_data, dtype=np.float32)
            except:
                mat = np.zeros(64*64, dtype=np.float32)
            all_frames.append(mat.reshape(64, 64))
        tensor = np.array(all_frames)
        tensor[tensor <= 4] = 0 
        pixel_max = np.max(tensor, axis=0)
        pixel_min = np.min(tensor, axis=0)
        keep_mask = (pixel_max - pixel_min) > 30 
        tensor = tensor * keep_mask
        max_series = df['max']
        is_active = (max_series > 4).astype(int).values
        labeled_array, num_features = scipy.ndimage.label(is_active)
        for label_id in range(1, num_features + 1):
            indices = np.where(labeled_array == label_id)[0]
            if max_series.iloc[indices].max() <= 150: 
                tensor[indices] = 0
        cleaned_tensors.append(tensor)

    print(f"  正在拼接并执行 [Step 4] 全局空间去噪...")
    total_matrix = []
    for row in range(min_len):
        frame_parts = [t[row] for t in cleaned_tensors]
        full_frame = np.hstack(frame_parts[::-1])
        final_frame = np.rot90(np.fliplr(full_frame), k=1) 
        
        if np.max(final_frame) > 0:
            mask = (final_frame > 0).astype(np.uint8)
            num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
            height, width = final_frame.shape
            for l in range(1, num_labels):
                area = stats[l, cv2.CC_STAT_AREA]
                left = stats[l, cv2.CC_STAT_LEFT]
                w = stats[l, cv2.CC_STAT_WIDTH]
                component_mask = (labels == l)
                blob_max_val = np.max(final_frame[component_mask])
                is_touching_edge = (left <= 5) or (left + w >= width - 5)
                if area < 20 or blob_max_val < 100 or is_touching_edge: 
                    final_frame[component_mask] = 0
        total_matrix.append(final_frame.tolist())
    return total_matrix

# =================================================================
# 2. 辅助分析函数
# =================================================================

def detect_active_gait_range(total_matrix, frame_ms=13, std_threshold=2.0, force_threshold=50):
    # total_matrix: 帧矩阵, frame_ms: 采样频率, std_threshold: 活跃度阈值, force_threshold: 压力阈值
    # 返回: 动态行走区间的起始和结束索引
    """通过COP标准差检测行走区间，返回 start_idx"""
    if not total_matrix: return 0, 0
    n_frames = len(total_matrix)
    cop_y_series = [] 
    for mat in total_matrix:
        frame = np.array(mat)
        if np.sum(frame) <= force_threshold:
            cop_y_series.append(np.nan)
        else:
            cx, cy = calculate_cop_single_side(frame) 
            cop_y_series.append(cx) 
            
    s_cop = pd.Series(cop_y_series)
    win_size = int(0.5 / (frame_ms / 1000.0))
    if win_size < 3: win_size = 3
    rolling_std = s_cop.rolling(window=win_size, center=True, min_periods=3).std().fillna(0).values
    is_active = (rolling_std > std_threshold)
    
    # 简单的平滑
    dilate_size = int(0.4 / (frame_ms / 1000.0))
    is_active_smooth = pd.Series(is_active).rolling(window=dilate_size, center=True, min_periods=1).max().fillna(0).values
    active_indices = np.where(is_active_smooth > 0)[0]
    
    if len(active_indices) == 0: return 0, n_frames - 1
    
    start_idx = active_indices[0]
    end_idx = active_indices[-1]
    
    # 缓冲
    buffer_frames = int(0.3 / (frame_ms / 1000.0))
    final_start = max(0, start_idx - buffer_frames)
    final_end = min(n_frames - 1, end_idx + buffer_frames)
    
    return int(final_start), int(final_end)


# --- [新增] 2. 提取静止帧 ---
def extract_static_pressure_data(raw_matrix, walk_start_idx, buffer_frames=100, min_pressure_threshold=1000):
    # raw_matrix: 帧矩阵, walk_start_idx: 行走起点, buffer_frames: 缓冲帧, min_pressure_threshold: 最小压力触发
    # 返回: 静止压力总和序列, 有效静止帧列表

    static_sums = []
    valid_frames = []
    static_end = max(0, walk_start_idx - buffer_frames)
    
    if static_end == 0:
        print("[警告] 行走开始得太早，无法提取静止帧。")
        return [], []
    
    print(f"  [校准] 正在提取静止帧 (0 -> {static_end})...")
    for i in range(static_end):
        frame = np.array(raw_matrix[i])
        total_val = np.sum(frame)
        if total_val > min_pressure_threshold:
            static_sums.append(total_val)
            valid_frames.append(frame)
            
    if len(static_sums) > 10:
        cut_len = int(len(static_sums) * 0.1)
        static_sums = static_sums[cut_len : -cut_len]
        valid_frames = valid_frames[cut_len : -cut_len]
        
    return static_sums, valid_frames


# --- [新增] 3. 计算 K 值 ---
def calibrate_k(body_weight_kg, static_frames_data):
    # body_weight_kg: 用户体重, static_frames_data: 静止帧数据
    # 返回: 压力校准系数 K

    if not static_frames_data:
        return 1.0
    pow_sums = []
    for frame in static_frames_data:
        frame_pow_sum = np.sum(np.power(frame[frame > 0], 0.783))
        pow_sums.append(frame_pow_sum)
    avg_pow_sum = np.mean(pow_sums)
    target_newton = body_weight_kg * 9.8
    if avg_pow_sum == 0: return 1.0
    k = target_newton / avg_pow_sum
    print(f"  [校准结果] 计算得出 k = {k:.6f} (体重 {body_weight_kg}kg)")
    return k


# --- [新增] 4. ADC 转 牛顿力 函数 ---
def adc_to_force(adc_values):
    # adc_values: ADC 数值（矩阵或序列）
    # 返回: 转换后的牛顿力 (N) 序列
    """
    将ADC值转换为力 (使用全局系数 GLOBAL_K)
    """
    global GLOBAL_K 
    adc = np.maximum(0, np.array(adc_values))
    return GLOBAL_K * np.power(adc, 0.783)


def calculate_cop_single_side(pressure_grid):
    # pressure_grid: 单只脚压力矩阵
    # 返回: 压力中心坐标 (cx, cy)

    arr = np.array(pressure_grid, dtype=float)
    total_pressure = arr.sum()
    if total_pressure <= 0: return (np.nan, np.nan)
    rows, cols = arr.shape
    x_coords = np.arange(rows).reshape(-1, 1)
    weighted_x = (arr * x_coords).sum()
    cop_x = weighted_x / total_pressure
    y_coords = np.arange(cols).reshape(1, -1)
    weighted_y = (arr * y_coords).sum()
    cop_y = weighted_y / total_pressure
    return (cop_x, cop_y)


def analyze_foot_distribution(total_matrix):
    # total_matrix: 帧矩阵
    # 返回: 检测到的左脚和右脚横向重心坐标

    all_centroids_col = []
    for frame in total_matrix:
        frame = np.array(frame)
        if np.max(frame) <= 0: continue
        mask = (frame > 0).astype(np.uint8)
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for i in range(1, num_labels):
            all_centroids_col.append(centroids[i][0])
    if not all_centroids_col: return 16.0, 48.0
    
    centers = [np.min(all_centroids_col), np.max(all_centroids_col)]
    for _ in range(10):
        group0, group1 = [], []
        for x in all_centroids_col:
            if abs(x - centers[0]) < abs(x - centers[1]): group0.append(x)
            else: group1.append(x)
        new_centers = list(centers)
        if group0: new_centers[0] = np.mean(group0)
        if group1: new_centers[1] = np.mean(group1)
        if abs(new_centers[0] - centers[0]) < 0.1 and abs(new_centers[1] - centers[1]) < 0.1: break
        centers = new_centers
    centers.sort()
    return centers[0], centers[1]


def get_foot_mask_by_centers(frame, is_right_foot, center_l, center_r):
    # frame: 单帧矩阵, is_right_foot: 左右标识, center_l/r: 重心坐标
    # 返回: 对应脚的二值化掩膜矩阵

    frame = np.array(frame)
    if np.max(frame) <= 0: return np.zeros_like(frame, dtype=np.uint8)
    mask = np.zeros_like(frame, dtype=np.uint8)
    binary = (frame > 0).astype(np.uint8)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    for i in range(1, num_labels):
        blob_center_col = centroids[i][0]
        dist_l = abs(blob_center_col - center_l)
        dist_r = abs(blob_center_col - center_r)
        if is_right_foot:
            if dist_r < dist_l: mask[labels == i] = 1
        else:
            if dist_l <= dist_r: mask[labels == i] = 1
    return mask


def detect_gait_events_simple(total_matrix, is_right, center_l, center_r):
    # total_matrix: 帧矩阵, is_right: 左右标识, center_l/r: 重心坐标
    # 返回: 步态事件的（起始，结束）帧索引元组列表

    loads = []
    for frame in total_matrix:
        mask = get_foot_mask_by_centers(frame, is_right, center_l, center_r)
        loads.append(np.sum(frame * mask))
    loads = np.array(loads)
    is_active = (loads > 50).astype(int) 
    labeled_array, num_features = scipy.ndimage.label(is_active)
    events = []
    for i in range(1, num_features + 1):
        indices = np.where(labeled_array == i)[0]
        if len(indices) > 5:
            events.append((indices[0], indices[-1]))
    return events

# =================================================================
# 3. 筛选、裁剪与指标计算 (修改了单位转换)
# =================================================================

def select_central_steps(total_matrix, center_l, center_r, target_row=128):
    # total_matrix: 帧矩阵, center_l/r: 重心, target_row: 目标行坐标
    # 返回: 最靠近中间位置的左、右脚步态区间索引
    """筛选最靠近中间的一步左脚和一步右脚"""
    left_events = detect_gait_events_simple(total_matrix, False, center_l, center_r)
    right_events = detect_gait_events_simple(total_matrix, True, center_l, center_r)
    
    best_left = None
    min_dist_left = float('inf')
    best_right = None
    min_dist_right = float('inf')
    
    print(f"正在筛选中央步态 (目标行: {target_row})...")

    for start, end in left_events:
        step_frames = np.array(total_matrix[start:end+1])
        accumulated = np.sum(step_frames, axis=0)
        mask = get_foot_mask_by_centers(accumulated, False, center_l, center_r)
        accumulated *= mask
        cop_x, _ = calculate_cop_single_side(accumulated)
        if not np.isnan(cop_x):
            dist = abs(cop_x - target_row)
            if dist < min_dist_left:
                min_dist_left = dist
                best_left = (start, end)

    for start, end in right_events:
        step_frames = np.array(total_matrix[start:end+1])
        accumulated = np.sum(step_frames, axis=0)
        mask = get_foot_mask_by_centers(accumulated, True, center_l, center_r)
        accumulated *= mask
        cop_x, _ = calculate_cop_single_side(accumulated)
        if not np.isnan(cop_x):
            dist = abs(cop_x - target_row)
            if dist < min_dist_right:
                min_dist_right = dist
                best_right = (start, end)
                
    return best_left, best_right


def select_max_pressure_steps(total_matrix, center_l, center_r):
    # total_matrix: 帧矩阵, center_l/r: 重心
    # 返回: 负荷峰值最大的左、右脚步态区间索引
    """
    筛选逻辑修改：提取左脚和右脚压力最大（峰值负荷最高）的一步
    """
    # 1. 检测所有步态事件
    left_events = detect_gait_events_simple(total_matrix, False, center_l, center_r)
    right_events = detect_gait_events_simple(total_matrix, True, center_l, center_r)
    
    best_left = None
    max_peak_left = -1.0
    
    best_right = None
    max_peak_right = -1.0
    
    print(f"正在筛选最大压力步态...")

    # --- 筛选左脚 ---
    for start, end in left_events:
        # 提取该步的所有帧
        step_frames = np.array(total_matrix[start:end+1])
        
        # 计算该步每一帧的瞬时压力总和，找到这一步里的“最大爆发力”时刻
        step_loads = []
        for frame in step_frames:
            mask = get_foot_mask_by_centers(frame, False, center_l, center_r)
            # 计算这一帧的有效总压力
            step_loads.append(np.sum(frame * mask))
            
        if not step_loads: continue
        
        # 获取这一步的峰值压力
        current_step_peak = np.max(step_loads)
        
        # 更新最大值
        if current_step_peak > max_peak_left:
            max_peak_left = current_step_peak
            best_left = (start, end)

    # --- 筛选右脚 ---
    for start, end in right_events:
        step_frames = np.array(total_matrix[start:end+1])
        
        step_loads = []
        for frame in step_frames:
            mask = get_foot_mask_by_centers(frame, True, center_l, center_r)
            step_loads.append(np.sum(frame * mask))
            
        if not step_loads: continue
            
        current_step_peak = np.max(step_loads)
        
        if current_step_peak > max_peak_right:
            max_peak_right = current_step_peak
            best_right = (start, end)
            
    print(f"  选中左脚区间: {best_left} (峰值负荷: {max_peak_left:.0f})")
    print(f"  选中右脚区间: {best_right} (峰值负荷: {max_peak_right:.0f})")
    
    return best_left, best_right


def get_step_bbox(total_matrix, start, end, is_right, center_l, center_r, padding=2):
    # total_matrix: 帧矩阵, start/end: 索引, is_right: 左右, center_l/r: 重心, padding: 边缘
    # 返回: 裁剪该步态所需的最小包围盒坐标 (rmin, rmax, cmin, cmax)
    """计算步态的包围盒 (Crop Box)"""
    step_frames = np.array(total_matrix[start:end+1])
    accumulated = np.sum(step_frames, axis=0)
    
    mask = get_foot_mask_by_centers(accumulated, is_right, center_l, center_r)
    accumulated_clean = accumulated * mask
    
    rows_idx, cols_idx = np.where(accumulated_clean > 1)
    
    if len(rows_idx) == 0:
        return 0, 64, 0, 64
        
    H, W = accumulated_clean.shape
    rmin = max(0, np.min(rows_idx) - padding)
    rmax = min(H, np.max(rows_idx) + padding)
    cmin = max(0, np.min(cols_idx) - padding)
    cmax = min(W, np.max(cols_idx) + padding)
    
    return rmin, rmax, cmin, cmax


def calculate_step_metrics(frames, cops, interval_sec=0.013, pitch_mm=14.0):
    # frames: 某一步的帧序列, cops: 该步的 COP 轨迹, interval_sec: 时间, pitch_mm: 间距
    # 返回: 该步随时间变化的负荷 (N)、面积 (cm²) 和速度 (mm/s) 序列
    """
    计算单步的时序指标
    【修改】 Force 现在是牛顿 (N)，通过 adc_to_force 转换
    """
    force = []
    area = []
    speed = []
    prev_cop = None
    
    for i, frame in enumerate(frames):
        # 1. Force (Newtons) - 【修改点】
        # 将 ADC 矩阵转换为力矩阵，然后求和
        f = np.sum(adc_to_force(frame))
        force.append(f)
        
        # 2. Area (cm^2)
        a = np.count_nonzero(frame)
        current_area = (a * pitch_mm * pitch_mm) / 100.0
        area.append(current_area)
        
        # 3. Speed (mm/s)
        curr_cop = cops[i]
        s = 0.0
        if i > 0 and prev_cop is not None and curr_cop is not None:
            dist_px = math.sqrt((curr_cop[0] - prev_cop[0])**2 + (curr_cop[1] - prev_cop[1])**2)
            dist_mm = dist_px * pitch_mm
            s = dist_mm / interval_sec
        
        if i == 0: speed.append(0)
        else: speed.append(s)
            
        if curr_cop is not None:
            prev_cop = curr_cop
            
    return force, area, speed

# =================================================================
# 4. 仪表盘式视频生成 (更新图表标题)
# =================================================================

def generate_dashboard_video(d1, d2, d3, d4, t1, t2, t3, t4, output_filename="gait_dashboard.mp4"):
    """
    生成包含步态分析仪表盘的视频文件
    参数：
        d1, d2, d3, d4: 四个传感器的原始 data 序列列表
        t1, t2, t3, t4: 对应的时间序列列表
        output_filename: 输出视频文件名
    返回: 无
    """
    total_matrix = load_and_preprocess_aligned_final(d1, d2, d3, d4, t1, t2, t3, t4)
    # 1.1 计算行走开始时间
    start_cut, end_cut = detect_active_gait_range(total_matrix)
    # 1.2 提取静止帧
    static_sums, static_frames_list = extract_static_pressure_data(total_matrix, start_cut)
    # 1.3 计算 K 值并更新全局变量
    GLOBAL_K = calibrate_k(BODY_WEIGHT_KG, static_frames_list)
    print(f"全局校准系数已更新: GLOBAL_K={GLOBAL_K:.5f}")
    
    # 2. 分析中心
    center_l, center_r = analyze_foot_distribution(total_matrix)
    print(f"检测到足部分布中心: L={center_l}, R={center_r}")
    
    # 3. 选择步态区间
    left_span, right_span = select_max_pressure_steps(total_matrix, center_l, center_r)
    
    if left_span is None or right_span is None:
        print("未检测到完整的左右脚数据，无法生成对比视频。")
        return

    l_rmin, l_rmax, l_cmin, l_cmax = get_step_bbox(total_matrix, left_span[0], left_span[1], False, center_l, center_r)
    r_rmin, r_rmax, r_cmin, r_cmax = get_step_bbox(total_matrix, right_span[0], right_span[1], True, center_l, center_r)

    def prepare_data(start, end, is_right, bbox):
        rmin, rmax, cmin, cmax = bbox
        res_frames = []
        cops_rel = [] 
        
        raw_frames = np.array(total_matrix[start:end+1])
        accumulated = np.sum(raw_frames, axis=0)
        mask_accum = get_foot_mask_by_centers(accumulated, is_right, center_l, center_r)
        bg_full = accumulated * mask_accum
        res_bg = bg_full[rmin:rmax, cmin:cmax]
        
        for frame in raw_frames:
            mask = get_foot_mask_by_centers(frame, is_right, center_l, center_r)
            clean = frame * mask
            cx, cy = calculate_cop_single_side(clean)
            
            crop_frame = clean[rmin:rmax, cmin:cmax]
            res_frames.append(crop_frame)
            
            if not np.isnan(cx):
                cops_rel.append((cy - cmin, cx - rmin)) 
            else:
                cops_rel.append(None)
        
        t_vec = np.arange(len(res_frames)) * 0.013 
        # 调用时会自动使用全局的 adc_to_force
        force, area, speed = calculate_step_metrics(res_frames, cops_rel, interval_sec=0.013)
        return res_frames, res_bg, cops_rel, t_vec, np.array(force), np.array(area), np.array(speed)

    l_frames, l_bg, l_cops, l_time, l_force, l_area, l_speed = prepare_data(left_span[0], left_span[1], False, (l_rmin, l_rmax, l_cmin, l_cmax))
    r_frames, r_bg, r_cops, r_time, r_force, r_area, r_speed = prepare_data(right_span[0], right_span[1], True, (r_rmin, r_rmax, r_cmin, r_cmax))

    max_len = max(len(l_frames), len(r_frames))
    padding_head = 5
    padding_tail = 5 
    total_frames = max_len + padding_head + padding_tail
    
    anim_data = []
    
    for i in range(total_frames):
        idx_l = i - padding_head
        idx_r = i - padding_head
        
        # 左脚
        if idx_l < 0:
            lf, lcp, lt = np.zeros_like(l_frames[0]), None, []
            l_curr_t, l_curr_f, l_curr_a, l_curr_s = 0, 0, 0, 0
        elif idx_l >= len(l_frames):
            lf, lcp, lt = l_frames[-1], None, [c for c in l_cops if c is not None]
            l_curr_t = l_time[-1]
            l_curr_f, l_curr_a, l_curr_s = l_force[-1], l_area[-1], 0
        else:
            lf = l_frames[idx_l]
            lcp = l_cops[idx_l]
            lt = [c for c in l_cops[:idx_l+1] if c is not None]
            l_curr_t = l_time[idx_l]
            l_curr_f, l_curr_a, l_curr_s = l_force[idx_l], l_area[idx_l], l_speed[idx_l]

        # 右脚
        if idx_r < 0:
            rf, rcp, rt = np.zeros_like(r_frames[0]), None, []
            r_curr_t, r_curr_f, r_curr_a, r_curr_s = 0, 0, 0, 0
        elif idx_r >= len(r_frames):
            rf, rcp, rt = r_frames[-1], None, [c for c in r_cops if c is not None]
            r_curr_t = r_time[-1]
            r_curr_f, r_curr_a, r_curr_s = r_force[-1], r_area[-1], 0
        else:
            rf = r_frames[idx_r]
            rcp = r_cops[idx_r]
            rt = [c for c in r_cops[:idx_r+1] if c is not None]
            r_curr_t = r_time[idx_r]
            r_curr_f, r_curr_a, r_curr_s = r_force[idx_r], r_area[idx_r], r_speed[idx_r]
            
        anim_data.append({
            'l': (lf, lcp, lt, l_curr_t, l_curr_f, l_curr_a, l_curr_s),
            'r': (rf, rcp, rt, r_curr_t, r_curr_f, r_curr_a, r_curr_s)
        })

    fig = plt.figure(figsize=(16, 9), facecolor='black')
    gs = GridSpec(3, 4, width_ratios=[1.2, 1, 1, 1.2], figure=fig)
    
    ax_l_force = fig.add_subplot(gs[0, 0])
    ax_l_area = fig.add_subplot(gs[1, 0])
    ax_l_speed = fig.add_subplot(gs[2, 0])
    ax_l_foot = fig.add_subplot(gs[:, 1])
    ax_r_foot = fig.add_subplot(gs[:, 2])
    ax_r_force = fig.add_subplot(gs[0, 3])
    ax_r_area = fig.add_subplot(gs[1, 3])
    ax_r_speed = fig.add_subplot(gs[2, 3])

    def style_chart(ax, title, x_data, y_data, color):
        ax.set_facecolor('#1a1a1a') 
        ax.plot(x_data, y_data, color=color, alpha=0.5, linewidth=1)
        ax.fill_between(x_data, y_data, color=color, alpha=0.1)
        line, = ax.plot([], [], color='white', linewidth=2)
        dot, = ax.plot([], [], 'o', color='white', markersize=6)
        
        ax.set_title(title, color='white', fontsize=14)
        ax.tick_params(axis='x', colors='gray', labelsize=8)
        ax.tick_params(axis='y', colors='gray', labelsize=8)
        ax.grid(True, color='#333333', linestyle='--')
        
        if len(x_data) > 0:
            ax.set_xlim(0, max(x_data)*1.05)
            # 动态调整 Y 轴上限
            ax.set_ylim(0, max(y_data)*1.2 if len(y_data)>0 and max(y_data)>0 else 1)
        return line, dot

    # 【修改点】图表标题改为“负荷 (N)”
    l_objs = []
    l_objs.append(style_chart(ax_l_force, "负荷 (N)", l_time, l_force, 'cyan'))
    l_objs.append(style_chart(ax_l_area, "面积 (cm²)", l_time, l_area, 'lime'))
    l_objs.append(style_chart(ax_l_speed, "COP速度 (mm/s)", l_time, l_speed, 'orange'))
    
    r_objs = []
    r_objs.append(style_chart(ax_r_force, "负荷 (N)", r_time, r_force, 'cyan'))
    r_objs.append(style_chart(ax_r_area, "面积 (cm²)", r_time, r_area, 'lime'))
    r_objs.append(style_chart(ax_r_speed, "COP速度 (mm/s)", r_time, r_speed, 'orange'))

    cmap = LinearSegmentedColormap.from_list("custom_jet", 
            [(0, 0, 0, 0), (0, 0, 1, 1), (0, 1, 1, 1), (0, 1, 0, 1), (1, 1, 0, 1), (1, 0, 0, 1)], N=256)
    
    def style_foot(ax, bg, title):
        ax.set_facecolor('black')
        ax.axis('off')
        ax.set_title(title, color='white', fontsize=14, pad=10)
        bg_norm = bg / (np.max(bg) + 1e-5)
        ax.imshow(bg_norm, cmap='gray', vmin=0, vmax=1, alpha=0.3)
        im = ax.imshow(np.zeros_like(bg), cmap=cmap, vmin=0, vmax=200, interpolation='bilinear')
        trace, = ax.plot([], [], color='magenta', linewidth=2)
        cop, = ax.plot([], [], 'o', color='black', markeredgecolor='orange', markeredgewidth=2, markersize=8)
        return im, trace, cop

    im_l, tr_l, cp_l = style_foot(ax_l_foot, l_bg, "")
    im_r, tr_r, cp_r = style_foot(ax_r_foot, r_bg, "")

    plt.tight_layout()

    def update(frame_idx):
        d = anim_data[frame_idx]
        artists = []
        
        def update_side(data_tuple, im, tr, cp, chart_objs, time_vec, force_vec, area_vec, speed_vec):
            frame, cop_pt, trace_pts, curr_t, curr_f, curr_a, curr_s = data_tuple
            
            im.set_data(frame)
            if trace_pts:
                xs, ys = zip(*trace_pts)
                tr.set_data(xs, ys)
            else: tr.set_data([], [])
            
            if cop_pt: cp.set_data([cop_pt[0]], [cop_pt[1]])
            else: cp.set_data([], [])
            artists.extend([im, tr, cp])
            
            if len(time_vec) > 0:
                mask = time_vec <= curr_t
                chart_objs[0][0].set_data(time_vec[mask], force_vec[mask])
                chart_objs[0][1].set_data([curr_t], [curr_f])
                chart_objs[1][0].set_data(time_vec[mask], area_vec[mask])
                chart_objs[1][1].set_data([curr_t], [curr_a])
                chart_objs[2][0].set_data(time_vec[mask], speed_vec[mask])
                chart_objs[2][1].set_data([curr_t], [curr_s])
                for obj in chart_objs:
                    artists.extend(obj)
                    
        update_side(d['l'], im_l, tr_l, cp_l, l_objs, l_time, l_force, l_area, l_speed)
        update_side(d['r'], im_r, tr_r, cp_r, r_objs, r_time, r_force, r_area, r_speed)
        return artists

    ani = animation.FuncAnimation(fig, update, frames=len(anim_data), interval=150, blit=True)
    
    try:
        if output_filename.endswith('.mp4'):
            writer = animation.FFMpegWriter(fps=3, metadata=dict(artist='GaitAnalysis'), bitrate=5000)
            ani.save(output_filename, writer=writer)
        else:
            writer = animation.PillowWriter(fps=3)
            ani.save(output_filename, writer=writer)
        print(f"仪表盘视频已成功保存至: {output_filename}")
    except Exception as e:
        print(f"保存失败: {e}")
        fallback = output_filename.replace('.mp4', '.gif')
        writer = animation.PillowWriter(fps=7)
        ani.save(fallback, writer=writer)

# =================================================================
# 主程序
# =================================================================

if __name__ == "__main__":
    # 配置输入路径
    base_dir = './data/20251206/20251206_徐' 
    input_files = [os.path.join(base_dir, f"{i}.csv") for i in range(1, 5)]
    output_path = os.path.join(os.path.dirname(input_files[0]), "gait_dashboard_force_front.mp4")

    # 1. 加载数据
    d1, d2, d3, d4, t1, t2, t3, t4 = read_gait_raw_data(input_files)

    # 2. 生成仪表盘视频
    generate_dashboard_video(d1, d2, d3, d4, t1, t2, t3, t4, output_filename=output_path)
