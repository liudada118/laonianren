import os
import ast
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import cv2
import scipy.ndimage
from datetime import datetime
from scipy.signal import find_peaks
from scipy.ndimage import center_of_mass, zoom, gaussian_filter
from scipy.spatial.distance import cdist
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Image, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

# ================= 字体注册 (全局配置) =================
MY_FONT_NAME = 'SimSun'  
try:
    pdfmetrics.registerFont(TTFont(MY_FONT_NAME, 'simsun.ttc', subfontIndex=0))
    print(f"成功加载字体: {MY_FONT_NAME}")
except Exception as e:
    print(f"【警告】未找到 simsun.ttc，尝试加载微软雅黑...")
    try:
        MY_FONT_NAME = 'MsYaHei'
        pdfmetrics.registerFont(TTFont(MY_FONT_NAME, 'msyh.ttf'))
        print(f"成功加载字体: {MY_FONT_NAME}")
    except:
        print("【错误】未找到自定义字体文件！回退到 STSong-Light")
        MY_FONT_NAME = 'STSong-Light'
        pdfmetrics.registerFont(UnicodeCIDFont(MY_FONT_NAME))

plt.rcParams['font.sans-serif'] = ['SimSun', 'SimHei', 'Microsoft YaHei']
plt.rcParams['axes.unicode_minus'] = False

# ================= 0. 数据读取函数 =================

def read_ss_raw_data(stand_path, sit_path):
    """
    输入： stand_path: 站立数据CSV路径, sit_path: 坐姿数据CSV路径
    输出: stand_data_seq, stand_time_seq, sit_data_seq, sit_time_seq
    """
    df_stand = pd.read_csv(stand_path)
    df_sit = pd.read_csv(sit_path)
    return (df_stand['data'].tolist(), df_stand['time'].tolist(), 
            df_sit['data'].tolist(), df_sit['time'].tolist())

# ================= 1. 核心算法工具 =================

def AMPD(data):
    # data: 输入的一维压力数值序列
    # 返回: 检测到的波峰索引列表 list
    """AMDP 峰值检测"""
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


def get_smooth_heatmap(original_matrix, upscale_factor=10, sigma=0.8):
    # original_matrix: 原始矩阵, upscale_factor: 放大倍数, sigma: 平滑系数
    # 返回: 处理后的平滑矩阵 numpy.ndarray
    matrix = np.array(original_matrix, dtype=float)
    if np.sum(matrix) == 0: return matrix
    high_res = zoom(matrix, upscale_factor, order=3, prefilter=False)
    high_res = np.where(high_res < 0, 0, high_res)
    smoothed = gaussian_filter(high_res, sigma=sigma)
    return smoothed


def unite_broken_arch_components(binary_map, dist_threshold=3.0):
    # binary_map: 二值掩膜, dist_threshold: 合并距离阈值
    # 返回: 连通域数, 标签图, 统计信息, 质心
    """高足弓修复逻辑"""
    binary_map = (binary_map > 0).astype(np.uint8)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_map, connectivity=8)
    if num_labels <= 2: return num_labels, labels, stats, centroids

    label_points = {}
    for l in range(1, num_labels):
        label_points[l] = np.argwhere(labels == l)

    parent = list(range(num_labels))
    def find(i):
        if parent[i] == i: return i
        parent[i] = find(parent[i])
        return parent[i]
    def union(i, j):
        root_i, root_j = find(i), find(j)
        if root_i != root_j: parent[root_i] = root_j

    active_labels = list(label_points.keys())
    for i in range(len(active_labels)):
        for j in range(i + 1, len(active_labels)):
            l1, l2 = active_labels[i], active_labels[j]
            d = np.min(cdist(label_points[l1], label_points[l2]))
            if d < dist_threshold: union(l1, l2)

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
            x_min, x_max, y_min, y_max = np.min(xs), np.max(xs), np.min(ys), np.max(ys)
            final_stats[i] = [x_min, y_min, x_max-x_min+1, y_max-y_min+1, len(ys)]
            final_centroids[i] = [np.mean(xs), np.mean(ys)]
            
    return final_num, new_labels, final_stats, final_centroids

# ================= 2. 数据加载 (Sit & Stand) =================

def parse_time_column(df):
    # df: 原始数据Dataframe
    # 返回: 解析后的时间序列 pd.Series
    """统一解析时间列"""
    if 'time' in df.columns:
        return pd.to_datetime(df['time'], format='%Y/%m/%d %H:%M:%S:%f', errors='coerce')
    return pd.Series([])


