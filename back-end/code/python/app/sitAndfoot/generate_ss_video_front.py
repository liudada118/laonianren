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
from scipy.ndimage import zoom, gaussian_filter
from scipy.spatial.distance import cdist

# =================================================================
# 【配置区】
# =================================================================
# 请根据实际环境修改 ffmpeg 路径
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

# =================================================================
# 0. 文件读取
# =================================================================

def read_ss_raw_data(stand_path, sit_path):
    """
    输入： stand_path: 站立数据CSV路径, sit_path: 坐姿数据CSV路径
    输出: stand_data_seq, stand_time_seq, sit_data_seq, sit_time_seq
    """
    df_stand = pd.read_csv(stand_path)
    df_sit = pd.read_csv(sit_path)
    return (df_stand['data'].tolist(), df_stand['time'].tolist(), 
            df_sit['data'].tolist(), df_sit['time'].tolist())

# =================================================================
# 1. 核心算法工具
# =================================================================

def AMPD(data):
    # data: 输入的一维压力/数值序列
    # 返回: 检测到的波峰索引列表 list
    """ 自适应多尺度波峰检测算法 """
    data = np.array(data, dtype=float)
    if data.size == 0: return []
    maxHalfPoints = max(data) / 2.0
    p_data = np.zeros_like(data, dtype=np.int32)
    count = data.shape[0]
    arr_rowsum = []
    
    for k in range(1, count // 2 + 1):
        row_sum = 0
        for i in range(k, count - k):
            if data[i] >= data[i - k] and data[i] > data[i + k] and data[i] >= maxHalfPoints:
                row_sum -= 1
        arr_rowsum.append(row_sum)
    
    if len(arr_rowsum) == 0: return []
    min_index = int(np.argmin(arr_rowsum))
    max_window_length = min_index + 1
    
    for k in range(1, max_window_length + 1):
        for i in range(k, count - k):
            if data[i] >= data[i - k] and data[i] > data[i + k] and data[i] >= maxHalfPoints:
                p_data[i] += 1
                
    return np.where(p_data == max_window_length)[0].tolist()


def get_smooth_heatmap(original_matrix, upscale_factor=10, sigma=None):
    # original_matrix: 原始压力矩阵, upscale_factor: 放大倍数, sigma: 高斯模糊标准差
    # 返回: 平滑处理后的高分辨率矩阵 numpy.ndarray
    """ 生成高清平滑热力图 (插值 + 高斯模糊) """
    matrix = np.array(original_matrix, dtype=float)
    if sigma is None:
        sigma = upscale_factor * 0.6
    # 使用双三次插值放大
    high_res = zoom(matrix, upscale_factor, order=3, prefilter=False)
    high_res = np.where(high_res < 0, 0, high_res) # 去除负值
    # 高斯平滑
    smoothed = gaussian_filter(high_res, sigma=sigma)
    return smoothed


def unite_broken_arch_components(binary_map, dist_threshold=3.0):
    # binary_map: 二值化掩膜矩阵, dist_threshold: 连通域合并的距离阈值
    # 返回: 合并后的连通域数量, 标签矩阵, 统计信息, 质心坐标
    """ 足底专用：高足弓断裂修复 """
    binary_map = (binary_map > 0).astype(np.uint8)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_map, connectivity=8)
    if num_labels <= 2: 
        return num_labels, labels, stats, centroids

    label_points = {}
    for l in range(1, num_labels):
        label_points[l] = np.argwhere(labels == l)

    parent = list(range(num_labels))
    def find(i):
        if parent[i] == i: return i
        parent[i] = find(parent[i])
        return parent[i]

    def union(i, j):
        root_i = find(i)
        root_j = find(j)
        if root_i != root_j:
            parent[root_i] = root_j

    active_labels = list(label_points.keys())
    for i in range(len(active_labels)):
        for j in range(i + 1, len(active_labels)):
            l1, l2 = active_labels[i], active_labels[j]
            d = np.min(cdist(label_points[l1], label_points[l2]))
            if d < dist_threshold:
                union(l1, l2)

    new_labels = np.zeros_like(labels)
    new_id_map = {}
    current_new_id = 1
    for l in range(1, num_labels):
        root = find(l)
        if root not in new_id_map:
            new_id_map[root] = current_new_id
            current_new_id += 1
        new_labels[labels == l] = new_id_map[root]
    
    final_num = current_new_id
    final_stats = np.zeros((final_num, 5), dtype=np.int32)
    final_centroids = np.zeros((final_num, 2), dtype=np.float64)
    
    for i in range(1, final_num):
        mask = (new_labels == i).astype(np.uint8)
        ys, xs = np.where(mask > 0)
        if len(ys) > 0:
            x_min, x_max = np.min(xs), np.max(xs)
            y_min, y_max = np.min(ys), np.max(ys)
            final_stats[i] = [x_min, y_min, x_max-x_min+1, y_max-y_min+1, len(ys)]
            final_centroids[i] = [np.mean(xs), np.mean(ys)]
            
    return final_num, new_labels, final_stats, final_centroids

