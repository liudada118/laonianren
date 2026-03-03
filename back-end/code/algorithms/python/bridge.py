#!/usr/bin/env python3
"""
Python 算法统一桥接脚本
=========================
被 Node.js 子进程调用，通过 stdin 接收 JSON 输入，stdout 输出 JSON 结果。
直接调用 algorithms/ 目录下的算法模块。

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
# algorithms 目录: back-end/code/python/app/algorithms/
ALGORITHMS_DIR = os.path.normpath(
    os.path.join(SCRIPT_DIR, '..', '..', 'python', 'app', 'algorithms')
)
# python/app 目录: 包含 heatmap_renderer.py 等共享模块
PYTHON_APP_DIR = os.path.normpath(
    os.path.join(SCRIPT_DIR, '..', '..', 'python', 'app')
)
# 将 algorithms 目录加入 sys.path（确保算法模块可被 import）
if ALGORITHMS_DIR not in sys.path:
    sys.path.insert(0, ALGORITHMS_DIR)
# 将共享模块目录加入 sys.path（确保 heatmap_renderer 等可被 import）
if PYTHON_APP_DIR not in sys.path:
    sys.path.insert(0, PYTHON_APP_DIR)

# 尝试设置 matplotlib 后端（不在顶层 import，避免启动失败）
try:
    import matplotlib
    matplotlib.use('Agg')
except ImportError:
    pass  # matplotlib 不可用时，某些算法可能不需要它


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
# 握力报告 - 使用 algorithms/ 目录下的算法
# ============================================================

@register('generate_grip_render_report')
def _grip_report(params):
    from glove_render_data import generate_grip_report
    return generate_grip_report(
        sensor_data=params.get('sensor_data', []),
        hand_type=params.get('hand_type', '左手'),
        times=params.get('times'),
        imu_data=params.get('imu_data'),
    )


# ============================================================
# 步道报告 - 使用 algorithms/ 目录下的算法
# ============================================================

@register('generate_gait_render_report')
def _gait_report(params):
    from gait_render_data import generate_gait_report
    return generate_gait_report(
        board_data=params.get('board_data', [[], [], [], []]),
        board_times=params.get('board_times', [[], [], [], []]),
    )


# ============================================================
# 起坐报告 - 使用 algorithms/ 目录下的算法
# ============================================================

@register('generate_sit_stand_render_report')
def _sitstand_report(params):
    from sit_stand_render_data import generate_sit_stand_report
    return generate_sit_stand_report(
        stand_data=params.get('stand_data', []),
        sit_data=params.get('sit_data', []),
        username=params.get('username', '用户'),
    )


# ============================================================
# 站立报告 - 使用 algorithms/ 目录下的算法
# ============================================================

@register('generate_standing_render_report')
def _standing_report(params):
    from one_step_render_data import generate_standing_report
    return generate_standing_report(
        data_array=params.get('data_array', []),
        fps=params.get('fps', 42),
        threshold_ratio=params.get('threshold_ratio', 0.8),
    )


# ============================================================
# JSON 序列化辅助
# ============================================================

def _sanitize_value(v):
    """将 float NaN / Infinity 替换为 JSON 安全值"""
    import math
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return 0
    return v


def _sanitize_obj(obj):
    """递归清理字典/列表中的 NaN/Infinity"""
    if isinstance(obj, dict):
        return {k: _sanitize_obj(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_obj(v) for v in obj]
    if isinstance(obj, tuple):
        return [_sanitize_obj(v) for v in obj]
    return _sanitize_value(obj)


def _json_serializer(obj):
    """处理 numpy 等不可直接 JSON 序列化的类型"""
    try:
        import numpy as np
        import math
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            v = float(obj)
            if math.isnan(v) or math.isinf(v):
                return 0
            return v
        if isinstance(obj, np.ndarray):
            return _sanitize_obj(obj.tolist())
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
    except ImportError:
        pass
    if isinstance(obj, bytes):
        return obj.decode('utf-8', errors='replace')
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def _output_result(success, data=None, error=None):
    """统一输出结果"""
    output = {"success": success, "data": data, "error": error}
    sys.stdout.write("__PY_RESULT_START__\n")
    sys.stdout.write(json.dumps(output, ensure_ascii=False, default=_json_serializer))
    sys.stdout.write("\n__PY_RESULT_END__\n")
    sys.stdout.flush()


# ============================================================
# 主入口
# ============================================================

def main():
    try:
        # 打印诊断信息到 stderr（不影响 stdout 的 JSON 输出）
        print(f"[bridge.py] Python {sys.version}", file=sys.stderr)
        print(f"[bridge.py] ALGORITHMS_DIR: {ALGORITHMS_DIR}", file=sys.stderr)
        print(f"[bridge.py] ALGORITHMS_DIR exists: {os.path.isdir(ALGORITHMS_DIR)}", file=sys.stderr)
        print(f"[bridge.py] PYTHON_APP_DIR: {PYTHON_APP_DIR}", file=sys.stderr)
        print(f"[bridge.py] PYTHON_APP_DIR exists: {os.path.isdir(PYTHON_APP_DIR)}", file=sys.stderr)

        # 从 stdin 读取 JSON 输入
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            _output_result(False, error="Empty stdin input")
            return

        params = json.loads(raw_input)

        func_name = params.get('func', '')
        func_params = params.get('params', {})

        print(f"[bridge.py] 调用函数: {func_name}", file=sys.stderr)

        if func_name not in FUNC_REGISTRY:
            _output_result(False, error=(
                f"未知的函数名: {func_name}, "
                f"可用: {list(FUNC_REGISTRY.keys())}"
            ))
            return

        # 调用对应算法
        result = FUNC_REGISTRY[func_name](func_params)

        # 清理 NaN/Infinity 确保 JSON 合法
        result = _sanitize_obj(result)

        # 输出结果
        _output_result(True, data=result)

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        print(f"[bridge.py] 错误: {error_msg}", file=sys.stderr)
        _output_result(False, error=error_msg)


if __name__ == '__main__':
    main()
