"""
静态站立评估 - 前端渲染数据封装模块
====================================
导入 OneStep_report.py 的计算逻辑，
将计算结果拆分为独立方法，供前端各可视化组件分别调用。

总入口方法: generate_standing_report(data_array, fps, threshold_ratio)

数据流: [N, 4096]数组 → Python计算 → 结构化dict → 前端ECharts/Canvas渲染
对应前端组件: StandingReport.jsx
"""

import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from OneStep_report import (
    preprocess_origin_data,
    preprocess_data_array,
    extract_pressure_curves,
    calculate_cop_trajectories,
    draw_confidence_ellipse,
    cal_cop_fromData,
)


# ============================================================
# 总入口方法 (类似 generate_foot_pressure_report)
# ============================================================

def generate_standing_report(data_array, fps=42, threshold_ratio=0.8):
    """
    静态站立评估总入口 - 接收 [N, 4096] 数组，返回全部分析结果

    Args:
        data_array (list[list] | np.ndarray): 足底压力数据，shape [N, 4096]
            每帧为长度4096的一维数组，内部会reshape为64×64矩阵
        fps (float): 采样率，默认42Hz
        threshold_ratio (float): COP计算阈值比例，默认0.8

    Returns:
        dict: 完整分析结果，结构如下:
            {
                'left_cop_metrics': dict,
                'right_cop_metrics': dict,
                'left_sway_features': dict,
                'right_sway_features': dict,
                'arch_features': { 'left_foot': {...}, 'right_foot': {...} },
                'additional_data': { 'left_length', 'right_length', ... },
                'cop_time_series': { 'path_length', 'contact_area', ... },
                'left_cop_trajectory': list,   # COP轨迹坐标 [[x,y], ...]
                'right_cop_trajectory': list,  # COP轨迹坐标 [[x,y], ...]
                'left_ellipse_params': dict,   # 置信椭圆参数
                'right_ellipse_params': dict,  # 置信椭圆参数
                'bilateral_pressure': dict,    # 左右脚真实压力比例
            }
    """
    # 确保是 list of lists 格式（preprocess_origin_data 期望的格式）
    if hasattr(data_array, 'tolist'):
        raw_data = data_array.tolist()
    else:
        raw_data = [list(row) for row in data_array]

    # 1. 预处理（跳过CSV读取，直接传入数组）
    processed_data = preprocess_origin_data(
        raw_data,
        rotate_90_ccw=True,
        mirrored_horizon=True,
        mirrored_vertical=True,
        apply_denoise=True,
        small_comp_min_size=3,
        small_comp_connectivity=4,
        margin=0,
        multi_component_mode=True,
        multi_component_top_n=3,
        multi_component_min_size=10,
    )

    # 2. 核心分析（返回 arch_features, cop_metrics, cop_time_series 等）
    results = cal_cop_fromData(
        processed_data,
        show_plots=False,
        save_pdf_path=None,
        rotate_data=False,
        fps=fps,
        threshold_ratio=threshold_ratio,
    )

    if results is None:
        return None

    # 3. 额外提取 COP 轨迹坐标（cal_cop_fromData 内部计算了但未放入返回值）
    try:
        df = preprocess_data_array(
            processed_data, rotate_90_ccw=False, mirrored_horizon=True
        )
        left_curve, right_curve = extract_pressure_curves(processed_data)
        left_cop, right_cop = calculate_cop_trajectories(
            df, left_curve, right_curve, threshold_ratio
        )

        # 转换为可序列化的列表格式
        results['left_cop_trajectory'] = [
            [float(pt[0]), float(pt[1])] for pt in left_cop
        ] if left_cop else []
        results['right_cop_trajectory'] = [
            [float(pt[0]), float(pt[1])] for pt in right_cop
        ] if right_cop else []

        # 4. 计算置信椭圆参数（不画图，只取数值）
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        fig_tmp, ax_tmp = plt.subplots()
        left_ellipse = draw_confidence_ellipse(ax_tmp, left_cop) or {}
        right_ellipse = draw_confidence_ellipse(ax_tmp, right_cop) or {}
        plt.close(fig_tmp)

        results['left_ellipse_params'] = left_ellipse
        results['right_ellipse_params'] = right_ellipse

    except Exception as e:
        print(f"[one_step_render_data] COP轨迹提取失败: {e}", file=sys.stderr)
        results['left_cop_trajectory'] = []
        results['right_cop_trajectory'] = []
        results['left_ellipse_params'] = {}
        results['right_ellipse_params'] = {}

    # 5. 计算真实的左右脚压力比例（替代前端硬编码的 50/50）
    try:
        ad = results.get('additional_data', {})
        left_pressure = ad.get('left_pressure', {})
        right_pressure = ad.get('right_pressure', {})

        # 方法1: 使用各区域压力的总和（前足+中足+后足的原始压力值）
        left_total = sum([
            left_pressure.get('前足', 0) or 0,
            left_pressure.get('中足', 0) or 0,
            left_pressure.get('后足', 0) or 0,
        ])
        right_total = sum([
            right_pressure.get('前足', 0) or 0,
            right_pressure.get('中足', 0) or 0,
            right_pressure.get('后足', 0) or 0,
        ])

        # 如果压力比例都是归一化的（加起来=1），用面积加权
        if abs(left_total - 1.0) < 0.01 and abs(right_total - 1.0) < 0.01:
            # 压力是归一化的，用面积作为权重
            left_area_info = ad.get('left_area', {})
            right_area_info = ad.get('right_area', {})
            left_area_total = left_area_info.get('total_area_cm2', 0) or 0
            right_area_total = right_area_info.get('total_area_cm2', 0) or 0

            # 用峰值帧的实际像素压力总和
            arch = results.get('arch_features', {})
            peak_frame = arch.get('peak_frame_data', [])
            if peak_frame and len(peak_frame) == 4096:
                matrix = np.array(peak_frame, dtype=float).reshape(64, 64)
                left_matrix = matrix[:, :32]
                right_matrix = matrix[:, 32:]
                left_sum = float(np.sum(left_matrix[left_matrix > 0]))
                right_sum = float(np.sum(right_matrix[right_matrix > 0]))
                total = left_sum + right_sum
                if total > 0:
                    left_ratio = round(left_sum / total * 100, 1)
                    right_ratio = round(100 - left_ratio, 1)
                else:
                    left_ratio, right_ratio = 50.0, 50.0
            elif left_area_total + right_area_total > 0:
                total = left_area_total + right_area_total
                left_ratio = round(left_area_total / total * 100, 1)
                right_ratio = round(100 - left_ratio, 1)
            else:
                left_ratio, right_ratio = 50.0, 50.0
        else:
            # 压力是绝对值，直接计算比例
            total = left_total + right_total
            if total > 0:
                left_ratio = round(left_total / total * 100, 1)
                right_ratio = round(100 - left_ratio, 1)
            else:
                left_ratio, right_ratio = 50.0, 50.0

        results['bilateral_pressure'] = {
            'leftRatio': left_ratio,
            'rightRatio': right_ratio,
        }

    except Exception as e:
        print(f"[one_step_render_data] 压力比例计算失败: {e}", file=sys.stderr)
        results['bilateral_pressure'] = {
            'leftRatio': 50.0,
            'rightRatio': 50.0,
        }

    return results