# =================================================================
# 2. 数据加载器
# =================================================================

def load_data_generic(data_seq, time_seq, shape=(64, 64), is_sit=False):
    """
    通用数据加载与预处理函数
    输入参数：
        data_seq: 数据序列, time_seq: 时间序列, shape: 矩阵尺寸, is_sit: 是否为坐垫数据
    返回: 处理后的帧序列(numpy.ndarray), 时间序列, 实际采集频率(FPS)
    """
    df = pd.DataFrame({'data': data_seq, 'time': time_seq})
    
    # 1. 时间解析
    times = pd.to_datetime(df['time'], format='%Y/%m/%d %H:%M:%S:%f', errors='coerce')
    valid_mask = times.notna()
    df = df[valid_mask].reset_index(drop=True)
    times = times[valid_mask].reset_index(drop=True)
    
    # 频率检测
    avg_interval_sec = 0.013 # 默认为高频 ~77Hz
    if len(times) > 1:
        diffs = times.diff().dropna()
        avg = diffs.mean().total_seconds()
        if avg > 0:
            avg_interval_sec = avg
    
    real_fps = 1.0 / avg_interval_sec if avg_interval_sec > 0 else 77.0
    print(f"   FPS: {real_fps:.1f} Hz (dt={avg_interval_sec:.4f}s)")

    # 2. 解析 Data
    raw_frames = []
    target_h, target_w = shape
    
    for raw_data in df['data']:
        try:
            if isinstance(raw_data, str):
                if raw_data.startswith('['): mat = np.array(ast.literal_eval(raw_data), dtype=np.float32)
                else: mat = np.fromstring(raw_data, sep=',')
            else: mat = np.array(raw_data, dtype=np.float32)
        except: mat = np.zeros(target_h*target_w, dtype=np.float32)
        
        # Reshape
        if mat.size == target_h * target_w:
            frame = mat.reshape(target_h, target_w)
        else:
            frame = np.zeros(shape, dtype=np.float32)
            
        raw_frames.append(frame)
    
    raw_frames = np.array(raw_frames)
    
    # 3. 特定去噪
    final_frames = []
    
    if not is_sit: 
        # === Stand (足底) 严格去噪 ===
        tensor = raw_frames.copy()
        tensor[tensor <= 4] = 0 # Step 1
        
        pixel_max = np.max(tensor, axis=0)
        pixel_min = np.min(tensor, axis=0)
        keep_mask = (pixel_max - pixel_min) > 25
        tensor = tensor * keep_mask # Step 2
        
        max_series = np.max(tensor.reshape(len(tensor), -1), axis=1) # Step 3
        is_active = (max_series > 4).astype(int)
        labeled_array, num_features = scipy.ndimage.label(is_active)
        for label_id in range(1, num_features + 1):
            indices = np.where(labeled_array == label_id)[0]
            if max_series[indices].max() <= 150: tensor[indices] = 0
            
        kernel = np.ones((3, 3), dtype=np.float32)
        
        for i in range(len(tensor)):
            frame = tensor[i]
            final_frame = np.rot90(np.fliplr(frame), k=1) # 旋转
            
            if np.max(final_frame) > 0:
                mask = (final_frame > 0).astype(np.uint8)
                num_labels, labels, stats, centroids = unite_broken_arch_components(mask, dist_threshold=3.0)
                h, w = final_frame.shape
                
                for l in range(1, num_labels):
                    area = stats[l, 4]
                    left = stats[l, 0]
                    w_box = stats[l, 2]
                    component_mask = (labels == l)
                    blob_max_val = np.max(final_frame[component_mask])
                    is_touching_edge = (left <= 5) or (left + w_box >= w - 5)
                    
                    if area < 15 or blob_max_val < 100 or is_touching_edge:
                        final_frame[component_mask] = 0
                
                if np.max(final_frame) > 0:
                    mask_float = (final_frame > 0).astype(np.float32)
                    neighbor_counts = cv2.filter2D(mask_float, -1, kernel, borderType=cv2.BORDER_CONSTANT)
                    keep_mask_neighbors = (neighbor_counts >= 4).astype(np.uint8)
                    final_frame = final_frame * keep_mask_neighbors
            
            final_frames.append(final_frame)
            
    else:
        # === Sit (坐垫) 去噪 ===
        for frame in raw_frames:
            # 基础阈值
            frame[frame <= 5] = 0
            
            # 最大连通域保留
            if np.max(frame) > 0:
                mask = (frame > 0).astype(np.uint8)
                num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
                if num_labels > 2:
                    areas = stats[1:, cv2.CC_STAT_AREA]
                    max_area_idx = np.argmax(areas) + 1
                    keep_mask = (labels == max_area_idx).astype(np.float32)
                    frame = frame * keep_mask
            
            final_frames.append(frame)

    return np.array(final_frames), times, real_fps