def parse_data_column(df, shape=(64, 64)):
    # df: 原始数据Dataframe, shape: 目标矩阵形状
    # 返回: 转换后的三维数据张量 (frames, H, W)
    """统一解析Data列"""
    raw_frames = []
    target_len = shape[0] * shape[1]
    for raw_data in df['data']:
        try:
            if isinstance(raw_data, str):
                if raw_data.startswith('['): mat = np.array(ast.literal_eval(raw_data), dtype=np.float32)
                else: mat = np.fromstring(raw_data, sep=',')
            else: mat = np.array(raw_data, dtype=np.float32)
        except: mat = np.zeros(target_len, dtype=np.float32)
        
        if mat.size == target_len:
            raw_frames.append(mat.reshape(shape))
        else:
            raw_frames.append(np.zeros(shape, dtype=np.float32))
    return np.array(raw_frames)


def load_stand_data(data_seq, time_seq):
    """
    参数： data_seq: 站立数据序列, time_seq: 站立时间序列
    返回: 去噪后的帧序列 numpy.ndarray, 时间序列 pd.Series
    """
    print(f"正在处理 Stand 序列数据...")
    df = pd.DataFrame({'data': data_seq, 'time': time_seq})
    times = parse_time_column(df)
    tensor = parse_data_column(df, shape=(64, 64))

    # --- Stand 严格去噪 ---
    print("   执行 Stand 严格去噪...")
    tensor[tensor <= 4] = 0
    pixel_max = np.max(tensor, axis=0)
    keep_mask = (pixel_max - np.min(tensor, axis=0)) > 25
    tensor = tensor * keep_mask 

    max_series = np.max(tensor.reshape(len(tensor), -1), axis=1)
    is_active = (max_series > 4).astype(int)
    labeled_array, num_features = scipy.ndimage.label(is_active)
    for label_id in range(1, num_features + 1):
        indices = np.where(labeled_array == label_id)[0]
        if max_series[indices].max() <= 150: tensor[indices] = 0

    final_matrix = []
    kernel = np.ones((3, 3), dtype=np.float32) 
    for i in range(len(tensor)):
        frame = tensor[i]
        final_frame = np.rot90(np.fliplr(frame), k=1) # 旋转
        if np.max(final_frame) > 0:
            mask = (final_frame > 0).astype(np.uint8)
            num_labels, labels, stats, centroids = unite_broken_arch_components(mask)
            for l in range(1, num_labels):
                area = stats[l, 4]
                left = stats[l, 0]
                w = stats[l, 2]
                blob_max = np.max(final_frame[labels == l])
                if area < 15 or blob_max < 100 or (left <= 5) or (left + w >= 64 - 5):
                    final_frame[labels == l] = 0
            if np.max(final_frame) > 0:
                mask_f = (final_frame > 0).astype(np.float32)
                counts = cv2.filter2D(mask_f, -1, kernel, borderType=cv2.BORDER_CONSTANT)
                final_frame = final_frame * (counts >= 4)
        final_matrix.append(final_frame)
    
    return np.array(final_matrix), times


def load_sit_data(data_seq, time_seq):
    """
    参数： data_seq: 坐姿数据序列, time_seq: 坐姿时间序列
    返回: 去噪后的帧序列 numpy.ndarray, 时间序列 pd.Series
    """
    print(f"正在处理 Sit 序列数据...")
    df = pd.DataFrame({'data': data_seq, 'time': time_seq})
    times = parse_time_column(df)
    tensor = parse_data_column(df, shape=(32, 32))

    # --- Sit 基础去噪 ---
    final_matrix = []
    for frame in tensor:
        # 1. 基础底噪过滤
        frame[frame <= 10] = 0
        
        if np.max(frame) > 0:
            # 2. 连通域分析
            mask = (frame > 0).astype(np.uint8)
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
            
            # 3. 遍历每个连通域 (label=0 是背景，从 1 开始)
            for l in range(1, num_labels):
                area = stats[l, cv2.CC_STAT_AREA]
                
                # 获取当前连通域内的最大压力值
                # 注意: labels == l 生成一个布尔掩膜
                blob_max_val = np.max(frame[labels == l])
                
                # 【修改后的逻辑】
                # 如果 面积 < 50 且 最大值 < 100，则视为噪声去除
                if area < 30 and blob_max_val < 80:
                    frame[labels == l] = 0
                    
        final_matrix.append(frame)
        
    return np.array(final_matrix), times

# ================= 3. 周期检测核心逻辑 (混合 Stand & Sit) =================

