"""
extract_render_data.py
======================
从 analyze_gait_from_content 的中间变量中提取前端渲染所需的原始数据，
替代 base64 图片，让前端用 Canvas/ECharts 直接渲染。

返回 renderData 字典，包含：
  - evolutionFrames: 动态压力演变帧数据 (左右脚各10帧)
  - gaitAverage: 步态平均热力图 + COP轨迹
  - footprintHeatmap: 足印叠加热力图 + FPA线坐标
"""

import math
import numpy as np
import cv2


def _safe_int(x):
    try:
        return int(x)
    except:
        return None


def extract_evolution_frames(total_matrix, left_on, left_off, right_on, right_off,
                             center_l, center_r, get_foot_mask_by_centers, frame_ms=40):
    """
    提取动态压力演变数据：左右脚各选最佳步，各取10个关键帧。
    返回: {
        'left': { 'frames': list[list[list]], 'titles': list[str], 'bbox': [rmin,rmax,cmin,cmax], 'vmax': float },
        'right': { ... }
    }
    每个 frame 是裁剪后的二维数组 (list of list)。
    """
    if len(total_matrix) == 0:
        return {'left': None, 'right': None}

    MAT_H, MAT_W = np.array(total_matrix[0]).shape

    def process_foot(on_list, off_list, is_right):
        best_step_data = None
        max_load_peak = -1.0

        # 策略A: 从检测到的步态中寻找
        min_len = min(len(on_list), len(off_list))
        if min_len > 0:
            for i in range(min_len):
                start = _safe_int(on_list[i])
                end = _safe_int(off_list[i])
                if start is None or end is None or end <= start:
                    continue
                step_loads = []
                step_frames = []
                for f_idx in range(start, end + 1):
                    if f_idx >= len(total_matrix):
                        break
                    raw = np.array(total_matrix[f_idx])
                    mask = get_foot_mask_by_centers(raw, is_right, center_l, center_r)
                    clean_frame = raw * mask
                    step_loads.append(np.sum(clean_frame))
                    step_frames.append(clean_frame)
                if not step_loads:
                    continue
                current_peak = max(step_loads)
                if current_peak > max_load_peak:
                    max_load_peak = current_peak
                    best_step_data = (step_loads, step_frames, start * frame_ms)

        # 策略B: 全局搜索保底
        if best_step_data is None:
            all_loads = []
            for raw in total_matrix:
                raw = np.array(raw)
                mask = get_foot_mask_by_centers(raw, is_right, center_l, center_r)
                all_loads.append(np.sum(raw * mask))
            if len(all_loads) > 0:
                global_peak_idx = np.argmax(all_loads)
                if all_loads[global_peak_idx] > 1.0:
                    sim_start = max(0, global_peak_idx - 15)
                    sim_end = min(len(total_matrix) - 1, global_peak_idx + 15)
                    step_loads = []
                    step_frames = []
                    for f_idx in range(sim_start, sim_end + 1):
                        raw = np.array(total_matrix[f_idx])
                        mask = get_foot_mask_by_centers(raw, is_right, center_l, center_r)
                        step_loads.append(np.sum(raw * mask))
                        step_frames.append(raw * mask)
                    best_step_data = (step_loads, step_frames, sim_start * frame_ms)

        if best_step_data is None:
            return None

        loads, frames, start_time_base = best_step_data
        loads = np.array(loads)
        frames = np.array(frames)

        # 裁剪区域
        accumulated_step = np.sum(frames, axis=0)
        valid_indices = np.where(accumulated_step > 0)
        if len(valid_indices[0]) == 0:
            rmin, rmax, cmin, cmax = 0, MAT_H, 0, MAT_W
        else:
            min_r, max_r = np.min(valid_indices[0]), np.max(valid_indices[0]) + 1
            min_c, max_c = np.min(valid_indices[1]), np.max(valid_indices[1]) + 1
            pad = 2
            rmin = max(0, min_r - pad)
            rmax = min(MAT_H, max_r + pad)
            cmin = max(0, min_c - pad)
            cmax = min(MAT_W, max_c + pad)
            if (rmax - rmin) < 5:
                rmax = min(MAT_H, rmin + 5)
            if (cmax - cmin) < 5:
                cmax = min(MAT_W, cmin + 5)

        # 选帧逻辑
        selected_frames = []
        selected_titles = []
        peak_idx = np.argmax(loads)
        peak_val = loads[peak_idx] if loads[peak_idx] > 0 else 0.0001

        ascending_idxs = np.arange(0, peak_idx + 1)
        ascending_loads = loads[:peak_idx + 1]
        descending_idxs = np.arange(peak_idx, len(loads))
        descending_loads = loads[peak_idx:]

        # Frame 1
        selected_frames.append(frames[min(1, len(frames) - 1)])
        selected_titles.append("Start 0ms")
        # Frames 2-5
        for r in [0.4, 0.5, 0.6, 0.85]:
            if len(ascending_loads) > 0:
                idx = (np.abs(ascending_loads - peak_val * r)).argmin()
                t = int(ascending_idxs[idx]) * frame_ms
                selected_frames.append(frames[ascending_idxs[idx]])
                selected_titles.append(f"{t}ms")
        # Frame 6
        selected_frames.append(frames[peak_idx])
        selected_titles.append(f"Peak {int(peak_idx * frame_ms)}ms")
        # Frames 7-9
        for r in [0.85, 0.7, 0.5]:
            if len(descending_loads) > 0:
                idx = (np.abs(descending_loads - peak_val * r)).argmin()
                t = int(descending_idxs[idx]) * frame_ms
                selected_frames.append(frames[descending_idxs[idx]])
                selected_titles.append(f"{t}ms")
        # Frame 10
        selected_frames.append(frames[-1])
        selected_titles.append(f"End {int((len(frames) - 1) * frame_ms)}ms")

        global_max = float(np.max(frames))
        vmax_val = global_max if global_max > 0 else 1.0

        # 裁剪每帧并转为 list
        cropped_frames = []
        for f in selected_frames:
            crop = f[rmin:rmax, cmin:cmax]
            cropped_frames.append(crop.tolist())

        return {
            'frames': cropped_frames,
            'titles': selected_titles[:len(cropped_frames)],
            'bbox': [int(rmin), int(rmax), int(cmin), int(cmax)],
            'vmax': round(vmax_val, 2),
        }

    return {
        'left': process_foot(left_on, left_off, False),
        'right': process_foot(right_on, right_off, True),
    }


