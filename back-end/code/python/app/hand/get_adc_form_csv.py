import csv
import os
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from datetime import datetime
import matplotlib.font_manager as fm

# ==============================================
# 字体配置 - 解决中文显示问题
# ==============================================
def setup_chinese_font():
    """配置中文字体"""
    # 候选字体列表（按优先级）
    font_candidates = [
        'SimHei',           # 黑体
        'Microsoft YaHei',  # 微软雅黑
        'SimSun',           # 宋体
        'KaiTi',            # 楷体
        'FangSong',         # 仿宋
        'STHeiti',          # Mac 黑体
        'STSong',           # Mac 宋体
        'Heiti SC',         # Mac 黑体简
        'PingFang SC',      # Mac 苹方
        'WenQuanYi Micro Hei',  # Linux 文泉驿
        'Noto Sans CJK SC',     # Linux Noto
        'Droid Sans Fallback',  # Linux
    ]

    # 获取系统可用字体
    available_fonts = set([f.name for f in fm.fontManager.ttflist])

    # 查找可用的中文字体
    selected_font = None
    for font in font_candidates:
        if font in available_fonts:
            selected_font = font
            print(f"使用字体: {font}")
            break

    if selected_font is None:
        # 尝试直接查找字体文件
        font_paths = [
            'C:/Windows/Fonts/simhei.ttf',
            'C:/Windows/Fonts/msyh.ttc',
            'C:/Windows/Fonts/simsun.ttc',
            '/System/Library/Fonts/PingFang.ttc',
            '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
        ]
        for fp in font_paths:
            if os.path.exists(fp):
                fm.fontManager.addfont(fp)
                prop = fm.FontProperties(fname=fp)
                selected_font = prop.get_name()
                print(f"从文件加载字体: {fp}")
                break

    if selected_font:
        plt.rcParams['font.sans-serif'] = [selected_font] + plt.rcParams['font.sans-serif']
    else:
        print("警告: 未找到中文字体，可能显示为方框")
        plt.rcParams['font.sans-serif'] = ['DejaVu Sans']

    plt.rcParams['axes.unicode_minus'] = False

    return selected_font

# 初始化字体
CHINESE_FONT = setup_chinese_font()


# ==============================================
# Hill方程参数
# ==============================================
VMAX = 930.5619
KM = 29.2241
N = 1.7024

# 传感器面积参数
SENSOR_WIDTH_MM = 4.0
SENSOR_HEIGHT_MM = 6.0
SENSOR_AREA_MM2 = SENSOR_WIDTH_MM * SENSOR_HEIGHT_MM

# 峰值检测参数
PEAK_FORCE_THRESHOLD_RATIO = 0.95
GRIP_START_THRESHOLD_RATIO = 0.1

# 抖动检测参数
SHAKE_ANGULAR_VELOCITY_THRESHOLD = 30.0
SHAKE_MIN_INTERVAL = 0.15
ANGULAR_VELOCITY_WINDOW_SIZE = 120


def adc_to_force(adc):
    """根据Hill方程反推Force值"""
    if adc <= 0:
        return 0.0
    if adc >= VMAX:
        return 300.0
    try:
        ratio = adc / (VMAX - adc)
        force = KM * np.power(ratio, 1.0 / N)
        return min(max(force, 0.0), 300.0)
    except:
        return 0.0


def normalize_quaternion(q):
    """归一化四元数"""
    norm = np.linalg.norm(q)
    if norm < 1e-8:
        return np.array([1.0, 0.0, 0.0, 0.0])
    return q / norm


def quaternion_to_euler(q):
    """四元数转欧拉角（返回角度制）"""
    w, x, y, z = q
    sinr_cosp = 2 * (w * x + y * z)
    cosr_cosp = 1 - 2 * (x * x + y * y)
    roll = np.arctan2(sinr_cosp, cosr_cosp)
    sinp = 2 * (w * y - z * x)
    sinp = np.clip(sinp, -1.0, 1.0)
    pitch = np.arcsin(sinp)
    siny_cosp = 2 * (w * z + x * y)
    cosy_cosp = 1 - 2 * (y * y + z * z)
    yaw = np.arctan2(siny_cosp, cosy_cosp)
    return np.degrees(roll), np.degrees(pitch), np.degrees(yaw)


def parse_quaternion_string(quat_str):
    """解析四元数字符串，支持 'w,x,y,z' 和 '[w,x,y,z]' 两种格式"""
    try:
        if not quat_str or quat_str.strip() == '':
            return None
        cleaned = quat_str.strip().strip('[]')
        parts = cleaned.split(',')
        if len(parts) != 4:
            return None
        quat = np.array([float(p.strip()) for p in parts])
        return normalize_quaternion(quat)
    except:
        return None


def calculate_angular_velocity_sliding_window(quaternions, times, window_size=10):
    """使用滑动窗口计算角速度"""
    n = len(quaternions)
    angular_velocities = np.zeros(n)
    half_window = window_size // 2
    for i in range(n):
        start_idx = max(0, i - half_window)
        end_idx = min(n - 1, i + half_window)
        if end_idx <= start_idx:
            continue
        q_start = quaternions[start_idx]
        q_end = quaternions[end_idx]
        dt = times[end_idx] - times[start_idx]
        if dt < 0.01:
            continue
        dot = np.abs(np.dot(q_start, q_end))
        dot = np.clip(dot, 0.0, 1.0)
        angle_rad = 2.0 * np.arccos(dot)
        angular_velocities[i] = np.degrees(angle_rad) / dt
    return angular_velocities


