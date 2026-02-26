import contextlib
import importlib.util
import json
import os
import sys
import traceback

import real_time_and_replay_cop_speed_2 as realtime_module
from foot.generate_pdf_front import analyze_gait_and_build_report
from foot.generate_video_front import generate_dashboard_video
with contextlib.redirect_stdout(sys.stderr):
    from hand.get_adc_form_csv import process_glove_data_from_array
    from hand.glove_video_front import create_video as create_glove_video
from sitAndfoot.generate_ss_pdf_front import process_and_generate_report
from sitAndfoot.generate_ss_video_front import generate_combined_dashboard
from staticFoot.Comprehensive_Indicators_4096_modify_input3 import (
    extract_peak_frame,
    generate_foot_pressure_report,
)

try:
    from real_rime_and_replay_cop_speed2 import (
        process_frame_realtime as legacy_process_frame_realtime,
        process_playback_batch as legacy_process_playback_batch,
    )
except Exception:
    legacy_process_frame_realtime = None
    legacy_process_playback_batch = None

_RENDER_MODULES = {}

_RENDER_CONFIG = {
    'grip': {
        'path_parts': ['frontendReport', '\u63e1\u529b', 'glove_render_data.py'],
        'func_name': 'generate_grip_report',
    },
    'sit_stand': {
        'path_parts': ['frontendReport', '\u8d77\u5750', 'sit_stand_render_data.py'],
        'func_name': 'generate_sit_stand_report',
    },
    'standing': {
        'path_parts': ['frontendReport', '\u7ad9\u7acb', 'one_step_render_data.py'],
        'func_name': 'generate_standing_report',
    },
    'gait': {
        'path_parts': ['frontendReport', '\u6b65\u6001', 'gait_render_data.py'],
        'func_name': 'generate_gait_report',
    },
}


def _resolve_render_file(cache_key):
    cfg = _RENDER_CONFIG.get(cache_key)
    if cfg is None:
        raise KeyError(f'Unknown render config: {cache_key}')

    module_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), *cfg['path_parts'])
    if not os.path.exists(module_path):
        raise FileNotFoundError(f'Render module not found: {module_path}')
    return module_path


def _load_render_module(cache_key):
    module = _RENDER_MODULES.get(cache_key)
    if module is not None:
        return module

    module_path = _resolve_render_file(cache_key)
    spec = importlib.util.spec_from_file_location(f'frontend_report_{cache_key}', module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f'Cannot load module spec: {module_path}')

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _RENDER_MODULES[cache_key] = module
    return module


def _call_render_function(cache_key, **kwargs):
    cfg = _RENDER_CONFIG.get(cache_key)
    if cfg is None:
        raise KeyError(f'Unknown render config: {cache_key}')

    module = _load_render_module(cache_key)
    func_name = cfg['func_name']
    func = getattr(module, func_name, None)
    if not callable(func):
        raise AttributeError(
            f"Render function '{func_name}' not found in module: {getattr(module, '__file__', '<unknown>')}"
        )
    return func(**kwargs)


def _realtime_process_frame(sensor_data, data_prev):
    fn = getattr(realtime_module, 'process_frame_realtime', None)
    if callable(fn):
        return fn(sensor_data, data_prev)
    if callable(legacy_process_frame_realtime):
        return legacy_process_frame_realtime(sensor_data, data_prev)
    raise RuntimeError('process_frame_realtime not available')


def _realtime_process_playback(sensor_data):
    fn = getattr(realtime_module, 'process_playback_batch', None)
    if callable(fn):
        return fn(sensor_data, fps=20.0)
    if callable(legacy_process_playback_batch):
        return legacy_process_playback_batch(sensor_data, fps=20.0)
    raise RuntimeError('process_playback_batch not available')


def realtime_server(sensor_data, data_prev):
    return _realtime_process_frame(sensor_data, data_prev)


def replay_server(sensor_data):
    return _realtime_process_playback(sensor_data)


def ping():
    return {'pong': True}


