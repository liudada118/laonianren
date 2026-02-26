def process_frame_realtime(data_current, data_prev=None, fps=20):
    """
    实时处理函数
    Args:
        data_current: 当前帧 4096 数组
        data_prev:    上一帧 4096 数组 (可选，若为None则速度为0)
        fps:          帧率，默认 77.0 (用于计算速度: 距离 * fps)
    Returns:
        dict: 包含左右脚 压力、面积、COP速度(cm/s)、脚印数组
    """
    import numpy as np
    import cv2
    import math

    # ================= 内部封装算法 =================
    PITCH_MM = 14.0

    def _parse_frame(data):
        if data is None: return None
        try:
            mat = np.array(data, dtype=np.float32)
            if mat.size != 4096: return None
            frame = mat.reshape(64, 64)
            frame = np.rot90(np.fliplr(frame), k=1)
            frame[frame <= 4] = 0 # 基础去噪
            return frame
        except: return None

    def _calc_cop_pos(frame):
        """ 计算重心坐标 (cx, cy) """
        if frame is None: return None
        total = np.sum(frame)
        if total <= 10: return None
        rows, cols = frame.shape
        y_coords, x_coords = np.mgrid[0:rows, 0:cols]
        cy = np.sum(frame * y_coords) / total
        cx = np.sum(frame * x_coords) / total
        return (cx, cy)

    def _get_centers_dynamic(frame):
        """ 动态寻找左右脚中心 """
        c_l, c_r = 16.0, 48.0 # 默认值
        if frame is None or np.max(frame) <= 5: return c_l, c_r
        
        mask = (frame > 5).astype(np.uint8)
        num, _, _, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        cols = [centroids[i][0] for i in range(1, num)]
        
        if not cols: return c_l, c_r

        centers = [min(cols), max(cols)]
        for _ in range(3):
            g0 = [x for x in cols if abs(x - centers[0]) < abs(x - centers[1])]
            g1 = [x for x in cols if abs(x - centers[0]) >= abs(x - centers[1])]
            if g0: centers[0] = np.mean(g0)
            if g1: centers[1] = np.mean(g1)
            
        centers.sort()
        if abs(centers[1] - centers[0]) < 10: return c_l, c_r
        return centers[0], centers[1]

    def _get_foot_split(frame, cl, cr):
        """ 分割左右脚 """
        mask_l = np.zeros_like(frame, dtype=np.uint8)
        mask_r = np.zeros_like(frame, dtype=np.uint8)
        if np.max(frame) > 0:
            binary = (frame > 0).astype(np.uint8)
            num, labels, _, cents = cv2.connectedComponentsWithStats(binary, connectivity=8)
            for i in range(1, num):
                col = cents[i][0]
                if abs(col - cl) <= abs(col - cr): mask_l[labels == i] = 1
                else: mask_r[labels == i] = 1
        return mask_l, mask_r

    def _calc_speed(pos_curr, pos_prev, fps_val):
        """ 计算速度 (cm/s) """
        if pos_curr is None or pos_prev is None: return 0.0
        # 像素距离
        dist_pix = math.sqrt((pos_curr[0] - pos_prev[0])**2 + (pos_curr[1] - pos_prev[1])**2)
        # 物理距离 (mm) = 像素 * 间距(mm)
        dist_mm = dist_pix * PITCH_MM
        # 速度 = 距离 / (1/fps) = 距离 * fps
        return dist_mm * fps_val

    # ================= 主处理流程 =================
    
    # 1. 解析数据
    frame_curr = _parse_frame(data_current)
    frame_prev = _parse_frame(data_prev)
    
    if frame_curr is None: return None

    # 2. 确定中心 (使用当前帧确定，若当前帧无效则用默认)
    cl, cr = _get_centers_dynamic(frame_curr)

    # 3. 处理当前帧
    mask_l_curr, mask_r_curr = _get_foot_split(frame_curr, cl, cr)
    frame_l_curr = frame_curr * mask_l_curr
    frame_r_curr = frame_curr * mask_r_curr
    
    cop_l_curr = _calc_cop_pos(frame_l_curr)
    cop_r_curr = _calc_cop_pos(frame_r_curr)

    # 4. 处理上一帧 (用于计算速度)
    cop_l_prev = None
    cop_r_prev = None
    
    if frame_prev is not None:
        # 为了保持分割一致性，建议使用当前帧的中心来分割上一帧，
        # 或者重新计算上一帧中心。这里选择重新计算以适应大幅度动作。
        cl_p, cr_p = _get_centers_dynamic(frame_prev)
        mask_l_prev, mask_r_prev = _get_foot_split(frame_prev, cl_p, cr_p)
        
        cop_l_prev = _calc_cop_pos(frame_prev * mask_l_prev)
        cop_r_prev = _calc_cop_pos(frame_prev * mask_r_prev)

    # 5. 计算指标
    res = {}
    
    # Left
    res['left'] = {
        "pressure": float(np.sum(frame_l_curr)),
        "area": float(np.count_nonzero(frame_l_curr) * (PITCH_MM**2) / 100.0),
        "cop_speed": float(_calc_speed(cop_l_curr, cop_l_prev, fps)),
        "array": frame_l_curr.astype(float).tolist()
    }
    
    # Right
    res['right'] = {
        "pressure": float(np.sum(frame_r_curr)),
        "area": float(np.count_nonzero(frame_r_curr) * (PITCH_MM**2) / 100.0),
        "cop_speed": float(_calc_speed(cop_r_curr, cop_r_prev, fps)),
        "array": frame_r_curr.astype(float).tolist()
    }
    
    return res