# =================================================================
# 3. 辅助计算 (分脚Mask, COP, 边框)
# =================================================================

def analyze_foot_centers(total_matrix):
    # total_matrix: 整个序列的压力帧
    # 返回: 左脚和右脚在横轴(Column)上的中心位置坐标 (center_l, center_r)
    all_centroids_col = []
    for frame in total_matrix:
        if np.max(frame) <= 0: continue
        mask = (frame > 0).astype(np.uint8)
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for i in range(1, num_labels):
            all_centroids_col.append(centroids[i][0])
            
    if not all_centroids_col: return 16.0, 48.0
    
    centers = [np.min(all_centroids_col), np.max(all_centroids_col)]
    for _ in range(10):
        group0 = [x for x in all_centroids_col if abs(x - centers[0]) < abs(x - centers[1])]
        group1 = [x for x in all_centroids_col if abs(x - centers[0]) >= abs(x - centers[1])]
        new_centers = list(centers)
        if group0: new_centers[0] = np.mean(group0)
        if group1: new_centers[1] = np.mean(group1)
        if abs(new_centers[0] - centers[0]) < 0.1 and abs(new_centers[1] - centers[1]) < 0.1: break
        centers = new_centers
    centers.sort()
    return centers[0], centers[1]


def get_foot_mask_by_centers(frame, is_right_foot, center_l, center_r):
    # frame: 单帧压力矩阵, is_right_foot: 是否提取右脚, center_l: 左中心, center_r: 右中心
    # 返回: 对应脚的二值化掩膜矩阵 numpy.ndarray
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


def get_combined_foot_bbox(frames, center_l, center_r, padding=4):
    # frames: 帧序列, center_l/r: 左右中心, padding: 边缘留白像素
    # 返回: 裁剪边界坐标 (row_min, row_max, col_min, col_max)
    accumulated = np.sum(frames, axis=0)
    mask_l = get_foot_mask_by_centers(accumulated, False, center_l, center_r)
    mask_r = get_foot_mask_by_centers(accumulated, True, center_l, center_r)
    combined = mask_l + mask_r
    rows_idx, cols_idx = np.where(combined > 0)
    if len(rows_idx) == 0: return 0, 64, 0, 64
    H, W = accumulated.shape
    return max(0, np.min(rows_idx)-padding), min(H, np.max(rows_idx)+padding), \
           max(0, np.min(cols_idx)-padding), min(W, np.max(cols_idx)+padding)


def calculate_cop(frame):
    # frame: 单帧压力矩阵
    # 返回: 压力中心坐标 (cx, cy)，若无压力则返回 (NaN, NaN)
    total = np.sum(frame)
    if total <= 10: return (np.nan, np.nan) # 避免除零，调高了微量阈值
    rows, cols = frame.shape
    y_coords, x_coords = np.mgrid[0:rows, 0:cols]
    cy = np.sum(frame * y_coords) / total
    cx = np.sum(frame * x_coords) / total
    return (cx, cy)


