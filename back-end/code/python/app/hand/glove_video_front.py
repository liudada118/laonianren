import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib.gridspec import GridSpec
from scipy.ndimage import gaussian_filter
import os
from matplotlib.colors import LinearSegmentedColormap

# =================================================================
# SECTION 0: 配置
# =================================================================
INPUT_CSV = "./data/20260205_114721_右手_抚摸_硬度_中等_123.csv"
OUTPUT_VIDEO = "./video_output/hand_heatmap_right_front.mp4"
# 确保路径正确
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

FPS = 100
GRID_SIZE = 32

# =================================================================
# SECTION 1: 前端映射矩阵
# =================================================================

GLOVES_POINTS =[
    [15, 27], [15, 28], [15, 29], [16, 26], [16, 27], [16, 28], [17, 25], [17, 26], [17, 27], [18, 24], [18, 25], [18, 26],
    [3, 22], [3, 23], [3, 24], [5, 21], [5, 22], [5, 23], [7, 20], [7, 21], [7, 22], [10, 19], [10, 20], [10, 21],
    [2, 14], [2, 15], [2, 16], [4, 14], [4, 15], [4, 16], [7, 14], [7, 15], [7, 16], [11, 14], [11, 15], [11, 16],
    [4, 6], [4, 7], [4, 8], [6, 7], [6, 8], [6, 9], [8, 8], [8, 9], [8, 10], [11, 9], [11, 10], [11, 11], 
    [6, 1], [6, 2], [6, 3], [8, 2], [8, 3], [8, 4], [10, 3], [10, 4], [10, 5], [12, 4], [12, 5], [12, 6],
    [16, 7], [16, 8], [16, 9], [16, 10], [16, 11], [16, 12], [16, 13], [16, 14], [16, 15], [16, 16], [16, 17], [16, 18],
    [19, 7], [19, 8], [19, 9], [19, 10], [19, 11], [19, 12], [19, 13], [19, 14], [19, 15], [19, 16], [19, 17], [19, 18], [19, 19], [19, 20], [19, 21], 
    [21, 7], [21, 8], [21, 9], [21, 10], [21, 11], [21, 12], [21, 13], [21, 14], [21, 15], [21, 16], [21, 17], [21, 18], [21, 19], [21, 20], [21, 21],
    [23, 7], [23, 8], [23, 9], [23, 10], [23, 11], [23, 12], [23, 13], [23, 14], [23, 15], [23, 16], [23, 17], [23, 18], [23, 19], [23, 20], [23, 21],
    [25, 7], [25, 8], [25, 9], [25, 10], [25, 11], [25, 12], [25, 13], [25, 14], [25, 15], [25, 16], [25, 17], [25, 18], [25, 19], [25, 20], [25, 21]
]

SENSOR_GROUPS = {
    'Thumb': [19,18,17,3,2,1,243,242,241,227,226,225],
    'Index': [22,21,20,6,5,4,246,245,244,230,229,228],
    'Middle': [25,24,23,9,8,7,249,248,247,233,232,231],
    'Ring': [28,27,26,12,11,10,252,251,250,236,235,234],
    'Pinky': [31,30,29,15,14,13,255,254,253,239,238,237],
    'Palm': [
        207,206,205,204,203,202,201,200,199,198,197,196,191,190,189,188,187,186,
        185,184,183,182,181,180,179,178,177,175,174,173,172,171,170,169,168,167,
        166,165,164,163,162,161,159,158,157,156,155,154,153,152,151,150,149,148,
        147,146,145,143,142,141,140,139,138,137,136,135,134,133,132,131,130,129
    ]
}


REGION_DATA_MAP = {}
current_offset = 0
for region in ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky', 'Palm']:
    indices = SENSOR_GROUPS[region]
    # 根据顺序切分对应的坐标点
    coords = GLOVES_POINTS[current_offset : current_offset + len(indices)]
    REGION_DATA_MAP[region] = {
        'indices': indices,
        'coords': coords
    }
    current_offset += len(indices)

# =================================================================
# SECTION 2: 数据处理
# =================================================================

