"""
起坐评估 - JSON输出模块
====================================
复用 generate_sit_stand_pdf_v3.py 的计算逻辑，
将所有指标结果输出到 JSON 文件。

用法:
    python sit_stand_json_data.py <data_folder> [output_json]

参数:
    data_folder: 数据文件夹路径（需包含 stand.csv 和 sit.csv）
    output_json: 输出JSON文件路径（可选，默认在文件夹内生成 sit_stand_result.json）
"""

import os
import sys
import json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from generate_sit_stand_pdf_v3 import generate_report_from_content


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


def process_sit_stand_to_json(data_folder, output_json=None, username="用户"):
    """
    读取起坐数据文件夹，计算所有指标，输出到JSON文件。

    Args:
        data_folder: 数据文件夹路径（需包含 stand.csv 和 sit.csv）
        output_json: 输出JSON路径（可选）
        username: 用户名

    Returns:
        str: 输出的JSON文件路径，失败返回None
    """
    if not os.path.isdir(data_folder):
        print(f"错误: 文件夹不存在: {data_folder}")
        return None

    stand_csv = os.path.join(data_folder, "stand.csv")
    sit_csv = os.path.join(data_folder, "sit.csv")

    if not os.path.exists(stand_csv):
        print(f"错误: 缺少文件: {stand_csv}")
        return None
    if not os.path.exists(sit_csv):
        print(f"错误: 缺少文件: {sit_csv}")
        return None

    # 默认输出路径
    if output_json is None:
        output_json = os.path.join(data_folder, "sit_stand_result.json")

    try:
        # 读取CSV内容
        with open(stand_csv, 'r', encoding='utf-8') as f:
            stand_content = f.read()
        with open(sit_csv, 'r', encoding='utf-8') as f:
            sit_content = f.read()

        # 调用计算逻辑
        import tempfile
        tmp_dir = tempfile.mkdtemp(prefix='sitstand_json_')
        result = generate_report_from_content(
            stand_content, sit_content,
            output_dir=tmp_dir, username=username,
        )

        # 移除 base64 图片数据
        result.pop('images', None)

        # 重排字段顺序：结果值在前，序列数据在后
        summary_keys = ['username', 'duration_stats', 'stand_frames',
                        'sit_frames', 'stand_peaks']
        series_keys = ['force_curves']
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
    DATA_FOLDER = r"C:\Users\xpr12\Desktop\数据\起坐数据"
    OUTPUT_JSON = None  # None则自动在文件夹内生成 sit_stand_result.json，也可指定路径
    USERNAME = "lxz"

    result_path = process_sit_stand_to_json(DATA_FOLDER, OUTPUT_JSON, USERNAME)
    if result_path:
        print(f"\n所有处理已完成！结果: {result_path}")
    else:
        print("\n处理过程中出现错误")
