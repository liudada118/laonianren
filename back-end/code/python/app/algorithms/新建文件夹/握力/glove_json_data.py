"""
握力评估 - JSON输出模块
====================================
复用 get_glove_info_from_csv.py 的计算逻辑，
将所有指标结果输出到 JSON 文件。

用法:
    python glove_json_data.py <input_csv> [output_json]

参数:
    input_csv: 输入CSV文件路径（文件名需包含'左手'或'右手'）
    output_json: 输出JSON文件路径（可选，默认与输入同目录同名.json）
"""

import os
import sys
import json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from get_glove_info_from_csv import process_glove_data_from_content, detect_hand_type


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


def process_glove_to_json(input_csv, output_json=None):
    """
    读取握力CSV文件，计算所有指标，输出到JSON文件。

    Args:
        input_csv: 输入CSV文件路径
        output_json: 输出JSON路径（可选）

    Returns:
        str: 输出的JSON文件路径，失败返回None
    """
    if not os.path.exists(input_csv):
        print(f"错误: 输入文件不存在: {input_csv}")
        return None

    # 检测左右手
    hand_type = detect_hand_type(input_csv)
    if hand_type is None:
        print("错误: 无法从文件名识别左右手（需包含'左手'或'右手'）")
        return None

    print(f"检测到: {hand_type}")

    # 默认输出路径
    if output_json is None:
        base = os.path.splitext(input_csv)[0]
        output_json = base + "_result.json"

    try:
        # 读取CSV内容
        with open(input_csv, 'r', encoding='utf-8') as f:
            csv_content = f.read()

        # 调用计算逻辑
        import tempfile
        tmp_dir = tempfile.mkdtemp(prefix='grip_json_')
        result = process_glove_data_from_content(csv_content, hand_type, output_dir=tmp_dir)

        # 移除不需要的字段（pdf路径、base64图片等）
        result.pop('pdf_path', None)

        # 重排字段顺序：结果值在前，序列数据在后
        summary_keys = ['handType', 'hand', 'totalFrames', 'timeRange',
                        'peakInfo', 'timeAnalysis', 'fingers', 'totalForce', 'totalArea']
        series_keys = ['times', 'forceTimeSeries', 'eulerData', 'angularVelocity']
        ordered = {}
        for k in summary_keys:
            if k in result:
                ordered[k] = result[k]
        for k in series_keys:
            if k in result:
                ordered[k] = result[k]
        # 其余未列出的字段追加到最后
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
    INPUT_FILE = r"C:\Users\xpr12\Desktop\20260129_144528_左手_抚摸_形状_球形_555.csv"
    OUTPUT_JSON = None  # None则自动生成同名_result.json，也可指定路径如 r"C:\xxx\result.json"

    result_path = process_glove_to_json(INPUT_FILE, OUTPUT_JSON)
    if result_path:
        print(f"\n所有处理已完成！结果: {result_path}")
    else:
        print("\n处理过程中出现错误")