def load_data(csv_path):
    """
    参数：
    加载 CSV 数据，返回 DataFrame 和传感器矩阵
    1. timestamp 转为相对时间（秒）
    2. 传感器数据字符串转为整数矩阵，长度不足补零，超出截断
    3. 返回值：DataFrame, 传感器矩阵 (N x 256)
    """
    print(f"Loading data: {csv_path}")
    df = pd.read_csv(csv_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    start_time = df['timestamp'].iloc[0]
    df['rel_time'] = (df['timestamp'] - start_time).dt.total_seconds()
    
    data_list = []
    for row_str in df['sensor_data_raw']:
        arr = np.fromstring(row_str, sep=',', dtype=int)
        target_len = 256
        if len(arr) < target_len:
            arr = np.pad(arr, (0, target_len - len(arr)))
        else:
            arr = arr[:target_len]
        data_list.append(arr)
        
    return df, np.vstack(data_list)


ordered_indices = []
for region in ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky', 'Palm']:
    ordered_indices.extend(SENSOR_GROUPS[region])


def map_to_grid(sensor_frame, points_map, grid_size=32):
    grid = np.zeros((grid_size, grid_size))
    for i in range(len(points_map)):
        sensor_idx = ordered_indices[i] 
        if sensor_idx < len(sensor_frame):
            r, c = points_map[i]
            grid[r, c] = sensor_frame[sensor_idx]
    return grid


def calculate_metrics(sensor_matrix):
    """
    参数：
    计算各手指和手掌的平均压力值（ADC）和受压面积
    返回值：
    metrics = {
        'Thumb': {'adc': [], 'area': []},
        'Index': {'adc': [], 'area': []},
        'Middle': {'adc': [], 'area': []},
        'Ring': {'adc': [], 'area': []},
        'Pinky': {'adc': [], 'area': []},
        'Palm': {'adc': [], 'area': []}
    }
    """
    metrics = {k: {'adc': [], 'area': []} for k in SENSOR_GROUPS.keys()}
    threshold = 1
    for frame in sensor_matrix:
        for region, indices in SENSOR_GROUPS.items():
            valid_indices = [i for i in indices if i < len(frame)]
            vals = frame[valid_indices]
            avg_p = np.mean(vals) if len(vals) > 0 else 0
            area = np.sum(vals > threshold)
            metrics[region]['adc'].append(avg_p)
            metrics[region]['area'].append(area)
    return metrics


UPSCALE_FACTOR = 10 # 放大倍数
def get_smooth_heatmap(original_matrix, upscale_factor=UPSCALE_FACTOR, sigma=None):
    """
    优化版高清热力图生成：使用 zoom 进行双三次插值，配合动态高斯模糊
    """
    from scipy.ndimage import zoom, gaussian_filter
    matrix = np.array(original_matrix, dtype=float)
    
    # 自动计算合适的 sigma：如果未指定，设为放大倍数的 0.6 倍
    if sigma is None:
        sigma = upscale_factor * 0.6

    # 1. 使用双三次插值 (order=3) 进行放大
    high_res = zoom(matrix, upscale_factor, order=3, prefilter=False)
    
    # 2. 修正负值 (Cubic插值可能会产生微小的负值)
    high_res = np.where(high_res < 0, 0, high_res)
    
    # 3. 高斯模糊 (消除传感器的“方块感”)
    smoothed = gaussian_filter(high_res, sigma=sigma)
    
    return smoothed

# =================================================================
# SECTION 3: 视频生成
# =================================================================

def create_video(data_seq, time_seq, output_file):

    frames = len(data_seq)
    timestamps = pd.to_datetime(time_seq, format='%Y/%m/%d %H:%M:%S:%f', errors='coerce')
    start_time = timestamps[0]
    times = (timestamps - start_time).total_seconds().to_numpy()

    sensor_matrix = []
    target_len = 256
    for item in data_seq:
        if isinstance(item, str):
            arr = np.fromstring(item, sep=',', dtype=int)
        else:
            arr = np.array(item, dtype=int)
        if len(arr) < target_len:
            arr = np.pad(arr, (0, target_len - len(arr)))
        else:
            arr = arr[:target_len]
        sensor_matrix.append(arr)
    sensor_matrix = np.vstack(sensor_matrix)

    metrics = calculate_metrics(sensor_matrix)
    
    fig = plt.figure(figsize=(18, 10), facecolor='#0f172a')
    gs = GridSpec(3, 6, figure=fig, wspace=0.3, hspace=0.4)
    
    layout_map = {
        'Thumb':  (0, 0, 1), 'Index':  (1, 0, 1), 'Middle': (2, 0, 1),
        'Ring':   (0, 4, 5), 'Pinky':  (1, 4, 5), 'Palm':   (2, 4, 5)
    }
    lines = {}
    
    for region, (row, col_adc, col_area) in layout_map.items():
        # ADC
        ax_adc = fig.add_subplot(gs[row, col_adc])
        ax_adc.set_facecolor('#1e293b')
        ax_adc.set_title(f"{region} Pressure", color='white', fontsize=10)
        ax_adc.tick_params(colors='#94a3b8', labelsize=8)
        for sp in ax_adc.spines.values(): sp.set_color('#475569')
        ax_adc.set_xlim(0, times[-1])
        ax_adc.set_ylim(0, 255)
        ln_adc, = ax_adc.plot([], [], color='#fbbf24', lw=1.5)
        lines[f"{region}_adc"] = ln_adc
        
        # Area
        ax_area = fig.add_subplot(gs[row, col_area])
        ax_area.set_facecolor('#1e293b')
        ax_area.set_title(f"{region} Area", color='white', fontsize=10)
        ax_area.tick_params(colors='#94a3b8', labelsize=8)
        for sp in ax_area.spines.values(): sp.set_color('#475569')
        ax_area.set_xlim(0, times[-1])
        ax_area.set_ylim(0, len(SENSOR_GROUPS[region]) * 1.1)
        ln_area, = ax_area.plot([], [], color='#34d399', lw=1.5)
        lines[f"{region}_area"] = ln_area

    # Heatmap
    ax_heat = fig.add_subplot(gs[:, 2:4])
    ax_heat.set_facecolor('black')
    ax_heat.set_title("Tactile Matrix", color='white', fontsize=16)
    ax_heat.axis('off')

    cmap = LinearSegmentedColormap.from_list("custom_jet", 
        [(0, 0, 0, 0), (0, 0, 1, 1), (0, 1, 1, 1), (0, 1, 0, 1), (1, 1, 0, 1), (1, 0, 0, 1)], N=256)
    
    img_display = ax_heat.imshow(
        # np.zeros((GRID_SIZE, GRID_SIZE)), 
        np.zeros((GRID_SIZE * UPSCALE_FACTOR, GRID_SIZE * UPSCALE_FACTOR)),
        cmap=cmap, 
        vmin=0, vmax=100, 
        interpolation='bilinear', 
        origin='upper',
        extent=[-0.5, 31.5, 31.5, -0.5], 
        zorder=2
    )
    
    time_text = ax_heat.text(0.5, -0.05, "0.00 s", transform=ax_heat.transAxes, 
                             ha='center', color='white', fontsize=14, fontweight='bold')

    def update(frame_idx):
        current_data = sensor_matrix[frame_idx]
        
        # 1. 创建高清画布 (用于合并各区域)
        total_high_res = np.zeros((GRID_SIZE * UPSCALE_FACTOR, GRID_SIZE * UPSCALE_FACTOR))
        
        # 2. 遍历每个区域，独立生成热力并合并
        for region_name, info in REGION_DATA_MAP.items():
            # 创建该区域专属的 32x32 基础层
            layer_32 = np.zeros((GRID_SIZE, GRID_SIZE))
            for i, (r, c) in enumerate(info['coords']):
                s_idx = info['indices'][i]
                if s_idx < len(current_data):
                    layer_32[r, c] = current_data[s_idx]
            
            # 对该区域独立进行高清插值和模糊（确保该区域的热力不会“溢出”并污染到其他手指）
            smoothed_region = get_smooth_heatmap(layer_32)
            
            # 使用 np.maximum 合并到总图，保留各区域独立的轮廓
            total_high_res = np.maximum(total_high_res, smoothed_region)
        
        img_display.set_data(total_high_res)
        
        # --- 以下维持原样 ---
        t = times[frame_idx]
        time_text.set_text(f"{t:.2f} s")
        current_times = times[:frame_idx+1]
        for region in layout_map.keys():
            y_adc = metrics[region]['adc'][:frame_idx+1]
            lines[f"{region}_adc"].set_data(current_times, y_adc)
            y_area = metrics[region]['area'][:frame_idx+1]
            lines[f"{region}_area"].set_data(current_times, y_area)
            
        return [img_display, time_text] + list(lines.values())

    print(f"Starting render: {frames} frames")
    
    # 【重点修改】：使用 mpeg4 编码器，并调高码率
    writer = animation.FFMpegWriter(
        fps=FPS, 
        codec='mpeg4',     # 兼容性之王
        bitrate=8000,      # MPEG4 效率低，给高码率保证清晰度
        extra_args=['-pix_fmt', 'yuv420p']
    )
    
    try:
        ani = animation.FuncAnimation(fig, update, frames=frames, interval=1000/FPS, blit=True)
        ani.save(output_file, writer=writer, dpi=100)
        print(f"Done! Video saved to: {output_file}")
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")
        # 如果连 mpeg4 都失败，只能保存为 gif (备选方案)
        # print("Trying to save as GIF...")
        # ani.save("backup.gif", writer='pillow', fps=FPS)


if __name__ == "__main__":
    if not os.path.exists(INPUT_CSV):
        print(f"Error: File not found {INPUT_CSV}")
    else:
        df_raw = pd.read_csv(INPUT_CSV)
        data_sequence = df_raw['sensor_data_raw'].tolist()
        time_sequence = df_raw['timestamp'].tolist()
        create_video(data_sequence, time_sequence, OUTPUT_VIDEO)
