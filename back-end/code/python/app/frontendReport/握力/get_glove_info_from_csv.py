import csv
import os
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from datetime import datetime
import matplotlib.font_manager as fm

# ==============================================
# 瀛椾綋閰嶇疆 - 瑙ｅ喅涓枃鏄剧ず闂
# ==============================================
def setup_chinese_font():
    """閰嶇疆涓枃瀛椾綋"""
    # 鍊欓€夊瓧浣撳垪琛紙鎸変紭鍏堢骇锛?
    font_candidates = [
        'SimHei',           # 榛戜綋
        'Microsoft YaHei',  # 寰蒋闆呴粦
        'SimSun',           # 瀹嬩綋
        'KaiTi',            # 妤蜂綋
        'FangSong',         # 浠垮畫
        'STHeiti',          # Mac 榛戜綋
        'STSong',           # Mac 瀹嬩綋
        'Heiti SC',         # Mac 榛戜綋绠€
        'PingFang SC',      # Mac 鑻规柟
        'WenQuanYi Micro Hei',  # Linux 鏂囨硥椹?
        'Noto Sans CJK SC',     # Linux Noto
        'Droid Sans Fallback',  # Linux
    ]

    # 鑾峰彇绯荤粺鍙敤瀛椾綋
    available_fonts = set([f.name for f in fm.fontManager.ttflist])

    # 鏌ユ壘鍙敤鐨勪腑鏂囧瓧浣?
    selected_font = None
    for font in font_candidates:
        if font in available_fonts:
            selected_font = font
            print(f"浣跨敤瀛椾綋: {font}")
            break

    if selected_font is None:
        # 灏濊瘯鐩存帴鏌ユ壘瀛椾綋鏂囦欢
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
                print(f"浠庢枃浠跺姞杞藉瓧浣? {fp}")
                break

    if selected_font:
        plt.rcParams['font.sans-serif'] = [selected_font] + plt.rcParams['font.sans-serif']
    else:
        print("Warning: no CJK font found; labels may render incorrectly.")
        plt.rcParams['font.sans-serif'] = ['DejaVu Sans']

    plt.rcParams['axes.unicode_minus'] = False

    return selected_font

# 鍒濆鍖栧瓧浣?
CHINESE_FONT = setup_chinese_font()


# ==============================================
# 涓夋寮忓垎娈电嚎鎬фā鍨嬪弬鏁帮紙12鐐规爣瀹氾級
# ==============================================
ADC_BREAKPOINT_1 = 61.2   # 绗竴杞姌鐐笰DC鍊硷紙瀵瑰簲50N锛?
ADC_BREAKPOINT_2 = 75.0   # 绗簩杞姌鐐?楗卞拰ADC鍊硷紙瀵瑰簲150N锛?
ADC_OFFSET = 2.87         # 璧风偣鍋忕Щ
CALIBRATION_POINTS = 12   # 鏍囧畾鐐规暟

# 浼犳劅鍣ㄩ潰绉弬鏁?
SENSOR_WIDTH_MM = 4.0
SENSOR_HEIGHT_MM = 6.0
SENSOR_AREA_MM2 = SENSOR_WIDTH_MM * SENSOR_HEIGHT_MM

# 宄板€兼娴嬪弬鏁?
PEAK_FORCE_THRESHOLD_RATIO = 0.95
GRIP_START_THRESHOLD_RATIO = 0.1

# 鎶栧姩妫€娴嬪弬鏁?
SHAKE_ANGULAR_VELOCITY_THRESHOLD = 30.0
SHAKE_MIN_INTERVAL = 0.15
ANGULAR_VELOCITY_WINDOW_SIZE = 120


def adc_to_force_single_point(adc):
    """Convert a single ADC value to force (N)."""
    if adc <= ADC_OFFSET:
        return 0.0
    if adc < ADC_BREAKPOINT_1:
        force = (adc - 2.87) / 1.17
    elif adc < ADC_BREAKPOINT_2:
        force = (adc - 54.34) / 0.14
    else:
        force = 150.0  # 楗卞拰
    return force / CALIBRATION_POINTS