def analyze_gait_and_build_report_with_csv(
    d1,
    d2,
    d3,
    d4,
    t1,
    t2,
    t3,
    t4,
    body_weight_kg,
    output_pdf,
    working_dir=None,
    csv_path=None,
):
    import csv
    from datetime import datetime

    if csv_path:
        csv_out = csv_path
    elif output_pdf:
        base, _ = os.path.splitext(output_pdf)
        csv_out = base + '_input.csv'
    else:
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        csv_out = os.path.join(os.path.dirname(os.path.abspath(__file__)), f'gait_input_{ts}.csv')

    os.makedirs(os.path.dirname(csv_out), exist_ok=True)

    n = min(len(d1), len(d2), len(d3), len(d4), len(t1), len(t2), len(t3), len(t4))
    with open(csv_out, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['time1', 'time2', 'time3', 'time4', 'foot1', 'foot2', 'foot3', 'foot4'])
        for i in range(n):
            writer.writerow(
                [
                    t1[i],
                    t2[i],
                    t3[i],
                    t4[i],
                    json.dumps(d1[i], ensure_ascii=False),
                    json.dumps(d2[i], ensure_ascii=False),
                    json.dumps(d3[i], ensure_ascii=False),
                    json.dumps(d4[i], ensure_ascii=False),
                ]
            )

    return analyze_gait_and_build_report(
        d1, d2, d3, d4, t1, t2, t3, t4, body_weight_kg, output_pdf, working_dir=working_dir
    )


def generate_dashboard_video_safe(d1, d2, d3, d4, t1, t2, t3, t4, output_filename='gait_dashboard.mp4'):
    with contextlib.redirect_stdout(sys.stderr):
        return generate_dashboard_video(
            d1, d2, d3, d4, t1, t2, t3, t4, output_filename=output_filename
        )


def generate_glove_video_safe(*args, **kwargs):
    with contextlib.redirect_stdout(sys.stderr):
        return create_glove_video(*args, **kwargs)


def generate_grip_render_report(sensor_data, hand_type, times=None, imu_data=None):
    with contextlib.redirect_stdout(sys.stderr):
        return _call_render_function(
            'grip',
            sensor_data=sensor_data,
            hand_type=hand_type,
            times=times,
            imu_data=imu_data,
        )


def generate_sit_stand_render_report(stand_data, sit_data, username='user'):
    with contextlib.redirect_stdout(sys.stderr):
        return _call_render_function(
            'sit_stand',
            stand_data=stand_data,
            sit_data=sit_data,
            username=username,
        )


def generate_standing_render_report(data_array, fps=42, threshold_ratio=0.8):
    with contextlib.redirect_stdout(sys.stderr):
        return _call_render_function(
            'standing',
            data_array=data_array,
            fps=fps,
            threshold_ratio=threshold_ratio,
        )


def generate_gait_render_report(d1, d2, d3, d4, t1, t2, t3, t4, body_weight_kg=80):
    with contextlib.redirect_stdout(sys.stderr):
        return _call_render_function(
            'gait',
            d1=d1,
            d2=d2,
            d3=d3,
            d4=d4,
            t1=t1,
            t2=t2,
            t3=t3,
            t4=t4,
            body_weight_kg=body_weight_kg,
        )


def _to_jsonable(value):
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_jsonable(v) for v in value]
    if isinstance(value, os.PathLike):
        return os.fspath(value)
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    if hasattr(value, 'tolist') and not isinstance(value, (str, bytes, bytearray)):
        try:
            return _to_jsonable(value.tolist())
        except Exception:
            pass
    if hasattr(value, 'item') and not isinstance(value, (str, bytes, bytearray)):
        try:
            return _to_jsonable(value.item())
        except Exception:
            pass
    return value


FUNCS = {
    'ping': ping,
    'realtime_server': realtime_server,
    'replay_server': replay_server,
    'get_peak_frame': extract_peak_frame,
    'generate_foot_pressure_report': generate_foot_pressure_report,
    'process_glove_data_from_array': process_glove_data_from_array,
    'analyze_gait_and_build_report': analyze_gait_and_build_report_with_csv,
    'generate_dashboard_video': generate_dashboard_video_safe,
    'generate_glove_video': generate_glove_video_safe,
    'process_and_generate_report': process_and_generate_report,
    'generate_combined_dashboard': generate_combined_dashboard,
    'generate_grip_render_report': generate_grip_render_report,
    'generate_sit_stand_render_report': generate_sit_stand_render_report,
    'generate_standing_render_report': generate_standing_render_report,
    'generate_gait_render_report': generate_gait_render_report,
}


def handle(req):
    fn = req.get('fn')
    if fn not in FUNCS:
        raise ValueError(f'Unknown function: {fn}')
    args = req.get('args') or {}
    return {'ok': True, 'data': _to_jsonable(FUNCS[fn](**args))}


def main():
    if hasattr(sys.stdin, 'reconfigure'):
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        req = None
        try:
            req = json.loads(line)
            rid = req.get('id')
            res = handle(req)
            print(json.dumps({'id': rid, **res}), flush=True)
        except Exception as exc:
            print(
                json.dumps(
                    {
                        'id': req.get('id') if isinstance(req, dict) else None,
                        'ok': False,
                        'error': str(exc),
                        'trace': traceback.format_exc(),
                    }
                ),
                flush=True,
            )


if __name__ == '__main__':
    main()
