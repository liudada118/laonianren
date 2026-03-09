"""
行走步态评估 - JSON输出模块
====================================
复用 generate_gait_report.py 的计算逻辑，
将所有指标结果输出到 JSON 文件。

用法:
    python gait_json_data.py <data_folder> [output_json]

参数:
    data_folder: 数据文件夹路径（需包含 1.csv, 2.csv, 3.csv, 4.csv）
    output_json: 输出JSON文件路径（可选，默认在文件夹内生成 gait_result.json）
"""

import os
import sys
import json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from generate_gait_report import analyze_gait_from_content


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


def process_gait_to_json(data_folder, output_json=None):
    """
    读取步态数据文件夹，计算所有指标，输出到JSON文件。

    Args:
        data_folder: 数据文件夹路径（需包含 1.csv ~ 4.csv）
        output_json: 输出JSON路径（可选）

    Returns:
        str: 输出的JSON文件路径，失败返回None
    """
    if not os.path.isdir(data_folder):
        print(f"错误: 文件夹不存在: {data_folder}")
        return None

    # 检查4个CSV文件是否存在
    csv_files = [os.path.join(data_folder, f"{i}.csv") for i in range(1, 5)]
    for f in csv_files:
        if not os.path.exists(f):
            print(f"错误: 缺少文件: {f}")
            return None

    # 默认输出路径
    if output_json is None:
        output_json = os.path.join(data_folder, "gait_result.json")

    try:
        # 读取4个CSV文件内容
        csv_contents = []
        for f in csv_files:
            with open(f, 'r', encoding='utf-8') as fh:
                csv_contents.append(fh.read())

        # 调用计算逻辑
        result = analyze_gait_from_content(csv_contents)

        # 移除 base64 图片数据（体积太大，json中不需要）
        result.pop('images', None)

        # 重排字段顺序：结果值在前，序列数据在后
        summary_keys = ['gaitParams', 'fpaPerStep', 'balance',
                        'partitionFeatures', 'supportPhases', 'cyclePhases']
        series_keys = ['timeSeries', 'partitionCurves', 'regionCoords']
        ordered = {}
        for k in summary_keys:
            if k in result:
                ordered[k] = result[k]
        for k in series_keys:
            if k in result:
                ordered[k] = result[k]
        for k in result:
            if k not in ordered:
                ordered[k] = result[k]

        # 写入JSON
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
    DATA_FOLDER = r"C:\Users\xpr12\Desktop\数据\步道数据\20260211_181023"
    OUTPUT_JSON = None  # None则自动在文件夹内生成 gait_result.json，也可指定路径

    result_path = process_gait_to_json(DATA_FOLDER, OUTPUT_JSON)
    if result_path:
        print(f"\n所有处理已完成！结果: {result_path}")
    else:
        print("\n处理过程中出现错误")