def calculate_metrics_stand(frames, center_l, center_r, interval_sec):
    # frames: 站立帧序列, center_l/r: 左右中心, interval_sec: 采样时间间隔
    # 返回: 包含左右脚压力总和、面积、COP速度及坐标的字典 (l_metrics, r_metrics)
    l_metrics = {'sum':[], 'area':[], 'speed':[], 'cop':[]}
    r_metrics = {'sum':[], 'area':[], 'speed':[], 'cop':[]}
    prev_l, prev_r = None, None
    pitch_mm = 14.0 
    
    for i, frame in enumerate(frames):
        # Left
        mask_l = get_foot_mask_by_centers(frame, False, center_l, center_r)
        fl = frame * mask_l
        l_metrics['sum'].append(np.sum(fl))
        l_metrics['area'].append(np.count_nonzero(fl) * (pitch_mm**2) / 100.0)
        cxl, cyl = calculate_cop(fl)
        l_metrics['cop'].append((cxl, cyl) if not np.isnan(cxl) else None)
        sl = 0
        if i>0 and prev_l and not np.isnan(cxl):
            d = math.sqrt((cxl-prev_l[0])**2 + (cyl-prev_l[1])**2) * pitch_mm / 10.0
            sl = d / interval_sec
        l_metrics['speed'].append(sl)
        if not np.isnan(cxl): prev_l = (cxl, cyl)

        # Right
        mask_r = get_foot_mask_by_centers(frame, True, center_l, center_r)
        fr = frame * mask_r
        r_metrics['sum'].append(np.sum(fr))
        r_metrics['area'].append(np.count_nonzero(fr) * (pitch_mm**2) / 100.0)
        cxr, cyr = calculate_cop(fr)
        r_metrics['cop'].append((cxr, cyr) if not np.isnan(cxr) else None)
        sr = 0
        if i>0 and prev_r and not np.isnan(cxr):
            d = math.sqrt((cxr-prev_r[0])**2 + (cyr-prev_r[1])**2) * pitch_mm / 10.0
            sr = d / interval_sec
        r_metrics['speed'].append(sr)
        if not np.isnan(cxr): prev_r = (cxr, cyr)
        
    return l_metrics, r_metrics


def calculate_metrics_sit(frames, times):
    # frames: 坐姿帧序列, times: 对应的时间序列
    # 返回: 包含坐姿压力总和、面积、COP速度及坐标的字典 metrics
    """
    【最终修正版】基于峰值的动态区间判定
    逻辑：
    1. 找到全过程压力最大的时刻 (Peak)。
    2. 以 Peak * 5% 为阈值，向左右两侧搜索起止点。
    3. 仅在核心区间内计算 COP，彻底切除起止阶段的低压噪声。
    """
    metrics = {'sum':[], 'area':[], 'speed':[], 'cop':[]}
    pitch_mm = 14.0
    
    # 1. 预计算压力曲线
    sum_curve = np.array([np.sum(f) for f in frames])
    n_frames = len(frames)
    
    # 2. 判定有效区间 (Peak-Centric)
    if n_frames > 0:
        max_val = np.max(sum_curve)
        max_idx = np.argmax(sum_curve)
    else:
        max_val = 0
        max_idx = 0
        
    # 【关键】动态阈值：设为最大压力的 5%
    # 例子：如果坐实了压力是 30000，阈值就是 1500。
    # 任何小于 1500 的时刻都被视为“未坐稳”或“噪声”，不画 COP。
    THRESHOLD = max(max_val * 0.03, 50) 
    # THRESHOLD = 50
    
    # 向左搜索起点 (Start)
    start_idx = 0
    for i in range(max_idx, -1, -1):
        if sum_curve[i] < THRESHOLD:
            start_idx = i + 1 # 这一帧是小于阈值的，所以有效帧是后一帧
            break
            
    # 向右搜索终点 (End)
    end_idx = n_frames - 1
    for i in range(max_idx, n_frames):
        if sum_curve[i] < THRESHOLD:
            end_idx = i - 1 # 这一帧小于阈值，有效帧是前一帧
            break

    print(f"   [Sit Analysis] Peak Force: {max_val:.1f}")
    print(f"   [Sit Analysis] Dynamic Threshold (5%): {THRESHOLD:.1f}")
    print(f"   [Sit Analysis] Active Interval: {start_idx} -> {end_idx} (Total Frames: {n_frames})")

    # 3. 逐帧计算
    prev_c = None
    
    for i, frame in enumerate(frames):
        s_sum = sum_curve[i]
        metrics['sum'].append(s_sum)
        metrics['area'].append(np.count_nonzero(frame) * (pitch_mm**2) / 100.0)
        
        # --- 仅在核心区间内计算 COP ---
        if start_idx <= i <= end_idx:
            cx, cy = calculate_cop(frame)
            
            if not np.isnan(cx):
                metrics['cop'].append((cx, cy))
                
                # 计算速度
                s = 0
                if i > 0 and prev_c is not None:
                    dt = (times[i] - times[i-1]).total_seconds()
                    if dt > 0.001:
                        d = math.sqrt((cx-prev_c[0])**2 + (cy-prev_c[1])**2) * pitch_mm / 10.0
                        s = d / dt
                metrics['speed'].append(s)
                prev_c = (cx, cy)
            else:
                metrics['cop'].append(None)
                metrics['speed'].append(0)
                prev_c = None
        else:
            # 区间外：强制置空，断开连线
            metrics['cop'].append(None)
            metrics['speed'].append(0)
            prev_c = None 
            
    return metrics

