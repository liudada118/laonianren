"""
静态站立评估 - JSON输出模块
====================================
复用 OneStep_report.py 的计算逻辑，
将所有指标结果输出到 JSON 文件。

用法:
    python one_step_json_data.py <input_csv> [output_json]

参数:
    input_csv: 输入CSV文件路径
    output_json: 输出JSON文件路径（可选，默认与输入同目录同名.json）
"""

import os
import sys
import json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from OneStep_report import load_csv_data, preprocess_origin_data, cal_cop_fromData


class NumpyEncoder(json.JSONEncoder):
    """处理 numpy 类型的 JSON 编码器"""
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        return super().default(obj)


def _clean_for_json(obj):
    """递归清理不可序列化的值（NaN, Inf 等）"""
    if isinstance(obj, dict):
        return {k: _clean_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_for_json(v) for v in obj]
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    return obj


def process_standing_to_json(input_csv, output_json=None):
    """
    读取站立CSV文件，计算所有指标，输出到JSON文件。

    Args:
        input_csv: 输入CSV文件路径
        output_json: 输出JSON路径（可选）

    Returns:
        str: 输出的JSON文件路径，失败返回None
    """
    if not os.path.exists(input_csv):
        print(f"错误: 输入文件不存在: {input_csv}")
        return None

    # 默认输出路径
    if output_json is None:
        base = os.path.splitext(input_csv)[0]
        output_json = base + "_result.json"

    try:
        # 1. 读取原始数据
        raw_data = load_csv_data(input_csv)

        # 2. 预处理
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

        # 3. 分析（不生成PDF和图片）
        import tempfile
        tmp_dir = tempfile.mkdtemp(prefix='standing_json_')
        results = cal_cop_fromData(
            processed_data,
            show_plots=False,
            save_pdf_path=None,
            rotate_data=False,
        )

        # 4. 清理不可序列化的值
        results = _clean_for_json(results)

        # 5. 重排字段顺序：结果值在前，序列数据在后
        summary_keys = ['left_cop_metrics', 'right_cop_metrics',
                        'left_sway_features', 'right_sway_features',
                        'arch_features', 'additional_data']
        series_keys = ['cop_time_series']
        ordered = {}
        for k in summary_keys:
            if k in results:
                ordered[k] = results[k]
        for k in series_keys:
            if k in results:
                ordered[k] = results[k]
        for k in results:
            if k not in ordered:
                ordered[k] = results[k]

        # 6. 写入JSON
        with open(output_json, 'w', encoding='utf-8') as f:
            json.dump(ordered, f, ensure_ascii=False, indent=2, cls=NumpyEncoder)

        print(f"[成功] JSON结果已保存: {output_json}")
        return output_json

    except Exception as e:
        print(f"处理出错: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == '__main__':
    # ========== 在这里修改你的路径 ==========
    INPUT_FILE = r"C:\Users\xpr12\Desktop\数据\静态站立数据\sit2026-1-27 14-00-59.csv"
    OUTPUT_JSON = None  # None则自动生成同名_result.json，也可指定路径

    result_path = process_standing_to_json(INPUT_FILE, OUTPUT_JSON)
    if result_path:
        print(f"\n所有处理已完成！结果: {result_path}")
    else:
        print("\n处理过程中出现错误")