def process_playback_batch(matrix_2d, fps=20):
    """
    回放函数：传入二维数组，根据固定FPS计算速度
    Args:
        matrix_2d: (N, 4096) 数据矩阵
        fps:       帧率 (默认 77.0)
    Returns:
        dict: 包含左右脚压力、面积、COP速度、数组序列
    """
    import numpy as np
    import cv2
    import scipy.ndimage
    import math
    from scipy.spatial.distance import cdist

    # ================= 内部封装算法 =================
    PITCH_MM = 14.0

    def _unite_broken_arch(binary_map, dist_threshold=3.0):
        binary_map = (binary_map > 0).astype(np.uint8)
        num, labels, stats, centroids = cv2.connectedComponentsWithStats(binary_map, connectivity=8)
        if num <= 2: return num, labels, stats, centroids
        label_points = {l: np.argwhere(labels == l) for l in range(1, num)}
        parent = list(range(num))
        def find(i):
            if parent[i] == i: return i
            parent[i] = find(parent[i])
            return parent[i]
        keys = list(label_points.keys())
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                l1, l2 = keys[i], keys[j]
                d = np.min(cdist(label_points[l1], label_points[l2]))
                if d < dist_threshold: parent[find(l1)] = find(l2)
        new_labels = np.zeros_like(labels)
        current_new_id = 1
        mapping = {}
        for l in range(1, num):
            root = find(l)
            if root not in mapping:
                mapping[root] = current_new_id
                current_new_id += 1
            new_labels[labels == l] = mapping[root]
        return current_new_id, new_labels, None, None

    def _calculate_cop_pos(frame):
        total = np.sum(frame)
        if total <= 10: return None
        rows, cols = frame.shape
        y, x = np.indices((rows, cols))
        return (np.sum(frame * x) / total, np.sum(frame * y) / total)

    def _get_foot_mask(frame, is_right, cl, cr):
        if np.max(frame) <= 0: return np.zeros_like(frame, dtype=np.uint8)
        mask = np.zeros_like(frame, dtype=np.uint8)
        binary = (frame > 0).astype(np.uint8)
        num, labels, _, cents = cv2.connectedComponentsWithStats(binary, connectivity=8)
        for i in range(1, num):
            col = cents[i][0]
            if is_right:
                if abs(col - cr) < abs(col - cl): mask[labels == i] = 1
            else:
                if abs(col - cl) <= abs(col - cr): mask[labels == i] = 1
        return mask

    # ================= 主处理流程 =================
    
    # 1. 数据准备
    raw_data = np.array(matrix_2d, dtype=np.float32)
    if raw_data.ndim == 1: raw_data = raw_data.reshape(1, -1)
    frames = raw_data.reshape(-1, 64, 64)
    
    # 2. 全局时域去噪
    frames[frames <= 4] = 0
    pixel_max = np.max(frames, axis=0)
    pixel_min = np.min(frames, axis=0)
    keep_mask = (pixel_max - pixel_min) > 25
    frames = frames * keep_mask

    # 3. 活跃序列过滤
    max_series = np.max(frames.reshape(len(frames), -1), axis=1)
    is_active = (max_series > 4).astype(int)
    labeled_arr, num_feats = scipy.ndimage.label(is_active)
    for lid in range(1, num_feats + 1):
        indices = np.where(labeled_arr == lid)[0]
        if max_series[indices].max() <= 150: frames[indices] = 0

    # 4. 逐帧精细处理 (旋转+修复+滤波)
    cleaned_frames = []
    neighbor_kernel = np.ones((3, 3), dtype=np.float32)

    for frame in frames:
        processed_frame = np.rot90(np.fliplr(frame), k=1)
        if np.max(processed_frame) > 0:
            mask = (processed_frame > 0).astype(np.uint8)
            num_l, labels, _, _ = _unite_broken_arch(mask, dist_threshold=3.0)
            
            h, w = processed_frame.shape
            clean_mask = np.zeros_like(processed_frame)
            for l in range(1, num_l):
                comp_mask = (labels == l)
                ys, xs = np.where(comp_mask)
                if len(ys) == 0: continue
                
                # 过滤条件
                x_min, x_max = np.min(xs), np.max(xs)
                blob_max = np.max(processed_frame[comp_mask])
                area_pix = len(ys)
                is_touching = (x_min <= 5) or (x_max >= w - 5)
                
                if not (area_pix < 15 or blob_max < 100 or is_touching):
                    clean_mask[comp_mask] = 1
            
            processed_frame *= clean_mask
            if np.max(processed_frame) > 0:
                bin_f = (processed_frame > 0).astype(np.float32)
                cts = cv2.filter2D(bin_f, -1, neighbor_kernel, borderType=cv2.BORDER_CONSTANT)
                processed_frame *= (cts >= 4).astype(np.float32)
        cleaned_frames.append(processed_frame)
    
    cleaned_frames = np.array(cleaned_frames)

    # 5. 全局中心计算
    all_centroids = []
    for f in cleaned_frames:
        if np.max(f) <= 0: continue
        num, _, _, cents = cv2.connectedComponentsWithStats((f>0).astype(np.uint8))
        for k in range(1, num): all_centroids.append(cents[k][0])
    
    c_l, c_r = 16.0, 48.0
    if all_centroids:
        centers = [min(all_centroids), max(all_centroids)]
        for _ in range(10):
            g0 = [x for x in all_centroids if abs(x-centers[0]) < abs(x-centers[1])]
            g1 = [x for x in all_centroids if abs(x-centers[0]) >= abs(x-centers[1])]
            nc = list(centers)
            if g0: nc[0] = np.mean(g0)
            if g1: nc[1] = np.mean(g1)
            if abs(nc[0]-centers[0]) < 0.1 and abs(nc[1]-centers[1]) < 0.1: break
            centers = nc
        centers.sort()
        c_l, c_r = centers[0], centers[1]

    # 6. 计算结果
    res = {
        "left":  {"pressure": [], "area": [], "cop_speed": [], "array": []},
        "right": {"pressure": [], "area": [], "cop_speed": [], "array": []}
    }
    
    # 记录上一帧的COP位置 (cx, cy)
    prev_cop = {'left': None, 'right': None}
    
    for f in cleaned_frames:
        # 分割
        ml = _get_foot_mask(f, False, c_l, c_r)
        mr = _get_foot_mask(f, True, c_l, c_r)
        
        # --- Left ---
        fl = f * ml
        res["left"]["pressure"].append(float(np.sum(fl)))
        res["left"]["area"].append(float(np.count_nonzero(fl) * (PITCH_MM**2) / 100.0))
        # res["left"]["array"].append(fl.astype(float).tolist())
        
        curr_cop_l = _calculate_cop_pos(fl)
        speed_l = 0.0
        if curr_cop_l and prev_cop['left']:
            # 距离(mm) * fps
            dist_pix = math.sqrt((curr_cop_l[0]-prev_cop['left'][0])**2 + (curr_cop_l[1]-prev_cop['left'][1])**2)
            speed_l = (dist_pix * PITCH_MM) * fps
        
        res["left"]["cop_speed"].append(float(speed_l))
        if curr_cop_l: prev_cop['left'] = curr_cop_l
        
        # --- Right ---
        fr = f * mr
        res["right"]["pressure"].append(float(np.sum(fr)))
        res["right"]["area"].append(float(np.count_nonzero(fr) * (PITCH_MM**2) / 100.0))
        # res["right"]["array"].append(fr.astype(float).tolist())
        
        curr_cop_r = _calculate_cop_pos(fr)
        speed_r = 0.0
        if curr_cop_r and prev_cop['right']:
            dist_pix = math.sqrt((curr_cop_r[0]-prev_cop['right'][0])**2 + (curr_cop_r[1]-prev_cop['right'][1])**2)
            speed_r = (dist_pix * PITCH_MM) * fps
            
        res["right"]["cop_speed"].append(float(speed_r))
        if curr_cop_r: prev_cop['right'] = curr_cop_r

    # 转为 numpy 数组
    return res


