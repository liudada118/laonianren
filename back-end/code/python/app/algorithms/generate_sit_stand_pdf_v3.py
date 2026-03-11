"""
起坐评估PDF报告生成脚本 v3.0
================================
重构版本 - 集中式布局配置 + 精确模板匹配

主要改进:
1. 使用 layout_config.py 集中管理所有布局参数
2. 直接使用 Canvas 绘制,实现像素级精确控制
3. 每页独立绘制函数,便于单独调整
4. 与PDF模板高度统一的样式

作者: Manus AI
日期: 2026-02-12
"""

import os
import ast
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')  # 使用非交互式后端
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import cv2
import scipy.ndimage
from datetime import datetime
from scipy.ndimage import center_of_mass, zoom, gaussian_filter
from scipy.spatial.distance import cdist
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from PIL import Image as PILImage
import io

# 导入布局配置
from layout_config import LayoutConfig as LC 

# ================= 字体注册 =================
def register_fonts():
    """注册中文字体"""
    global FONT_NAME
    try:
        pdfmetrics.registerFont(TTFont('SimSun', 'C:/Windows/Fonts/simsun.ttc', subfontIndex=0))
        FONT_NAME = 'SimSun'
        print(f"[Font] Loaded: {FONT_NAME}")
    except:
        try:
            pdfmetrics.registerFont(TTFont('MsYaHei', 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
            FONT_NAME = 'MsYaHei'
            print(f"[Font] Loaded: {FONT_NAME}")
        except:
            FONT_NAME = 'STSong-Light'
            pdfmetrics.registerFont(UnicodeCIDFont(FONT_NAME))
            print(f"[Font] Fallback: {FONT_NAME}")

    # 更新配置中的字体名称
    LC.FONT_NAME = FONT_NAME
    return FONT_NAME

# 注册字体
FONT_NAME = register_fonts()

# Matplotlib中文字体配置
plt.rcParams['font.sans-serif'] = ['SimSun', 'SimHei', 'Microsoft YaHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# ================= 核心算法工具 =================

def AMPD(data):
    """AMPD 峰值检测算法"""
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


# ================= ADC → 牛顿 转换 =================

def adc_to_newton_foot(frame):
    """足底传感器 ADC→牛顿 转换（逐像素）
    规则: ADC < 150 → ADC / 12.7 N; ADC >= 150 → 12.0 N
    """
    frame = np.array(frame, dtype=np.float64)
    return np.where(frame < 150, frame / 12.7, 12.0) * (frame > 0)


def adc_to_newton_foot_sum(frame):
    """足底传感器单帧 ADC→牛顿 总和"""
    return float(np.sum(adc_to_newton_foot(frame)))


def adc_to_newton_sit_sum(adc_sum):
    """坐垫传感器 ADC总和→牛顿 转换
    规则: ADC总和 / 26.18 = 牛顿
    """
    return adc_sum / 26.18


def get_smooth_heatmap(original_matrix, upscale_factor=10, sigma=0.8):
    """生成平滑热力图"""
    matrix = np.array(original_matrix, dtype=float)
    if np.sum(matrix) == 0: return matrix
    high_res = zoom(matrix, upscale_factor, order=3, prefilter=False)
    high_res = np.where(high_res < 0, 0, high_res)
    smoothed = gaussian_filter(high_res, sigma=sigma)
    return smoothed


def _jet_colormap(val):
    """jet 色图近似 (0~1 -> RGB)"""
    if val <= 0:
        return (0, 0, 0)
    r = min(max(4*val - 1.5, 0), 1) if val < 0.89 else max(-4*val + 4.5, 0)
    g = min(max(4*val - 0.5, 0), 1) if val < 0.64 else max(-4*val + 3.5, 0)
    b = min(max(4*val + 0.5, 0), 1) if val < 0.36 else max(-4*val + 2.5, 0)
    return (int(r*255), int(g*255), int(b*255))

# 预计算 jet 色图查找表 (256 级) — 用 matplotlib 精确生成
_JET_LUT = np.zeros((256, 3), dtype=np.uint8)
_jet_cm = plt.cm.get_cmap('jet')
for _i in range(256):
    _c = _jet_cm(_i / 255.0)
    _JET_LUT[_i] = (int(_c[0]*255), int(_c[1]*255), int(_c[2]*255))


def matrix_to_base64_png(matrix, vmax=None, bg_color=(0, 0, 0)):
    """用 PIL 将 numpy 矩阵直接转为 base64 PNG（跳过 matplotlib）"""
    arr = np.array(matrix, dtype=float)
    if arr.size == 0:
        return None
    mx = vmax if vmax and vmax > 0 else np.max(arr)
    if mx == 0:
        mx = 1
    # 阈值：低于最大值 2% 的像素视为背景（与 matplotlib masked_where 效果一致）
    threshold = mx * 0.02
    # 归一化到 0~255
    norm = np.clip(arr / mx * 255, 0, 255).astype(np.uint8)
    # 查表着色
    rgb = _JET_LUT[norm]  # shape: (H, W, 3)
    # 透明度：低于阈值的像素透明
    alpha = np.where(arr > threshold, 255, 0).astype(np.uint8)
    rgba = np.dstack([rgb, alpha[:, :, np.newaxis] if alpha.ndim == 2 else alpha])
    img = PILImage.fromarray(rgba.astype(np.uint8), 'RGBA')
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    import base64
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('ascii')


def unite_broken_arch_components(binary_map, dist_threshold=3.0):
    """高足弓修复逻辑 - 合并断裂的连通域"""
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

# ================= 数据加载与处理 =================

def parse_time_column(df):
    """解析时间列"""
    if 'time' in df.columns:
        return pd.to_datetime(df['time'], format='%Y/%m/%d %H:%M:%S:%f', errors='coerce')
    return pd.Series([])


def parse_data_column(df, shape=(64, 64)):
    """解析Data列为矩阵序列"""
    raw_frames = []
    target_len = shape[0] * shape[1]
    for raw_data in df['data']:
        try:
            if isinstance(raw_data, str):
                if raw_data.startswith('['): 
                    mat = np.array(ast.literal_eval(raw_data), dtype=np.float32)
                else: 
                    mat = np.fromstring(raw_data, sep=',')
            else: 
                mat = np.array(raw_data, dtype=np.float32)
        except: 
            mat = np.zeros(target_len, dtype=np.float32)
        
        if mat.size == target_len:
            raw_frames.append(mat.reshape(shape))
        else:
            raw_frames.append(np.zeros(shape, dtype=np.float32))
    return np.array(raw_frames)


def load_stand_data(file_path):
    """加载并去噪站立数据"""
    print(f" 正在读取 Stand 文件: {file_path}")
    df = pd.read_csv(file_path)
    times = parse_time_column(df)
    tensor = parse_data_column(df, shape=(64, 64))

    print("    执行 Stand 严格去噪...")
    tensor[tensor <= 4] = 0
    pixel_max = np.max(tensor, axis=0)
    keep_mask = (pixel_max - np.min(tensor, axis=0)) > 25
    tensor = tensor * keep_mask 

    max_series = np.max(tensor.reshape(len(tensor), -1), axis=1)
    is_active = (max_series > 4).astype(int)
    labeled_array, num_features = scipy.ndimage.label(is_active)
    for label_id in range(1, num_features + 1):
        indices = np.where(labeled_array == label_id)[0]
        if max_series[indices].max() <= 150: 
            tensor[indices] = 0

    # 批量旋转（向量化，避免逐帧 rot90+fliplr）
    tensor = np.rot90(np.flip(tensor, axis=2), k=1, axes=(1, 2))

    # 逐帧去噪（仅处理非零帧）
    kernel = np.ones((3, 3), dtype=np.float32)
    for i in range(len(tensor)):
        frame = tensor[i]
        if np.max(frame) <= 0:
            continue
        mask = (frame > 0).astype(np.uint8)
        # 用简单 connectedComponents 替代 unite_broken_arch_components（快 3-5 倍）
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for l in range(1, num_labels):
            area = stats[l, cv2.CC_STAT_AREA]
            left = stats[l, cv2.CC_STAT_LEFT]
            w = stats[l, cv2.CC_STAT_WIDTH]
            blob_max = np.max(frame[labels == l])
            if area < 15 or blob_max < 100 or left <= 5 or (left + w >= 59):
                frame[labels == l] = 0
        if np.max(frame) > 0:
            mask_f = (frame > 0).astype(np.float32)
            counts = cv2.filter2D(mask_f, -1, kernel, borderType=cv2.BORDER_CONSTANT)
            tensor[i] = frame * (counts >= 4)

    print(f"    Stand 数据加载完成: {len(tensor)} 帧")
    return tensor, times


def load_sit_data(file_path):
    """加载并去噪坐姿数据"""
    print(f" 正在读取 Sit 文件: {file_path}")
    df = pd.read_csv(file_path)
    times = parse_time_column(df)
    tensor = parse_data_column(df, shape=(32, 32))

    final_matrix = []
    for frame in tensor:
        frame[frame <= 10] = 0
        
        if np.max(frame) > 0:
            mask = (frame > 0).astype(np.uint8)
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
            
            for l in range(1, num_labels):
                area = stats[l, cv2.CC_STAT_AREA]
                blob_max_val = np.max(frame[labels == l])
                
                if area < 30 and blob_max_val < 80:
                    frame[labels == l] = 0
                    
        final_matrix.append(frame)
    
    print(f"    Sit 数据加载完成: {len(final_matrix)} 帧")
    return np.array(final_matrix), times

# ================= 周期检测 =================

def detect_stand_peaks_assisted(stand_data, stand_times, sit_data, sit_times):
    """使用 Sit 数据辅助确定 Stand 波峰"""
    print(" 正在执行 [Sit辅助] 周期检测...")
    
    sit_force = np.sum(sit_data, axis=(1, 2))
    sit_peaks_idx = AMPD(sit_force)
    
    if len(sit_peaks_idx) == 0:
        print("     未检测到 Sit 波峰，退回仅使用 Stand 数据 AMPD")
        stand_force = np.sum(stand_data, axis=(1, 2))
        return AMPD(stand_force)

    sit_peak_timestamps = sit_times.iloc[sit_peaks_idx].values
    print(f"    检测到 {len(sit_peak_timestamps)} 次坐下动作")

    stand_split_indices = []
    stand_times_val = stand_times.values
    for t_sit in sit_peak_timestamps:
        idx = np.argmin(np.abs(stand_times_val - t_sit))
        stand_split_indices.append(idx)
    
    stand_split_indices.sort()
    
    final_stand_peaks = []
    stand_force = np.sum(stand_data, axis=(1, 2))
    
    all_boundaries = [0] + stand_split_indices + [len(stand_force)-1]
    
    for i in range(len(all_boundaries) - 1):
        start = all_boundaries[i]
        end = all_boundaries[i+1]
        
        if end - start < 10: 
            continue
            
        segment = stand_force[start:end]
        if len(segment) > 0 and np.max(segment) > 500:
            local_max_idx = np.argmax(segment)
            global_idx = start + local_max_idx
            final_stand_peaks.append(global_idx)
            
    final_stand_peaks = sorted(list(set(final_stand_peaks)))
    print(f"    最终锁定 {len(final_stand_peaks)} 个 Stand 周期波峰")
    return final_stand_peaks


def calculate_cycle_durations(stand_times, stand_peaks):
    """计算周期统计信息"""
    if len(stand_peaks) < 2:
        return None

    t_start = stand_times.iloc[stand_peaks[0]]
    t_end = stand_times.iloc[stand_peaks[-1]]
    
    total_duration = (t_end - t_start).total_seconds()
    num_cycles = len(stand_peaks) - 1
    avg_duration = total_duration / num_cycles if num_cycles > 0 else 0
    
    return {
        "total_duration": total_duration,
        "num_cycles": num_cycles,
        "avg_duration": avg_duration
    }

# ================= 足部分析工具 =================

def get_foot_masks_and_bbox(pressure_data_np):
    """获取左右脚掩膜和边界框"""
    total_energy = np.sum(pressure_data_np, axis=0)
    binary = (total_energy > np.max(total_energy) * 0.05).astype(np.uint8)
    num_labels, labels, stats, centroids = unite_broken_arch_components(binary)
    
    valid_components = []
    for i in range(1, num_labels):
        if stats[i, 4] > 20: 
            valid_components.append((i, centroids[i]))
            
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
        if not np.any(rows) or not np.any(cols): 
            return 0, h, 0, w
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        pad = 3
        return max(0, rmin-pad), min(h, rmax+pad), max(0, cmin-pad), min(w, cmax+pad)

    return left_mask, right_mask, get_bbox(left_mask), get_bbox(right_mask)


def calculate_split_cop(pressure_data_segment, l_mask, r_mask):
    """计算分离的左右脚COP轨迹"""
    l_cops, r_cops = [], []
    for frame in pressure_data_segment:
        lf = frame * l_mask
        if np.sum(lf) > 10: 
            l_cops.append(center_of_mass(lf)[::-1])
        else: 
            l_cops.append((np.nan, np.nan))
        
        rf = frame * r_mask
        if np.sum(rf) > 10: 
            r_cops.append(center_of_mass(rf)[::-1])
        else: 
            r_cops.append((np.nan, np.nan))
    return l_cops, r_cops


def calculate_sit_cop(frame):
    """计算坐姿COP"""
    total = np.sum(frame)
    if total <= 10: 
        return np.nan, np.nan
    cy, cx = center_of_mass(frame)
    return cx, cy


# ================= 图像生成函数 =================

def generate_stand_evolution_heatmaps(pressure_data_np, peaks, output_dir):
    """生成Stand演变热力图 (2行×11列)
    
    Returns:
        list: 24个热力图图像路径 [(row, col, path), ...]
    """
    if len(peaks) < 2: 
        return []
    
    print(" 生成 Stand 演变热力图...")
    
    l_mask, r_mask, l_bbox, r_bbox = get_foot_masks_and_bbox(pressure_data_np)
    
    start_idx, end_idx = peaks[0], peaks[1]
    cycle_data = pressure_data_np[start_idx : end_idx+1]
    
    # 12个时间点采样
    indices = [int(p * (len(cycle_data)-1)) for p in np.linspace(0, 1, 11)]
    
    heatmap_paths = []
    
    for col_idx, frame_idx in enumerate(indices):
        frame = cycle_data[frame_idx]
        
        for row_idx, (mask, bbox, label) in enumerate([
            (l_mask, l_bbox, "left"),
            (r_mask, r_bbox, "right")
        ]):
            # 裁剪并平滑
            crop = (frame * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
            smooth = get_smooth_heatmap(crop, upscale_factor=LC.ImageConfig.UPSCALE_FACTOR, 
                                       sigma=LC.ImageConfig.SIGMA)
            masked = np.ma.masked_where(smooth <= np.max(smooth)*0.02, smooth)
            
            # 生成单个热力图
            fig, ax = plt.subplots(figsize=(2, 5), facecolor='white', dpi=LC.ImageConfig.DPI)
            ax.set_facecolor('black')
            ax.imshow(masked, cmap=LC.ImageConfig.HEATMAP_CMAP, origin='upper', interpolation='bicubic')
            ax.set_xticks([])
            ax.set_yticks([])
            for spine in ax.spines.values(): 
                spine.set_visible(False)
            
            plt.tight_layout(pad=0)
            
            # 保存
            img_path = os.path.join(output_dir, f"stand_evo_r{row_idx}_c{col_idx}.png")
            plt.savefig(img_path, dpi=LC.ImageConfig.DPI, bbox_inches='tight', 
                       facecolor='white', pad_inches=0)
            plt.close()
            
            heatmap_paths.append((row_idx, col_idx, img_path))
    
    print(f"    生成 {len(heatmap_paths)} 个热力图")
    return heatmap_paths


def generate_stand_cop_images(pressure_data_np, peaks, output_dir):
    """生成Stand COP曲线图 (左右两张)
    
    Returns:
        tuple: (left_image_path, right_image_path)
    """
    if len(peaks) < 2: 
        return None, None
    
    print(" 生成 Stand COP 曲线图...")
    
    l_mask, r_mask, l_bbox, r_bbox = get_foot_masks_and_bbox(pressure_data_np)
    
    peak_frames = pressure_data_np[peaks]
    avg_peak = np.mean(peak_frames, axis=0)
    
    colors_cycle = plt.cm.spring(np.linspace(0, 1, len(peaks)-1))
    
    img_paths = []
    
    for foot_name, mask, bbox in [("left", l_mask, l_bbox), ("right", r_mask, r_bbox)]:
        fig, ax = plt.subplots(figsize=(8, 10), facecolor='white', dpi=LC.ImageConfig.DPI)
        ax.set_facecolor('black')
        
        # 背景热力图
        bg = (avg_peak * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
        bg_smooth = get_smooth_heatmap(bg, sigma=LC.ImageConfig.SIGMA)
        ax.imshow(np.ma.masked_where(bg_smooth<1, bg_smooth), 
                 cmap=LC.ImageConfig.HEATMAP_CMAP, origin='upper', 
                 extent=[0, bg.shape[1], bg.shape[0], 0], alpha=0.8)
        
        # COP轨迹
        for i in range(len(peaks)-1):
            seg = pressure_data_np[peaks[i]:peaks[i+1]+1]
            l_cops, r_cops = calculate_split_cop(seg, l_mask, r_mask)
            cops = l_cops if foot_name == "left" else r_cops
            
            xs = [c[0] - bbox[2] for c in cops]
            ys = [c[1] - bbox[0] for c in cops]
            
            ax.plot(xs, ys, '-', lw=LC.ImageConfig.COP_LINE_WIDTH, 
                   color=colors_cycle[i], alpha=LC.ImageConfig.COP_LINE_ALPHA, 
                   label=f'Cycle {i+1}' if foot_name=="right" else "")
            if len(xs)>0 and not np.isnan(xs[0]):
                ax.scatter(xs[0], ys[0], c=LC.ImageConfig.COP_START_MARKER_COLOR, 
                          s=LC.ImageConfig.COP_START_MARKER_SIZE, zorder=5, 
                          edgecolors=colors_cycle[i], 
                          linewidths=LC.ImageConfig.COP_START_MARKER_EDGE_WIDTH)
        
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values(): 
            spine.set_edgecolor('black')
            spine.set_linewidth(2)
        
        if foot_name == "right" and len(peaks) > 2:
            legend = ax.legend(fontsize=LC.COPLayout.LEGEND_FONT_SIZE, 
                              loc='upper right', framealpha=0.9)
            legend.get_frame().set_facecolor('black')
            legend.get_frame().set_edgecolor('white')
            for text in legend.get_texts():
                text.set_color('white')
        
        plt.tight_layout(pad=0)
        
        img_path = os.path.join(output_dir, f"stand_cop_{foot_name}.png")
        plt.savefig(img_path, dpi=LC.ImageConfig.DPI, bbox_inches='tight', 
                   facecolor='white', pad_inches=0)
        plt.close()
        
        img_paths.append(img_path)
    
    print(f"    生成 2 张 COP 图")
    return tuple(img_paths)


def generate_sit_evolution_heatmaps(sit_data, sit_times, stand_peaks, stand_times, output_dir):
    """生成Sit演变热力图 (1行×11列)
    
    Returns:
        list: 11个热力图图像路径 [(col, path), ...]
    """
    if len(stand_peaks) < 2: 
        return []
    
    print(" 生成 Sit 演变热力图...")
    
    sit_force_curve = np.sum(sit_data, axis=(1, 2))
    global_max_val = np.max(sit_force_curve) if len(sit_force_curve) > 0 else 1
    
    stand_times_val = stand_times.values
    sit_times_val = sit_times.values
    
    # 选择中间周期
    best_cycle_idx = 0
    if len(stand_peaks) > 2:
        best_cycle_idx = len(stand_peaks) // 2 - 1
    
    rep_t_start = stand_times_val[stand_peaks[best_cycle_idx]]
    rep_t_end = stand_times_val[stand_peaks[best_cycle_idx+1]]
    rep_idx_start = np.searchsorted(sit_times_val, rep_t_start)
    rep_idx_end = np.searchsorted(sit_times_val, rep_t_end)
    rep_segment = sit_data[rep_idx_start:rep_idx_end]
    
    # 11个采样点
    indices = [int(p * (len(rep_segment)-1)) for p in np.linspace(0, 1, 11)]
    
    sit_max = np.max(rep_segment) if len(rep_segment) > 0 else 1
    
    heatmap_paths = []
    
    for col_idx, frame_idx in enumerate(indices):
        fig, ax = plt.subplots(figsize=(2.5, 3), facecolor='white', dpi=LC.ImageConfig.DPI)
        ax.set_facecolor('black')
        
        if frame_idx < len(rep_segment):
            frame = rep_segment[frame_idx]
            smooth = get_smooth_heatmap(frame, upscale_factor=LC.ImageConfig.UPSCALE_FACTOR, 
                                       sigma=LC.ImageConfig.SIGMA)
            masked = np.ma.masked_where(smooth <= 1, smooth)
            ax.imshow(masked, cmap=LC.ImageConfig.HEATMAP_CMAP, 
                     vmin=0, vmax=sit_max, origin='upper')
        
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values(): 
            spine.set_visible(False)
        
        plt.tight_layout(pad=0)
        
        img_path = os.path.join(output_dir, f"sit_evo_c{col_idx}.png")
        plt.savefig(img_path, dpi=LC.ImageConfig.DPI, bbox_inches='tight', 
                   facecolor='white', pad_inches=0)
        plt.close()
        
        heatmap_paths.append((col_idx, img_path))
    
    print(f"    生成 {len(heatmap_paths)} 个热力图")
    return heatmap_paths


def generate_sit_cop_image(sit_data, sit_times, stand_peaks, stand_times, output_dir):
    """生成Sit COP曲线图 (单张大图)
    
    Returns:
        str: 图像路径
    """
    if len(stand_peaks) < 2: 
        return None
    
    print(" 生成 Sit COP 曲线图...")
    
    sit_force_curve = np.sum(sit_data, axis=(1, 2))
    global_max_val = np.max(sit_force_curve) if len(sit_force_curve) > 0 else 1
    THRESHOLD = max(global_max_val * 0.03, 50)
    
    all_cycles_cops = []
    valid_frames_accumulator = []
    
    stand_times_val = stand_times.values
    sit_times_val = sit_times.values
    
    for i in range(len(stand_peaks) - 1):
        t_start = stand_times_val[stand_peaks[i]]
        t_end = stand_times_val[stand_peaks[i+1]]
        
        idx_start = np.searchsorted(sit_times_val, t_start)
        idx_end = np.searchsorted(sit_times_val, t_end)
        
        if idx_end <= idx_start: continue
        
        segment_data = sit_data[idx_start:idx_end]
        segment_force = sit_force_curve[idx_start:idx_end]
        
        cycle_cop_xs = []
        cycle_cop_ys = []
        scale = float(LC.ImageConfig.UPSCALE_FACTOR)
        
        has_valid_data = False
        
        for frame_idx, frame in enumerate(segment_data):
            if segment_force[frame_idx] > THRESHOLD:
                cx, cy = calculate_sit_cop(frame)
                if not np.isnan(cx):
                    cycle_cop_xs.append(cx * scale)
                    cycle_cop_ys.append(cy * scale)
                    valid_frames_accumulator.append(frame)
                    has_valid_data = True
        
        if has_valid_data and len(cycle_cop_xs) > 1:
            all_cycles_cops.append((cycle_cop_xs, cycle_cop_ys))

    num_cycles = len(all_cycles_cops)
    
    if num_cycles == 0:
        return None

    fig, ax = plt.subplots(figsize=(16, 12), facecolor='white', dpi=LC.ImageConfig.DPI)
    ax.set_facecolor('black')
    
    # 背景热力图
    if len(valid_frames_accumulator) > 0:
        avg_frame = np.mean(valid_frames_accumulator, axis=0)
    else:
        avg_frame = np.zeros((32, 32))
        
    bg_smooth = get_smooth_heatmap(avg_frame, upscale_factor=LC.ImageConfig.UPSCALE_FACTOR, 
                                   sigma=LC.ImageConfig.SIGMA)
    h_bg, w_bg = bg_smooth.shape
    ax.imshow(np.ma.masked_where(bg_smooth<1, bg_smooth), 
             cmap=LC.ImageConfig.HEATMAP_CMAP, origin='upper', 
             extent=[0, w_bg, h_bg, 0], alpha=0.9)
    
    # COP轨迹
    colors_cycle = plt.cm.spring(np.linspace(0, 1, max(num_cycles, 2)))
    
    for i in range(num_cycles):
        xs, ys = all_cycles_cops[i]
        color = colors_cycle[i]
        
        if len(xs) > 1:
            ax.plot(xs, ys, color=color, lw=LC.ImageConfig.COP_LINE_WIDTH + 0.5, 
                   alpha=LC.ImageConfig.COP_LINE_ALPHA, label=f'Cycle {i+1}')
            ax.scatter(xs[0], ys[0], c=LC.ImageConfig.COP_START_MARKER_COLOR, 
                      s=LC.ImageConfig.COP_START_MARKER_SIZE + 10, zorder=10, 
                      edgecolors=color, linewidths=LC.ImageConfig.COP_START_MARKER_EDGE_WIDTH)
    
    legend = ax.legend(fontsize=LC.COPLayout.LEGEND_FONT_SIZE, 
                      loc='upper right', framealpha=0.9)
    legend.get_frame().set_facecolor('black')
    legend.get_frame().set_edgecolor('white')
    for text in legend.get_texts():
        text.set_color('white')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values(): 
        spine.set_edgecolor('black')
        spine.set_linewidth(2)

    plt.tight_layout(pad=0)
    
    img_path = os.path.join(output_dir, "sit_cop.png")
    plt.savefig(img_path, dpi=LC.ImageConfig.DPI, bbox_inches='tight', 
               facecolor='white', pad_inches=0)
    plt.close()
    
    print(f"    生成 1 张 COP 图")
    return img_path


# ================= PDF绘制函数 (使用Canvas直接绘制) =================

def draw_rounded_rect(c, x, y, width, height, radius, fill=0, stroke=1):
    """绘制圆角矩形"""
    c.saveState()
    p = c.beginPath()
    p.moveTo(x + radius, y)
    p.lineTo(x + width - radius, y)
    p.arcTo(x + width - radius, y, x + width, y + radius, radius)
    p.lineTo(x + width, y + height - radius)
    p.arcTo(x + width, y + height - radius, x + width - radius, y + height, radius)
    p.lineTo(x + radius, y + height)
    p.arcTo(x + radius, y + height, x, y + height - radius, radius)
    p.lineTo(x, y + radius)
    p.arcTo(x, y + radius, x + radius, y, radius)
    p.close()
    c.drawPath(p, fill=fill, stroke=stroke)
    c.restoreState()


def draw_page_header(c, title_text, duration_stats, page_type, username="用户"):
    """绘制页眉 (第1页和第3页)
    
    Args:
        c: Canvas对象
        title_text: 副标题文字 (Stand Analysis / Sit Analysis)
        duration_stats: 统计数据字典
        page_type: 'stand' 或 'sit'
        username: 用户名
    """
    # 主标题
    c.setFont(LC.FONT_NAME, LC.HeaderLayout.TITLE_FONT_SIZE)
    c.setFillColor(LC.COLOR_BLACK)
    main_title = f"{username}的起坐评估静态报告"
    c.drawCentredString(LC.PAGE_WIDTH/2, LC.HeaderLayout.TITLE_Y, main_title)
    
    # 链接
    # c.setFillColor(LC.COLOR_BLUE)
    # c.setFont(LC.FONT_NAME, LC.HeaderLayout.LINK_FONT_SIZE)
    # c.drawRightString(LC.PAGE_WIDTH - LC.MARGIN_RIGHT, LC.HeaderLayout.LINK_Y, 
    #                   "⇨ 切换动态报告")
    
    # 黑色标签 "站-坐-站" (使用圆角矩形)
    c.setFillColor(LC.COLOR_BLACK)
    c.roundRect(LC.HeaderLayout.LABEL_X, LC.HeaderLayout.LABEL_Y, 
          LC.HeaderLayout.LABEL_WIDTH, LC.HeaderLayout.LABEL_HEIGHT, 
          radius=LC.HeaderLayout.LABEL_RADIUS, fill=1, stroke=0)
    
    c.setFillColor(LC.COLOR_WHITE)
    c.setFont(LC.FONT_NAME, LC.HeaderLayout.LABEL_FONT_SIZE)
    c.drawCentredString(LC.HeaderLayout.LABEL_X + LC.HeaderLayout.LABEL_WIDTH/2, 
                       LC.HeaderLayout.LABEL_Y + LC.HeaderLayout.LABEL_HEIGHT/2 - 0.1*cm, "站-坐-站")
    
    # 副标题文字
    c.setFillColor(LC.COLOR_BLACK)
    c.setFont(LC.FONT_NAME, LC.HeaderLayout.SUBTITLE_FONT_SIZE)
    c.drawString(LC.HeaderLayout.SUBTITLE_X, LC.HeaderLayout.SUBTITLE_Y, title_text)
    
    # 数据指标框
    if duration_stats:
        titles = ["测试总时长", "有效周期 (站-坐-站为一个周期)", "平均周期时"]
        values = [
            f"{duration_stats['total_duration']:.2f}",
            f"{duration_stats['num_cycles']}",
            f"{duration_stats['avg_duration']:.2f}"
        ]
        
        positions = LC.get_metrics_box_positions()
        
        for i, (x, y) in enumerate(positions):
            # 黑色标题栏
            c.setFillColor(LC.COLOR_BLACK)
            c.roundRect(x, y + LC.HeaderLayout.METRICS_DATA_HEIGHT, 
                  LC.HeaderLayout.METRICS_BOX_WIDTH, 
                  LC.HeaderLayout.METRICS_TITLE_HEIGHT, radius=LC.HeaderLayout.METRICE_RADIUS, fill=1, stroke=0)
            
            # 白色标题文字
            c.setFillColor(LC.COLOR_WHITE)
            c.setFont(LC.FONT_NAME, LC.HeaderLayout.METRICS_TITLE_FONT_SIZE)
            c.drawCentredString(x + LC.HeaderLayout.METRICS_BOX_WIDTH/2, 
                               y + LC.HeaderLayout.METRICS_DATA_HEIGHT + 0.15*cm, 
                               titles[i])
            
            # 白色数据框
            c.setFillColor(LC.COLOR_WHITE)
            c.setStrokeColor(LC.COLOR_GRAY_BORDER)
            c.setLineWidth(1)
            c.roundRect(x, y, LC.HeaderLayout.METRICS_BOX_WIDTH, 
                  LC.HeaderLayout.METRICS_DATA_HEIGHT - 0.2*cm, radius=LC.HeaderLayout.METRICE_RADIUS, fill=1, stroke=1)
            
            # 黑色数据文字
            c.setFillColor(LC.COLOR_BLACK)
            c.setFont(LC.FONT_NAME, LC.HeaderLayout.METRICS_DATA_FONT_SIZE)
            c.drawCentredString(x + LC.HeaderLayout.METRICS_BOX_WIDTH/2, 
                               y + 0.2*cm, values[i])


def draw_page1_stand_evolution(c, heatmap_paths, duration_stats, username="用户"):
    """绘制第1页: Stand演变图
    
    Args:
        c: Canvas对象
        heatmap_paths: 热力图路径列表 [(row, col, path), ...]
        duration_stats: 统计数据
        username: 用户名
    """
    print(" 绘制第1页: Stand演变图...")
    
    # 绘制页眉
    draw_page_header(c, "足底压力分布与重心演变 (Stand Analysis)", 
                    duration_stats, 'stand', username)
    
    # 绘制主内容区边框
    c.setStrokeColor(LC.COLOR_BLACK)
    c.setLineWidth(LC.EvolutionLayout.BORDER_LINE_WIDTH)
    c.roundRect(LC.EvolutionLayout.BORDER_X, LC.EvolutionLayout.BORDER_Y, 
               LC.EvolutionLayout.BORDER_WIDTH, LC.EvolutionLayout.BORDER_HEIGHT, 
               LC.EvolutionLayout.BORDER_RADIUS, fill=0, stroke=1)
    
    # 内容标题
    c.setFillColor(LC.COLOR_BLACK)
    c.setFont(LC.FONT_NAME, LC.EvolutionLayout.CONTENT_TITLE_FONT_SIZE)
    c.drawString(LC.EvolutionLayout.CONTENT_TITLE_X, LC.EvolutionLayout.CONTENT_TITLE_Y, 
                "周期内脚底压力变化 (站-坐-站)")
    
    # 第一列标题 "演变"
    x0, y0, w0, h0 = LC.get_stand_cell_position(0, 0)
    c.setFillColor(LC.EvolutionLayout.LABEL_BG_COLOR)
    c.rect(x0, y0 + h0 - LC.EvolutionLayout.COL_TITLE_PADDING, 
          w0, LC.EvolutionLayout.COL_TITLE_PADDING, fill=1, stroke=0)
    c.setFillColor(LC.EvolutionLayout.LABEL_TEXT_COLOR)
    c.setFont(LC.FONT_NAME, LC.EvolutionLayout.COL_TITLE_FONT_SIZE)
    c.drawCentredString(x0 + w0/2, y0 + h0 - LC.EvolutionLayout.COL_TITLE_PADDING + 1*mm, "演变")
    
    # 列标题
    col_titles = ["0%", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "100%"]
    for col_idx, title in enumerate(col_titles):
        x, y, w, h = LC.get_stand_cell_position(0, col_idx + 1)
        c.setFillColor(LC.EvolutionLayout.COL_TITLE_BG_COLOR)
        c.rect(x, y + h - LC.EvolutionLayout.COL_TITLE_PADDING, 
                   w, LC.EvolutionLayout.COL_TITLE_PADDING + 1 * mm, 
                   fill=1, stroke=0)
        c.setFillColor(LC.COLOR_BLACK)
        c.setFont(LC.FONT_NAME, LC.EvolutionLayout.COL_TITLE_FONT_SIZE)
        c.drawCentredString(x + w/2, y + h - LC.EvolutionLayout.COL_TITLE_PADDING + 1*mm, title)
    
    # 行标签
    row_labels = [("左脚\nLeft\nFoot", 0), ("右脚\nRight\nFoot", 1)]
    for label_text, row_idx in row_labels:
        x, y, w, h = LC.get_stand_cell_position(row_idx, 0)
        c.setFillColor(LC.EvolutionLayout.LABEL_BG_COLOR)
        c.rect(x, y, w, h + 1 * mm, fill=1, stroke=0)
        c.setFillColor(LC.EvolutionLayout.LABEL_TEXT_COLOR)
        c.setFont(LC.FONT_NAME, LC.EvolutionLayout.LABEL_FONT_SIZE)
        # 多行文字
        lines = label_text.split('\n')
        for i, line in enumerate(lines):
            c.drawCentredString(x + w/2, y + h/2 + (len(lines)/2 - i - 0.5)*0.4*cm, line)
    
    # 绘制热力图 (不保持宽高比,完全填充单元格)
    for row, col, img_path in heatmap_paths:
        x, y, w, h = LC.get_stand_cell_position(row, col + 1)
        img_h = h - LC.EvolutionLayout.COL_TITLE_PADDING if row == 0 else h + 1 * mm
        c.drawImage(img_path, x, y, width=w, height=img_h, preserveAspectRatio=False, mask='auto')


def draw_page2_stand_cop(c, left_img, right_img):
    """绘制第2页: Stand COP曲线
    
    Args:
        c: Canvas对象
        left_img: 左脚COP图像路径
        right_img: 右脚COP图像路径
    """
    print(" 绘制第2页: Stand COP曲线...")
    
    # 页面标题
    c.setFont(LC.FONT_NAME, LC.COPLayout.PAGE_TITLE_FONT_SIZE)
    c.setFillColor(LC.COLOR_BLACK)
    c.drawString(LC.MARGIN_LEFT, LC.COPLayout.PAGE_TITLE_Y, "平均压力&COP曲线")
    
    # 左栏
    c.setFillColor(LC.COPLayout.COL_TITLE_BG_COLOR)
    c.roundRect(LC.COPLayout.STAND_LEFT_X, 
          LC.COPLayout.STAND_LEFT_Y + LC.COPLayout.STAND_LEFT_HEIGHT - LC.COPLayout.COL_TITLE_HEIGHT + 2 * mm, 
          LC.COPLayout.STAND_LEFT_WIDTH, LC.COPLayout.COL_TITLE_HEIGHT, radius=2*mm, fill=1, stroke=0)
    c.setFillColor(LC.COPLayout.COL_TITLE_TEXT_COLOR)
    c.setFont(LC.FONT_NAME, LC.COPLayout.COL_TITLE_FONT_SIZE)
    c.drawCentredString(LC.COPLayout.STAND_LEFT_X + LC.COPLayout.STAND_LEFT_WIDTH/2, 
                       LC.COPLayout.STAND_LEFT_Y + LC.COPLayout.STAND_LEFT_HEIGHT - LC.COPLayout.COL_TITLE_HEIGHT/2, 
                       "左脚COP曲线")
    
    # 绘制黑色背景
    img_height = LC.COPLayout.STAND_LEFT_HEIGHT - LC.COPLayout.COL_TITLE_HEIGHT
    c.setFillColor(colors.black)
    c.roundRect(LC.COPLayout.STAND_LEFT_X, LC.COPLayout.STAND_LEFT_Y, 
          LC.COPLayout.STAND_LEFT_WIDTH, img_height, radius=2*mm, fill=1, stroke=0)
    
    # 绘制边框
    # c.setStrokeColor(LC.COPLayout.BORDER_COLOR)
    # c.setLineWidth(LC.COPLayout.BORDER_LINE_WIDTH)
    # c.rect(LC.COPLayout.STAND_LEFT_X, LC.COPLayout.STAND_LEFT_Y, 
    #       LC.COPLayout.STAND_LEFT_WIDTH, LC.COPLayout.STAND_LEFT_HEIGHT, fill=0, stroke=1)
    
    # 绘制左栏图片 (保持宽高比,居中显示)
    c.drawImage(left_img, LC.COPLayout.STAND_LEFT_X, LC.COPLayout.STAND_LEFT_Y, 
               width=LC.COPLayout.STAND_LEFT_WIDTH, 
               height=img_height, 
               preserveAspectRatio=True, anchor='c', mask='auto')
    
    # 右栏
    c.setFillColor(LC.COPLayout.COL_TITLE_BG_COLOR)
    c.roundRect(LC.COPLayout.STAND_RIGHT_X, 
          LC.COPLayout.STAND_RIGHT_Y + LC.COPLayout.STAND_RIGHT_HEIGHT - LC.COPLayout.COL_TITLE_HEIGHT + 2 * mm, 
          LC.COPLayout.STAND_RIGHT_WIDTH, LC.COPLayout.COL_TITLE_HEIGHT, radius=2*mm, fill=1, stroke=0)
    c.setFillColor(LC.COPLayout.COL_TITLE_TEXT_COLOR)
    c.setFont(LC.FONT_NAME, LC.COPLayout.COL_TITLE_FONT_SIZE)
    c.drawCentredString(LC.COPLayout.STAND_RIGHT_X + LC.COPLayout.STAND_RIGHT_WIDTH/2, 
                       LC.COPLayout.STAND_RIGHT_Y + LC.COPLayout.STAND_RIGHT_HEIGHT - LC.COPLayout.COL_TITLE_HEIGHT/2, 
                       "右脚COP曲线")
    
    # 绘制黑色背景
    img_height = LC.COPLayout.STAND_RIGHT_HEIGHT - LC.COPLayout.COL_TITLE_HEIGHT
    c.setFillColor(colors.black)
    c.roundRect(LC.COPLayout.STAND_RIGHT_X, LC.COPLayout.STAND_RIGHT_Y, 
          LC.COPLayout.STAND_RIGHT_WIDTH, img_height, radius=2*mm, fill=1, stroke=0)
    
    # 绘制边框
    # c.setStrokeColor(LC.COPLayout.BORDER_COLOR)
    # c.setLineWidth(LC.COPLayout.BORDER_LINE_WIDTH)
    # c.rect(LC.COPLayout.STAND_RIGHT_X, LC.COPLayout.STAND_RIGHT_Y, 
    #       LC.COPLayout.STAND_RIGHT_WIDTH, LC.COPLayout.STAND_RIGHT_HEIGHT, fill=0, stroke=1)
    
    # 绘制右栏图片 (保持宽高比,居中显示)
    c.drawImage(right_img, LC.COPLayout.STAND_RIGHT_X, LC.COPLayout.STAND_RIGHT_Y, 
               width=LC.COPLayout.STAND_RIGHT_WIDTH, 
               height=img_height, 
               preserveAspectRatio=True, anchor='c', mask='auto')


def draw_page3_sit_evolution(c, heatmap_paths, duration_stats, username="用户"):
    """绘制第3页: Sit演变图
    
    Args:
        c: Canvas对象
        heatmap_paths: 热力图路径列表 [(col, path), ...]
        duration_stats: 统计数据
        username: 用户名
    """
    print(" 绘制第3页: Sit演变图...")
    
    # 绘制页眉
    draw_page_header(c, "坐姿压力分布与重心演变 (Sit Analysis)", 
                    duration_stats, 'sit', username)
    
    # 绘制主内容区边框
    c.setStrokeColor(LC.COLOR_BLACK)
    c.setLineWidth(LC.EvolutionLayout.BORDER_LINE_WIDTH)
    c.roundRect(LC.EvolutionLayout.BORDER_X, LC.EvolutionLayout.BORDER_Y, 
               LC.EvolutionLayout.BORDER_WIDTH, LC.EvolutionLayout.BORDER_HEIGHT, 
               LC.EvolutionLayout.BORDER_RADIUS, fill=0, stroke=1)
    
    # 内容标题
    c.setFillColor(LC.COLOR_BLACK)
    c.setFont(LC.FONT_NAME, LC.EvolutionLayout.CONTENT_TITLE_FONT_SIZE)
    c.drawString(LC.EvolutionLayout.CONTENT_TITLE_X, LC.EvolutionLayout.CONTENT_TITLE_Y, 
                "周期内坐姿压力变化 (站-坐-站)")
    
    # 列标题
    col_titles = ["开始", "10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%", "结束"]
    for col_idx, title in enumerate(col_titles):
        x, y, w, h = LC.get_sit_cell_position(col_idx)
        c.setFillColor(LC.EvolutionLayout.COL_TITLE_BG_COLOR)
        c.rect(x, y + h - LC.EvolutionLayout.COL_TITLE_PADDING + 4 * cm, 
                   w, LC.EvolutionLayout.COL_TITLE_PADDING + 2 * mm, 
                    fill=1, stroke=0)
        c.setFillColor(LC.COLOR_BLACK)
        c.setFont(LC.FONT_NAME, LC.EvolutionLayout.COL_TITLE_FONT_SIZE)
        c.drawCentredString(x + w/2, y + h - LC.EvolutionLayout.COL_TITLE_PADDING + 41*mm, title)
    
    # 绘制热力图 (不保持宽高比,完全填充单元格)
    for col, img_path in heatmap_paths:
        x, y, w, h = LC.get_sit_cell_position(col)
        img_h = h - LC.EvolutionLayout.COL_TITLE_PADDING
        c.drawImage(img_path, x, y + 4 * cm, width=w, height=img_h, 
                   preserveAspectRatio=False, mask='auto')


def draw_page4_sit_cop(c, img_path):
    """绘制第4页: Sit COP曲线
    
    Args:
        c: Canvas对象
        img_path: COP图像路径
    """
    print(" 绘制第4页: Sit COP曲线...")
    
    # 页面标题
    c.setFont(LC.FONT_NAME, LC.COPLayout.PAGE_TITLE_FONT_SIZE)
    c.setFillColor(LC.COLOR_BLACK)
    c.drawString(LC.MARGIN_LEFT, LC.COPLayout.PAGE_TITLE_Y, "平均压力&COP曲线")
    
    # 绘制黑色背景
    c.setFillColor(colors.black)
    c.roundRect(LC.COPLayout.SIT_X, LC.COPLayout.SIT_Y, 
          LC.COPLayout.SIT_WIDTH, LC.COPLayout.SIT_HEIGHT, radius=5*mm, fill=1, stroke=0)
    
    # 绘制边框
    # c.setStrokeColor(LC.COPLayout.BORDER_COLOR)
    # c.setLineWidth(LC.COPLayout.BORDER_LINE_WIDTH)
    # c.rect(LC.COPLayout.SIT_X, LC.COPLayout.SIT_Y, 
    #       LC.COPLayout.SIT_WIDTH, LC.COPLayout.SIT_HEIGHT, fill=0, stroke=1)
    
    # 绘制Sit COP图片 (保持宽高比,居中显示)
    c.drawImage(img_path, LC.COPLayout.SIT_X, LC.COPLayout.SIT_Y, 
               width=LC.COPLayout.SIT_WIDTH, height=LC.COPLayout.SIT_HEIGHT, 
               preserveAspectRatio=True, anchor='c', mask='auto')


# ================= 主控函数 =================

def generate_report(data_dir, output_dir=None, pdf_name="Report.pdf", username="用户"):
    """主控函数: 生成完整的4页PDF报告
    
    Args:
        data_dir: 数据目录 (包含 stand.csv 和 sit.csv)
        output_dir: 输出目录 (默认与数据目录相同)
        pdf_name: PDF文件名
        username: 用户名
    """
    if output_dir is None:
        output_dir = data_dir
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    stand_csv = os.path.join(data_dir, "stand.csv")
    sit_csv = os.path.join(data_dir, "sit.csv")
    
    if not (os.path.exists(stand_csv) and os.path.exists(sit_csv)):
        print(f" 错误: 在 {data_dir} 中未找到 stand.csv 和 sit.csv")
        return
    
    print("="*60)
    print(" 开始生成起坐评估PDF报告")
    print("="*60)
    
    # 1. 加载数据
    stand_data, stand_times = load_stand_data(stand_csv)
    sit_data, sit_times = load_sit_data(sit_csv)
    
    # 2. 周期检测
    stand_peaks = detect_stand_peaks_assisted(stand_data, stand_times, sit_data, sit_times)
    duration_stats = calculate_cycle_durations(stand_times, stand_peaks)
    
    if not duration_stats:
        print(" 错误: 无法计算周期统计信息")
        return
    
    print(f"\n 统计信息:")
    print(f"   总时长: {duration_stats['total_duration']:.2f}s")
    print(f"   周期数: {duration_stats['num_cycles']}")
    print(f"   平均周期时长: {duration_stats['avg_duration']:.2f}s\n")
    
    # 3. 生成图像
    temp_images = []
    
    stand_evo_paths = generate_stand_evolution_heatmaps(stand_data, stand_peaks, output_dir)
    temp_images.extend([path for _, _, path in stand_evo_paths])
    
    stand_cop_left, stand_cop_right = generate_stand_cop_images(stand_data, stand_peaks, output_dir)
    if stand_cop_left: temp_images.append(stand_cop_left)
    if stand_cop_right: temp_images.append(stand_cop_right)
    
    sit_evo_paths = generate_sit_evolution_heatmaps(sit_data, sit_times, stand_peaks, stand_times, output_dir)
    temp_images.extend([path for _, path in sit_evo_paths])
    
    sit_cop_path = generate_sit_cop_image(sit_data, sit_times, stand_peaks, stand_times, output_dir)
    if sit_cop_path: temp_images.append(sit_cop_path)
    
    # 4. 生成PDF
    pdf_path = os.path.join(output_dir, pdf_name)
    print(f"\n 正在生成PDF: {pdf_path}")
    
    c = canvas.Canvas(pdf_path, pagesize=LC.PAGE_SIZE)
    
    # 第1页: Stand演变图
    if stand_evo_paths:
        draw_page1_stand_evolution(c, stand_evo_paths, duration_stats, username)
        c.showPage()
    
    # 第2页: Stand COP曲线
    if stand_cop_left and stand_cop_right:
        draw_page2_stand_cop(c, stand_cop_left, stand_cop_right)
        c.showPage()
    
    # 第3页: Sit演变图
    if sit_evo_paths:
        draw_page3_sit_evolution(c, sit_evo_paths, duration_stats, username)
        c.showPage()
    
    # 第4页: Sit COP曲线
    if sit_cop_path:
        draw_page4_sit_cop(c, sit_cop_path)
    
    c.save()
    
    print(f" PDF生成成功!")
    
    # 5. 清理临时图片
    print(f"\n 正在清理 {len(temp_images)} 个临时图片...")
    for img_path in temp_images:
        try:
            if os.path.exists(img_path):
                os.remove(img_path)
        except Exception as e:
            print(f"     无法删除 {img_path}: {e}")
    
    print(" 清理完成!")
    print("="*60)
    print(f" 报告生成完成: {pdf_path}")
    print("="*60)


# ================= API 可调用函数 =================

def generate_report_from_content(stand_csv_content, sit_csv_content, output_dir=None, username="用户"):
    """
    从 CSV 文本内容生成起坐评估报告（供 API 调用）

    Args:
        stand_csv_content: 脚垫 CSV 文本内容
        sit_csv_content: 坐垫 CSV 文本内容
        output_dir: 输出目录
        username: 用户名

    Returns:
        dict: 包含分析指标和 base64 图片的结构化结果
    """
    import tempfile

    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix='sitstand_api_')

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 写入临时 CSV 文件
    stand_csv = os.path.join(output_dir, "stand.csv")
    sit_csv = os.path.join(output_dir, "sit.csv")

    with open(stand_csv, 'w', encoding='utf-8') as f:
        f.write(stand_csv_content)
    with open(sit_csv, 'w', encoding='utf-8') as f:
        f.write(sit_csv_content)

    # 1. 加载数据
    stand_data, stand_times = load_stand_data(stand_csv)
    sit_data, sit_times = load_sit_data(sit_csv)

    # 1.5 对齐时间范围：裁剪到两个传感器的重叠区间，保持数据真实
    if len(stand_times) > 0 and len(sit_times) > 0:
        overlap_end = min(stand_times.iloc[-1], sit_times.iloc[-1])
        overlap_start = max(stand_times.iloc[0], sit_times.iloc[0])
        # 裁剪足底
        stand_mask = (stand_times >= overlap_start) & (stand_times <= overlap_end)
        if stand_mask.sum() > 0 and stand_mask.sum() < len(stand_times):
            print(f"  [对齐] 足底裁剪: {len(stand_times)} → {stand_mask.sum()} 帧")
            stand_data = stand_data[stand_mask.values]
            stand_times = stand_times[stand_mask.values].reset_index(drop=True)
        # 裁剪坐垫
        sit_mask = (sit_times >= overlap_start) & (sit_times <= overlap_end)
        if sit_mask.sum() > 0 and sit_mask.sum() < len(sit_times):
            print(f"  [对齐] 坐垫裁剪: {len(sit_times)} → {sit_mask.sum()} 帧")
            sit_data = sit_data[sit_mask.values]
            sit_times = sit_times[sit_mask.values].reset_index(drop=True)

    # 2. 周期检测
    stand_peaks = detect_stand_peaks_assisted(stand_data, stand_times, sit_data, sit_times)
    duration_stats = calculate_cycle_durations(stand_times, stand_peaks)

    if not duration_stats:
        # 峰值不足2个时，提供默认周期统计（不再抛异常，让报告继续生成）
        print("  ⚠️ 峰值不足2个，使用默认周期统计（力曲线和压力统计仍可用）")
        stand_force_total = np.sum(stand_data, axis=(1, 2))
        t0 = stand_times.iloc[0] if len(stand_times) > 0 else None
        t_end = stand_times.iloc[-1] if len(stand_times) > 0 else None
        total_dur = (t_end - t0).total_seconds() if t0 is not None and t_end is not None else 0
        duration_stats = {
            "total_duration": total_dur,
            "num_cycles": 0,
            "avg_duration": 0,
        }

    # [已注释] 3. base64 PNG 图片生成 — 前端已使用 heatmap_data + cop_data 通过 Canvas 渲染，不再需要 images
    # import base64  # (下方 cop_data 段仍需要，移到那里)
    upf = LC.ImageConfig.UPSCALE_FACTOR
    sig = LC.ImageConfig.SIGMA

    # print(" 生成站立演变热力图 (PIL)...")
    stand_evo_images = []
    # if len(stand_peaks) >= 2:
    #     l_mask, r_mask, l_bbox, r_bbox = get_foot_masks_and_bbox(stand_data)
    #     start_idx, end_idx = stand_peaks[0], stand_peaks[1]
    #     cycle_data = stand_data[start_idx : end_idx+1]
    #     indices = [int(p * (len(cycle_data)-1)) for p in np.linspace(0, 1, 11)]
    #     for col_idx, frame_idx in enumerate(indices):
    #         frame = cycle_data[frame_idx]
    #         for row_idx, (mask, bbox, label) in enumerate([
    #             (l_mask, l_bbox, "left"), (r_mask, r_bbox, "right")
    #         ]):
    #             crop = (frame * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
    #             smooth = get_smooth_heatmap(crop, upscale_factor=upf, sigma=sig)
    #             b64 = matrix_to_base64_png(smooth)
    #             if b64:
    #                 stand_evo_images.append({'label': row_idx, 'sublabel': col_idx, 'image': b64})

    # [已注释] 站立COP base64 图片 — 前端使用 cop_data 通过 Canvas 渲染
    # print(" 生成站立COP图 (PIL)...")
    stand_cop_left_b64 = None
    stand_cop_right_b64 = None
    # if len(stand_peaks) >= 2:
    #     peak_frames = stand_data[stand_peaks]
    #     avg_peak = np.mean(peak_frames, axis=0)
    #     for foot_name, mask, bbox in [("left", l_mask, l_bbox), ("right", r_mask, r_bbox)]:
    #         bg = (avg_peak * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
    #         bg_smooth = get_smooth_heatmap(bg, sigma=sig)
    #         h_bg, w_bg = bg_smooth.shape
    #         mx = np.max(bg_smooth) if np.max(bg_smooth) > 0 else 1
    #         norm = np.clip(bg_smooth / mx * 255, 0, 255).astype(np.uint8)
    #         rgb = _JET_LUT[norm]
    #         alpha = np.where(bg_smooth > 1, int(255*0.8), 0).astype(np.uint8)
    #         rgba = np.dstack([rgb, alpha[:,:,np.newaxis] if alpha.ndim == 2 else alpha])
    #         img = PILImage.fromarray(rgba.astype(np.uint8), 'RGBA')
    #         from PIL import ImageDraw
    #         draw = ImageDraw.Draw(img)
    #         colors_arr = np.linspace(0, 1, max(len(stand_peaks)-1, 1))
    #         for i in range(len(stand_peaks)-1):
    #             seg = stand_data[stand_peaks[i]:stand_peaks[i+1]+1]
    #             l_cops, r_cops = calculate_split_cop(seg, l_mask, r_mask)
    #             cops = l_cops if foot_name == "left" else r_cops
    #             pts = []
    #             for c_pt in cops:
    #                 x = (c_pt[0] - bbox[2]) * upf
    #                 y = (c_pt[1] - bbox[0]) * upf
    #                 if not (np.isnan(x) or np.isnan(y)):
    #                     pts.append((x, y))
    #             if len(pts) > 1:
    #                 t = colors_arr[i]
    #                 cr = 255
    #                 cg = int(255 * (1 - t))
    #                 cb = int(255 * t)
    #                 draw.line(pts, fill=(cr, cg, cb, 200), width=max(2, upf // 4))
    #                 if pts:
    #                     x0, y0 = pts[0]
    #                     r = max(3, upf // 3)
    #                     draw.ellipse([x0-r, y0-r, x0+r, y0+r], fill=(0, 255, 0, 255))
    #         buf = io.BytesIO()
    #         img.save(buf, format='PNG', optimize=True)
    #         b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('ascii')
    #         if foot_name == "left":
    #             stand_cop_left_b64 = b64
    #         else:
    #             stand_cop_right_b64 = b64

    # [已注释] 坐姿演变 base64 图片 — 前端使用 heatmap_data.sit_evolution 通过 Canvas 渲染
    # print(" 生成坐姿演变热力图 (PIL)...")
    sit_evo_images = []
    # if len(stand_peaks) >= 2:
    #     stand_times_val = stand_times.values
    #     sit_times_val = sit_times.values
    #     best_cycle_idx = 0
    #     if len(stand_peaks) > 2:
    #         best_cycle_idx = len(stand_peaks) // 2 - 1
    #     rep_t_start = stand_times_val[stand_peaks[best_cycle_idx]]
    #     rep_t_end = stand_times_val[stand_peaks[best_cycle_idx+1]]
    #     rep_idx_start = np.searchsorted(sit_times_val, rep_t_start)
    #     rep_idx_end = np.searchsorted(sit_times_val, rep_t_end)
    #     rep_segment = sit_data[rep_idx_start:rep_idx_end]
    #     sit_indices = [int(p * (len(rep_segment)-1)) for p in np.linspace(0, 1, 11)]
    #     for col_idx, frame_idx in enumerate(sit_indices):
    #         if frame_idx < len(rep_segment):
    #             frame = rep_segment[frame_idx]
    #             smooth = get_smooth_heatmap(frame, upscale_factor=upf, sigma=sig)
    #             b64 = matrix_to_base64_png(smooth)
    #             if b64:
    #                 sit_evo_images.append({'label': col_idx, 'image': b64})

    # [已注释] 坐姿COP base64 图片 — 前端使用 cop_data 通过 Canvas 渲染
    # print(" 生成坐姿COP图 (PIL)...")
    sit_cop_b64 = None
    # if len(stand_peaks) >= 2:
    #     sit_force_curve = np.sum(sit_data, axis=(1, 2))
    #     global_max_val = np.max(sit_force_curve) if len(sit_force_curve) > 0 else 1
    #     THRESHOLD = max(global_max_val * 0.03, 50)
    #     all_cycles_cops = []
    #     valid_frames_accumulator = []
    #     for i in range(len(stand_peaks) - 1):
    #         t_start = stand_times_val[stand_peaks[i]]
    #         t_end = stand_times_val[stand_peaks[i+1]]
    #         idx_start = np.searchsorted(sit_times_val, t_start)
    #         idx_end = np.searchsorted(sit_times_val, t_end)
    #         if idx_end <= idx_start: continue
    #         segment_data = sit_data[idx_start:idx_end]
    #         segment_force = sit_force_curve[idx_start:idx_end]
    #         cycle_xs, cycle_ys = [], []
    #         has_valid = False
    #         for fi, frame in enumerate(segment_data):
    #             if segment_force[fi] > THRESHOLD:
    #                 cx, cy = calculate_sit_cop(frame)
    #                 if not np.isnan(cx):
    #                     cycle_xs.append(cx * upf)
    #                     cycle_ys.append(cy * upf)
    #                     valid_frames_accumulator.append(frame)
    #                     has_valid = True
    #         if has_valid and len(cycle_xs) > 1:
    #             all_cycles_cops.append((cycle_xs, cycle_ys))
    #     if len(all_cycles_cops) > 0 and len(valid_frames_accumulator) > 0:
    #         avg_frame = np.mean(valid_frames_accumulator, axis=0)
    #         bg_smooth = get_smooth_heatmap(avg_frame, upscale_factor=upf, sigma=sig)
    #         h_bg, w_bg = bg_smooth.shape
    #         mx = np.max(bg_smooth) if np.max(bg_smooth) > 0 else 1
    #         norm = np.clip(bg_smooth / mx * 255, 0, 255).astype(np.uint8)
    #         rgb = _JET_LUT[norm]
    #         alpha = np.where(bg_smooth > 1, int(255*0.9), 0).astype(np.uint8)
    #         rgba = np.dstack([rgb, alpha[:,:,np.newaxis] if alpha.ndim == 2 else alpha])
    #         img = PILImage.fromarray(rgba.astype(np.uint8), 'RGBA')
    #         from PIL import ImageDraw
    #         draw = ImageDraw.Draw(img)
    #         colors_arr = np.linspace(0, 1, max(len(all_cycles_cops), 2))
    #         for i, (xs, ys) in enumerate(all_cycles_cops):
    #             pts = [(x, y) for x, y in zip(xs, ys) if not (np.isnan(x) or np.isnan(y))]
    #             if len(pts) > 1:
    #                 t = colors_arr[i]
    #                 cr, cg, cb = 255, int(255*(1-t)), int(255*t)
    #                 draw.line(pts, fill=(cr, cg, cb, 200), width=max(2, upf // 3))
    #                 x0, y0 = pts[0]
    #                 r = max(3, upf // 2)
    #                 draw.ellipse([x0-r, y0-r, x0+r, y0+r], fill=(0, 255, 0, 255))
    #         buf = io.BytesIO()
    #         img.save(buf, format='PNG', optimize=True)
    #         sit_cop_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('ascii')

    # [已注释] images 字典保留空值结构，确保前端不报错
    images = {
        'stand_evolution': [],          # 已注释: 前端使用 heatmap_data
        'stand_cop_left': None,         # 已注释: 前端使用 cop_data
        'stand_cop_right': None,        # 已注释: 前端使用 cop_data
        'sit_evolution': [],            # 已注释: 前端使用 heatmap_data
        'sit_cop': None,                # 已注释: 前端使用 cop_data
    }

    # 4.5 力-时间曲线原始数据（前端用 EChart 渲染，前端侧做 LTTB 降采样）
    # ADC→牛顿转换: 足底逐像素转换后求和, 坐垫ADC总和/26.18
    stand_force_arr = np.array([adc_to_newton_foot_sum(f) for f in stand_data])
    sit_adc_arr = np.sum(sit_data, axis=(1, 2))
    sit_force_arr = sit_adc_arr / 26.18  # 坐垫 ADC→牛顿
    stand_force = stand_force_arr.tolist()
    sit_force = sit_force_arr.tolist()
    t0_stand = stand_times.iloc[0] if len(stand_times) > 0 else None
    t0_sit = sit_times.iloc[0] if len(sit_times) > 0 else None
    # 使用统一时间基准，确保两条曲线在图表上对齐
    if t0_stand is not None and t0_sit is not None:
        t0 = min(t0_stand, t0_sit)
    else:
        t0 = t0_stand or t0_sit
    stand_time_list = [(t - t0).total_seconds() for t in stand_times] if t0 is not None and len(stand_times) > 0 else []
    sit_time_list = [(t - t0).total_seconds() for t in sit_times] if t0 is not None and len(sit_times) > 0 else []

    # ====== 4.6 补充前端所需的额外字段 ======

    # --- 4.6.1 heatmap_data: 热力图矩阵数据（供前端 Canvas 渲染） ---
    print(" 生成热力图矩阵数据 (heatmap_data)...")
    # 计算左右脚掩码和边界框（原在 images 段计算，现移至此处）
    l_mask = r_mask = l_bbox = r_bbox = None
    if len(stand_peaks) >= 2:
        l_mask, r_mask, l_bbox, r_bbox = get_foot_masks_and_bbox(stand_data)
    stand_evo_matrix = []
    if len(stand_peaks) >= 2:
        start_idx, end_idx = stand_peaks[0], stand_peaks[1]
        cycle_data = stand_data[start_idx : end_idx+1]
        indices = [int(p * (len(cycle_data)-1)) for p in np.linspace(0, 1, 11)]
        for col_idx, frame_idx in enumerate(indices):
            frame = cycle_data[frame_idx]
            for row_idx, (mask, bbox, label) in enumerate([
                (l_mask, l_bbox, "left"), (r_mask, r_bbox, "right")
            ]):
                crop = (frame * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
                stand_evo_matrix.append({
                    'label': row_idx,
                    'sublabel': col_idx,
                    'matrix': crop.tolist(),
                })

    sit_evo_matrix = []
    if len(stand_peaks) >= 2:
        stand_times_val = stand_times.values
        sit_times_val = sit_times.values
        best_cycle_idx = 0
        if len(stand_peaks) > 2:
            best_cycle_idx = len(stand_peaks) // 2 - 1
        rep_t_start = stand_times_val[stand_peaks[best_cycle_idx]]
        rep_t_end = stand_times_val[stand_peaks[best_cycle_idx+1]]
        rep_idx_start = np.searchsorted(sit_times_val, rep_t_start)
        rep_idx_end = np.searchsorted(sit_times_val, rep_t_end)
        rep_segment = sit_data[rep_idx_start:rep_idx_end]
        # 裁剪：找最大连续有压力区间（真正坐着的部分，排除两端站立残余）
        if len(rep_segment) > 0:
            seg_force = np.sum(rep_segment, axis=(1, 2))
            threshold = np.max(seg_force) * 0.05 if np.max(seg_force) > 0 else 0
            active_mask = seg_force > threshold
            # 找最长连续 True 区间
            best_start, best_len = 0, 0
            cur_start, cur_len = 0, 0
            for idx, val in enumerate(active_mask):
                if val:
                    if cur_len == 0:
                        cur_start = idx
                    cur_len += 1
                    if cur_len > best_len:
                        best_start, best_len = cur_start, cur_len
                else:
                    cur_len = 0
            if best_len > 0:
                rep_segment = rep_segment[best_start:best_start + best_len]
        if len(rep_segment) > 1:
            sit_indices = [int(p * (len(rep_segment)-1)) for p in np.linspace(0, 1, 11)]
            for col_idx, frame_idx in enumerate(sit_indices):
                if frame_idx < len(rep_segment):
                    frame = rep_segment[frame_idx]
                    sit_evo_matrix.append({
                        'label': col_idx,
                        'matrix': frame.tolist(),
                    })

    heatmap_data = {
        'stand_evolution': stand_evo_matrix,
        'sit_evolution': sit_evo_matrix,
    }

    # --- 4.6.2 cop_data: COP 轨迹数据（供前端 Canvas 渲染） ---
    print(" 生成COP轨迹数据 (cop_data)...")
    cop_data = {'stand_left': None, 'stand_right': None, 'sit': None}
    if len(stand_peaks) >= 2:
        # 站立 COP：背景矩阵 + 轨迹坐标
        peak_frames = stand_data[stand_peaks]
        avg_peak = np.mean(peak_frames, axis=0)
        for foot_name, mask, bbox in [("left", l_mask, l_bbox), ("right", r_mask, r_bbox)]:
            bg = (avg_peak * mask)[bbox[0]:bbox[1], bbox[2]:bbox[3]]
            trajectories = []
            for i in range(len(stand_peaks) - 1):
                seg = stand_data[stand_peaks[i]:stand_peaks[i+1]+1]
                l_cops, r_cops = calculate_split_cop(seg, l_mask, r_mask)
                cops = l_cops if foot_name == "left" else r_cops
                pts = []
                for c_pt in cops:
                    x = c_pt[0] - bbox[2]
                    y = c_pt[1] - bbox[0]
                    if not (np.isnan(x) or np.isnan(y)):
                        pts.append([float(x), float(y)])
                if len(pts) > 1:
                    trajectories.append(pts)
            cop_data_key = 'stand_left' if foot_name == 'left' else 'stand_right'
            cop_data[cop_data_key] = {
                'bg_matrix': bg.tolist(),
                'trajectories': trajectories,
            }

        # 坐姿 COP
        sit_force_curve = np.sum(sit_data, axis=(1, 2))
        global_max_val = np.max(sit_force_curve) if len(sit_force_curve) > 0 else 1
        THRESHOLD = max(global_max_val * 0.03, 50)
        all_cycles_cops = []
        valid_frames_accumulator = []
        stand_times_val = stand_times.values
        sit_times_val = sit_times.values
        for i in range(len(stand_peaks) - 1):
            t_start = stand_times_val[stand_peaks[i]]
            t_end = stand_times_val[stand_peaks[i+1]]
            idx_start = np.searchsorted(sit_times_val, t_start)
            idx_end = np.searchsorted(sit_times_val, t_end)
            if idx_end <= idx_start:
                continue
            segment_data = sit_data[idx_start:idx_end]
            segment_force = sit_force_curve[idx_start:idx_end]
            cycle_pts = []
            has_valid = False
            for fi, frame in enumerate(segment_data):
                if segment_force[fi] > THRESHOLD:
                    cx, cy = calculate_sit_cop(frame)
                    if not np.isnan(cx):
                        cycle_pts.append([float(cx), float(cy)])
                        valid_frames_accumulator.append(frame)
                        has_valid = True
            if has_valid and len(cycle_pts) > 1:
                all_cycles_cops.append(cycle_pts)
        if len(all_cycles_cops) > 0 and len(valid_frames_accumulator) > 0:
            avg_frame = np.mean(valid_frames_accumulator, axis=0)
            cop_data['sit'] = {
                'bg_matrix': avg_frame.tolist(),
                'trajectories': all_cycles_cops,
            }

    # --- 4.6.3 cycle_durations: 各周期时长明细 ---
    print(" 计算各周期时长明细...")
    cycle_durations = []
    if len(stand_peaks) >= 2:
        for i in range(len(stand_peaks) - 1):
            t_start = stand_times.iloc[stand_peaks[i]]
            t_end = stand_times.iloc[stand_peaks[i+1]]
            dur = (t_end - t_start).total_seconds()
            cycle_durations.append(round(dur, 2))

    # --- 4.6.4 symmetry: 左右脚对称性（每帧平均力，牛顿） ---
    print(" 计算左右脚对称性...")
    symmetry = {}
    if len(stand_peaks) >= 2:
        left_forces = []
        right_forces = []
        for i in range(len(stand_peaks) - 1):
            seg = stand_data[stand_peaks[i]:stand_peaks[i+1]+1]
            for frame in seg:
                newton_frame = adc_to_newton_foot(frame)
                left_forces.append(float(np.sum(newton_frame * l_mask)))
                right_forces.append(float(np.sum(newton_frame * r_mask)))
        left_avg = np.mean(left_forces) if len(left_forces) > 0 else 0
        right_avg = np.mean(right_forces) if len(right_forces) > 0 else 0
        max_avg = max(left_avg, right_avg)
        min_avg = min(left_avg, right_avg)
        ratio = (min_avg / max_avg * 100) if max_avg > 0 else 0
        symmetry = {
            'left_right_ratio': round(ratio, 1),
            'left_avg_force': round(left_avg, 1),   # 左脚每帧平均力(N)
            'right_avg_force': round(right_avg, 1),  # 右脚每帧平均力(N)
        }

    # --- 4.6.5 pressure_stats: 压力统计 ---
    print(" 计算压力统计...")
    foot_max = float(np.max(stand_force_arr)) if len(stand_force_arr) > 0 else 0
    foot_avg = float(np.mean(stand_force_arr)) if len(stand_force_arr) > 0 else 0
    sit_max = float(np.max(sit_force_arr)) if len(sit_force_arr) > 0 else 0
    sit_avg = float(np.mean(sit_force_arr)) if len(sit_force_arr) > 0 else 0
    # 最大变化率（相邻帧之间的最大差值）
    max_foot_change_rate = 0
    if len(stand_force_arr) > 1:
        foot_diff = np.abs(np.diff(stand_force_arr))
        max_foot_change_rate = float(np.max(foot_diff))
    max_sit_change_rate = 0
    if len(sit_force_arr) > 1:
        sit_diff = np.abs(np.diff(sit_force_arr))
        max_sit_change_rate = float(np.max(sit_diff))
    pressure_stats = {
        'foot_max': round(foot_max, 0),
        'foot_avg': round(foot_avg, 0),
        'sit_max': round(sit_max, 0),
        'sit_avg': round(sit_avg, 0),
        'max_foot_change_rate': round(max_foot_change_rate, 0),
        'max_sit_change_rate': round(max_sit_change_rate, 0),
    }

    # --- 4.6.6 cycle_peak_forces: 各周期峰值力 ---
    print(" 计算各周期峰值力...")
    cycle_peak_forces = []
    if len(stand_peaks) >= 2:
        for i in range(len(stand_peaks) - 1):
            seg_force = stand_force_arr[stand_peaks[i]:stand_peaks[i+1]+1]
            if len(seg_force) > 0:
                cycle_peak_forces.append(round(float(np.max(seg_force)), 0))

    # 5. 构建返回结果
    return {
        'duration_stats': {
            'total_duration': round(duration_stats['total_duration'], 2),
            'num_cycles': duration_stats['num_cycles'],
            'avg_duration': round(duration_stats['avg_duration'], 2),
            'cycle_durations': cycle_durations,
        },
        'stand_frames': len(stand_data),
        'sit_frames': len(sit_data),
        'stand_peaks': len(stand_peaks) if stand_peaks is not None else 0,
        'username': username,
        'images': images,
        'heatmap_data': heatmap_data,
        'cop_data': cop_data,
        'symmetry': symmetry,
        'pressure_stats': pressure_stats,
        'cycle_peak_forces': cycle_peak_forces,
        'force_curves': {
            'stand_times': stand_time_list,
            'stand_force': stand_force,
            'sit_times': sit_time_list,
            'sit_force': sit_force,
            'stand_peaks_idx': stand_peaks.tolist() if isinstance(stand_peaks, np.ndarray) else (list(stand_peaks) if stand_peaks else []),
        },
    }


# ================= 主程序入口 =================

if __name__ == "__main__":
    # 配置参数
    DATA_DIR = r"C:\Users\xpr12\Desktop\data_ss"  # 数据目录
    OUTPUT_DIR = DATA_DIR                 # 输出目录
    PDF_NAME = "Sit_Stand_Analysis_Report_v3.pdf"  # PDF文件名
    USERNAME = "lxz"                   # 用户名
    
    # 生成报告
    generate_report(DATA_DIR, OUTPUT_DIR, PDF_NAME, USERNAME)
