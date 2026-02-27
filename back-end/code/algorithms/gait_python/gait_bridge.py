#!/usr/bin/env python3
"""
步道算法 Python 桥接脚本
=========================
被 Node.js 子进程调用，通过 stdin 接收 JSON 输入，stdout 输出 JSON 结果。

输入 JSON 格式:
{
    "board_data": [[...], [...], [...], [...]],   // 4块板数据，每块是 list[str]
    "board_times": [[...], [...], [...], [...]]   // 4块板时间戳，每块是 list[str]
}

输出 JSON 格式:
{
    "success": true/false,
    "data": { ... },   // analyze_gait_from_content 的返回结果
    "error": "..."     // 错误信息（仅失败时）
}
"""

import sys
import os
import json
import traceback

# 确保能导入同目录下的模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 禁用 matplotlib 的 GUI 后端，避免在无头环境下报错
import matplotlib
matplotlib.use('Agg')


def main():
    try:
        # 从 stdin 读取 JSON 输入
        raw_input = sys.stdin.read()
        params = json.loads(raw_input)

        board_data = params.get('board_data', [[], [], [], []])
        board_times = params.get('board_times', [[], [], [], []])

        # 验证输入
        if len(board_data) != 4 or len(board_times) != 4:
            raise ValueError(f"需要4块板数据，收到 board_data={len(board_data)}, board_times={len(board_times)}")

        for i in range(4):
            if not board_data[i]:
                raise ValueError(f"板{i+1} 数据为空")

        # 调用步道算法
        from gait_render_data import generate_gait_report
        result = generate_gait_report(board_data, board_times)

        # 输出结果
        output = {
            "success": True,
            "data": result
        }
        # 使用特殊分隔符标记 JSON 输出的开始，避免算法的 print 输出干扰
        sys.stdout.write("__GAIT_RESULT_START__\n")
        sys.stdout.write(json.dumps(output, ensure_ascii=False, default=_json_serializer))
        sys.stdout.write("\n__GAIT_RESULT_END__\n")
        sys.stdout.flush()

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        output = {
            "success": False,
            "data": None,
            "error": error_msg
        }
        sys.stdout.write("__GAIT_RESULT_START__\n")
        sys.stdout.write(json.dumps(output, ensure_ascii=False))
        sys.stdout.write("\n__GAIT_RESULT_END__\n")
        sys.stdout.flush()


def _json_serializer(obj):
    """处理 numpy 等不可直接 JSON 序列化的类型"""
    import numpy as np
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


if __name__ == '__main__':
    main()