# ============================================================
# 以下为拆分方法，每个方法对应前端一个可视化区域
# 入参均为 generate_standing_report 的返回值 result
# ============================================================


def get_arch_overview(result):
    """
    【渲染区域】基本信息与足弓指标 (StandingReport.jsx #overview)
    足弓指数、足弓类型、足部尺寸、面积等

    返回: {
        'left': {
            'archIndex': float,       # 足弓指数 (0.21~0.26为正常)
            'archType': str,          # 足弓类型 (Normal/High/Flat)
            'clarkeAngle': float,     # Clarke角
            'clarkeType': str,        # Clarke分类
            'staheliRatio': float,    # Staheli比值
            'length': float,          # 足长(cm)
            'width': float,           # 足宽(cm)
            'totalArea': float,       # 总面积(cm²)
            'forefootArea': float,    # 前足面积(cm²)
            'midfootArea': float,     # 中足面积(cm²)
            'hindfootArea': float,    # 后足面积(cm²)
        },
        'right': { ... 同上 },
    }
    前端渲染: 左右脚对比表格/卡片
    """
    arch = result.get('arch_features', {})
    ad = result.get('additional_data', {})
    la = ad.get('left_area', {})
    ra = ad.get('right_area', {})
    left_foot = arch.get('left_foot', {})
    right_foot = arch.get('right_foot', {})

    def build_foot(foot, area, length_key, width_key):
        return {
            'archIndex': foot.get('area_index'),
            'archType': foot.get('area_type'),
            'clarkeAngle': foot.get('clarke_angle'),
            'clarkeType': foot.get('clarke_type'),
            'staheliRatio': foot.get('staheli_ratio'),
            'length': ad.get(length_key, 0),
            'width': ad.get(width_key, 0),
            'totalArea': area.get('total_area_cm2', 0),
            'forefootArea': (area.get('area_cm2') or [0, 0, 0])[0],
            'midfootArea': (area.get('area_cm2') or [0, 0, 0])[1],
            'hindfootArea': (area.get('area_cm2') or [0, 0, 0])[2],
        }

    return {
        'left': build_foot(left_foot, la, 'left_length', 'left_width'),
        'right': build_foot(right_foot, ra, 'right_length', 'right_width'),
    }