def load_footdata_and_process(csv_path="foot1769080175320.0.csv", fps=77.0):
    """
    Read footdata column from CSV, build (N, 4096) matrix, and run playback batch.
    """
    import ast
    import csv

    from real_rime_and_replay_cop_speed2 import process_playback_batch

    matrix_2d = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        footdata_key = None
        for name in fieldnames:
            if name and name.lower() == "footdata":
                footdata_key = name
                break
        if not footdata_key:
            raise ValueError("data column not found in CSV")

        for row_idx, row in enumerate(reader, start=2):
            raw = row.get(footdata_key)
            if raw is None or raw == "":
                continue
            try:
                data = ast.literal_eval(raw)
            except (ValueError, SyntaxError) as exc:
                raise ValueError(f"invalid footdata at row {row_idx}") from exc
            if not isinstance(data, list):
                raise ValueError(f"footdata at row {row_idx} is not a list")
            if len(data) != 4096:
                raise ValueError(f"footdata length != 4096 at row {row_idx}")
            matrix_2d.append(data)

    return process_playback_batch(matrix_2d, fps=fps)


# print(load_footdata_and_process(csv_path="/Users/imac/Documents/GitHub/jqtoolsWin/python/app/stand.csv"))

# print(load_footdata_and_process()["left"]["cop_speed"])