def extract_gait_average(total_matrix, left_on, left_off, right_on, right_off,
                         center_l, center_r, get_foot_mask_by_centers,
                         calculate_cop_single_side, unite_broken_arch_components):
    """
    提取步态平均热力图数据 + COP轨迹。
    返回: {
        'left': { 'heatmap': list[list], 'copTrajectories': [[[x,y],...], ...], 'stepCount': int },
        'right': { ... }
    }
    """
    data_3d = np.array(total_matrix)

    def collect_foot_data(on_list, off_list, is_right):
        valid_steps_info = []
        global_max_h = 0
        global_max_w = 0
        min_len = min(len(on_list), len(off_list))

        for i in range(min_len):
            on_idx, off_idx = on_list[i], off_list[i]
            try:
                on_idx = int(on_idx)
                off_idx = int(off_idx)
            except:
                continue
            if np.isnan(on_idx) or np.isnan(off_idx) or off_idx <= on_idx:
                continue

            step_frames_raw = data_3d[on_idx: off_idx + 1]
            if step_frames_raw.shape[0] == 0:
                continue

            step_frames = []
            for frame in step_frames_raw:
                try:
                    mask = get_foot_mask_by_centers(frame, is_right, center_l, center_r)
                    step_frames.append(frame * mask)
                except:
                    step_frames.append(frame)

            step_frames = np.array(step_frames)
            accumulated_step = np.sum(step_frames, axis=0)
            _, binary = cv2.threshold(accumulated_step.astype(np.float32), 1, 255, cv2.THRESH_BINARY)
            binary = binary.astype(np.uint8)

            num_labels, labels, stats, centroids = unite_broken_arch_components(binary, dist_threshold=3.0)
            if num_labels <= 1:
                continue

            largest_label = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
            clean_mask = (labels == largest_label)

            valid_indices = np.where(clean_mask)
            if len(valid_indices[0]) == 0:
                continue

            min_r, max_r = np.min(valid_indices[0]), np.max(valid_indices[0]) + 1
            min_c, max_c = np.min(valid_indices[1]), np.max(valid_indices[1]) + 1

            h = max_r - min_r
            w = max_c - min_c
            if h > global_max_h:
                global_max_h = h
            if w > global_max_w:
                global_max_w = w

            valid_steps_info.append({
                'raw_frames': step_frames,
                'clean_mask': clean_mask,
                'bbox': (min_r, max_r, min_c, max_c),
                'accumulated_clean': accumulated_step * clean_mask,
            })
        return valid_steps_info, global_max_h, global_max_w

    def get_aligned(steps_info, max_h, max_w, is_right):
        if not steps_info:
            return [], []
        CANVAS_H = max_h + 4
        CANVAS_W = max_w + 4
        aligned_images = []
        aligned_cops = []

        for info in steps_info:
            min_r, max_r, min_c, max_c = info['bbox']
            h = max_r - min_r
            w = max_c - min_c
            canvas = np.zeros((CANVAS_H, CANVAS_W), dtype=float)
            pad_top = (CANVAS_H - h) // 2
            pad_left = (CANVAS_W - w) // 2

            tight_footprint = info['accumulated_clean'][min_r:max_r, min_c:max_c]
            canvas[pad_top: pad_top + h, pad_left: pad_left + w] = tight_footprint
            aligned_images.append(canvas.copy())

            cop_trail = []
            for frame_idx in range(info['raw_frames'].shape[0]):
                frame_data = info['raw_frames'][frame_idx]
                masked_frame = frame_data * info['clean_mask']
                tight_frame = masked_frame[min_r:max_r, min_c:max_c]
                if np.sum(tight_frame) < 1:
                    continue
                try:
                    cx_local, cy_local = calculate_cop_single_side(tight_frame)
                    if not np.isnan(cx_local) and not np.isnan(cy_local):
                        cop_trail.append([round(float(cx_local + pad_top), 2),
                                          round(float(cy_local + pad_left), 2)])
                except:
                    pass
            aligned_cops.append(cop_trail)
        return aligned_images, aligned_cops

    left_info, l_h, l_w = collect_foot_data(left_on, left_off, False)
    right_info, r_h, r_w = collect_foot_data(right_on, right_off, True)

    l_imgs, l_cops = get_aligned(left_info, l_h, l_w, False)
    r_imgs, r_cops = get_aligned(right_info, r_h, r_w, True)

    def build_result(imgs, cops):
        if not imgs:
            return None
        avg = np.mean(np.array(imgs), axis=0)
        return {
            'heatmap': avg.tolist(),
            'copTrajectories': cops,
            'stepCount': len(imgs),
        }

    return {
        'left': build_result(l_imgs, l_cops),
        'right': build_result(r_imgs, r_cops),
    }