def calculate_part_force(sensor_data, indices):
    """Calculate total force for a region."""
    total_force = 0.0
    for idx in indices:
        array_idx = idx - 1
        if 0 <= array_idx < len(sensor_data) and sensor_data[array_idx] > 0:
            total_force += adc_to_force_single_point(sensor_data[array_idx])
    return total_force


def normalize_quaternion(q):
    """褰掍竴鍖栧洓鍏冩暟"""
    norm = np.linalg.norm(q)
    if norm < 1e-8:
        return np.array([1.0, 0.0, 0.0, 0.0])
    return q / norm


def quaternion_to_euler(q):
    """鍥涘厓鏁拌浆娆ф媺瑙掞紙杩斿洖瑙掑害鍒讹級"""
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
    """浣跨敤婊戝姩绐楀彛璁＄畻瑙掗€熷害"""
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
    """Detect shake events from angular velocity time series."""
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
    """浠庢枃浠跺悕妫€娴嬪乏鍙虫墜绫诲瀷"""
    filename = os.path.basename(filepath)
    if '宸︽墜' in filename:
        return '宸︽墜'
    elif '鍙虫墜' in filename:
        return '鍙虫墜'
    return None


def parse_sensor_string(sensor_str):
    """Parse sensor array text into a numeric list."""
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
# PDF鎶ュ憡鐢熸垚锛堜慨澶嶅瓧浣撻棶棰橈級
# ==============================================
def create_pdf_report(output_path, hand_type, input_file, times, force_data, euler_data,
                      angular_velocities, peak_info, grip_start_time, shake_info,
                      results, part_names, part_keys):
    """鐢熸垚瀹屾暣鐨凱DF鎶ュ憡"""

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

    # 鑾峰彇瀛椾綋灞炴€?
    if CHINESE_FONT:
        font_prop = fm.FontProperties(family=CHINESE_FONT)
    else:
        font_prop = fm.FontProperties()

    with PdfPages(pdf_path) as pdf:

        # ==========================================
        # 绗?椤碉細灏侀潰鍜屽熀鏈俊鎭〃鏍硷紙璋冩暣甯冨眬锛?
        # ==========================================
        fig1 = plt.figure(figsize=(11, 8.5))
        fig1.suptitle('鎵嬪鏁版嵁鍒嗘瀽鎶ュ憡', fontsize=24, fontweight='bold', y=0.97,
                      fontproperties=font_prop)

        # 鍩烘湰淇℃伅锛堢缉灏忓苟涓婄Щ锛?
        info_text = f"鎵嬬被鍨? {hand_type}  |  婧愭枃浠? {os.path.basename(input_file)}\n鍒嗘瀽鏃堕棿: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  |  鎬诲抚鏁? {len(times)}  |  鏃堕棿鑼冨洿: {times[0]:.3f}s - {times[-1]:.3f}s"
        fig1.text(0.5, 0.88, info_text, fontsize=11, ha='center', va='top',
                  fontproperties=font_prop,
                  bbox=dict(boxstyle='round,pad=0.5', facecolor='#E8F4FD', edgecolor='#3498DB'))

        # 鏃堕棿鍒嗘瀽琛ㄦ牸锛堝乏渚э紝璋冩暣浣嶇疆锛?
        ax_table1 = fig1.add_axes([0.05, 0.48, 0.42, 0.35])
        ax_table1.axis('off')
        ax_table1.set_title('鏃堕棿鍒嗘瀽', fontsize=13, fontweight='bold', loc='left',
                            fontproperties=font_prop, pad=5)

        time_data = [
            ['鎶撴彙寮€濮嬫椂闂?, f'{grip_start_time:.3f} s'],
        ]
        if peak_info:
            time_data.extend([
                ['宄板€煎姏鏃堕棿', f'{peak_info["peak_time"]:.3f} s'],
                ['鍒拌揪宄板€艰€楁椂', f'{peak_info["peak_time"] - grip_start_time:.3f} s'],
                ['宄板€煎尯闂村紑濮?, f'{peak_info["start_time"]:.3f} s'],
                ['宄板€煎尯闂寸粨鏉?, f'{peak_info["end_time"]:.3f} s'],
                ['宄板€兼寔缁椂闂?, f'{peak_info["duration"]:.3f} s'],
                ['宄板€煎姏', f'{peak_info["peak_force"]:.2f} N'],
            ])

        table1 = ax_table1.table(cellText=time_data,
                                 colLabels=['鎸囨爣', '鏁板€?],
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

        # 鎶栧姩鍒嗘瀽琛ㄦ牸锛堝彸渚э級
        ax_table2 = fig1.add_axes([0.53, 0.48, 0.42, 0.35])
        ax_table2.axis('off')
        ax_table2.set_title('鎶栧姩鍒嗘瀽', fontsize=13, fontweight='bold', loc='left',
                            fontproperties=font_prop, pad=5)

        shake_data = [
            ['妫€娴嬮槇鍊?, f'{SHAKE_ANGULAR_VELOCITY_THRESHOLD} 掳/s'],
            ['绐楀彛澶у皬', f'{ANGULAR_VELOCITY_WINDOW_SIZE} 甯?],
            ['鎶栧姩娆℃暟', f'{shake_count} 娆?],
            ['骞冲潎瑙掗€熷害', f'{np.mean(angular_velocities):.2f} 掳/s'],
            ['鏈€澶ц閫熷害', f'{np.max(angular_velocities):.2f} 掳/s'],
        ]

        table2 = ax_table2.table(cellText=shake_data,
                                 colLabels=['鎸囨爣', '鏁板€?],
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

        # 宄板€煎抚閮ㄤ綅鏁版嵁琛ㄦ牸锛堝簳閮紝璋冩暣浣嶇疆閬垮厤閲嶅彔锛?
        ax_table3 = fig1.add_axes([0.1, 0.05, 0.8, 0.38])
        ax_table3.axis('off')
        ax_table3.set_title('宄板€煎抚鍚勯儴浣嶆暟鎹?, fontsize=13, fontweight='bold', loc='left',
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
        part_data.append(['鍚堣', '-', f'{total_force:.2f}', f'{total_area:.0f}', '-'])

        table3 = ax_table3.table(cellText=part_data,
                                 colLabels=['閮ㄤ綅', 'ADC', '鍔?N)', '闈㈢Н(mm$^2$)', '鐐规暟'],
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
        # 绗?椤碉細鍔?鏃堕棿鏇茬嚎鍥?
        # ==========================================
        fig2 = plt.figure(figsize=(11, 8.5))
        ax2 = fig2.add_subplot(111)

        for part_key in part_keys:
            ax2.plot(times, force_data[part_key],
                    label=part_names[part_key],
                    color=colors[part_key],
                    linewidth=1.5, alpha=0.8)

        ax2.plot(times, force_data['total'],
                label='鎬诲姏', color=colors['total'],
                linewidth=2.5, linestyle='--')

        if peak_info:
            ax2.axvspan(peak_info['start_time'], peak_info['end_time'],
                       alpha=0.25, color='#FFD93D',
                       label=f'宄板€煎尯闂?({peak_info["duration"]:.2f}s)')
            ax2.scatter([peak_info['peak_time']], [peak_info['peak_force']],
                       color='red', s=150, zorder=5, marker='*',
                       label=f'宄板€? {peak_info["peak_force"]:.1f}N')
            ax2.axvline(x=grip_start_time, color='green', linestyle=':',
                       linewidth=2, alpha=0.7, label=f'鎶撴彙寮€濮?({grip_start_time:.2f}s)')

        ax2.set_xlabel('鏃堕棿 (绉?', fontsize=12, fontproperties=font_prop)
        ax2.set_ylabel('鍔?(N)', fontsize=12, fontproperties=font_prop)
        ax2.set_title(f'{hand_type} - 鍔?鏃堕棿鏇茬嚎', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax2.legend(loc='upper right', fontsize=9, ncol=2, prop=font_prop)
        ax2.grid(True, alpha=0.3)
        ax2.set_xlim(times[0], times[-1])

        pdf.savefig(fig2, bbox_inches='tight')
        plt.close(fig2)

        # ==========================================
        # 绗?椤碉細鍔涘垎甯冨爢鍙犲浘
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
                       alpha=0.3, color='#FFD93D', label='宄板€煎尯闂?)

        ax3.set_xlabel('鏃堕棿 (绉?', fontsize=12, fontproperties=font_prop)
        ax3.set_ylabel('鍔?(N)', fontsize=12, fontproperties=font_prop)
        ax3.set_title(f'{hand_type} - 鍚勯儴浣嶅姏鍒嗗竷锛堝爢鍙犲浘锛?, fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax3.legend(loc='upper right', fontsize=10, prop=font_prop)
        ax3.grid(True, alpha=0.3)
        ax3.set_xlim(times[0], times[-1])

        pdf.savefig(fig3, bbox_inches='tight')
        plt.close(fig3)

        # ==========================================
        # 绗?椤碉細宄板€煎抚閮ㄤ綅鍔涙煴鐘跺浘
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

        # 璁剧疆x杞存爣绛惧瓧浣?
        ax4.set_xticklabels(bar_parts, fontproperties=font_prop)
        ax4.set_ylabel('鍔?(N)', fontsize=12, fontproperties=font_prop)
        ax4.set_title(f'{hand_type} - 宄板€煎抚鍚勯儴浣嶅姏鍒嗗竷', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax4.grid(True, alpha=0.3, axis='y')

        ax4.text(0.95, 0.95, f'鎬诲姏: {total_force:.1f}N', transform=ax4.transAxes,
                fontsize=14, ha='right', va='top', fontweight='bold',
                fontproperties=font_prop,
                bbox=dict(boxstyle='round', facecolor='white', alpha=0.9, edgecolor='#2C3E50'))

        pdf.savefig(fig4, bbox_inches='tight')
        plt.close(fig4)

        # ==========================================
        # 绗?椤碉細娆ф媺瑙掓椂搴忓浘
        # ==========================================
        fig5 = plt.figure(figsize=(11, 8.5))
        ax5 = fig5.add_subplot(111)

        ax5.plot(times, euler_data['roll'], label='妯粴 (Roll)', color='#E74C3C', linewidth=1.5)
        ax5.plot(times, euler_data['pitch'], label='淇话 (Pitch)', color='#27AE60', linewidth=1.5)
        ax5.plot(times, euler_data['yaw'], label='鍋忚埅 (Yaw)', color='#3498DB', linewidth=1.5)

        if peak_info:
            ax5.axvspan(peak_info['start_time'], peak_info['end_time'],
                       alpha=0.2, color='#FFD93D', label='宄板€煎尯闂?)

        ax5.set_xlabel('鏃堕棿 (绉?', fontsize=12, fontproperties=font_prop)
        ax5.set_ylabel('瑙掑害 (掳)', fontsize=12, fontproperties=font_prop)
        ax5.set_title(f'{hand_type} - 鎵嬮儴濮挎€侊紙娆ф媺瑙掞級', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax5.legend(loc='upper right', fontsize=11, prop=font_prop)
        ax5.grid(True, alpha=0.3)
        ax5.set_xlim(times[0], times[-1])

        pdf.savefig(fig5, bbox_inches='tight')
        plt.close(fig5)

        # ==========================================
        # 绗?椤碉細瑙掗€熷害鏇茬嚎锛堟姈鍔ㄦ娴嬶級
        # ==========================================
        fig6 = plt.figure(figsize=(11, 8.5))
        ax6 = fig6.add_subplot(111)

        ax6.plot(times, angular_velocities, label='瑙掗€熷害', color='#9B59B6', linewidth=1.5)
        ax6.axhline(y=SHAKE_ANGULAR_VELOCITY_THRESHOLD, color='#E74C3C',
                   linestyle='--', linewidth=2, alpha=0.8,
                   label=f'鎶栧姩闃堝€?({SHAKE_ANGULAR_VELOCITY_THRESHOLD}掳/s)')

        if shake_count > 0:
            shake_velocities = [angular_velocities[i] for i in shake_indices]
            ax6.scatter(shake_times_list, shake_velocities,
                       color='#E74C3C', s=100, zorder=5, marker='v',
                       label=f'妫€娴嬪埌鎶栧姩 ({shake_count}娆?')
            for i, st in enumerate(shake_times_list):
                ax6.axvline(x=st, color='#E74C3C', alpha=0.3, linewidth=1)

        info_text = f'鎶栧姩娆℃暟: {shake_count}  |  骞冲潎瑙掗€熷害: {np.mean(angular_velocities):.1f}掳/s  |  宄板€艰閫熷害: {np.max(angular_velocities):.1f}掳/s'
        ax6.text(0.02, 0.98, info_text, transform=ax6.transAxes, fontsize=11,
                verticalalignment='top', fontproperties=font_prop,
                bbox=dict(boxstyle='round', facecolor='#F8F9FA', alpha=0.95, edgecolor='#9B59B6'))

        ax6.set_xlabel('鏃堕棿 (绉?', fontsize=12, fontproperties=font_prop)
        ax6.set_ylabel('瑙掗€熷害 (掳/s)', fontsize=12, fontproperties=font_prop)
        ax6.set_title(f'{hand_type} - 瑙掗€熷害鏇茬嚎锛堟姈鍔ㄦ娴嬶級', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax6.legend(loc='upper right', fontsize=10, prop=font_prop)
        ax6.grid(True, alpha=0.3)
        ax6.set_xlim(times[0], times[-1])
        ax6.set_ylim(bottom=0)

        pdf.savefig(fig6, bbox_inches='tight')
        plt.close(fig6)

        # ==========================================
        # 绗?椤碉細閮ㄤ綅鍔涘崰姣旈ゼ鍥?
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

        ax7.set_title(f'{hand_type} - 宄板€煎抚鍚勯儴浣嶅姏鍗犳瘮', fontsize=16, fontweight='bold',
                     fontproperties=font_prop)
        ax7.text(0.5, -0.05, f'鎬诲姏: {total_force:.1f}N', transform=ax7.transAxes,
                fontsize=14, ha='center', fontweight='bold', fontproperties=font_prop,
                bbox=dict(boxstyle='round', facecolor='white', alpha=0.9))

        pdf.savefig(fig7, bbox_inches='tight')
        plt.close(fig7)

    print(f"PDF鎶ュ憡宸蹭繚瀛? {pdf_path}")
    return pdf_path


def process_glove_data_from_content(csv_content, hand_type, output_dir=None, generate_pdf=True):
    """
    浠?CSV 鏂囨湰鍐呭澶勭悊鎵嬪鏁版嵁锛堜緵 API 璋冪敤锛?

    Args:
        csv_content: CSV 鏂囦欢鐨勬枃鏈唴瀹?
        hand_type: '宸︽墜' 鎴?'鍙虫墜'
        output_dir: 杈撳嚭鐩綍锛圥DF/PNG锛夛紝涓?None 鍒欎娇鐢ㄤ复鏃剁洰褰?

    Returns:
        dict: 鍖呭惈鍒嗘瀽鎸囨爣鍜屾椂搴忔暟鎹殑缁撴瀯鍖栫粨鏋?
    """
    import tempfile

    # 鍐欏叆涓存椂 CSV 鏂囦欢
    tmp_csv = tempfile.NamedTemporaryFile(
        mode='w', suffix=f'_{hand_type}.csv', delete=False, encoding='utf-8'
    )
    tmp_csv.write(csv_content)
    tmp_csv.close()

    output_csv = None
    if generate_pdf:
        if output_dir is None:
            output_dir = tempfile.mkdtemp(prefix='grip_api_')
        output_csv = os.path.join(output_dir, 'result.csv')

    try:
        result = _process_glove_data_core(
            tmp_csv.name, output_csv, hand_type, generate_pdf=generate_pdf
        )
        return result
    finally:
        os.unlink(tmp_csv.name)


def _process_glove_data_core(input_csv, output_csv, hand_type, generate_pdf=True):
    """Core glove processing logic shared by API and script entrypoints."""

    print(f"妫€娴嬪埌: {hand_type}")

    try:
        with open(input_csv, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader)
            rows = list(reader)
        print(f"宸茶鍙?{len(rows)} 琛屾暟鎹?)
    except Exception as e:
        raise ValueError(f"鏃犳硶璇诲彇CSV: {e}")

    if 'sensor_data_calibrated' not in header:
        raise ValueError("鏈壘鍒?sensor_data_calibrated 鍒?)

    data_idx = header.index('sensor_data_calibrated')
    time_idx = header.index('relative_time') if 'relative_time' in header else None

    imu_idx = None
    for col_name in ['imu_data_calibrated', 'imu_data_raw']:
        if col_name in header:
            imu_idx = header.index(col_name)
            break

    hand_layout = LeftHand() if hand_type == '宸︽墜' else RightHand()

    part_keys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm']
    part_names = {
        'thumb': '澶ф媷鎸?, 'index_finger': '椋熸寚', 'middle_finger': '涓寚',
        'ring_finger': '鏃犲悕鎸?, 'little_finger': '灏忔媷鎸?, 'palm': '鎵嬫帉'
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
            force = calculate_part_force(sensor_data, part_indices[part_key])
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
        raise ValueError("娌℃湁鏈夋晥鏁版嵁")

    times = np.array(times)
    for key in force_data:
        force_data[key] = np.array(force_data[key])
    for key in euler_data:
        euler_data[key] = np.array(euler_data[key])

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
        force = calculate_part_force(peak_frame_data, indices)

        total_force += force
        total_area += area

        results[part_key] = {
            'adc': int(adc),
            'force': force,
            'area': area,
            'nonzero_count': nonzero,
            'total_count': len(indices)
        }

    # 鐢熸垚 PDF 鎶ュ憡
    pdf_path = None
    if generate_pdf:
        if not output_csv:
            raise ValueError("output_csv is required when generate_pdf=True")
        pdf_path = create_pdf_report(
            output_csv, hand_type, input_csv, times, force_data, euler_data,
            angular_velocities, peak_info, grip_start_time, shake_info,
            results, part_names, part_keys
        )
    # 鏋勫缓杩斿洖缁撴灉锛堜笌 GripReport.jsx 鐨?reportData 鏍煎紡瀵归綈锛?
    time_analysis = [
        {'label': '鎶撴彙寮€濮嬫椂闂?, 'value': f'{grip_start_time:.3f} s'},
    ]
    if peak_info:
        time_analysis.extend([
            {'label': '宄板€煎姏鏃堕棿', 'value': f'{peak_info["peak_time"]:.3f} s'},
            {'label': '鍒拌揪宄板€艰€楁椂', 'value': f'{peak_info["peak_time"] - grip_start_time:.3f} s'},
            {'label': '宄板€煎尯闂村紑濮?, 'value': f'{peak_info["start_time"]:.3f} s'},
            {'label': '宄板€煎尯闂寸粨鏉?, 'value': f'{peak_info["end_time"]:.3f} s'},
            {'label': '宄板€兼寔缁椂闂?, 'value': f'{peak_info["duration"]:.3f} s'},
            {'label': '宄板€煎姏', 'value': f'{peak_info["peak_force"]:.2f} N'},
        ])
    time_analysis.extend([
        {'label': '妫€娴嬮槇鍊?, 'value': f'{SHAKE_ANGULAR_VELOCITY_THRESHOLD}掳/s'},
        {'label': '绐楀彛澶у皬', 'value': f'{ANGULAR_VELOCITY_WINDOW_SIZE} 甯?},
        {'label': '鎶栧姩娆℃暟', 'value': f'{shake_count} 娆?},
        {'label': '骞冲潎瑙掗€熷害', 'value': f'{np.mean(angular_velocities):.2f}掳/s'},
        {'label': '鏈€澶ц閫熷害', 'value': f'{np.max(angular_velocities):.2f}掳/s'},
    ])

    fingers = []
    for pk in part_keys:
        d = results[pk]
        fingers.append({
            'name': part_names[pk],
            'key': pk,
            'force': round(d['force'], 2),
            'area': int(d['area']),
            'adc': d['adc'],
            'points': f"{d['nonzero_count']}/{d['total_count']}"
        })

    # 鏃跺簭鏁版嵁锛堥檷閲囨牱鍒版渶澶?500 鐐癸級
    step = max(1, len(times) // 500)
    sampled_times = [round(float(x), 3) for x in times[::step]]
    force_time_series = {}
    for pk in part_keys:
        force_time_series[pk] = [round(float(x), 2) for x in force_data[pk][::step]]
    force_time_series['total'] = [round(float(x), 2) for x in force_data['total'][::step]]

    sampled_euler = {
        'roll': [round(float(x), 2) for x in euler_data['roll'][::step]],
        'pitch': [round(float(x), 2) for x in euler_data['pitch'][::step]],
        'yaw': [round(float(x), 2) for x in euler_data['yaw'][::step]],
    }
    sampled_angular = [round(float(x), 2) for x in angular_velocities[::step]]

    return {
        'handType': hand_type,
        'hand': hand_type,
        'totalFrames': len(times),
        'timeRange': f'{times[0]:.3f}s ~ {times[-1]:.3f}s',
        'peakInfo': {
            'peak_force': round(float(peak_info['peak_force']), 2),
            'peak_time': round(float(peak_info['peak_time']), 3),
        } if peak_info else None,
        'timeAnalysis': time_analysis,
        'fingers': fingers,
        'totalForce': round(total_force, 2),
        'totalArea': int(total_area),
        'times': sampled_times,
        'forceTimeSeries': force_time_series,
        'eulerData': sampled_euler,
        'angularVelocity': sampled_angular,
        'pdf_path': pdf_path,
    }


def process_glove_data(input_csv, output_csv):
    """Process glove data from CSV and optionally write report artifacts."""
    hand_type = detect_hand_type(input_csv)
    if hand_type is None:
        print("閿欒: 鏃犳硶浠庢枃浠跺悕璇嗗埆宸﹀彸鎵嬶紙闇€鍖呭惈'宸︽墜'鎴?鍙虫墜'锛?)
        return False

    print(f"妫€娴嬪埌: {hand_type}")

    try:
        with open(input_csv, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader)
            rows = list(reader)
        print(f"宸茶鍙?{len(rows)} 琛屾暟鎹?)
    except Exception as e:
        print(f"閿欒: 鏃犳硶璇诲彇CSV - {e}")
        return False

    if 'sensor_data_calibrated' not in header:
        print("閿欒: 鏈壘鍒?sensor_data_calibrated 鍒?)
        return False

    data_idx = header.index('sensor_data_calibrated')
    time_idx = header.index('relative_time') if 'relative_time' in header else None

    imu_idx = None
    for col_name in ['imu_data_calibrated', 'imu_data_raw']:
        if col_name in header:
            imu_idx = header.index(col_name)
            break

    hand_layout = LeftHand() if hand_type == '宸︽墜' else RightHand()

    part_keys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm']
    part_names = {
        'thumb': '澶ф媷鎸?, 'index_finger': '椋熸寚', 'middle_finger': '涓寚',
        'ring_finger': '鏃犲悕鎸?, 'little_finger': '灏忔媷鎸?, 'palm': '鎵嬫帉'
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

    print("姝ｅ湪澶勭悊鏁版嵁...")

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
            force = calculate_part_force(sensor_data, part_indices[part_key])
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
        print("閿欒: 娌℃湁鏈夋晥鏁版嵁!")
        return False

    times = np.array(times)
    for key in force_data:
        force_data[key] = np.array(force_data[key])
    for key in euler_data:
        euler_data[key] = np.array(euler_data[key])

    print(f"鏈夋晥甯ф暟: {len(times)}")
    print(f"鏃堕棿鑼冨洿: {times[0]:.3f}s - {times[-1]:.3f}s")
    print(f"宄板€煎抚: 绗?{peak_frame_idx} 甯?)

    print("璁＄畻瑙掗€熷害锛堟粦鍔ㄧ獥鍙ｏ級...")
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
        force = calculate_part_force(peak_frame_data, indices)

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
    print(f"鍒嗘瀽鎶ュ憡 - {hand_type}")
    print(f"{'='*70}")

    print(f"\n銆愭椂闂村垎鏋愩€?)
    print(f"  鎶撴彙寮€濮? {grip_start_time:.3f}s")
    if peak_info:
        print(f"  宄板€兼椂鍒? {peak_info['peak_time']:.3f}s")
        print(f"  鍒拌揪宄板€? {peak_info['peak_time'] - grip_start_time:.3f}s")
        print(f"  宄板€煎尯闂? {peak_info['start_time']:.3f}s - {peak_info['end_time']:.3f}s")
        print(f"  宄板€兼寔缁? {peak_info['duration']:.3f}s")
        print(f"  宄板€煎姏:   {peak_info['peak_force']:.2f}N")

    print(f"\n銆愭姈鍔ㄥ垎鏋愩€?)
    print(f"  妫€娴嬮槇鍊? {SHAKE_ANGULAR_VELOCITY_THRESHOLD}掳/s")
    print(f"  绐楀彛澶у皬: {ANGULAR_VELOCITY_WINDOW_SIZE}甯?)
    print(f"  鎶栧姩娆℃暟: {shake_count}娆?)
    print(f"  骞冲潎瑙掗€熷害: {np.mean(angular_velocities):.2f}掳/s")
    print(f"  鏈€澶ц閫熷害: {np.max(angular_velocities):.2f}掳/s")

    print(f"\n銆愬嘲鍊煎抚閮ㄤ綅鏁版嵁銆?)
    print(f"{'閮ㄤ綅':<8} {'ADC':>8} {'鍔?N)':>10} {'闈㈢Н(mm$^2$))':>10} {'鐐规暟':>10}")
    print(f"{'-'*50}")
    for part_key in part_keys:
        d = results[part_key]
        print(f"{part_names[part_key]:<8} {d['adc']:>8} {d['force']:>10.2f} {d['area']:>10.0f} {d['nonzero_count']:>4}/{d['total_count']:<5}")
    print(f"{'-'*50}")
    print(f"{'鍚堣':<8} {'':>8} {total_force:>10.2f} {total_area:>10.0f}")
    print(f"{'='*70}")

    print("\n鐢熸垚PDF鎶ュ憡...")
    pdf_path = None
    if generate_pdf:
        if not output_csv:
            raise ValueError("output_csv is required when generate_pdf=True")
        pdf_path = create_pdf_report(
            output_csv, hand_type, input_csv, times, force_data, euler_data,
            angular_velocities, peak_info, grip_start_time, shake_info,
            results, part_names, part_keys
        )
    ts_csv = output_csv.replace('.csv', '_timeseries.csv')
    try:
        with open(ts_csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            ts_header = ['鏃堕棿(s)', '甯у彿']
            for pk in part_keys:
                ts_header.append(f'{part_names[pk]}_鍔?N)')
            ts_header.extend(['鎬诲姏(N)', 'Roll(掳)', 'Pitch(掳)', 'Yaw(掳)', '瑙掗€熷害(掳/s)'])
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
        print(f"鏃跺簭鏁版嵁宸蹭繚瀛? {ts_csv}")
    except Exception as e:
        print(f"璀﹀憡: 鏃跺簭鏁版嵁淇濆瓨澶辫触 - {e}")

    print(f"\n澶勭悊瀹屾垚!")
    print(f"鐢熸垚鏂囦欢:")
    print(f"  - PDF鎶ュ憡: {pdf_path}")
    print(f"  - 鏃跺簭CSV: {ts_csv}")

    return True


# ==============================================
# 绋嬪簭鍏ュ彛
# ==============================================
if __name__ == '__main__':

    # 杈撳叆鏂囦欢璺緞
    INPUT_FILE = r"C:\Users\xpr12\Desktop\20260129_144528_宸︽墜_鎶氭懜_褰㈢姸_鐞冨舰_555.csv"

    # 杈撳嚭鏂囦欢璺緞鍓嶇紑
    #OUTPUT_PREFIX = r"C:\Users\xpr12\Desktop\ADC-N\old_glove_Force"

    if not os.path.exists(INPUT_FILE):
        print(f"閿欒: 杈撳叆鏂囦欢涓嶅瓨鍦? {INPUT_FILE}")
        print("璇蜂慨鏀?INPUT_FILE 鍙橀噺涓烘纭殑鏂囦欢璺緞")
    else:
        output_file = r"C:\Users\xpr12\Desktop\ff.csv"
        success = process_glove_data(INPUT_FILE, output_file)

        if success:
            print("\n" + "="*50)
            print("鎵€鏈夊鐞嗗凡瀹屾垚锛?)
            print("="*50)
        else:
            print("\n澶勭悊杩囩▼涓嚭鐜伴敊璇?)