def get_pressure_distribution(result):
    """
    【渲染区域】区域压力分布 (StandingReport.jsx #pressure)
    前足/中足/后足的压力占比

    返回: {
        'left': {
            'forefoot': float,  # 前足压力占比(%)
            'midfoot': float,   # 中足压力占比(%)
            'hindfoot': float,  # 后足压力占比(%)
        },
        'right': { ... 同上 },
    }
    前端渲染: ECharts 柱状图或饼图
    """
    ad = result.get('additional_data', {})
    lp = ad.get('left_pressure', {})
    rp = ad.get('right_pressure', {})

    def to_percent(p):
        return {
            'forefoot': (p.get('前足') or 0) * 100,
            'midfoot': (p.get('中足') or 0) * 100,
            'hindfoot': (p.get('后足') or 0) * 100,
        }

    return {
        'left': to_percent(lp),
        'right': to_percent(rp),
    }


def get_arch_zone_data(result):
    """
    【渲染区域】足弓区域分布图 (StandingReport.jsx #arch-zones)
    用于 InteractiveArchChart 组件渲染足弓分区

    返回: {
        'leftSectionCoords': list|None,   # 左脚分区坐标 [前足coords, 中足coords, 后足coords]
        'rightSectionCoords': list|None,  # 右脚分区坐标
        'peakFrameFlat': list,            # 峰值帧4096长度一维数组(用于热力图背景)
    }
    前端渲染: Canvas 自定义绘制足弓分区
    """
    arch = result.get('arch_features', {})
    return {
        'leftSectionCoords': arch.get('left_foot', {}).get('section_coords'),
        'rightSectionCoords': arch.get('right_foot', {}).get('section_coords'),
        'peakFrameFlat': arch.get('peak_frame_data', []),
    }


def get_cop_trajectory_data(result):
    """
    【渲染区域】COP压力中心轨迹 (StandingReport.jsx #cop-heatmap)
    用于 InteractiveCOPChart 组件渲染COP轨迹

    返回: {
        'leftCopTrajectory': list,    # 左脚COP轨迹 [[x,y], ...]
        'rightCopTrajectory': list,   # 右脚COP轨迹 [[x,y], ...]
        'distLeftToBoth': float,      # 左脚COP到整体COP距离(cm)
        'distRightToBoth': float,     # 右脚COP到整体COP距离(cm)
        'leftForward': float,         # 左脚前移量(cm)
    }
    前端渲染: InteractiveCOPChart 组件
    """
    ad = result.get('additional_data', {})
    cop = ad.get('cop_results', {})
    return {
        'leftCopTrajectory': result.get('left_cop_trajectory', []),
        'rightCopTrajectory': result.get('right_cop_trajectory', []),
        'distLeftToBoth': cop.get('dist_left_to_both') or cop.get('左脚COP到整体COP距离(cm)', 0),
        'distRightToBoth': cop.get('dist_right_to_both') or cop.get('右脚COP到整体COP距离(cm)', 0),
        'leftForward': cop.get('left_forward') or cop.get('左脚前移量(cm)', 0),
    }