# =================================================================
# 4. 区间与同步逻辑
# =================================================================

def find_stand_interval(frames):
    # frames: 原始站立帧序列
    # 返回: 选取的起始帧索引和结束帧索引 (start_idx, end_idx)
    """
    基于 Stand 数据的 AMPD 峰值选取区间
    """
    curve = [np.sum(f) for f in frames]
    peaks = AMPD(curve)
    
    if len(peaks) < 2:
        print("   [警告] 检测到的波峰少于2个，使用全长。")
        return 0, len(frames)-1
    
    peak_vals = [curve[p] for p in peaks]
    max_peak_val = max(peak_vals)
    max_peak_idx = peaks[np.argmax(peak_vals)]
    
    print(f"   [Event] 峰值所在帧: {max_peak_idx}")
    
    if max_peak_idx == peaks[-1]:
        print("   [Event] 最大峰值是最后一个峰值。使用 [倒数第二个 -> 最后一个].")
        start_idx = peaks[-2]
        end_idx = peaks[-1]
    else:
        print("   [Event] 最大峰值不是最后一个峰值。使用 [最大峰值 -> 下一个峰值].")
        idx_in_peaks = peaks.index(max_peak_idx)
        start_idx = max_peak_idx
        end_idx = peaks[idx_in_peaks + 1]
        
    print(f"   [Interval] 选取帧数区间： {start_idx} -> {end_idx}")
    return start_idx, end_idx


def synchronize_data(stand_frames, stand_times, sit_frames, sit_times, start_idx, end_idx):
    # stand_frames/times: 站立原始数据, sit_frames/times: 坐姿原始数据, start/end_idx: 截取区间
    # 返回: 同步截取后的站立帧、站立时间、坐姿帧、坐姿时间

    # 1. 截取 Stand
    s_frames = stand_frames[start_idx : end_idx + 1]
    s_times = stand_times[start_idx : end_idx + 1].reset_index(drop=True)
    
    if len(s_times) == 0:
        return s_frames, s_times, [], [], [], []

    # 2. 截取 Sit (时间匹配)
    t_start = s_times.iloc[0]
    t_end = s_times.iloc[-1]
    
    dist_start = np.abs(sit_times - t_start)
    idx_sit_start = np.argmin(dist_start)
    
    dist_end = np.abs(sit_times - t_end)
    idx_sit_end = np.argmin(dist_end)
    
    if idx_sit_start > idx_sit_end:
        idx_sit_end = idx_sit_start

    sit_seg_frames = sit_frames[idx_sit_start : idx_sit_end + 1]
    sit_seg_times = sit_times[idx_sit_start : idx_sit_end + 1].reset_index(drop=True)
    
    return s_frames, s_times, sit_seg_frames, sit_seg_times

# =================================================================
# 5. 可视化生成
# =================================================================

