"""
FastAPI 后端服务 - 封装握力评估 Python 计算逻辑
供前端系统调用，确保计算结果与 Python 完全一致
"""

import sys
import os
import io

# 修复 Windows GBK 编码问题
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import json
import tempfile
import traceback
import base64
import shutil
import numpy as np
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

# 设置 matplotlib 为无头模式
import matplotlib
matplotlib.use('Agg')

# 确保能导入同目录下的模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from get_glove_info_from_csv import process_glove_data_from_content
from fastapi import FastAPI, HTTPException, File, UploadFile, Form

app = FastAPI(title="Sarcopenia Grip Analysis API", version="1.0.0")

# 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GripAnalyzeRequest(BaseModel):
    """握力分析请求"""
    csv_content: str
    hand_type: str  # "左手" 或 "右手"


class _SafeEncoder(json.JSONEncoder):
    """JSON encoder that converts NaN/Inf to null"""
    def default(self, o):
        try:
            return super().default(o)
        except TypeError:
            return None

    def encode(self, o):
        return super().encode(self._sanitize(o))

    def _sanitize(self, obj):
        if isinstance(obj, float):
            if obj != obj or obj == float('inf') or obj == float('-inf'):
                return None
            return obj
        if isinstance(obj, dict):
            return {k: self._sanitize(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._sanitize(item) for item in obj]
        return obj


def numpy_to_python(obj):
    """递归将 numpy 类型转换为 Python 原生类型，NaN/Inf 转为 None"""
    if isinstance(obj, dict):
        return {k: numpy_to_python(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [numpy_to_python(item) for item in obj]
    elif isinstance(obj, np.ndarray):
        return numpy_to_python(obj.tolist())
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if (v != v or v == float('inf') or v == float('-inf')) else v
    elif isinstance(obj, float):
        return None if (obj != obj or obj == float('inf') or obj == float('-inf')) else obj
    elif isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def read_image_as_base64(path: str) -> str:
    """读取图片文件并转为 base64 data URI"""
    with open(path, "rb") as f:
        data = f.read()
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "sarcopenia-grip-analysis"}


@app.post("/analyze-grip")
def analyze_grip(request: GripAnalyzeRequest):
    """接收 CSV 文本内容 + 手类型进行握力分析"""
    try:
        if not request.csv_content.strip():
            raise HTTPException(status_code=400, detail="CSV 内容不能为空")

        if request.hand_type not in ("左手", "右手"):
            raise HTTPException(status_code=400, detail="hand_type 必须为 '左手' 或 '右手'")

        tmp_dir = tempfile.mkdtemp(prefix="grip_api_")

        try:
            result = process_glove_data_from_content(
                request.csv_content,
                request.hand_type,
                output_dir=tmp_dir,
            )

            # 读取生成的 PDF 中的图片（PDF 路径在 result 中）
            images = {}
            pdf_path = result.pop('pdf_path', None)
            if pdf_path and os.path.exists(pdf_path):
                images['report_pdf'] = read_image_as_base64(pdf_path) if pdf_path.endswith('.png') else None

            # 转换为可序列化格式
            serializable = numpy_to_python(result)

            body = json.dumps({"success": True, "data": serializable, "images": images}, cls=_SafeEncoder, ensure_ascii=False)
            return Response(content=body, media_type="application/json")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 起坐能力评估 ====================

# 延迟导入，避免启动时导入失败导致整个服务挂掉
_sitstand_report = None
_sitstand_video = None

def _get_sitstand_report():
    global _sitstand_report
    if _sitstand_report is None:
        from generate_sit_stand_pdf_v3 import generate_report_from_content
        _sitstand_report = generate_report_from_content
    return _sitstand_report

def _get_sitstand_video():
    global _sitstand_video
    if _sitstand_video is None:
        from generate_ss_dashboard_v3 import generate_video_from_content
        _sitstand_video = generate_video_from_content
    return _sitstand_video


class SitStandAnalyzeRequest(BaseModel):
    """起坐分析请求（小数据用 JSON）"""
    stand_csv_content: str
    sit_csv_content: str
    username: Optional[str] = "用户"


@app.post("/analyze-sitstand")
async def analyze_sitstand(
    stand_file: UploadFile = File(...),
    sit_file: UploadFile = File(...),
    username: str = Form("用户"),
):
    """接收坐垫+脚垫 CSV 文件进行起坐能力分析"""
    try:
        stand_content = (await stand_file.read()).decode("utf-8")
        sit_content = (await sit_file.read()).decode("utf-8")

        if not stand_content.strip():
            raise HTTPException(status_code=400, detail="脚垫 CSV 内容不能为空")
        if not sit_content.strip():
            raise HTTPException(status_code=400, detail="坐垫 CSV 内容不能为空")

        tmp_dir = tempfile.mkdtemp(prefix="sitstand_api_")

        try:
            result = _get_sitstand_report()(
                stand_content,
                sit_content,
                output_dir=tmp_dir,
                username=username or "用户",
            )
            serializable = numpy_to_python(result)
            body = json.dumps({"success": True, "data": serializable}, cls=_SafeEncoder, ensure_ascii=False)
            return Response(content=body, media_type="application/json")

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-sitstand-video")
async def generate_sitstand_video(
    stand_file: UploadFile = File(...),
    sit_file: UploadFile = File(...),
):
    """生成起坐动态视频，保存到 public 目录"""
    try:
        stand_content = (await stand_file.read()).decode("utf-8")
        sit_content = (await sit_file.read()).decode("utf-8")

        if not stand_content.strip() or not sit_content.strip():
            raise HTTPException(status_code=400, detail="CSV 内容不能为空")

        # 保存到项目 public/assets 目录
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        assets_dir = os.path.join(project_root, "public", "assets")
        os.makedirs(assets_dir, exist_ok=True)
        output_path = os.path.join(assets_dir, "dynamic_report.mp4")

        _get_sitstand_video()(
            stand_content,
            sit_content,
            output_path,
            speed_factor=0.5,
        )

        return {"success": True, "video_url": "/assets/dynamic_report.mp4"}

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 静态站立评估 ====================

# 延迟导入 OneStep_report，避免启动时导入失败
_standing_modules = None

def _get_standing_modules():
    global _standing_modules
    if _standing_modules is None:
        # mock heatmap_renderer 以避免 playwright 依赖
        try:
            import playwright  # noqa: F401
        except ImportError:
            import types
            mock_module = types.ModuleType("heatmap_renderer")
            async def _noop(*args, **kwargs): return None
            mock_module.generate_heatmap_png = _noop
            sys.modules["heatmap_renderer"] = mock_module

        from OneStep_report import (
            load_csv_data,
            preprocess_origin_data,
            preprocess_data_array,
            cal_cop_fromData,
            calculate_cop_time_series,
            extract_pressure_curves,
            calculate_cop_trajectories,
            draw_confidence_ellipse,
        )
        _standing_modules = {
            "load_csv_data": load_csv_data,
            "preprocess_origin_data": preprocess_origin_data,
            "preprocess_data_array": preprocess_data_array,
            "cal_cop_fromData": cal_cop_fromData,
            "extract_pressure_curves": extract_pressure_curves,
            "calculate_cop_trajectories": calculate_cop_trajectories,
            "draw_confidence_ellipse": draw_confidence_ellipse,
        }
    return _standing_modules


@app.post("/analyze-standing")
async def analyze_standing(
    csv_file: UploadFile = File(...),
    fps: float = Form(42),
    threshold_ratio: float = Form(0.8),
):
    """接收 CSV 文件进行静态站立分析"""
    try:
        csv_content = (await csv_file.read()).decode("utf-8")

        if not csv_content.strip():
            raise HTTPException(status_code=400, detail="CSV 内容不能为空")

        modules = _get_standing_modules()

        # 写入临时文件供 load_csv_data 读取
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, encoding="utf-8"
        ) as f:
            f.write(csv_content)
            tmp_csv_path = f.name

        tmp_dir = tempfile.mkdtemp(prefix="standing_api_")

        try:
            # 读取 CSV 数据
            raw_data = modules["load_csv_data"](tmp_csv_path)

            # 预处理
            processed_data = modules["preprocess_origin_data"](
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

            # 分析（生成图片到临时目录）
            tmp_pdf = os.path.join(tmp_dir, "report.pdf")
            results = modules["cal_cop_fromData"](
                processed_data,
                show_plots=False,
                save_pdf_path=tmp_pdf,
                rotate_data=False,
                fps=fps,
                threshold_ratio=threshold_ratio,
            )

            if results is None:
                raise HTTPException(status_code=400, detail="分析失败，数据可能无效")

            # ── 额外提取 COP 轨迹 & 椭圆参数（cal_cop_fromData 未返回这些） ──
            df = modules["preprocess_data_array"](
                processed_data, rotate_90_ccw=False, mirrored_horizon=False
            )
            left_curve, right_curve = modules["extract_pressure_curves"](processed_data)
            left_cop, right_cop = modules["calculate_cop_trajectories"](
                df, left_curve, right_curve, threshold_ratio
            )

            # 计算置信椭圆参数（不画图，只取数值）
            import matplotlib.pyplot as plt
            fig_tmp, ax_tmp = plt.subplots()
            left_ellipse = modules["draw_confidence_ellipse"](ax_tmp, left_cop) or {}
            right_ellipse = modules["draw_confidence_ellipse"](ax_tmp, right_cop) or {}
            plt.close(fig_tmp)

            results["left_cop_trajectory"] = left_cop
            results["right_cop_trajectory"] = right_cop
            results["left_ellipse_params"] = left_ellipse
            results["right_ellipse_params"] = right_ellipse

            # 读取生成的图片转为 base64
            images = {}
            image_files = {
                "cop_trajectory": os.path.join(tmp_dir, "cop_trajectory.png"),
                "arch_regions": os.path.join(tmp_dir, "arch_regions.png"),
                "heatmap_internal": os.path.join(tmp_dir, "heatmap_internal.png"),
                "velocity_series": os.path.join(tmp_dir, "velocity_series.png"),
                "confidence_ellipse": os.path.join(tmp_dir, "confidence_ellipse.png"),
            }
            for key, path in image_files.items():
                if os.path.exists(path):
                    images[key] = read_image_as_base64(path)

            serializable = numpy_to_python(results)
            body = json.dumps({"success": True, "data": serializable, "images": images}, cls=_SafeEncoder, ensure_ascii=False)
            return Response(content=body, media_type="application/json")

        finally:
            os.unlink(tmp_csv_path)
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 步态分析 ====================

_gait_report = None

def _get_gait_report():
    global _gait_report
    if _gait_report is None:
        from generate_gait_report import analyze_gait_from_content
        _gait_report = analyze_gait_from_content
    return _gait_report


@app.post("/analyze-gait")
async def analyze_gait(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
    file3: UploadFile = File(...),
    file4: UploadFile = File(...),
):
    """接收 4 个步道传感器 CSV 文件进行步态分析"""
    try:
        csv_contents = []
        for f in [file1, file2, file3, file4]:
            content = (await f.read()).decode("utf-8")
            if not content.strip():
                raise HTTPException(status_code=400, detail=f"CSV 文件 {f.filename} 内容不能为空")
            csv_contents.append(content)

        tmp_dir = tempfile.mkdtemp(prefix="gait_api_")

        try:
            result = _get_gait_report()(csv_contents, working_dir=tmp_dir)
            serializable = numpy_to_python(result)
            body = json.dumps({"success": True, "data": serializable}, cls=_SafeEncoder, ensure_ascii=False)
            return Response(content=body, media_type="application/json")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PYTHON_API_PORT", 8765))
    print(f"Starting Sarcopenia Analysis API on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port)