def detect_shakes(angular_velocities, times, threshold=30.0, min_interval=0.15):
    """检测手部抖动"""
    if len(angular_velocities) < 3:
        return 0, [], []
    shake_times = []
    shake_indices = []
    last_shake_time = -min_interval * 2
    for i in range(1, len(angular_velocities) - 1):
        if angular_velocities[i] < threshold:
            continue
        if angular_velocities[i] <= angular_velocities[i-1]:
            continue
        if angular_velocities[i] <= angular_velocities[i+1]:
            continue
        if times[i] - last_shake_time < min_interval:
            continue
        shake_times.append(times[i])
        shake_indices.append(i)
        last_shake_time = times[i]
    return len(shake_times), shake_times, shake_indices


class RightHand:
    def __init__(self):
        self.thumb = np.array([
            [240, 239, 238], [256, 255, 254], [16, 15, 14], [32, 31, 30], [-1, 47, -1]
        ])
        self.index_finger = np.array([
            [237, 236, 235], [253, 252, 251], [13, 12, 11], [29, 28, 27], [-1, 44, -1]
        ])
        self.middle_finger = np.array([
            [234, 233, 232], [250, 249, 248], [10, 9, 8], [26, 25, 24], [-1, 41, -1]
        ])
        self.ring_finger = np.array([
            [231, 230, 229], [247, 246, 245], [7, 6, 5], [23, 22, 21], [-1, 38, -1]
        ])
        self.little_finger = np.array([
            [228, 227, 226], [244, 243, 242], [4, 3, 2], [20, 19, 18], [-1, 35, -1]
        ])
        self.palm = np.array([
            [-1, -1, -1, 61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50],
            [80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66],
            [96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82],
            [112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98],
            [128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114]
        ])


class LeftHand:
    def __init__(self):
        self.thumb = np.array([
            [19, 18, 17], [3, 2, 1], [243, 242, 241], [227, 226, 225], [-1, 210, -1]
        ])
        self.index_finger = np.array([
            [22, 21, 20], [6, 5, 4], [246, 245, 244], [230, 229, 228], [-1, 213, -1]
        ])
        self.middle_finger = np.array([
            [25, 24, 23], [9, 8, 7], [249, 248, 247], [233, 232, 231], [-1, 216, -1]
        ])
        self.ring_finger = np.array([
            [28, 27, 26], [12, 11, 10], [252, 251, 250], [236, 235, 234], [-1, 219, -1]
        ])
        self.little_finger = np.array([
            [31, 30, 29], [15, 14, 13], [255, 254, 253], [239, 238, 237], [-1, 222, -1]
        ])
        self.palm = np.array([
            [207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196, -1, -1, -1],
            [191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177],
            [175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161],
            [159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145],
            [143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129]
        ])


def detect_hand_type(filepath):
    """从文件名检测左右手类型"""
    filename = os.path.basename(filepath)
    if '左手' in filename:
        return '左手'
    elif '右手' in filename:
        return '右手'
    return None


def parse_sensor_string(sensor_str):
    """解析传感器数据字符串为数组"""
    try:
        if not sensor_str or sensor_str.strip() == '':
            return None
        sensor_str = sensor_str.strip().strip('[]')
        values = [float(v.strip()) for v in sensor_str.split(',') if v.strip()]
        if len(values) < 144:
            return None
        sensor_array = np.zeros(256, dtype=np.float32)
        sensor_array[:len(values[:256])] = values[:256]
        return sensor_array
    except:
        return None


def is_fingertip_row(row):
    return len(row) == 3 and row[0] == -1 and row[2] == -1 and row[1] != -1


def get_valid_indices(part_array):
    valid_indices = []
    for row in part_array:
        if is_fingertip_row(row):
            continue
        for idx in row:
            if idx != -1:
                valid_indices.append(int(idx))
    return valid_indices


def calculate_part_adc(sensor_data, indices):
    total = 0
    for idx in indices:
        array_idx = idx - 1
        if 0 <= array_idx < len(sensor_data):
            total += sensor_data[array_idx]
    return total


def calculate_nonzero_count(sensor_data, indices):
    count = 0
    for idx in indices:
        array_idx = idx - 1
        if 0 <= array_idx < len(sensor_data) and sensor_data[array_idx] > 0:
            count += 1
    return count


def detect_grip_start(total_forces, times, threshold_ratio=0.1):
    if len(total_forces) == 0:
        return 0, 0
    max_force = np.max(total_forces)
    if max_force <= 0:
        return 0, times[0] if len(times) > 0 else 0
    threshold = max_force * threshold_ratio
    for i, force in enumerate(total_forces):
        if force > threshold:
            return i, times[i]
    return 0, times[0]


def detect_peak_region(total_forces, times, threshold_ratio=0.95):
    if len(total_forces) == 0:
        return None
    max_force = np.max(total_forces)
    peak_idx = np.argmax(total_forces)
    if max_force <= 0:
        return None
    threshold = max_force * threshold_ratio
    above = total_forces >= threshold
    start_idx = peak_idx
    end_idx = peak_idx
    while start_idx > 0 and above[start_idx - 1]:
        start_idx -= 1
    while end_idx < len(above) - 1 and above[end_idx + 1]:
        end_idx += 1
    return {
        'peak_idx': peak_idx,
        'peak_force': max_force,
        'peak_time': times[peak_idx],
        'start_idx': start_idx,
        'end_idx': end_idx,
        'start_time': times[start_idx],
        'end_time': times[end_idx],
        'duration': times[end_idx] - times[start_idx]
    }