def generate_combined_dashboard(
    d_stand, t_stand, 
    d_sit, t_sit, 
    output_filename,
    SPEED_FACTOR=0.5
):
    """
    生成站立+坐姿综合视频仪表盘
    输入参数：
        d_stand: 站立数据序列, t_stand: 站立时间序列
        d_sit: 坐姿数据序列, t_sit: 坐姿时间序列
        SPEED_FACTOR: 视频播放速度倍数
        output_filename: 输出视频文件路径
    返回: None
    生成的视频包含站立和坐姿的热力图及相关指标走势图。
    """
    # ================= 1. 数据处理与分析 =================
    print("1. 正在处理 Stand 数据...")
    stand_frames, stand_times, _ = load_data_generic(d_stand, t_stand, shape=(64,64), is_sit=False)
    
    print("2. 正在处理 Sit 数据...")
    full_sit_frames, full_sit_times, _ = load_data_generic(d_sit, t_sit, shape=(32,32), is_sit=True)
    
    if len(stand_frames) == 0:
        print("错误：Stand 数据为空")
        return

    print("3. 分析足底中心与区间...")
    center_l, center_r = analyze_foot_centers(stand_frames)
    start_idx, end_idx = find_stand_interval(stand_frames)
    
    print("4. 执行数据同步...")
    stand_seg, stand_times, sit_seg, sit_times = synchronize_data(
        stand_frames, stand_times, full_sit_frames, full_sit_times, start_idx, end_idx
    )
    
    # ================= 2. 视频生成逻辑 =================

    real_fps = 77.0 
    if len(stand_times) > 1:
        dt = (stand_times.iloc[-1] - stand_times.iloc[0]).total_seconds()
        if dt > 0:
            real_fps = len(stand_seg) / dt        

    fps = real_fps * SPEED_FACTOR
    print(f"   [Video] 计算播放帧率: {fps:.1f}")

    n_frames = len(stand_seg)
    if n_frames < 2: return

    # --- 计算指标 ---
    avg_dt_stand = (stand_times.iloc[-1] - stand_times.iloc[0]).total_seconds() / max(1, n_frames)
    l_metrics, r_metrics = calculate_metrics_stand(stand_seg, center_l, center_r, avg_dt_stand)
    
    if len(sit_seg) > 0:
        sit_metrics = calculate_metrics_sit(sit_seg, sit_times)
        print(f"   [Sit Metrics] 计算完成，共 {len(sit_seg)} 帧数据。")
    else:
        sit_metrics = {'sum':[0], 'area':[0], 'speed':[0], 'cop':[None]}
        
    # 时间轴
    start_time_abs = stand_times.iloc[0]
    t_vec_stand = np.array([(t - start_time_abs).total_seconds() for t in stand_times])
    
    if len(sit_seg) > 0:
        t_vec_sit = np.array([(t - start_time_abs).total_seconds() for t in sit_times])
    else:
        t_vec_sit = np.array([0])

    # --- 布局 ---
    fig = plt.figure(figsize=(18, 12), facecolor='black')
    gs = GridSpec(6, 3, figure=fig, height_ratios=[1,1,1, 1,1,1], width_ratios=[1, 1.2, 1])
    
    ax_stand_l = [fig.add_subplot(gs[i, 0]) for i in range(3)]
    ax_stand_heat = fig.add_subplot(gs[0:3, 1])
    ax_stand_r = [fig.add_subplot(gs[i, 2]) for i in range(3)]
    
    ax_sit_heat = fig.add_subplot(gs[3:6, 0:2])
    ax_sit_charts = [fig.add_subplot(gs[3+i, 2]) for i in range(3)]
    
    # 样式函数
    def setup_chart(ax, title, x_data, y_data, color):
        ax.set_facecolor('#1a1a1a')
        ax.set_title(title, color='white', fontsize=10)
        ax.tick_params(colors='gray', labelsize=8)
        ax.grid(True, color='#333333', linestyle='--')
        ax.plot(x_data, y_data, color=color, alpha=0.3, linewidth=1)
        line, = ax.plot([], [], color='white', linewidth=2)
        dot, = ax.plot([], [], 'o', color='white', markersize=5)
        
        max_t = max(t_vec_stand[-1], 0.1)
        if len(x_data) > 0: max_t = max(max_t, x_data[-1])
        ax.set_xlim(0, max_t)
        
        ymax = np.nanmax(y_data) if len(y_data) > 0 else 1
        ax.set_ylim(0, ymax * 1.15 + 0.1)
        return line, dot

    sl_objs = [
        setup_chart(ax_stand_l[0], "左脚压力（ADC）", t_vec_stand, l_metrics['sum'], 'cyan'),
        setup_chart(ax_stand_l[1], "左脚面积（cm²）", t_vec_stand, l_metrics['area'], 'lime'),
        setup_chart(ax_stand_l[2], "左脚 COP 速度（cm/s）", t_vec_stand, l_metrics['speed'], 'orange')
    ]
    sr_objs = [
        setup_chart(ax_stand_r[0], "右脚压力（ADC）", t_vec_stand, r_metrics['sum'], 'cyan'),
        setup_chart(ax_stand_r[1], "右脚面积（cm²）", t_vec_stand, r_metrics['area'], 'lime'),
        setup_chart(ax_stand_r[2], "右脚 COP 速度（cm/s）", t_vec_stand, r_metrics['speed'], 'orange')
    ]
    sit_objs = [
        setup_chart(ax_sit_charts[0], "坐姿压力（ADC）", t_vec_sit, sit_metrics['sum'], 'cyan'),
        setup_chart(ax_sit_charts[1], "坐姿面积（cm²）", t_vec_sit, sit_metrics['area'], 'lime'),
        setup_chart(ax_sit_charts[2], "坐姿 COP 速度（cm/s）", t_vec_sit, sit_metrics['speed'], 'orange')
    ]

    # --- 热力图配置 ---
    cmap = LinearSegmentedColormap.from_list("jet_alpha", [(0,0,0,0), (0,0,1,1), (0,1,1,1), (0,1,0,1), (1,1,0,1), (1,0,0,1)], N=256)
    
    # Stand Heatmap (【修改】开启差值平滑)
    FOOT_UPSCALE = 10 # 放大倍数
    rmin, rmax, cmin, cmax = get_combined_foot_bbox(stand_seg, center_l, center_r)
    h_box, w_box = rmax-rmin, cmax-cmin
    
    ax_stand_heat.set_facecolor('black'); ax_stand_heat.axis('off')
    ax_stand_heat.set_title("站立分析", color='white', fontsize=14)
    # 初始化时图像尺寸也要放大
    im_stand = ax_stand_heat.imshow(np.zeros((h_box*FOOT_UPSCALE, w_box*FOOT_UPSCALE)), cmap=cmap, vmin=0, vmax=255)
    tr_sl, = ax_stand_heat.plot([], [], color='magenta', lw=2)
    tr_sr, = ax_stand_heat.plot([], [], color='yellow', lw=2)
    dot_sl, = ax_stand_heat.plot([], [], 'o', color='white', mec='magenta', mew=2)
    dot_sr, = ax_stand_heat.plot([], [], 'o', color='white', mec='yellow', mew=2)
    
    # Sit Heatmap
    SIT_UPSCALE = 10
    ax_sit_heat.set_facecolor('black'); ax_sit_heat.axis('off')
    ax_sit_heat.set_title("坐姿分析", color='white', fontsize=14)
    im_sit = ax_sit_heat.imshow(np.zeros((32*SIT_UPSCALE, 32*SIT_UPSCALE)), cmap=cmap, vmin=0, vmax=255)
    tr_sit, = ax_sit_heat.plot([], [], color='white', lw=2)
    dot_sit, = ax_sit_heat.plot([], [], 'o', color='yellow', mec='white', mew=2)

    plt.tight_layout()
    stand_max = np.max(stand_seg) if len(stand_seg)>0 else 255
    im_stand.set_clim(0, stand_max * 0.9)

    # --- 更新函数 ---
    def update(frame_idx):
        # 1. Stand 更新
        curr_time = stand_times.iloc[frame_idx]
        t_curr = t_vec_stand[frame_idx]
        
        frame = stand_seg[frame_idx]
        mask_l = get_foot_mask_by_centers(frame, False, center_l, center_r)
        mask_r = get_foot_mask_by_centers(frame, True, center_l, center_r)
        # 裁剪
        crop_frame = (frame * (mask_l + mask_r))[rmin:rmax, cmin:cmax]
        # 【修改】平滑插值处理
        crop_smooth = get_smooth_heatmap(crop_frame, upscale_factor=FOOT_UPSCALE, sigma=0.8)
        im_stand.set_data(crop_smooth)
        
        # COP 轨迹 Stand (坐标需适配放大倍数)
        # 坐标调整: (原始坐标 - 裁剪偏移) * 放大倍数
        def adj_s(p): return ((p[0]-cmin)*FOOT_UPSCALE, (p[1]-rmin)*FOOT_UPSCALE) if p else None
        
        cl, cr = l_metrics['cop'][frame_idx], r_metrics['cop'][frame_idx]
        acl, acr = adj_s(cl), adj_s(cr)
        
        if acl: dot_sl.set_data([acl[0]], [acl[1]])
        else: dot_sl.set_data([], [])
        if acr: dot_sr.set_data([acr[0]], [acr[1]])
        else: dot_sr.set_data([], [])
        
        hist_l = [adj_s(p) for p in l_metrics['cop'][:frame_idx+1] if p]
        hist_r = [adj_s(p) for p in r_metrics['cop'][:frame_idx+1] if p]
        if hist_l: tr_sl.set_data(*zip(*hist_l))
        if hist_r: tr_sr.set_data(*zip(*hist_r))
        
        # Stand 图表更新
        for j, objs in enumerate(sl_objs):
            objs[0].set_data(t_vec_stand[:frame_idx+1], l_metrics[list(l_metrics.keys())[j]][:frame_idx+1])
            objs[1].set_data([t_curr], [l_metrics[list(l_metrics.keys())[j]][frame_idx]])
        for j, objs in enumerate(sr_objs):
            objs[0].set_data(t_vec_stand[:frame_idx+1], r_metrics[list(r_metrics.keys())[j]][:frame_idx+1])
            objs[1].set_data([t_curr], [r_metrics[list(r_metrics.keys())[j]][frame_idx]])

        # 2. Sit 更新
        if len(full_sit_times) > 0:
            time_diffs = np.abs(full_sit_times - curr_time)
            closest_sit_idx = np.argmin(time_diffs)
            
            raw_sit = full_sit_frames[closest_sit_idx]
            smooth_sit = get_smooth_heatmap(raw_sit, upscale_factor=SIT_UPSCALE, sigma=0.8)
            im_sit.set_data(smooth_sit)
            
            if len(sit_times) > 0:
                dt_local = np.abs(sit_times - curr_time)
                local_idx = np.argmin(dt_local)
                
                curr_cop = sit_metrics['cop'][local_idx]
                if curr_cop:
                    dot_sit.set_data([curr_cop[0]*SIT_UPSCALE], [curr_cop[1]*SIT_UPSCALE])
                else:
                    dot_sit.set_data([], [])
                
                # 仅绘制有效点的轨迹
                valid_cops = [p for p in sit_metrics['cop'][:local_idx+1] if p]
                if valid_cops:
                    tr_sit.set_data([p[0]*SIT_UPSCALE for p in valid_cops], [p[1]*SIT_UPSCALE for p in valid_cops])
                
                t_curr_sit = t_vec_sit[local_idx]
                for j, objs in enumerate(sit_objs):
                    objs[0].set_data(t_vec_sit[:local_idx+1], sit_metrics[list(sit_metrics.keys())[j]][:local_idx+1])
                    objs[1].set_data([t_curr_sit], [sit_metrics[list(sit_metrics.keys())[j]][local_idx]])

        return [im_stand, im_sit, tr_sl, tr_sr, tr_sit, dot_sl, dot_sr, dot_sit] + \
               [x for pair in sl_objs for x in pair] + \
               [x for pair in sr_objs for x in pair] + \
               [x for pair in sit_objs for x in pair]

    ani = animation.FuncAnimation(fig, update, frames=n_frames, interval=1000.0/fps, blit=True)
    
    try:
        writer = animation.FFMpegWriter(fps=fps, metadata=dict(artist='CombinedAnalysis'), bitrate=8000)
        ani.save(output_filename, writer=writer)
        print(f"✅ 视频已生成: {output_filename}")
    except Exception as e:
        print(f"❌ 保存失败: {e}")

# =================================================================
# 主程序
# =================================================================

if __name__ == "__main__":
    base_dir = './data/20260115/20260115_xu' 
    SPEED_FACTOR = 0.5  # 播放速度倍率
    output_path = os.path.join(base_dir, "combined_dashboard_vfront.mp4")

    if not os.path.exists(base_dir):
        if os.path.exists('sit.csv'): base_dir = '.'

    if os.path.exists(os.path.join(base_dir, "stand.csv")) and os.path.exists(os.path.join(base_dir, "sit.csv")):
        d_stand, t_stand, d_sit, t_sit = read_ss_raw_data(
            os.path.join(base_dir, "stand.csv"), 
            os.path.join(base_dir, "sit.csv")
        )
        
        generate_combined_dashboard(
            d_stand, t_stand,
            d_sit, t_sit,
            output_path,
            SPEED_FACTOR=SPEED_FACTOR
        )
    else:
        print(f"❌ 未在 {base_dir} 找到输入文件")
