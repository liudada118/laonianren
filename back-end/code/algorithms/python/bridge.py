#!/usr/bin/env python3
"""
Python 算法统一桥接脚本
=========================
被 Node.js 子进程调用，通过 stdin 接收 JSON 输入，stdout 输出 JSON 结果。
直接调用 frontendReport/ 下已有的 Python 算法模块。

输入 JSON 格式:
{
    "func": "generate_grip_render_report",
    "params": { ... }
}

输出 JSON 格式 (使用分隔符包裹):
__PY_RESULT_START__
{ "success": true/false, "data": { ... }, "error": "..." }
__PY_RESULT_END__
"""

import sys
import os
import json
import traceback

# ============================================================
# 路径设置
# ============================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# frontendReport 目录: back-end/code/python/app/frontendReport/
FRONTEND_REPORT_DIR = os.path.normpath(
    os.path.join(SCRIPT_DIR, '..', '..', 'python', 'app', 'frontendReport')
)

# 禁用 matplotlib 的 GUI 后端
import matplotlib
matplotlib.use('Agg')


# ============================================================
# 算法函数注册表
# ============================================================

FUNC_REGISTRY = {}


def register(name):
    """装饰器：注册算法函数"""
    def decorator(func):
        FUNC_REGISTRY[name] = func
        return func
    return decorator


# ============================================================
# 握力报告
# ============================================================

@register('generate_grip_render_report')
def _grip_report(params):
    grip_dir = os.path.join(FRONTEND_REPORT_DIR, '握力')
    sys.path.insert(0, grip_dir)
    from glove_render_data import generate_grip_report
    return generate_grip_report(
        sensor_data=params.get('sensor_data', []),
        hand_type=params.get('hand_type', '左手'),
        times=params.get('times'),
        imu_data=params.get('imu_data'),
    )


# ============================================================
# 步道报告（新版）
# ============================================================

@register('generate_gait_render_report')
def _gait_report(params):
    gait_dir = os.path.join(FRONTEND_REPORT_DIR, '步态')
    sys.path.insert(0, gait_dir)
    from gait_render_data import generate_gait_report
    return generate_gait_report(
        board_data=params.get('board_data', [[], [], [], []]),
        board_times=params.get('board_times', [[], [], [], []]),
    )


# ============================================================
# 起坐报告
# ============================================================

@register('generate_sit_stand_render_report')
def _sitstand_report(params):
    sitstand_dir = os.path.join(FRONTEND_REPORT_DIR, '起坐')
    sys.path.insert(0, sitstand_dir)
    from sit_stand_render_data import generate_sit_stand_report
    return generate_sit_stand_report(
        stand_data=params.get('stand_data', []),
        sit_data=params.get('sit_data', []),
        username=params.get('username', '用户'),
    )


# ============================================================
# 站立报告
# ============================================================

@register('generate_standing_render_report')
def _standing_report(params):
    standing_dir = os.path.join(FRONTEND_REPORT_DIR, '站立')
    sys.path.insert(0, standing_dir)
    from one_step_render_data import generate_standing_report
    return generate_standing_report(
        data_array=params.get('data_array', []),
        fps=params.get('fps', 42),
        threshold_ratio=params.get('threshold_ratio', 0.8),
    )


# ============================================================
# JSON 序列化辅助
# ============================================================

def _json_serializer(obj):
    """处理 numpy 等不可直接 JSON 序列化的类型"""
    try:
        import numpy as np
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
    except ImportError:
        pass
    if isinstance(obj, bytes):
        return obj.decode('utf-8', errors='replace')
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


# ============================================================
# 主入口
# ============================================================

def main():
    try:
        # 从 stdin 读取 JSON 输入
        raw_input = sys.stdin.read()
        params = json.loads(raw_input)

        func_name = params.get('func', '')
        func_params = params.get('params', {})

        if func_name not in FUNC_REGISTRY:
            raise ValueError(
                f"未知的函数名: {func_name}, "
                f"可用: {list(FUNC_REGISTRY.keys())}"
            )

        # 调用对应算法
        result = FUNC_REGISTRY[func_name](func_params)

        # 输出结果
        output = {"success": True, "data": result}
        sys.stdout.write("__PY_RESULT_START__\n")
        sys.stdout.write(json.dumps(output, ensure_ascii=False, default=_json_serializer))
        sys.stdout.write("\n__PY_RESULT_END__\n")
        sys.stdout.flush()

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        output = {"success": False, "data": None, "error": error_msg}
        sys.stdout.write("__PY_RESULT_START__\n")
        sys.stdout.write(json.dumps(output, ensure_ascii=False))
        sys.stdout.write("\n__PY_RESULT_END__\n")
        sys.stdout.flush()


if __name__ == '__main__':
    main()