def extract_footprint_heatmap(raw_total_matrix, raw_lx, raw_rx, raw_center_l, raw_center_r,
                              total_matrix, lx, rx, center_l, center_r,
                              get_foot_mask_by_centers, get_largest_connected_region_cv,
                              adc_to_force, analyze_fpa_geometry):
    """
    提取足印叠加热力图数据 + FPA线坐标。
    返回: {
        'heatmap': list[list],  # H x W 的叠加压力矩阵
        'fpaLines': [
            { 'heel': [x,y], 'fore': [x,y], 'angle': float, 'isRight': bool },
            ...
        ],
        'size': [H, W],
    }
    """
    data_np = np.array(raw_total_matrix)
    H, W = data_np[0].shape
    heatmap = np.zeros((H, W), dtype=np.float32)
    force_matrix = adc_to_force(data_np)
    pressure_sum = np.sum(force_matrix, axis=0)

    # 提取左右脚区域
    left_regions = []
    for idx in raw_lx:
        raw_frame = np.array(raw_total_matrix[idx])
        mask = get_foot_mask_by_centers(raw_frame, False, raw_center_l, raw_center_r)
        coords = get_largest_connected_region_cv(raw_frame * mask)
        left_regions.append(coords)

    right_regions = []
    for idx in raw_rx:
        raw_frame = np.array(raw_total_matrix[idx])
        mask = get_foot_mask_by_centers(raw_frame, True, raw_center_l, raw_center_r)
        coords = get_largest_connected_region_cv(raw_frame * mask)
        right_regions.append(coords)

    for region in left_regions:
        if region is None or len(region) == 0:
            continue
        ys, xs = region[:, 0], region[:, 1]
        heatmap[ys, xs] += pressure_sum[ys, xs]

    for region in right_regions:
        if region is None or len(region) == 0:
            continue
        ys, xs = region[:, 0], region[:, 1]
        heatmap[ys, xs] += pressure_sum[ys, xs]

    # FPA 线
    fpa_lines = []
    for idx in lx:
        if idx >= len(total_matrix):
            continue
        frame = np.array(total_matrix[idx])
        angle, heel, fore = analyze_fpa_geometry(frame, False, center_l, center_r)
        if angle is not None and heel is not None and fore is not None:
            fpa_lines.append({
                'heel': [round(float(heel[0]), 2), round(float(heel[1]), 2)],
                'fore': [round(float(fore[0]), 2), round(float(fore[1]), 2)],
                'angle': round(float(angle), 1),
                'isRight': False,
            })

    for idx in rx:
        if idx >= len(total_matrix):
            continue
        frame = np.array(total_matrix[idx])
        angle, heel, fore = analyze_fpa_geometry(frame, True, center_l, center_r)
        if angle is not None and heel is not None and fore is not None:
            fpa_lines.append({
                'heel': [round(float(heel[0]), 2), round(float(heel[1]), 2)],
                'fore': [round(float(fore[0]), 2), round(float(fore[1]), 2)],
                'angle': round(float(angle), 1),
                'isRight': True,
            })

    # 降采样热力图以减少传输量 (原始可能是 64x256, 太大了)
    # 保留原始尺寸，前端做渲染
    heatmap_list = [[round(float(v), 2) for v in row] for row in heatmap]

    return {
        'heatmap': heatmap_list,
        'fpaLines': fpa_lines,
        'size': [int(H), int(W)],
    }