def detect_stand_peaks_assisted(stand_data, stand_times, sit_data, sit_times):
    # stand_data/times: 站立数据, sit_data/times: 坐姿数据
    # 返回: 结合坐姿波谷确定的站立波峰索引列表 list
    """
    使用 Sit 数据的波峰（坐下时刻）作为 Stand 数据的分割点（波谷），
    在分割点之间寻找 Stand 的最大值（站立时刻）。
    返回：Stand 波峰的索引列表。
    """
    print("正在执行 [Sit辅助] 周期检测...")
    
    # 1. 计算 Sit 数据的总压力曲线 & 波峰
    sit_force = np.sum(sit_data, axis=(1, 2))
    sit_peaks_idx = AMPD(sit_force)
    
    if len(sit_peaks_idx) == 0:
        print("   [警告] 未检测到 Sit 波峰，退回仅使用 Stand 数据 AMPD。")
        stand_force = np.sum(stand_data, axis=(1, 2))
        return AMPD(stand_force)

    # 2. 获取 Sit 波峰对应的时间戳
    sit_peak_timestamps = sit_times.iloc[sit_peaks_idx].values
    print(f"   检测到 {len(sit_peak_timestamps)} 次坐下动作 (Sit Peaks)")

    # 3. 将 Sit 波峰时间映射到 Stand 数据的索引 (这些是 Stand 的理论波谷/分割点)
    stand_split_indices = []
    stand_times_val = stand_times.values
    for t_sit in sit_peak_timestamps:
        # 找到最近的 Stand 时间点索引
        idx = np.argmin(np.abs(stand_times_val - t_sit))
        stand_split_indices.append(idx)
    
    stand_split_indices.sort()
    
    # 4. 构建搜索区间，寻找 Stand 波峰
    # 逻辑：在 [Split_i, Split_i+1] 之间找最大值
    
    final_stand_peaks = []
    stand_force = np.sum(stand_data, axis=(1, 2))
    
    # 添加起始和结束点作为辅助分割
    all_boundaries = [0] + stand_split_indices + [len(stand_force)-1]
    
    for i in range(len(all_boundaries) - 1):
        start = all_boundaries[i]
        end = all_boundaries[i+1]
        
        # 区间过短则忽略
        if end - start < 10: 
            continue
            
        # 在区间内找 Stand 压力最大值
        segment = stand_force[start:end]
        if len(segment) > 0 and np.max(segment) > 500: # 必须有一定压力
            local_max_idx = np.argmax(segment)
            global_idx = start + local_max_idx
            final_stand_peaks.append(global_idx)
            
    # 去重并排序
    final_stand_peaks = sorted(list(set(final_stand_peaks)))
    print(f"   [结果] 结合 Sit 数据，最终锁定 {len(final_stand_peaks)} 个 Stand 周期波峰。")
    return final_stand_peaks


def calculate_cycle_durations(stand_times, stand_peaks):
    # stand_times: 时间序列, stand_peaks: 波峰索引
    # 返回: 包含总时长、周期数和平均周期的字典 dict
    """
    计算从第一个Stand波峰到最后一个Stand波峰的总用时及平均周期用时
    """
    if len(stand_peaks) < 2:
        return None

    # 获取时间戳 (pandas Series)
    t_start = stand_times.iloc[stand_peaks[0]]
    t_end = stand_times.iloc[stand_peaks[-1]]
    
    # 计算总耗时 (秒)
    total_duration = (t_end - t_start).total_seconds()
    
    # 计算有效周期数 (波峰数 - 1，即中间的区间数)
    num_cycles = len(stand_peaks) - 1
    
    # 计算平均耗时
    avg_duration = total_duration / num_cycles if num_cycles > 0 else 0
    
    return {
        "total_duration": total_duration,
        "num_cycles": num_cycles,
        "avg_duration": avg_duration
    }

# ================= 4. 绘图生成 (Page 1: Stand) =================

def get_foot_masks_and_bbox(pressure_data_np):
    # pressure_data_np: 压力数据矩阵序列
    # 返回: 左脚掩膜, 右脚掩膜, 左脚边界框, 右脚边界框
    total_energy = np.sum(pressure_data_np, axis=0)
    binary = (total_energy > np.max(total_energy) * 0.05).astype(np.uint8)
    num_labels, labels, stats, centroids = unite_broken_arch_components(binary) # 使用修复版
    
    valid_components = []
    for i in range(1, num_labels):
        if stats[i, 4] > 20: valid_components.append((i, centroids[i]))
            
    h, w = total_energy.shape
    left_mask = np.zeros((h, w), dtype=bool)
    right_mask = np.zeros((h, w), dtype=bool)
    
    if len(valid_components) >= 2:
        valid_components.sort(key=lambda x: x[1][0])
        l_idx, r_idx = valid_components[0][0], valid_components[-1][0]
        left_mask[labels == l_idx] = True
        right_mask[labels == r_idx] = True
    else:
        left_mask[:, :32] = True
        right_mask[:, 32:] = True
        
    def get_bbox(mask):
        rows = np.any(mask, axis=1)
        cols = np.any(mask, axis=0)
        if not np.any(rows) or not np.any(cols): return 0, h, 0, w
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        pad = 3
        return max(0, rmin-pad), min(h, rmax+pad), max(0, cmin-pad), min(w, cmax+pad)

    return left_mask, right_mask, get_bbox(left_mask), get_bbox(right_mask)