# ==============================================
# PDF报告生成（修复字体问题）
# ==============================================
def create_pdf_report(output_path, hand_type, input_file, times, force_data, euler_data,
                      angular_velocities, peak_info, grip_start_time, shake_info,
                      results, part_names, part_keys):
    """生成完整的PDF报告"""

    pdf_path = output_path.replace('.csv', '.pdf')

    colors = {
        'thumb': '#FF6B6B',
        'index_finger': '#4ECDC4',
        'middle_finger': '#45B7D1',
        'ring_finger': '#96CEB4',
        'little_finger': '#FFEAA7',
        'palm': '#DDA0DD',
        'total': '#2C3E50'
    }

    shake_count, shake_times_list, shake_indices = shake_info

    # 获取字体属性
    if CHINESE_FONT:
        font_prop = fm.FontProperties(family=CHINESE_FONT)
    else:
        font_prop = fm.FontProperties()

    with PdfPages(pdf_path) as pdf:

        # ==========================================
        # 第1页：封面和基本信息表格（调整布局）
        # ==========================================
        fig1 = plt.figure(figsize=(11, 8.5))
        fig1.suptitle('手套数据分析报告', fontsize=24, fontweight='bold', y=0.97,
                      fontproperties=font_prop)

        # 基本信息（缩小并上移）
        info_text = f"手类型: {hand_type}  |  源文件: {os.path.basename(input_file)}\n分析时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  |  总帧数: {len(times)}  |  时间范围: {times[0]:.3f}s - {times[-1]:.3f}s"
        fig1.text(0.5, 0.88, info_text, fontsize=11, ha='center', va='top',
                  fontproperties=font_prop,
                  bbox=dict(boxstyle='round,pad=0.5', facecolor='#E8F4FD', edgecolor='#3498DB'))

        # 时间分析表格（左侧，调整位置）
        ax_table1 = fig1.add_axes([0.05, 0.48, 0.42, 0.35])
        ax_table1.axis('off')
        ax_table1.set_title('时间分析', fontsize=13, fontweight='bold', loc='left',
                            fontproperties=font_prop, pad=5)

        time_data = [
            ['抓握开始时间', f'{grip_start_time:.3f} s'],
        ]
        if peak_info:
            time_data.extend([
                ['峰值力时间', f'{peak_info["peak_time"]:.3f} s'],
                ['到达峰值耗时', f'{peak_info["peak_time"] - grip_start_time:.3f} s'],
                ['峰值区间开始', f'{peak_info["start_time"]:.3f} s'],
                ['峰值区间结束', f'{peak_info["end_time"]:.3f} s'],
                ['峰值持续时间', f'{peak_info["duration"]:.3f} s'],
                ['峰值力', f'{peak_info["peak_force"]:.2f} N'],
            ])

        table1 = ax_table1.table(cellText=time_data,
                                 colLabels=['指标', '数值'],
                                 loc='upper center',
                                 cellLoc='left',
                                 colWidths=[0.55, 0.45])
        table1.auto_set_font_size(False)
        table1.set_fontsize(9)
        table1.scale(1.0, 1.3)

        for key, cell in table1.get_celld().items():
            cell.set_text_props(fontproperties=font_prop)
            i, j = key
            if i == 0:
                cell.set_facecolor('#3498DB')
                cell.set_text_props(color='white', fontweight='bold', fontproperties=font_prop)
            else:
                cell.set_facecolor('#F8F9FA' if i % 2 == 0 else 'white')

        # 抖动分析表格（右侧）
        ax_table2 = fig1.add_axes([0.53, 0.48, 0.42, 0.35])
        ax_table2.axis('off')
        ax_table2.set_title('抖动分析', fontsize=13, fontweight='bold', loc='left',
                            fontproperties=font_prop, pad=5)

        shake_data = [
            ['检测阈值', f'{SHAKE_ANGULAR_VELOCITY_THRESHOLD} °/s'],
            ['窗口大小', f'{ANGULAR_VELOCITY_WINDOW_SIZE} 帧'],
            ['抖动次数', f'{shake_count} 次'],
            ['平均角速度', f'{np.mean(angular_velocities):.2f} °/s'],
            ['最大角速度', f'{np.max(angular_velocities):.2f} °/s'],
        ]

        table2 = ax_table2.table(cellText=shake_data,
                                 colLabels=['指标', '数值'],
                                 loc='upper center',
                                 cellLoc='left',
                                 colWidths=[0.55, 0.45])
        table2.auto_set_font_size(False)
        table2.set_fontsize(9)
        table2.scale(1.0, 1.3)
        for key, cell in table2.get_celld().items():
            cell.set_text_props(fontproperties=font_prop)
            i, j = key
            if i == 0:
                cell.set_facecolor('#9B59B6')
                cell.set_text_props(color='white', fontweight='bold', fontproperties=font_prop)
            else:
                cell.set_facecolor('#F8F9FA' if i % 2 == 0 else 'white')

        # 峰值帧部位数据表格（底部，调整位置避免重叠）
        ax_table3 = fig1.add_axes([0.1, 0.05, 0.8, 0.38])
        ax_table3.axis('off')
        ax_table3.set_title('峰值帧各部位数据', fontsize=13, fontweight='bold', loc='left',
                            fontproperties=font_prop, pad=5)

        total_force = sum([results[pk]['force'] for pk in part_keys])
        total_area = sum([results[pk]['area'] for pk in part_keys])

        part_data = []
        for pk in part_keys:
            d = results[pk]
            part_data.append([
                part_names[pk],
                str(d['adc']),
                f"{d['force']:.2f}",
                f"{d['area']:.0f}",
                f"{d['nonzero_count']}/{d['total_count']}"
            ])
        part_data.append(['合计', '-', f'{total_force:.2f}', f'{total_area:.0f}', '-'])

        table3 = ax_table3.table(cellText=part_data,
                                 colLabels=['部位', 'ADC', '力(N)', '面积(mm$^2$)', '点数'],
                                 loc='upper center',
                                 cellLoc='center',
                                 colWidths=[0.18, 0.18, 0.18, 0.22, 0.18])
        table3.auto_set_font_size(False)
        table3.set_fontsize(9)
        table3.scale(1.0, 1.4)
        for key, cell in table3.get_celld().items():
            cell.set_text_props(fontproperties=font_prop)
            i, j = key
            if i == 0:
                cell.set_facecolor('#27AE60')
                cell.set_text_props(color='white', fontweight='bold', fontproperties=font_prop)
            elif i == len(part_data):
                cell.set_facecolor('#D5F4E6')
                cell.set_text_props(fontweight='bold', fontproperties=font_prop)
            else:
                cell.set_facecolor('#F8F9FA' if i % 2 == 0 else 'white')

        pdf.savefig(fig1, bbox_inches='tight')
        plt.close(fig1)
        # ==========================================
        # 第2页：力-时间曲线图
        # ==========================================
        fig2 = plt.figure(figsize=(11, 8.5))
        ax2 = fig2.add_subplot(111)

        for part_key in part_keys:
            ax2.plot(times, force_data[part_key],
                    label=part_names[part_key],
                    color=colors[part_key],
                    linewidth=1.5, alpha=0.8)

        ax2.plot(times, force_data['total'],
                label='总力', color=colors['total'],
                linewidth=2.5, linestyle='--')

        if peak_info:
            ax2.axvspan(peak_info['start_time'], peak_info['end_time'],
                       alpha=0.25, color='#FFD93D',
                       label=f'峰值区间 ({peak_info["duration"]:.2f}s)')
            ax2.scatter([peak_info['peak_time']], [peak_info['peak_force']],
                       color='red', s=150, zorder=5, marker='*',
                       label=f'峰值: {peak_info["peak_force"]:.1f}N')
            ax2.axvline(x=grip_start_time, color='green', linestyle=':',
                       linewidth=2, alpha=0.7, label=f'抓握开始 ({grip_start_time:.2f}s)')

        ax2.set_xlabel('时间 (秒)', fontsize=12, fontproperties=font_prop)
        ax2.set_ylabel('力 (N)', fontsize=12, fontproperties=font_prop)
        ax2.set_title(f'{hand_type} - 力-时间曲线', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax2.legend(loc='upper right', fontsize=9, ncol=2, prop=font_prop)
        ax2.grid(True, alpha=0.3)
        ax2.set_xlim(times[0], times[-1])

        pdf.savefig(fig2, bbox_inches='tight')
        plt.close(fig2)

        # ==========================================
        # 第3页：力分布堆叠图
        # ==========================================
        fig3 = plt.figure(figsize=(11, 8.5))
        ax3 = fig3.add_subplot(111)

        parts_order = ['palm', 'little_finger', 'ring_finger', 'middle_finger', 'index_finger', 'thumb']
        stack_data = [force_data[p] for p in parts_order]
        stack_labels = [part_names[p] for p in parts_order]
        stack_colors = [colors[p] for p in parts_order]

        ax3.stackplot(times, stack_data, labels=stack_labels, colors=stack_colors, alpha=0.8)

        if peak_info:
            ax3.axvspan(peak_info['start_time'], peak_info['end_time'],
                       alpha=0.3, color='#FFD93D', label='峰值区间')

        ax3.set_xlabel('时间 (秒)', fontsize=12, fontproperties=font_prop)
        ax3.set_ylabel('力 (N)', fontsize=12, fontproperties=font_prop)
        ax3.set_title(f'{hand_type} - 各部位力分布（堆叠图）', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax3.legend(loc='upper right', fontsize=10, prop=font_prop)
        ax3.grid(True, alpha=0.3)
        ax3.set_xlim(times[0], times[-1])

        pdf.savefig(fig3, bbox_inches='tight')
        plt.close(fig3)

        # ==========================================
        # 第4页：峰值帧部位力柱状图
        # ==========================================
        fig4 = plt.figure(figsize=(11, 8.5))
        ax4 = fig4.add_subplot(111)

        bar_parts = [part_names[pk] for pk in part_keys]
        bar_forces = [results[pk]['force'] for pk in part_keys]
        bar_colors = [colors[pk] for pk in part_keys]

        bars = ax4.bar(bar_parts, bar_forces, color=bar_colors, edgecolor='black', linewidth=1)

        for bar, force in zip(bars, bar_forces):
            if force > 0:
                ax4.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                        f'{force:.1f}N', ha='center', va='bottom', fontsize=11, fontweight='bold')

        # 设置x轴标签字体
        ax4.set_xticklabels(bar_parts, fontproperties=font_prop)
        ax4.set_ylabel('力 (N)', fontsize=12, fontproperties=font_prop)
        ax4.set_title(f'{hand_type} - 峰值帧各部位力分布', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax4.grid(True, alpha=0.3, axis='y')

        ax4.text(0.95, 0.95, f'总力: {total_force:.1f}N', transform=ax4.transAxes,
                fontsize=14, ha='right', va='top', fontweight='bold',
                fontproperties=font_prop,
                bbox=dict(boxstyle='round', facecolor='white', alpha=0.9, edgecolor='#2C3E50'))

        pdf.savefig(fig4, bbox_inches='tight')
        plt.close(fig4)

        # ==========================================
        # 第5页：欧拉角时序图
        # ==========================================
        fig5 = plt.figure(figsize=(11, 8.5))
        ax5 = fig5.add_subplot(111)

        ax5.plot(times, euler_data['roll'], label='横滚 (Roll)', color='#E74C3C', linewidth=1.5)
        ax5.plot(times, euler_data['pitch'], label='俯仰 (Pitch)', color='#27AE60', linewidth=1.5)
        ax5.plot(times, euler_data['yaw'], label='偏航 (Yaw)', color='#3498DB', linewidth=1.5)

        if peak_info:
            ax5.axvspan(peak_info['start_time'], peak_info['end_time'],
                       alpha=0.2, color='#FFD93D', label='峰值区间')

        ax5.set_xlabel('时间 (秒)', fontsize=12, fontproperties=font_prop)
        ax5.set_ylabel('角度 (°)', fontsize=12, fontproperties=font_prop)
        ax5.set_title(f'{hand_type} - 手部姿态（欧拉角）', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax5.legend(loc='upper right', fontsize=11, prop=font_prop)
        ax5.grid(True, alpha=0.3)
        ax5.set_xlim(times[0], times[-1])

        pdf.savefig(fig5, bbox_inches='tight')
        plt.close(fig5)

        # ==========================================
        # 第6页：角速度曲线（抖动检测）
        # ==========================================
        fig6 = plt.figure(figsize=(11, 8.5))
        ax6 = fig6.add_subplot(111)

        ax6.plot(times, angular_velocities, label='角速度', color='#9B59B6', linewidth=1.5)
        ax6.axhline(y=SHAKE_ANGULAR_VELOCITY_THRESHOLD, color='#E74C3C',
                   linestyle='--', linewidth=2, alpha=0.8,
                   label=f'抖动阈值 ({SHAKE_ANGULAR_VELOCITY_THRESHOLD}°/s)')

        if shake_count > 0:
            shake_velocities = [angular_velocities[i] for i in shake_indices]
            ax6.scatter(shake_times_list, shake_velocities,
                       color='#E74C3C', s=100, zorder=5, marker='v',
                       label=f'检测到抖动 ({shake_count}次)')
            for i, st in enumerate(shake_times_list):
                ax6.axvline(x=st, color='#E74C3C', alpha=0.3, linewidth=1)

        info_text = f'抖动次数: {shake_count}  |  平均角速度: {np.mean(angular_velocities):.1f}°/s  |  峰值角速度: {np.max(angular_velocities):.1f}°/s'
        ax6.text(0.02, 0.98, info_text, transform=ax6.transAxes, fontsize=11,
                verticalalignment='top', fontproperties=font_prop,
                bbox=dict(boxstyle='round', facecolor='#F8F9FA', alpha=0.95, edgecolor='#9B59B6'))

        ax6.set_xlabel('时间 (秒)', fontsize=12, fontproperties=font_prop)
        ax6.set_ylabel('角速度 (°/s)', fontsize=12, fontproperties=font_prop)
        ax6.set_title(f'{hand_type} - 角速度曲线（抖动检测）', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax6.legend(loc='upper right', fontsize=10, prop=font_prop)
        ax6.grid(True, alpha=0.3)
        ax6.set_xlim(times[0], times[-1])
        ax6.set_ylim(bottom=0)

        pdf.savefig(fig6, bbox_inches='tight')
        plt.close(fig6)

        # ==========================================
        # 第7页：部位力占比饼图
        # ==========================================
        fig7 = plt.figure(figsize=(11, 8.5))
        ax7 = fig7.add_subplot(111)

        pie_forces = [results[pk]['force'] for pk in part_keys]
        pie_labels = [f'{part_names[pk]}\n{results[pk]["force"]:.1f}N' for pk in part_keys]
        pie_colors = [colors[pk] for pk in part_keys]

        non_zero_indices = [i for i, f in enumerate(pie_forces) if f > 0]
        pie_forces = [pie_forces[i] for i in non_zero_indices]
        pie_labels = [pie_labels[i] for i in non_zero_indices]
        pie_colors = [pie_colors[i] for i in non_zero_indices]

        if len(pie_forces) > 0:
            wedges, texts, autotexts = ax7.pie(pie_forces, labels=pie_labels, colors=pie_colors,
                                                autopct='%1.1f%%', startangle=90,
                                                explode=[0.02] * len(pie_forces),
                                                textprops={'fontsize': 10, 'fontproperties': font_prop})
            for autotext in autotexts:
                autotext.set_fontsize(10)
                autotext.set_fontweight('bold')

        ax7.set_title(f'{hand_type} - 峰值帧各部位力占比', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax7.text(0.5, -0.05, f'总力: {total_force:.1f}N', transform=ax7.transAxes,
                fontsize=14, ha='center', fontweight='bold', fontproperties=font_prop,
                bbox=dict(boxstyle='round', facecolor='white', alpha=0.9))

        pdf.savefig(fig7, bbox_inches='tight')
        plt.close(fig7)

    print(f"PDF报告已保存: {pdf_path}")
    return pdf_path

#*********************************************************************************
def process_glove_data_from_array(sensor_array, hand_type, name, user_name, user_age, user_gender, user_id):
    """
    处理手套数据主函数（从数组输入，供前端调用）

    Args:
        sensor_array: 二维数组，形状为 [n_frames, 256]，每帧256个传感器数据
        hand_type: 字符串，'左手' 或 '右手'
        name: 输出文件名（不含扩展名），用于生成PDF和CSV
        user_name: 用户姓名
        user_age: 用户年龄
        user_gender: 用户性别
        user_id: 用户ID

    Returns:
        dict: 包含处理结果的字典，失败返回None
    """
    # 验证手类型
    if hand_type not in ['左手', '右手']:
        print(f"Error: hand_type must be 'left' or 'right', current value: {hand_type}")
        return None

    print(f"Detected: {hand_type}")
    print(f"User info: name={user_name}, age={user_age}, gender={user_gender}, ID={user_id}")

    # 转换为numpy数组
    sensor_array = np.array(sensor_array, dtype=np.float32)
    if sensor_array.ndim == 1:
        sensor_array = sensor_array.reshape(1, -1)

    n_frames, n_sensors = sensor_array.shape
    print(f"Loaded {n_frames} frames, {n_sensors} sensors per frame")

    # 补零处理
    if n_sensors < 256:
        print(f"Warning: sensor data length {n_sensors} < 256, auto padding with zeros")
        padded = np.zeros((n_frames, 256), dtype=np.float32)
        padded[:, :n_sensors] = sensor_array
        sensor_array = padded

    hand_layout = LeftHand() if hand_type == '左手' else RightHand()

    part_keys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm']
    part_names_en = {
        'thumb': 'Thumb', 'index_finger': 'Index', 'middle_finger': 'Middle',
        'ring_finger': 'Ring', 'little_finger': 'Little', 'palm': 'Palm'
    }
    part_names = {
        'thumb': '大拇指', 'index_finger': '食指', 'middle_finger': '中指',
        'ring_finger': '无名指', 'little_finger': '小拇指', 'palm': '手掌'
    }

    part_indices = {key: get_valid_indices(getattr(hand_layout, key)) for key in part_keys}

    times = []
    force_data = {key: [] for key in part_keys}
    force_data['total'] = []
    euler_data = {'roll': [], 'pitch': [], 'yaw': []}
    quaternions = []

    max_sum = -1
    peak_frame_data = None
    peak_frame_idx = -1

    print("Processing data...")

    for row_idx in range(n_frames):
        sensor_data = sensor_array[row_idx]

        t = row_idx * 0.01
        times.append(t)

        frame_total = 0
        for part_key in part_keys:
            adc = calculate_part_adc(sensor_data, part_indices[part_key])
            force = adc_to_force(adc)
            force_data[part_key].append(force)
            frame_total += force
        force_data['total'].append(frame_total)

        frame_sum = np.sum(sensor_data)
        if frame_sum > max_sum:
            max_sum = frame_sum
            peak_frame_data = sensor_data
            peak_frame_idx = row_idx + 1

        # 无IMU数据时使用默认值
        quaternions.append(np.array([1, 0, 0, 0]))
        euler_data['roll'].append(0)
        euler_data['pitch'].append(0)
        euler_data['yaw'].append(0)

    if len(times) == 0 or peak_frame_data is None:
        print("Error: No valid data!")
        return None

    times = np.array(times)
    for key in force_data:
        force_data[key] = np.array(force_data[key])
    for key in euler_data:
        euler_data[key] = np.array(euler_data[key])

    print(f"Valid frames: {len(times)}")
    print(f"Time range: {times[0]:.3f}s - {times[-1]:.3f}s")
    print(f"Peak frame: #{peak_frame_idx}")

    print("Calculating angular velocity (sliding window)...")
    angular_velocities = calculate_angular_velocity_sliding_window(
        quaternions, times, window_size=ANGULAR_VELOCITY_WINDOW_SIZE
    )

    grip_start_idx, grip_start_time = detect_grip_start(
        force_data['total'], times, GRIP_START_THRESHOLD_RATIO
    )

    peak_info = detect_peak_region(force_data['total'], times, PEAK_FORCE_THRESHOLD_RATIO)

    shake_info = detect_shakes(
        angular_velocities, times,
        SHAKE_ANGULAR_VELOCITY_THRESHOLD,
        SHAKE_MIN_INTERVAL
    )
    shake_count, shake_times_list, shake_indices = shake_info

    results = {}
    total_force = 0
    total_area = 0

    for part_key in part_keys:
        indices = part_indices[part_key]
        adc = calculate_part_adc(peak_frame_data, indices)
        nonzero = calculate_nonzero_count(peak_frame_data, indices)
        area = nonzero * SENSOR_AREA_MM2
        force = adc_to_force(adc)

        total_force += force
        total_area += area

        results[part_key] = {
            'adc': int(adc),
            'force': force,
            'area': area,
            'nonzero_count': nonzero,
            'total_count': len(indices)
        }

    # 添加用户信息到结果
    results['user_info'] = {
        'name': user_name,
        'age': user_age,
        'gender': user_gender,
        'id': user_id
    }

    print(f"\n{'='*70}")
    print(f"Analysis Report - {hand_type}")
    print(f"User: {user_name} ({user_gender}, age {user_age}, ID: {user_id})")
    print(f"{'='*70}")

    print(f"\n[Time Analysis]")
    print(f"  Grip start: {grip_start_time:.3f}s")
    if peak_info:
        print(f"  Peak time: {peak_info['peak_time']:.3f}s")
        print(f"  Time to peak: {peak_info['peak_time'] - grip_start_time:.3f}s")
        print(f"  Peak range: {peak_info['start_time']:.3f}s - {peak_info['end_time']:.3f}s")
        print(f"  Peak duration: {peak_info['duration']:.3f}s")
        print(f"  Peak force: {peak_info['peak_force']:.2f}N")

    print(f"\n[Shake Analysis]")
    print(f"  Threshold: {SHAKE_ANGULAR_VELOCITY_THRESHOLD} deg/s")
    print(f"  Window size: {ANGULAR_VELOCITY_WINDOW_SIZE} frames")
    print(f"  Shake count: {shake_count}")
    print(f"  Avg angular velocity: {np.mean(angular_velocities):.2f} deg/s")
    print(f"  Max angular velocity: {np.max(angular_velocities):.2f} deg/s")

    print(f"\n[Peak Frame Part Data]")
    print(f"{'Part':<12} {'ADC':>8} {'Force(N)':>10} {'Area(mm2)':>10} {'Points':>10}")
    print(f"{'-'*55}")
    for part_key in part_keys:
        d = results[part_key]
        print(f"{part_names_en[part_key]:<12} {d['adc']:>8} {d['force']:>10.2f} {d['area']:>10.0f} {d['nonzero_count']:>4}/{d['total_count']:<5}")
    print(f"{'-'*55}")
    print(f"{'Total':<12} {'':>8} {total_force:>10.2f} {total_area:>10.0f}")
    print(f"{'='*70}")

    # 生成输出文件路径
    output_csv = name + '.csv'
    pdf_path_base = name + '.pdf'

    print("\nGenerating PDF report...")
    pdf_path = create_pdf_report(
        output_csv, hand_type, f"User{user_id}_{hand_type}", times, force_data, euler_data,
        angular_velocities, peak_info, grip_start_time, shake_info,
        results, part_names, part_keys
    )

    ts_csv = name + '_timeseries.csv'
    try:
        with open(ts_csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            ts_header = ['Time(s)', 'Frame']
            for pk in part_keys:
                ts_header.append(f'{part_names_en[pk]}_Force(N)')
            ts_header.extend(['Total_Force(N)', 'Roll(deg)', 'Pitch(deg)', 'Yaw(deg)', 'AngularVelocity(deg/s)'])
            writer.writerow(ts_header)

            for i in range(len(times)):
                row = [f'{times[i]:.4f}', i + 1]
                for pk in part_keys:
                    row.append(f'{force_data[pk][i]:.2f}')
                row.extend([
                    f'{force_data["total"][i]:.2f}',
                    f'{euler_data["roll"][i]:.2f}',
                    f'{euler_data["pitch"][i]:.2f}',
                    f'{euler_data["yaw"][i]:.2f}',
                    f'{angular_velocities[i]:.2f}'
                ])
                writer.writerow(row)
        print(f"Timeseries data saved: {ts_csv}")
    except Exception as e:
        print(f"Warning: Failed to save timeseries data - {e}")

    # 添加汇总信息到结果
    results['summary'] = {
        'total_force': total_force,
        'total_area': total_area,
        'peak_frame_idx': peak_frame_idx,
        'grip_start_time': grip_start_time,
        'peak_info': peak_info,
        'shake_count': shake_count,
        'pdf_path': pdf_path,
        'timeseries_csv': ts_csv
    }

    print(f"\nProcessing complete!")
    print(f"Generated files:")
    print(f"  - PDF report: {pdf_path}")
    print(f"  - Timeseries CSV: {ts_csv}")

    return 'success'


def process_glove_data(input_csv, output_csv):
    """处理手套数据主函数"""
    hand_type = detect_hand_type(input_csv)
    if hand_type is None:
        print("错误: 无法从文件名识别左右手（需包含'左手'或'右手'）")
        return False

    print(f"检测到: {hand_type}")

    try:
        with open(input_csv, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader)
            rows = list(reader)
        print(f"已读取 {len(rows)} 行数据")
    except Exception as e:
        print(f"错误: 无法读取CSV - {e}")
        return False

    if 'sensor_data_calibrated' not in header:
        print("错误: 未找到 sensor_data_calibrated 列")
        return False

    data_idx = header.index('sensor_data_calibrated')
    time_idx = header.index('relative_time') if 'relative_time' in header else None

    imu_idx = None
    for col_name in ['imu_data_calibrated', 'imu_data_raw']:
        if col_name in header:
            imu_idx = header.index(col_name)
            break

    hand_layout = LeftHand() if hand_type == '左手' else RightHand()

    part_keys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm']
    part_names = {
        'thumb': '大拇指', 'index_finger': '食指', 'middle_finger': '中指',
        'ring_finger': '无名指', 'little_finger': '小拇指', 'palm': '手掌'
    }

    part_indices = {key: get_valid_indices(getattr(hand_layout, key)) for key in part_keys}

    times = []
    force_data = {key: [] for key in part_keys}
    force_data['total'] = []
    euler_data = {'roll': [], 'pitch': [], 'yaw': []}
    quaternions = []

    max_sum = -1
    peak_frame_data = None
    peak_frame_idx = -1

    print("正在处理数据...")

    for row_idx, row in enumerate(rows):
        if len(row) <= data_idx:
            continue

        sensor_data = parse_sensor_string(row[data_idx])
        if sensor_data is None:
            continue

        if time_idx is not None and len(row) > time_idx:
            try:
                t = float(row[time_idx])
            except:
                t = row_idx * 0.01
        else:
            t = row_idx * 0.01
        times.append(t)

        frame_total = 0
        for part_key in part_keys:
            adc = calculate_part_adc(sensor_data, part_indices[part_key])
            force = adc_to_force(adc)
            force_data[part_key].append(force)
            frame_total += force
        force_data['total'].append(frame_total)

        frame_sum = np.sum(sensor_data)
        if frame_sum > max_sum:
            max_sum = frame_sum
            peak_frame_data = sensor_data
            peak_frame_idx = row_idx + 1

        if imu_idx is not None and len(row) > imu_idx:
            quat = parse_quaternion_string(row[imu_idx])
            if quat is not None:
                quaternions.append(quat)
                roll, pitch, yaw = quaternion_to_euler(quat)
                euler_data['roll'].append(roll)
                euler_data['pitch'].append(pitch)
                euler_data['yaw'].append(yaw)
            else:
                quaternions.append(np.array([1, 0, 0, 0]))
                euler_data['roll'].append(0)
                euler_data['pitch'].append(0)
                euler_data['yaw'].append(0)
        else:
            quaternions.append(np.array([1, 0, 0, 0]))
            euler_data['roll'].append(0)
            euler_data['pitch'].append(0)
            euler_data['yaw'].append(0)

    if len(times) == 0 or peak_frame_data is None:
        print("错误: 没有有效数据!")
        return False

    times = np.array(times)
    for key in force_data:
        force_data[key] = np.array(force_data[key])
    for key in euler_data:
        euler_data[key] = np.array(euler_data[key])

    print(f"有效帧数: {len(times)}")
    print(f"时间范围: {times[0]:.3f}s - {times[-1]:.3f}s")
    print(f"峰值帧: 第 {peak_frame_idx} 帧")

    print("计算角速度（滑动窗口）...")
    angular_velocities = calculate_angular_velocity_sliding_window(
        quaternions, times, window_size=ANGULAR_VELOCITY_WINDOW_SIZE
    )

    grip_start_idx, grip_start_time = detect_grip_start(
        force_data['total'], times, GRIP_START_THRESHOLD_RATIO
    )

    peak_info = detect_peak_region(force_data['total'], times, PEAK_FORCE_THRESHOLD_RATIO)

    shake_info = detect_shakes(
        angular_velocities, times,
        SHAKE_ANGULAR_VELOCITY_THRESHOLD,
        SHAKE_MIN_INTERVAL
    )
    shake_count, shake_times_list, shake_indices = shake_info

    results = {}
    total_force = 0
    total_area = 0

    for part_key in part_keys:
        indices = part_indices[part_key]
        adc = calculate_part_adc(peak_frame_data, indices)
        nonzero = calculate_nonzero_count(peak_frame_data, indices)
        area = nonzero * SENSOR_AREA_MM2
        force = adc_to_force(adc)

        total_force += force
        total_area += area

        results[part_key] = {
            'adc': int(adc),
            'force': force,
            'area': area,
            'nonzero_count': nonzero,
            'total_count': len(indices)
        }

    print(f"\n{'='*70}")
    print(f"分析报告 - {hand_type}")
    print(f"{'='*70}")

    print(f"\n【时间分析】")
    print(f"  抓握开始: {grip_start_time:.3f}s")
    if peak_info:
        print(f"  峰值时刻: {peak_info['peak_time']:.3f}s")
        print(f"  到达峰值: {peak_info['peak_time'] - grip_start_time:.3f}s")
        print(f"  峰值区间: {peak_info['start_time']:.3f}s - {peak_info['end_time']:.3f}s")
        print(f"  峰值持续: {peak_info['duration']:.3f}s")
        print(f"  峰值力:   {peak_info['peak_force']:.2f}N")

    print(f"\n【抖动分析】")
    print(f"  检测阈值: {SHAKE_ANGULAR_VELOCITY_THRESHOLD}°/s")
    print(f"  窗口大小: {ANGULAR_VELOCITY_WINDOW_SIZE}帧")
    print(f"  抖动次数: {shake_count}次")
    print(f"  平均角速度: {np.mean(angular_velocities):.2f}°/s")
    print(f"  最大角速度: {np.max(angular_velocities):.2f}°/s")

    print(f"\n【峰值帧部位数据】")
    print(f"{'部位':<8} {'ADC':>8} {'力(N)':>10} {'面积(mm$^2$))':>10} {'点数':>10}")
    print(f"{'-'*50}")
    for part_key in part_keys:
        d = results[part_key]
        print(f"{part_names[part_key]:<8} {d['adc']:>8} {d['force']:>10.2f} {d['area']:>10.0f} {d['nonzero_count']:>4}/{d['total_count']:<5}")
    print(f"{'-'*50}")
    print(f"{'合计':<8} {'':>8} {total_force:>10.2f} {total_area:>10.0f}")
    print(f"{'='*70}")

    print("\n生成PDF报告...")
    pdf_path = create_pdf_report(
        output_csv, hand_type, input_csv, times, force_data, euler_data,
        angular_velocities, peak_info, grip_start_time, shake_info,
        results, part_names, part_keys
    )

    ts_csv = output_csv.replace('.csv', '_timeseries.csv')
    try:
        with open(ts_csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            ts_header = ['时间(s)', '帧号']
            for pk in part_keys:
                ts_header.append(f'{part_names[pk]}_力(N)')
            ts_header.extend(['总力(N)', 'Roll(°)', 'Pitch(°)', 'Yaw(°)', '角速度(°/s)'])
            writer.writerow(ts_header)

            for i in range(len(times)):
                row = [f'{times[i]:.4f}', i + 1]
                for pk in part_keys:
                    row.append(f'{force_data[pk][i]:.2f}')
                row.extend([
                    f'{force_data["total"][i]:.2f}',
                    f'{euler_data["roll"][i]:.2f}',
                    f'{euler_data["pitch"][i]:.2f}',
                    f'{euler_data["yaw"][i]:.2f}',
                    f'{angular_velocities[i]:.2f}'
                ])
                writer.writerow(row)
        print(f"时序数据已保存: {ts_csv}")
    except Exception as e:
        print(f"警告: 时序数据保存失败 - {e}")

    print(f"\n处理完成!")
    print(f"生成文件:")
    print(f"  - PDF报告: {pdf_path}")
    print(f"  - 时序CSV: {ts_csv}")

    return True


# ==============================================
# 程序入口
# ==============================================
# if __name__ == '__main__':

    # 输入文件路径
    INPUT_FILE = r"C:\Users\xpr12\Desktop\ADC-N\glove_all_v2\data\左手\抚摸\形状\球形\559\20260129_144439_左手_抚摸_形状_球形_559.csv"

    # 输出文件路径前缀
    OUTPUT_PREFIX = r"C:\Users\xpr12\Desktop\ADC-N\old_glove_Force"

    if not os.path.exists(INPUT_FILE):
        print(f"错误: 输入文件不存在: {INPUT_FILE}")
        print("请修改 INPUT_FILE 变量为正确的文件路径")
    else:
        output_file = r"ff.csv"
        success = process_glove_data(INPUT_FILE, output_file)

        if success:
            print("\n" + "="*50)
            print("所有处理已完成！")
            print("="*50)
        else:
            print("\n处理过程中出现错误")