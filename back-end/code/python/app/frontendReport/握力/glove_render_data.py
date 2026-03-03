"""
鎻″姏璇勪及 - 鍓嶇娓叉煋鏁版嵁灏佽妯″潡
====================================
瀵煎叆 get_glove_info_from_csv.py 鐨勮绠楅€昏緫锛?
灏嗚绠楃粨鏋滄媶鍒嗕负鐙珛鏂规硶锛屼緵鍓嶇鍚勫彲瑙嗗寲缁勪欢鍒嗗埆璋冪敤銆?

鎬诲叆鍙ｆ柟娉? generate_grip_report(sensor_data, hand_type, times=None, imu_data=None)

鏁版嵁娴? [N, 256]鏁扮粍 鈫?Python璁＄畻 鈫?缁撴瀯鍖杁ict 鈫?鍓嶇ECharts娓叉煋
瀵瑰簲鍓嶇缁勪欢: GripReport.jsx
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np

process_glove_data_from_content = None


# ============================================================
# 鎬诲叆鍙ｆ柟娉?(绫讳技 generate_foot_pressure_report)
# ============================================================

def generate_grip_report(sensor_data, hand_type, times=None, imu_data=None):
    """
    鎻″姏璇勪及鎬诲叆鍙?- 鎺ユ敹 [N, 256] 浼犳劅鍣ㄦ暟缁勶紝杩斿洖鍏ㄩ儴鍒嗘瀽缁撴灉

    Args:
        sensor_data (list[list] | np.ndarray): 浼犳劅鍣ㄦ暟鎹紝shape [N, 256]
            姣忓抚涓洪暱搴?56鐨勪竴缁存暟缁勶紙宸叉牎鍑咥DC鍊硷級
        hand_type (str): '宸︽墜' 鎴?'鍙虫墜'锛屽喅瀹氫紶鎰熷櫒绱㈠紩鏄犲皠
        times (list[float] | None): 鏃堕棿鎴虫暟缁勶紝shape [N]锛屽崟浣嶇
            濡傛灉涓篘one锛岃嚜鍔ㄦ寜0.01s闂撮殧鐢熸垚
        imu_data (list[list] | None): IMU鍥涘厓鏁版暟鎹紝shape [N, 4]
            濡傛灉涓篘one锛屼笉璁＄畻娆ф媺瑙掑拰瑙掗€熷害

    Returns:
        dict: 瀹屾暣鍒嗘瀽缁撴灉锛岀粨鏋勫涓?
            {
                'handType': str,
                'hand': str,
                'totalFrames': int,
                'timeRange': str,
                'peakInfo': { 'peak_force', 'peak_time' },
                'timeAnalysis': [{'label', 'value'}],
                'fingers': [{'name','key','force','area','adc','points'}],
                'totalForce': float,
                'totalArea': int,
                'times': [float],
                'forceTimeSeries': { 'thumb':[], ..., 'total':[] },
                'eulerData': { 'roll':[], 'pitch':[], 'yaw':[] },
                'angularVelocity': [float],
            }
    """
    if callable(process_glove_data_from_content):
        # 灏嗘暟缁勮浆鎹负CSV鏂囨湰鏍煎紡锛屽鐢ㄧ幇鏈夌殑 process_glove_data_from_content
        csv_content = _arrays_to_glove_csv(sensor_data, times, imu_data)
        result = process_glove_data_from_content(
            csv_content,
            hand_type,
            generate_pdf=False,
        )
        # 绉婚櫎 pdf_path锛屽墠绔笉闇€瑕?
        result.pop('pdf_path', None)
        return result
    return _fallback_generate_grip_report(sensor_data, hand_type, times, imu_data)


def _fallback_generate_grip_report(sensor_data, hand_type, times=None, imu_data=None):
    # 传感器面积参数
    SENSOR_AREA_MM2 = 24.0  # 4mm x 6mm

    # 离散传感器索引映射 (1-based，与 LeftHand/RightHand 类一致，排除 -1 和指尖行)
    LEFT_HAND_INDICES = {
        'thumb':         [19, 18, 17, 3, 2, 1, 243, 242, 241, 227, 226, 225],
        'index_finger':  [22, 21, 20, 6, 5, 4, 246, 245, 244, 230, 229, 228],
        'middle_finger': [25, 24, 23, 9, 8, 7, 249, 248, 247, 233, 232, 231],
        'ring_finger':   [28, 27, 26, 12, 11, 10, 252, 251, 250, 236, 235, 234],
        'little_finger': [31, 30, 29, 15, 14, 13, 255, 254, 253, 239, 238, 237],
        'palm': [
            207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196,
            191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177,
            175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161,
            159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145,
            143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129,
        ],
    }
    RIGHT_HAND_INDICES = {
        'thumb':         [240, 239, 238, 256, 255, 254, 16, 15, 14, 32, 31, 30],
        'index_finger':  [237, 236, 235, 253, 252, 251, 13, 12, 11, 29, 28, 27],
        'middle_finger': [234, 233, 232, 250, 249, 248, 10, 9, 8, 26, 25, 24],
        'ring_finger':   [231, 230, 229, 247, 246, 245, 7, 6, 5, 23, 22, 21],
        'little_finger': [228, 227, 226, 244, 243, 242, 4, 3, 2, 20, 19, 18],
        'palm': [
            61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50,
            80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66,
            96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82,
            112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98,
            128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114,
        ],
    }

    arr = np.asarray(sensor_data, dtype=float)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    if arr.ndim != 2:
        raise ValueError('sensor_data must be 2D')
    if arr.shape[1] < 256:
        arr = np.pad(arr, ((0, 0), (0, 256 - arr.shape[1])), mode='constant')
    elif arr.shape[1] > 256:
        arr = arr[:, :256]

    n = int(arr.shape[0])
    if n == 0:
        raise ValueError('sensor_data is empty')

    if times is None:
        t = np.arange(n, dtype=float) * 0.01
    else:
        t = np.asarray(times, dtype=float)
        if t.shape[0] != n:
            t = np.arange(n, dtype=float) * 0.01

    # 使用正确的离散传感器索引映射（与 LeftHand/RightHand 类一致）
    hand_indices = LEFT_HAND_INDICES if hand_type == '左手' else RIGHT_HAND_INDICES
    part_keys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm']
    part_names = {
        'thumb': 'Thumb',
        'index_finger': 'Index',
        'middle_finger': 'Middle',
        'ring_finger': 'Ring',
        'little_finger': 'Little',
        'palm': 'Palm',
    }
    part_indices = {key: hand_indices[key] for key in part_keys}

    # 计算各区域力-时间序列（使用离散索引）
    force_time_series = {}
    for k in part_keys:
        indices = part_indices[k]
        series = np.zeros(n, dtype=float)
        for i in range(n):
            s = 0.0
            for idx in indices:
                array_idx = idx - 1
                if 0 <= array_idx < 256 and arr[i, array_idx] > 0:
                    s += arr[i, array_idx]
            series[i] = s
        force_time_series[k] = series
    total_force_series = np.zeros(n, dtype=float)
    for k in part_keys:
        total_force_series += force_time_series[k]
    force_time_series['total'] = total_force_series

    peak_idx = int(np.argmax(total_force_series))
    peak_force = float(total_force_series[peak_idx]) if n else 0.0
    peak_time = float(t[peak_idx]) if n else 0.0

    threshold = peak_force * 0.1
    above = np.where(total_force_series >= threshold)[0]
    grip_start_time = float(t[above[0]]) if len(above) else float(t[0])

    euler_roll = np.zeros(n, dtype=float)
    euler_pitch = np.zeros(n, dtype=float)
    euler_yaw = np.zeros(n, dtype=float)
    angular_velocity = np.zeros(n, dtype=float)
    if imu_data is not None:
        q = np.asarray(imu_data, dtype=float)
        if q.ndim == 2 and q.shape[1] >= 4 and q.shape[0] == n:
            q = q[:, :4]
            norms = np.linalg.norm(q, axis=1, keepdims=True)
            norms[norms < 1e-8] = 1.0
            q = q / norms
            w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
            sinr = 2 * (w * x + y * z)
            cosr = 1 - 2 * (x * x + y * y)
            euler_roll = np.degrees(np.arctan2(sinr, cosr))
            sinp = np.clip(2 * (w * y - z * x), -1.0, 1.0)
            euler_pitch = np.degrees(np.arcsin(sinp))
            siny = 2 * (w * z + x * y)
            cosy = 1 - 2 * (y * y + z * z)
            euler_yaw = np.degrees(np.arctan2(siny, cosy))

            for i in range(1, n):
                dt = max(1e-3, float(t[i] - t[i - 1]))
                dot = abs(float(np.dot(q[i - 1], q[i])))
                dot = min(1.0, max(0.0, dot))
                angle = 2.0 * np.arccos(dot)
                angular_velocity[i] = np.degrees(angle) / dt

    shake_threshold = 30.0
    shake_min_interval = 0.15
    shake_times = []
    last_shake_t = -1e9
    for i, v in enumerate(angular_velocity):
        ti = float(t[i])
        if v >= shake_threshold and (ti - last_shake_t) >= shake_min_interval:
            shake_times.append(ti)
            last_shake_t = ti

    peak_frame = arr[peak_idx]
    sensor_area_mm2 = SENSOR_AREA_MM2
    fingers = []
    total_force = 0.0
    total_area = 0
    for key in part_keys:
        indices = part_indices[key]
        force = 0.0
        nonzero = 0
        adc_sum = 0
        for idx in indices:
            array_idx = idx - 1
            if 0 <= array_idx < 256 and peak_frame[array_idx] > 0:
                force += float(peak_frame[array_idx])
                nonzero += 1
                adc_sum += peak_frame[array_idx]
        area = int(nonzero * sensor_area_mm2)
        adc = int(round(adc_sum / nonzero)) if nonzero else 0
        total_force += force
        total_area += area
        fingers.append(
            {
                'name': part_names[key],
                'key': key,
                'force': round(force, 2),
                'area': area,
                'adc': adc,
                'points': f'{nonzero}/{len(indices)}',
            }
        )

    step = max(1, n // 500)
    sampled_t = [round(float(x), 3) for x in t[::step]]
    sampled_force = {k: [round(float(x), 2) for x in force_time_series[k][::step]] for k in part_keys}
    sampled_force['total'] = [round(float(x), 2) for x in force_time_series['total'][::step]]

    return {
        'handType': hand_type,
        'hand': hand_type,
        'totalFrames': n,
        'timeRange': f'{float(t[0]):.3f}s ~ {float(t[-1]):.3f}s',
        'peakInfo': {
            'peak_force': round(peak_force, 2),
            'peak_time': round(peak_time, 3),
        },
        'timeAnalysis': [
            {'label': 'Grip Start', 'value': f'{grip_start_time:.3f} s'},
            {'label': 'Peak Time', 'value': f'{peak_time:.3f} s'},
            {'label': 'Time To Peak', 'value': f'{(peak_time - grip_start_time):.3f} s'},
            {'label': 'Peak Force', 'value': f'{peak_force:.2f} N'},
            {'label': 'Shake Threshold', 'value': f'{shake_threshold:.1f} deg/s'},
            {'label': 'Shake Count', 'value': f'{len(shake_times)}'},
            {'label': 'Avg Angular Velocity', 'value': f'{float(np.mean(angular_velocity)):.2f} deg/s'},
            {'label': 'Max Angular Velocity', 'value': f'{float(np.max(angular_velocity)):.2f} deg/s'},
        ],
        'fingers': fingers,
        'totalForce': round(total_force, 2),
        'totalArea': int(total_area),
        'times': sampled_t,
        'forceTimeSeries': sampled_force,
        'eulerData': {
            'roll': [round(float(x), 2) for x in euler_roll[::step]],
            'pitch': [round(float(x), 2) for x in euler_pitch[::step]],
            'yaw': [round(float(x), 2) for x in euler_yaw[::step]],
        },
        'angularVelocity': [round(float(x), 2) for x in angular_velocity[::step]],
    }


def _arrays_to_glove_csv(sensor_data, times=None, imu_data=None):
    """
    灏嗘暟缁勬暟鎹浆鎹负鎵嬪CSV鏂囨湰鏍煎紡锛堝唴閮ㄩ€傞厤鍑芥暟锛?

    Args:
        sensor_data: [N, 256] 浼犳劅鍣ㄦ暟鎹?
        times: [N] 鏃堕棿鎴筹紙鍙€夛級
        imu_data: [N, 4] IMU鍥涘厓鏁帮紙鍙€夛級

    Returns:
        str: CSV鏂囨湰鍐呭
    """
    import io
    import csv

    n_frames = len(sensor_data)

    # 鏋勫缓header
    headers = ['sensor_data_calibrated', 'relative_time']
    if imu_data is not None:
        headers.append('imu_data_calibrated')

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)

    for i in range(n_frames):
        # sensor_data 杞负瀛楃涓叉牸寮?"[1.0, 2.0, ...]"
        row_data = sensor_data[i]
        if hasattr(row_data, 'tolist'):
            row_data = row_data.tolist()
        sensor_str = '[' + ','.join(str(v) for v in row_data) + ']'

        # 鏃堕棿鎴?
        t = times[i] if times is not None else i * 0.01

        row = [sensor_str, str(t)]

        # IMU鏁版嵁
        if imu_data is not None:
            imu_row = imu_data[i]
            if hasattr(imu_row, 'tolist'):
                imu_row = imu_row.tolist()
            imu_str = '[' + ','.join(str(v) for v in imu_row) + ']'
            row.append(imu_str)

        writer.writerow(row)

    return output.getvalue()


# ============================================================
# 浠ヤ笅涓烘媶鍒嗘柟娉曪紝姣忎釜鏂规硶瀵瑰簲鍓嶇涓€涓彲瑙嗗寲鍖哄煙
# 鍏ュ弬鍧囦负 generate_grip_report 鐨勮繑鍥炲€?result
# ============================================================


def get_overview(result):
    """
    銆愭覆鏌撳尯鍩熴€戝熀鏈俊鎭崱鐗?(GripReport.jsx #overview)
    杩斿洖: {
        'handType': str,       # '宸︽墜' 鎴?'鍙虫墜'
        'totalFrames': int,    # 鎬诲抚鏁?
        'timeRange': str,      # 鏃堕棿鑼冨洿 (濡?'0.000s ~ 10.500s')
        'totalForce': float,   # 鎬绘彙鍔?(N)
        'totalArea': int,      # 鎬绘帴瑙﹂潰绉?
        'peakInfo': dict|None, # 宄板€间俊鎭?{ 'peak_force', 'peak_time' }
    }
    """
    return {
        'handType': result.get('handType'),
        'totalFrames': result.get('totalFrames'),
        'timeRange': result.get('timeRange'),
        'totalForce': result.get('totalForce'),
        'totalArea': result.get('totalArea'),
        'peakInfo': result.get('peakInfo'),
    }


def get_time_analysis(result):
    """
    銆愭覆鏌撳尯鍩熴€戞椂闂村垎鏋愯〃鏍?(GripReport.jsx #time-analysis)
    鍖呭惈鎶撴彙寮€濮嬫椂闂淬€佸嘲鍊煎姏鏃堕棿銆佸埌杈惧嘲鍊艰€楁椂銆佹姈鍔ㄦ娴嬬瓑

    杩斿洖: list[dict]
        姣忎釜鍏冪礌: { 'label': str, 'value': str }
    鍓嶇娓叉煋: 琛ㄦ牸鎴栧崱鐗囧垪琛?
    """
    return result.get('timeAnalysis', [])


def get_finger_data(result):
    """
    銆愭覆鏌撳尯鍩熴€戝嘲鍊煎抚鍚勯儴浣嶆暟鎹〃 (GripReport.jsx #peak-data)
    6涓儴浣?鎷囨寚/椋熸寚/涓寚/鏃犲悕鎸?灏忔寚/鎵嬫帉)鐨勫姏銆侀潰绉瓑

    杩斿洖: list[dict]
        姣忎釜鍏冪礌: {
            'name': str,    # 涓枃鍚?(澶ф媷鎸?椋熸寚/...)
            'key': str,     # 鑻辨枃key (thumb/index_finger/...)
            'force': float, # 鍔涘€?(N)
            'area': int,    # 鎺ヨЕ闈㈢Н
            'adc': int,     # ADC鍊?
            'points': str,  # 鏈夋晥鐐?鎬荤偣 (濡?'24/30')
        }
    鍓嶇娓叉煋: 鏁版嵁琛ㄦ牸
    """
    return result.get('fingers', [])


def get_force_time_series(result):
    """
    銆愭覆鏌撳尯鍩熴€戝姏-鏃堕棿鏇茬嚎 (GripReport.jsx #force-curve)
    7鏉＄嚎: 5涓墜鎸?+ 鎵嬫帉 + 鎬诲姏

    杩斿洖: {
        'times': [float],           # 鏃堕棿杞?绉?, 宸查檷閲囨牱鍒皛500鐐?
        'forceTimeSeries': {
            'thumb': [float],
            'index_finger': [float],
            'middle_finger': [float],
            'ring_finger': [float],
            'little_finger': [float],
            'palm': [float],
            'total': [float],
        }
    }
    鍓嶇娓叉煋: ECharts 澶氱嚎鎶樼嚎鍥?
    """
    return {
        'times': result.get('times', []),
        'forceTimeSeries': result.get('forceTimeSeries', {}),
    }


def get_force_time_echarts_option(result):
    """
    銆愭覆鏌撳尯鍩熴€戝姏-鏃堕棿鏇茬嚎 - 鐩存帴鐢熸垚 ECharts option
    鏂逛究鍓嶇鐩存帴浼犲叆 ECharts 瀹炰緥

    杩斿洖: dict (ECharts option 閰嶇疆)
    """
    times = result.get('times', [])
    fts = result.get('forceTimeSeries', {})

    colors = ['#0066CC', '#0891B2', '#059669', '#D97706', '#9333EA', '#DC2626', '#1F2937']
    names = ['Thumb', 'Index', 'Middle', 'Ring', 'Little', 'Palm', 'Total']
    keys = ['thumb', 'index_finger', 'middle_finger', 'ring_finger', 'little_finger', 'palm', 'total']

    series = []
    for i, key in enumerate(keys):
        values = fts.get(key, [])
        series.append({
            'name': names[i],
            'type': 'line',
            'data': list(zip(times, values)),
            'smooth': True,
            'symbol': 'none',
            'lineStyle': {'width': 1.5 if key != 'total' else 2.5, 'color': colors[i]},
        })

    return {
        'legend': {'data': names},
        'xAxis': {'type': 'value', 'name': '鏃堕棿 (s)'},
        'yAxis': {'type': 'value', 'name': '鍔?(N)'},
        'series': series,
        'tooltip': {'trigger': 'axis'},
    }


def get_force_distribution(result):
    """
    銆愭覆鏌撳尯鍩熴€戝姏鍒嗗竷鍫嗗彔鍥?+ 楗煎浘 (GripReport.jsx #force-stack, #pie)
    鍚勯儴浣嶅姏鍗犳瘮

    杩斿洖: list[dict]
        姣忎釜鍏冪礌: {
            'name': str,    # 涓枃鍚?
            'key': str,     # 鑻辨枃key
            'force': float, # 鍔涘€?(N)
            'ratio': float, # 鍗犳瘮 (0~1)
        }
    鍓嶇娓叉煋: ECharts 鍫嗗彔闈㈢Н鍥?/ 楗煎浘
    """
    fingers = result.get('fingers', [])
    total = result.get('totalForce', 0)
    if total <= 0:
        total = sum(f.get('force', 0) for f in fingers) or 1

    return [
        {
            'name': f['name'],
            'key': f['key'],
            'force': f['force'],
            'ratio': round(f['force'] / total, 4),
        }
        for f in fingers
    ]


def get_euler_data(result):
    """
    銆愭覆鏌撳尯鍩熴€戞墜閮ㄥЭ鎬佹鎷夎 (GripReport.jsx #euler)
    3鏉＄嚎: Roll(妯粴) / Pitch(淇话) / Yaw(鍋忚埅)

    杩斿洖: {
        'times': [float],
        'roll': [float],   # 妯粴瑙?掳)
        'pitch': [float],  # 淇话瑙?掳)
        'yaw': [float],    # 鍋忚埅瑙?掳)
    }
    鍓嶇娓叉煋: ECharts 涓夌嚎鎶樼嚎鍥?
    """
    euler = result.get('eulerData', {})
    return {
        'times': result.get('times', []),
        'roll': euler.get('roll', []),
        'pitch': euler.get('pitch', []),
        'yaw': euler.get('yaw', []),
    }


def get_euler_echarts_option(result): 
    """
    銆愭覆鏌撳尯鍩熴€戞鎷夎 - 鐩存帴鐢熸垚 ECharts option

    杩斿洖: dict (ECharts option 閰嶇疆)
    """
    times = result.get('times', [])
    euler = result.get('eulerData', {})

    configs = [
        ('妯粴 (Roll)', 'roll', '#E74C3C'),
        ('淇话 (Pitch)', 'pitch', '#27AE60'),
        ('鍋忚埅 (Yaw)', 'yaw', '#3498DB'),
    ]

    series = []
    for name, key, color in configs:
        values = euler.get(key, [])
        series.append({
            'name': name,
            'type': 'line',
            'data': list(zip(times, values)),
            'smooth': True,
            'symbol': 'none',
            'lineStyle': {'width': 1.5, 'color': color},
        })

    return {
        'legend': {'data': [c[0] for c in configs]},
        'xAxis': {'type': 'value', 'name': '鏃堕棿 (s)'},
        'yAxis': {'type': 'value', 'name': '瑙掑害 (掳)'},
        'series': series,
        'tooltip': {'trigger': 'axis'},
    }


def get_angular_velocity_data(result):
    """
    銆愭覆鏌撳尯鍩熴€戣閫熷害鏇茬嚎 + 鎶栧姩妫€娴?(GripReport.jsx #angular)

    杩斿洖: {
        'times': [float],
        'angularVelocity': [float],  # 瑙掗€熷害(掳/s)
    }
    鍓嶇娓叉煋: ECharts 鎶樼嚎鍥? 鍙彔鍔犳姈鍔ㄩ槇鍊肩嚎
    """
    return {
        'times': result.get('times', []),
        'angularVelocity': result.get('angularVelocity', []),
    }


# ============================================================
# 娴嬭瘯鍏ュ彛
# ============================================================

if __name__ == '__main__':
    from pprint import pprint

    # ========== 鍦ㄨ繖閲岀矘璐翠綘鐨勬祴璇曟暟鎹?==========
    # sensor_data: [N, 256] 浼犳劅鍣ㄦ暟鎹?
    sensor_data = [
        # [v0, v1, ..., v255],  # 绗?甯?
        # [v0, v1, ..., v255],  # 绗?甯?
        [5,0,0,34,42,16,28,31,31,41,33,33,35,32,24,0,20,0,0,34,36,17,29,34,37,29,29,31,40,34,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,47,20,3,0,0,0,0,0,0,0,0,0,2,29,23,0,0,12,0,26,34,19,25,27,23,31,40,29,35,45,32,0,3,18,1,35,48,26,33,36,29,41,58,37,44,60,37,0,4,0,0,26,1,18,49,35,40,30,5,33,53,28,21,0,23,0,0,30,25,2,33,32,27,36,27,36,32,2,2,0],
        [4,0,0,35,42,15,27,32,31,41,33,33,35,32,24,0,21,0,0,35,36,17,29,34,37,30,30,32,40,34,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,48,19,3,0,0,0,0,0,0,0,0,0,2,29,23,0,0,5,0,27,34,18,26,28,23,31,40,30,35,45,31,0,3,18,1,36,48,25,33,36,29,41,58,39,44,60,37,0,5,0,0,26,1,17,49,36,40,30,5,34,53,28,5,0,25,0,0,31,25,2,33,32,27,35,27,36,32,2,2,0]
        
    ]
    hand_type = '鍙虫墜'  # 鎴?'宸︽墜'

    # times: [N] 鏃堕棿鎴筹紙鍙€夛紝None鍒欒嚜鍔ㄦ寜0.01s闂撮殧鐢熸垚锛?
    times = None

    # imu_data: [N, 4] IMU鍥涘厓鏁帮紙鍙€夛紝None鍒欎笉璁＄畻娆ф媺瑙?瑙掗€熷害锛?
    imu_data = None
    # ============================================

    assert len(sensor_data) > 0, "璇峰厛绮樿创 sensor_data 鏁版嵁"

    print("=" * 60)
    print("鎻″姏璇勪及 - 娴嬭瘯")
    print(f"杈撳叆 sensor_data: [{len(sensor_data)}, {len(sensor_data[0])}]")
    print(f"hand_type: {hand_type}")
    print("=" * 60)

    result = generate_grip_report(sensor_data, hand_type, times=times, imu_data=imu_data)

    print("\n--- get_overview ---")
    pprint(get_overview(result))

    print("\n--- get_time_analysis ---")
    pprint(get_time_analysis(result))

    print("\n--- get_finger_data ---")
    pprint(get_finger_data(result))

    print("\n--- get_force_time_series ---")
    fts = get_force_time_series(result)
    print(f"  times length: {len(fts['times'])}")
    print(f"  series keys: {list(fts['forceTimeSeries'].keys())}")

    print("\n--- get_force_distribution ---")
    pprint(get_force_distribution(result))

    print("\n--- get_euler_data ---")
    ed = get_euler_data(result)
    print(f"  times length: {len(ed['times'])}")
    print(f"  roll length: {len(ed['roll'])}")

    print("\n--- get_angular_velocity_data ---")
    avd = get_angular_velocity_data(result)
    print(f"  times length: {len(avd['times'])}")
    print(f"  angularVelocity length: {len(avd['angularVelocity'])}")