def calculate_split_cop(pressure_data_segment, l_mask, r_mask):
    # pressure_data_segment: 某一段压力序列, l_mask: 左脚掩膜, r_mask: 右脚掩膜
    # 返回: 左脚COP轨迹列表, 右脚COP轨迹列表
    l_cops, r_cops = [], []
    for frame in pressure_data_segment:
        # Left
        lf = frame * l_mask
        if np.sum(lf) > 10: l_cops.append(center_of_mass(lf)[::-1]) # (x, y)
        else: l_cops.append((np.nan, np.nan))
        # Right
        rf = frame * r_mask
        if np.sum(rf) > 10: r_cops.append(center_of_mass(rf)[::-1])
        else: r_cops.append((np.nan, np.nan))
    return l_cops, r_cops


def generate_stand_visuals(pressure_data_np, peaks, output_dir):
    # pressure_data_np: 压力数据, peaks: 波峰索引, output_dir: 图片保存目录
    # 返回: 演变图路径, COP图路径 (str, str)
    if len(peaks) < 2: return None, None
    l_mask, r_mask, l_bbox, r_bbox = get_foot_masks_and_bbox(pressure_data_np)
    
    # --- 图1: 周期演变 ---
    start_idx, end_idx = peaks[0], peaks[1]
    cycle_data = pressure_data_np[start_idx : end_idx+1]
    indices = [int(p * (len(cycle_data)-1)) for p in [0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0]]
    time_labels = ["0%", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"]
    
    fig, axes = plt.subplots(2, len(indices), figsize=(2.5 * len(indices), 8), facecolor='white')
    
    for col, (idx, label) in enumerate(zip(indices, time_labels)):
        frame = cycle_data[idx]
        for row, (mask, bbox, title) in enumerate([(l_mask, l_bbox, "Left"), (r_mask, r_bbox, "Right")]):
            ax = axes[row, col]
            ax.set_facecolor('black')
            crop = (frame * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
            smooth = get_smooth_heatmap(crop)
            masked = np.ma.masked_where(smooth <= np.max(smooth)*0.02, smooth)
            ax.imshow(masked, cmap='jet', origin='upper', interpolation='bicubic')
            if col == 0: ax.set_ylabel(title, fontsize=20, fontweight='bold', color='black')
            if row == 0: ax.set_title(label, fontsize=20, fontweight='bold', color='black')
            ax.set_xticks([]); ax.set_yticks([])
            for spine in ax.spines.values(): spine.set_visible(False)

    plt.tight_layout()
    img_evo = os.path.join(output_dir, "stand_evolution.png")
    plt.savefig(img_evo, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close()

    # --- 图2: COP 轨迹 ---
    peak_frames = pressure_data_np[peaks]
    avg_peak = np.mean(peak_frames, axis=0)
    fig2, (ax1, ax2) = plt.subplots(1, 2, figsize=(10, 5), facecolor='white')
    
    colors_cycle = plt.cm.spring(np.linspace(0, 1, len(peaks)-1))
    
    for ax, mask, bbox, name in [(ax1, l_mask, l_bbox, "左脚"), (ax2, r_mask, r_bbox, "右脚")]:
        ax.set_facecolor('black')
        bg = (avg_peak * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
        bg_smooth = get_smooth_heatmap(bg, sigma=0.8)
        ax.imshow(np.ma.masked_where(bg_smooth<1, bg_smooth), cmap='jet', origin='upper', 
                  extent=[0, bg.shape[1], bg.shape[0], 0], alpha=0.8)
        
        for i in range(len(peaks)-1):
            seg = pressure_data_np[peaks[i]:peaks[i+1]+1]
            l_cops, r_cops = calculate_split_cop(seg, l_mask, r_mask)
            cops = l_cops if name == "左脚" else r_cops
            
            # 坐标转换: global (x,y) -> local (x-bbox_cmin, y-bbox_rmin)
            xs = [c[0] - bbox[2] for c in cops]
            ys = [c[1] - bbox[0] for c in cops]
            
            ax.plot(xs, ys, '-', lw=2, color=colors_cycle[i], alpha=0.9, label=f'Cycle {i+1}' if name=="右脚" else "")
            if len(xs)>0 and not np.isnan(xs[0]):
                ax.scatter(xs[0], ys[0], c='white', s=20, zorder=5, edgecolors=colors_cycle[i]) # 起点
                # ax.scatter(xs[-1], ys[-1], c='red', marker='x', s=20, zorder=11, linewidths=1) # 终点
        
        ax.set_title(f"{name} COP曲线", color='black')
        ax.set_xticks([]); ax.set_yticks([])
        for spine in ax.spines.values(): spine.set_visible(False)
        
    if len(peaks) > 2: ax2.legend(fontsize='x-small', facecolor='black', labelcolor='white')
    plt.suptitle("平均压力 & COP曲线", color='black', fontsize=14)
    img_cop = os.path.join(output_dir, "stand_cop.png")
    plt.savefig(img_cop, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close()
    
    return img_evo, img_cop

# ================= 5. 绘图生成 (Page 2: Sit - 周期同步版) =================

def calculate_sit_cop(frame):
    # frame: 单帧坐姿矩阵
    # 返回: 坐标 (cx, cy)
    total = np.sum(frame)
    if total <= 10: return np.nan, np.nan
    cy, cx = center_of_mass(frame)
    return cx, cy


def generate_sit_visuals(sit_data, sit_times, stand_peaks, stand_times, output_dir):
    # sit_data/times: 坐姿数据, stand_peaks/times: 站立同步参考, output_dir: 图片保存目录
    # 返回: 坐姿演变图路径, 坐姿COP图路径 (str, str)
    """
    生成 Page 2: 坐姿演变与COP (同步版)
    逻辑：利用 Stand 的波峰时间作为 Sit 的分割点，提取中间段作为 Sit 周期
    """
    # 至少需要两个 Stand 波峰才能确定一个中间的 Sit 过程
    if len(stand_peaks) < 2: 
        print("   [Sit] Stand 周期不足以界定 Sit 区间 (需要至少2个 Stand Peaks)")
        return None, None
    
    print(f"   [Sit] 基于 Stand 周期进行同步分析...")

    # 1. 计算全局阈值 (ADC > max * 3%)
    sit_force_curve = np.sum(sit_data, axis=(1, 2))
    global_max_val = np.max(sit_force_curve) if len(sit_force_curve) > 0 else 1
    # 阈值：最大压力的 3% 或 50 (底噪防护)，取大者
    THRESHOLD = max(global_max_val * 0.03, 50)
    print(f"   [Sit] 噪声过滤阈值: {THRESHOLD:.1f} (Max: {global_max_val:.1f})")

    # 2. 提取所有周期的 Sit 数据段
    all_cycles_cops = [] # 存储每个周期的 [(x,y), (x,y)...]
    valid_frames_accumulator = [] # 用于生成背景热力图
    
    stand_times_val = stand_times.values
    sit_times_val = sit_times.values
    
    # 遍历每两个 Stand 波峰之间的时间段
    for i in range(len(stand_peaks) - 1):
        # 获取 Stand 确定的时间窗口 (Stand Peak -> Stand Peak)
        # 理论上，两个站立峰值中间就是坐下过程
        t_start = stand_times_val[stand_peaks[i]]
        t_end = stand_times_val[stand_peaks[i+1]]
        
        # 在 Sit 数据中找到对应的索引范围
        # 使用 searchsorted 快速定位
        idx_start = np.searchsorted(sit_times_val, t_start)
        idx_end = np.searchsorted(sit_times_val, t_end)
        
        if idx_end <= idx_start: continue
        
        # 提取该段数据
        segment_data = sit_data[idx_start:idx_end]
        segment_force = sit_force_curve[idx_start:idx_end]
        
        cycle_cop_xs = []
        cycle_cop_ys = []
        scale = 10.0 # 对应 upscale_factor
        
        has_valid_data = False
        
        for frame_idx, frame in enumerate(segment_data):
            # 【关键】3% 阈值过滤
            if segment_force[frame_idx] > THRESHOLD:
                cx, cy = calculate_sit_cop(frame)
                if not np.isnan(cx):
                    cycle_cop_xs.append(cx * scale)
                    cycle_cop_ys.append(cy * scale)
                    valid_frames_accumulator.append(frame)
                    has_valid_data = True
        
        # 只有当该周期内有有效数据时才记录
        if has_valid_data and len(cycle_cop_xs) > 5:
            all_cycles_cops.append((cycle_cop_xs, cycle_cop_ys))

    num_cycles = len(all_cycles_cops)
    print(f"   [Sit] 成功提取 {num_cycles} 个有效 Sit 周期。")
    
    if num_cycles == 0:
        return None, None

    # --- 图1: Sit 演变 (选取第一个完整周期做展示) ---
    # 为了展示效果，我们选取点数最多的那个周期来画演变图
    best_cycle_idx = np.argmax([len(c[0]) for c in all_cycles_cops])
    
    # 重新定位回原始数据做演变图 (为了获取原始帧)
    # 这里简化处理：直接使用累积的有效帧生成平均态，或者取中间时刻
    # 为了美观，我们使用 valid_frames_accumulator 生成平均演变不太现实（时序乱了）
    # 所以我们单独为演变图取一个代表性周期
    
    # 再次获取代表性周期的数据用于画第一行图
    rep_t_start = stand_times_val[stand_peaks[best_cycle_idx]]
    rep_t_end = stand_times_val[stand_peaks[best_cycle_idx+1]]
    rep_idx_start = np.searchsorted(sit_times_val, rep_t_start)
    rep_idx_end = np.searchsorted(sit_times_val, rep_t_end)
    rep_segment = sit_data[rep_idx_start:rep_idx_end]
    
    # 简单的演变图采样
    indices = [int(p * (len(rep_segment)-1)) for p in [0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0]]
    labels = ["Start", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "End"]
    
    fig, axes = plt.subplots(1, 11, figsize=(15, 3.5), facecolor='white')
    sit_max = global_max_val / (32*32) * 5 # 估算一个显示亮度
    if len(rep_segment) > 0:
        sit_max = np.max(rep_segment)
    
    for i, idx in enumerate(indices):
        ax = axes[i]
        ax.set_facecolor('black')
        if idx < len(rep_segment):
            frame = rep_segment[idx]
            smooth = get_smooth_heatmap(frame, upscale_factor=10, sigma=0.8)
            masked = np.ma.masked_where(smooth <= 1, smooth)
            ax.imshow(masked, cmap='jet', vmin=0, vmax=sit_max, origin='upper')
        ax.set_title(labels[i], color='black')
        ax.set_xticks([]); ax.set_yticks([])
        for spine in ax.spines.values(): spine.set_visible(False)
        
    plt.tight_layout()
    img_sit_evo = os.path.join(output_dir, "sit_evolution.png")
    plt.savefig(img_sit_evo, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close()

    # --- 图2: Sit 平均分布 + 多周期 COP 轨迹 ---
    fig2, ax = plt.subplots(figsize=(6, 5), facecolor='white')
    ax.set_facecolor('black')
    
    # 1. 绘制背景：所有有效帧的平均值
    if len(valid_frames_accumulator) > 0:
        avg_frame = np.mean(valid_frames_accumulator, axis=0)
    else:
        avg_frame = np.zeros((32, 32))
        
    bg_smooth = get_smooth_heatmap(avg_frame, upscale_factor=10, sigma=0.8)
    h_bg, w_bg = bg_smooth.shape
    ax.imshow(np.ma.masked_where(bg_smooth<1, bg_smooth), cmap='jet', origin='upper', 
              extent=[0, w_bg, h_bg, 0], alpha=0.9)
    
    # 2. 绘制每一条 COP 轨迹
    colors_cycle = plt.cm.spring(np.linspace(0, 1, max(num_cycles, 2)))
    
    for i in range(num_cycles):
        xs, ys = all_cycles_cops[i]
        color = colors_cycle[i]
        
        if len(xs) > 1:
            ax.plot(xs, ys, color=color, lw=2.0, alpha=0.9, label=f'Cycle {i+1}')
            # 标记起点 (圆圈)
            ax.scatter(xs[0], ys[0], c='white', s=20, zorder=10, edgecolors=color) 
            ax.scatter(xs[-1], ys[-1], c='red', marker='x', s=20, zorder=11, linewidths=1)
    
    ax.legend(facecolor='black', labelcolor='white', fontsize='x-small', loc='upper right')
    ax.set_title(f"平均压力 & COP曲线", color='black', fontsize=14)
    ax.set_xticks([]); ax.set_yticks([])
    for spine in ax.spines.values(): spine.set_visible(False)

    img_sit_cop = os.path.join(output_dir, "sit_cop.png")
    plt.savefig(img_sit_cop, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close()
    
    return img_sit_evo, img_sit_cop


# ================= 7. 主控与PDF生成合并函数 (分业独立控制版) =================

def process_and_generate_report(stand_data_seq, stand_time_seq, 
    sit_data_seq, sit_time_seq, output_dir=None, pdf_name="Sit_Stand_Analysis_Report.pdf"):
    # input_dir: CSV所在目录, output_dir: PDF保存目录, pdf_name: 文件名
    # 返回: 无（直接保存PDF到指定目录并清理临时图片）
    """
    合并版主控函数：负责数据处理、绘图、以及直接生成PDF报告。
    已将 PDF 页面生成逻辑拆开，方便单独调试每一页的样式。
    """
    if not os.path.exists(output_dir): 
        print(f"创建输出目录: {output_dir}")
        os.makedirs(output_dir, exist_ok=True)
    
    temp_images = []
    stand_img1, stand_img2 = None, None
    sit_img1, sit_img2 = None, None
    
    # ---------------------------------------------------------
    # 1. 数据加载与图像生成阶段
    # ---------------------------------------------------------
    try:
        # 加载数据
        stand_data, stand_times = load_stand_data(stand_data_seq, stand_time_seq)
        sit_data, sit_times = load_sit_data(sit_data_seq, sit_time_seq)
        
        # 核心算法
        stand_peaks = detect_stand_peaks_assisted(stand_data, stand_times, sit_data, sit_times)

        # 计算用时
        duration_stats = calculate_cycle_durations(stand_times, stand_peaks)
        
        # 生成图片
        print("正在生成 Stand 页面图片...")
        stand_img1, stand_img2 = generate_stand_visuals(stand_data, stand_peaks, output_dir)
        if stand_img1: temp_images.append(stand_img1)
        if stand_img2: temp_images.append(stand_img2)
        
        print("正在生成 Sit 页面图片 (基于 Stand 同步)...")
        sit_img1, sit_img2 = generate_sit_visuals(sit_data, sit_times, stand_peaks, stand_times, output_dir)
        if sit_img1: temp_images.append(sit_img1)
        if sit_img2: temp_images.append(sit_img2)
            
    except Exception as e:
        print(f"数据处理阶段发生错误: {e}")
        import traceback
        traceback.print_exc()
        return

    # ---------------------------------------------------------
    # 2. PDF 生成阶段 (每一页单独控制)
    # ---------------------------------------------------------
    if not (stand_img1 and stand_img2) and not (sit_img1 and sit_img2):
        print("没有有效图片可生成 PDF。")
        return

    output_pdf_path = os.path.join(output_dir, pdf_name)
    print(f"正在组装 PDF: {output_pdf_path}")

    # --- 内部函数：页眉绘制逻辑 ---
    def draw_header(canvas, doc):
        canvas.saveState()
        page_w, page_h = doc.pagesize
        
        # Logo 配置
        logo_left = "./logo/logo_report.png"
        logo_right = "./logo/logo_company.png"
        
        line_y = page_h - 2.1 * cm    
        date_y = line_y + 0.3 * cm    
        
        # Logos
        if os.path.exists(logo_left):
            canvas.drawImage(logo_left, x=2*cm, y=page_h - 1.3*cm, 
                             width=7*cm, height=1*cm, mask='auto', preserveAspectRatio=True)
        if os.path.exists(logo_right):
            img_w = 5 * cm
            canvas.drawImage(logo_right, x=page_w - 2*cm - img_w, y=page_h - 1.8*cm, 
                             width=img_w, height=1.5*cm, mask='auto', preserveAspectRatio=True)

        # 日期
        date_str = datetime.now().strftime("%d/%m/%Y")
        try: canvas.setFont('SimSun', 16)
        except: canvas.setFont('Helvetica', 16)
        canvas.setFillColor(colors.black)
        canvas.drawString(2*cm, date_y, date_str)

        # 分割线
        canvas.setStrokeColor(colors.gray)
        canvas.setLineWidth(0.5)
        canvas.line(2*cm, line_y, page_w - 2*cm, line_y)
        canvas.restoreState()

    try:
        # 文档结构
        doc = SimpleDocTemplate(
            output_pdf_path, 
            pagesize=landscape(A4),
            leftMargin=2*cm, 
            rightMargin=2*cm, 
            topMargin=2.5*cm, 
            bottomMargin=1*cm
        )
        
        styles = getSampleStyleSheet()
        heading_style = ParagraphStyle(
            name='ChineseHeading', 
            parent=styles['Heading2'],
            fontName=MY_FONT_NAME, 
            fontSize=16, 
            leading=20, 
            spaceAfter=10, 
            textColor=colors.black
        )
        
        story = []

        if duration_stats:
            table_data = [
                ["总测试时长(s)", "有效周期数(站-坐-站为一个周期)", "平均周期时长(s)"],
                [f"{duration_stats['total_duration']:.2f}", 
                    f"{duration_stats['num_cycles']}", 
                    f"{duration_stats['avg_duration']:.2f}"]
            ]
            
            ts = TableStyle([
                ('FONTNAME', (0, 0), (-1, -1), MY_FONT_NAME),  # 字体
                ('FONTSIZE', (0, 0), (-1, 0), 12),             # 表头字号
                ('FONTSIZE', (0, 1), (-1, 1), 12),             # 内容字号
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),         # 居中对齐
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),        # 垂直居中
                ('GRID', (0, 0), (-1, -1), 1, colors.black),   # 黑色网格线
                ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey), # 表头背景灰
                ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
                ('topPadding', (0, 0), (-1, -1), 8),
                ('bottomPadding', (0, 0), (-1, -1), 8),
            ])
            t = Table(table_data, colWidths=[8.3*cm, 8.3*cm, 8.3*cm])
            t.setStyle(ts)
        
        # ==========================================
        # PAGE 1: 站姿分析 (Stand Analysis)
        # ==========================================
        if stand_img1 and stand_img2 and os.path.exists(stand_img1) and os.path.exists(stand_img2):
            title_text = "站-坐-站 足底压力分布与重心演变 (Stand Analysis)"
            story.append(Paragraph(title_text, heading_style))
            story.append(t)
            story.append(Spacer(1, 5)) # 标题下方间距

            im1 = Image(stand_img1)
            im1._restrictSize(25 * cm, 10 * cm) 
            story.append(im1)

            story.append(Spacer(1, 1)) # 两图之间间距

            im2 = Image(stand_img2)
            im2._restrictSize(15 * cm, 7 * cm)
            story.append(im2)
            
            # 如果后面还有 Page 2，则添加分页符
            if sit_img1 and sit_img2:
                story.append(PageBreak())

        # ==========================================
        # PAGE 2: 坐姿分析 (Sit Analysis)
        # ==========================================
        if sit_img1 and sit_img2 and os.path.exists(sit_img1) and os.path.exists(sit_img2):
            # 1. 标题
            title_text = "站-坐-站 坐姿压力分布与重心演变 (Sit Analysis)"
            story.append(Paragraph(title_text, heading_style))
            story.append(t)
            story.append(Spacer(1, 5)) # 标题下方间距

            im1 = Image(sit_img1)
            im1._restrictSize(25 * cm, 10 * cm) 
            story.append(im1)
            
            story.append(Spacer(1, 1))

            im2 = Image(sit_img2)
            im2._restrictSize(18 * cm, 7 * cm)
            story.append(im2)

            story.append(Spacer(1, 0.5 * cm))

        # num_blank_pages = 3  # 这里修改你需要的空白页数量
        # for _ in range(num_blank_pages):
        #     story.append(PageBreak())

        # story.append(PageBreak())
        # title_text = "站-坐-站 足底压力、重心演变综合分析 (Comprehensive Analysis)"
        # story.append(Paragraph(title_text, heading_style))

        # story.append(PageBreak())
        # title_text = "站-坐-站 坐姿压力、重心演变综合分析 (Comprehensive Analysis)"
        # story.append(Paragraph(title_text, heading_style))

        # 生成 PDF
        doc.build(story, onFirstPage=draw_header, onLaterPages=draw_header)
        print(f"✅ PDF生成成功: {output_pdf_path}")
        
        # ---------------------------------------------------------
        # 3. 清理阶段
        # ---------------------------------------------------------
        print("正在清理临时缓存图片...")
        for img_path in temp_images:
            try:
                if os.path.exists(img_path):
                    os.remove(img_path)
            except Exception as e:
                print(f"警告: 无法删除文件 {img_path}: {e}")
        print("清理完成，仅保留PDF报告。")

    except Exception as e:
        print(f"❌ PDF生成失败: {e}")
        import traceback
        traceback.print_exc()



# ================= Main (仅包含配置和调用) =================

if __name__ == "__main__":
    # 配置数据目录
    DATA_DIR = "./data/20260109/20260109_liu2" # 请修改为实际数据路径
    OUTPUT_DIR = DATA_DIR  # 可自定义输出目录
    PDF_NAME = "Sit_Stand_Analysis_Report_front.pdf"  # 可自定义PDF名称

    d_stand, t_stand, d_sit, t_sit = read_ss_raw_data(
        os.path.join(DATA_DIR, "stand.csv"),
        os.path.join(DATA_DIR, "sit.csv")
    )
    print("数据读取完成。开始处理...")
    # 执行处理
    process_and_generate_report(d_stand, t_stand, d_sit, t_sit, output_dir=OUTPUT_DIR, pdf_name=PDF_NAME)