def get_cop_time_series(result):
    """
    【渲染区域】COP参数表 + 速度时间序列 (StandingReport.jsx #cop-params, #cop-velocity)
    15项COP平衡指标

    返回: {
        'pathLength': float,       # COP轨迹长度(mm)
        'contactArea': float,      # COP活动面积(mm²)
        'majorAxis': float,        # 最大摇摆幅度(mm)
        'minorAxis': float,        # 最小摇摆幅度(mm)
        'lsRatio': float,          # 摇摆幅度系数
        'eccentricity': float,     # 摇摆均匀性系数
        'deltaY': float,           # 左右摇摆幅度
        'deltaX': float,           # 前后摇摆幅度
        'maxDisplacement': float,  # 最大偏心距(mm)
        'minDisplacement': float,  # 最小偏心距(mm)
        'avgVelocity': float,      # 平均速度(mm/s)
        'rmsDisplacement': float,  # RMS位移(mm)
        'stdY': float,             # 左右标准差(mm)
        'stdX': float,             # 前后标准差(mm)
    }
    前端渲染: 参数表格 + ECharts 速度折线图
    """
    cts = result.get('cop_time_series', {})
    return {
        'pathLength': cts.get('path_length', 0),
        'contactArea': cts.get('contact_area', 0),
        'majorAxis': cts.get('major_axis', 0),
        'minorAxis': cts.get('minor_axis', 0),
        'lsRatio': cts.get('ls_ratio', 0),
        'eccentricity': cts.get('eccentricity', 0),
        'deltaY': cts.get('delta_y', 0),
        'deltaX': cts.get('delta_x', 0),
        'maxDisplacement': cts.get('max_displacement', 0),
        'minDisplacement': cts.get('min_displacement', 0),
        'avgVelocity': cts.get('avg_velocity', 0),
        'rmsDisplacement': cts.get('rms_displacement', 0),
        'stdY': cts.get('std_y', 0),
        'stdX': cts.get('std_x', 0),
    }


def get_cop_metrics(result):
    """
    【渲染区域】COP统计指标 (研究/调参用)
    左右脚分别的COP偏移、速度、加速度、样本熵等

    返回: {
        'left': dict,   # 左脚COP指标 (15项)
        'right': dict,  # 右脚COP指标 (15项)
    }
    每项包含: 横向偏移(range), 纵向偏移(range), 置信椭圆面积,
             横/纵/合速度(RMS), 横/纵/合加速度(RMS),
             横/纵/合偏移(SampEn), 横/纵/合速度(SampEn)
    """
    return {
        'left': result.get('left_cop_metrics', {}),
        'right': result.get('right_cop_metrics', {}),
    }


def get_sway_features(result):
    """
    【渲染区域】摇摆特征 (研究/调参用)
    左右脚的摇摆密度、摇摆长度、摇摆半径等

    返回: {
        'left': dict|None,   # 左脚摇摆特征
        'right': dict|None,  # 右脚摇摆特征
    }
    """
    return {
        'left': result.get('left_sway_features'),
        'right': result.get('right_sway_features'),
    }


def get_bilateral_pressure_ratio(result):
    """
    【渲染区域】左右脚压力比 (StandingReport.jsx #overview)

    返回: {
        'leftRatio': float,   # 左脚压力占比(%)
        'rightRatio': float,  # 右脚压力占比(%)
    }
    前端渲染: 进度条或饼图
    """
    bp = result.get('bilateral_pressure', {})
    if bp:
        return bp
    # 兼容旧版本
    return {'leftRatio': 50.0, 'rightRatio': 50.0}


# ============================================================
# 测试入口
# ============================================================

if __name__ == '__main__':
    from pprint import pprint

    # ========== 在这里粘贴你的测试数据 ==========
    # data_array: [N, 4096] 足底压力数据
    data_array = [
        # [v0, v1, ..., v4095],  # 第1帧
        # [v0, v1, ..., v4095],  # 第2帧
    ]

    if data_array:
        result = generate_standing_report(data_array)
        if result:
            print("\n=== 足弓概览 ===")
            pprint(get_arch_overview(result))
            print("\n=== 压力分布 ===")
            pprint(get_pressure_distribution(result))
            print("\n=== COP 轨迹 ===")
            pprint(get_cop_trajectory_data(result))
            print("\n=== 左右脚压力比 ===")
            pprint(get_bilateral_pressure_ratio(result))
        else:
            print("分析失败")
    else:
        print("请在 data_array 中填入测试数据")
