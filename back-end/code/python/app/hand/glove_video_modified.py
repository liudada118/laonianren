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
OUTPUT_VIDEO = "./video_output/hand_heatmap_right_1.mp4"
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
GRID_SIZE = 128

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


GLOVES_POINTS_132 = [
    # --- Thumb (Right) ---
    [50, 113], [52, 116], [56, 109], [58, 112], [62, 105], [64, 108], [68, 101], [70, 104], [74, 97], [76, 100], [80, 93], [82, 96],
    # --- Index ---
    [25, 90], [26, 93], [33, 88], [34, 91], [41, 86], [42, 89], [49, 84], [50, 87], [57, 82], [58, 85], [65, 80], [66, 83],
    # --- Middle ---
    [15, 62], [15, 65], [24, 62], [24, 65], [33, 62], [33, 65], [43, 62], [43, 65], [52, 62], [52, 65], [62, 62], [62, 65],
    # --- Ring ---
    [25, 36], [25, 39], [33, 38], [33, 41], [41, 40], [41, 43], [49, 42], [49, 45], [57, 44], [57, 47], [65, 46], [65, 49],
    # --- Pinky (Left) ---
    [45, 12], [46, 15], [50, 15], [51, 18], [55, 19], [56, 22], [60, 22], [61, 25], [65, 26], [66, 29], [70, 29], [71, 32],
    # --- Palm (Row 1: 12 pts) ---
    [70, 25], [70, 32], [70, 39], [70, 46], [70, 53], [70, 60], [70, 67], [70, 74], [70, 81], [70, 88], [70, 95], [70, 103],
    # --- Palm (Row 2: 15 pts) ---
    [81, 28], [81, 33], [81, 38], [81, 43], [81, 48], [81, 53], [81, 58], [81, 64], [81, 69], [81, 74], [81, 79], [81, 84], [81, 89], [81, 94], [81, 100],
    # --- Palm (Row 3: 15 pts) ---
    [92, 32], [92, 36], [92, 41], [92, 45], [92, 50], [92, 54], [92, 59], [92, 64], [92, 68], [92, 73], [92, 77], [92, 82], [92, 86], [92, 91], [92, 96],
    # --- Palm (Row 4: 15 pts) ---
    [103, 36], [103, 40], [103, 44], [103, 48], [103, 52], [103, 56], [103, 60], [103, 64], [103, 68], [103, 72], [103, 76], [103, 80], [103, 84], [103, 88], [103, 92],
    # --- Palm (Row 5: 15 pts) ---
    [115, 40], [115, 43], [115, 46], [115, 50], [115, 53], [115, 57], [115, 60], [115, 64], [115, 67], [115, 70], [115, 74], [115, 77], [115, 81], [115, 84], [115, 88]
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
    coords = GLOVES_POINTS_132[current_offset : current_offset + len(indices)]
    REGION_DATA_MAP[region] = {
        'indices': indices,
        'coords': coords
    }
    current_offset += len(indices)

# =================================================================
# SECTION 2: 数据处理
# =================================================================

def load_data(csv_path):
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

def create_video(df, sensor_matrix, metrics, output_file):
    img_bg = plt.imread("left_hand.png")

    frames = len(df)
    times = df['rel_time'].values
    
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

    background_display = ax_heat.imshow(
        img_bg, 
        extent=[-0.5, 31.5, 31.5, -0.5], 
        alpha=0.7, 
        zorder=1
    )

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


def debug_first_frame(df, sensor_matrix):
    # 基础配置
    # GRID_SIZE = 128
    UPSCALE_FACTOR = 10
    
    # 创建画布
    fig, ax = plt.subplots(figsize=(8, 8))
    ax.set_facecolor('black')
    
    # 加载背景
    try:
        img_bg = plt.imread("left_hand.jpg")
    except:
        print("未找到 left_hand.jpg，请检查路径")
        return

    # --- 调试核心区域：调整这里的 extent 来移动背景图 ---
    # 格式: [左边界, 右边界, 底边界, 顶边界]
    custom_extent = [-0.5, 31.5, 31.5, -0.5] 
    
    # 绘制背景
    ax.imshow(img_bg, extent=custom_extent, alpha=0.7, zorder=1)
    
    # 获取第一帧数据并映射（使用你之前的分层逻辑）
    current_data = sensor_matrix[0]
    total_high_res = np.zeros((GRID_SIZE * UPSCALE_FACTOR, GRID_SIZE * UPSCALE_FACTOR))
    
    for region_name, info in REGION_DATA_MAP.items():
        layer_32 = np.zeros((GRID_SIZE, GRID_SIZE))
        for i, (r, c) in enumerate(info['coords']):
            s_idx = info['indices'][i]
            if s_idx < len(current_data):
                layer_32[r, c] = current_data[s_idx]
        
        # 使用你定义的插值函数
        smoothed_region = get_smooth_heatmap(layer_32, upscale_factor=UPSCALE_FACTOR)
        total_high_res = np.maximum(total_high_res, smoothed_region)
    
    # 绘制热力图
    cmap = plt.get_cmap('jet') # 临时使用标准 jet 方便观察
    ax.imshow(total_high_res, extent=custom_extent, cmap=cmap, 
              vmin=0, vmax=200, alpha=0.6, zorder=2)
    
    # 绘制原始传感器散点（辅助对齐：红点代表你的 GLOVES_POINTS 物理坐标）
    for r, c in GLOVES_POINTS_132:
        ax.scatter(c, r, s=10, c='white', marker='x', alpha=0.5, zorder=3)

    ax.set_title("Debug Mode: Check alignment (White X = Sensor Point)")
    plt.show()


if __name__ == "__main__":
    if not os.path.exists(INPUT_CSV):
        print(f"Error: File not found {INPUT_CSV}")
    else:
        df, matrix = load_data(INPUT_CSV)
        metrics = calculate_metrics(matrix)
        debug_first_frame(df, matrix)
        create_video(df, matrix, metrics, OUTPUT_VIDEO)
