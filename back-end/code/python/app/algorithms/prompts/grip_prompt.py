"""
Grip assessment LLM prompt helpers.
"""

from __future__ import annotations


GRIP_SYSTEM_PROMPT = """你是一名老年肌少症与手部功能评估助手。

你的任务是根据握力评估的量化结果生成结构化 JSON 报告，重点要求如下：
1. 左手与右手必须分别分析，不能混写成一段。
2. 如果同时给了左右手数据，需要额外给出单独的双手对比结论。
3. 如果某一侧缺失，要明确说明缺失，不要编造。
4. 如果数据质量异常，要优先在 data_quality 中指出问题，并给出重测建议。
5. 输出必须是严格 JSON，不要输出 Markdown，不要输出额外解释文字。

握力判断可参考：
- EWGSOP2: 男性 < 27kg、女性 < 16kg 提示握力偏低
- AWGS: 男性 < 28kg、女性 < 18kg 提示握力偏低

请保持语言专业、清晰、适合临床沟通场景。"""


def _round(value, digits: int = 2):
    if isinstance(value, (int, float)):
        return round(float(value), digits)
    return value


def _normalize_range(range_info):
    if not isinstance(range_info, dict):
        return "未知"

    minimum = range_info.get("min")
    maximum = range_info.get("max")
    if minimum is None or maximum is None:
        return "未知"
    return f"{minimum} ~ {maximum}"


def _normalize_legacy_payload(grip_data: dict) -> dict:
    hand_type = str(grip_data.get("hand_type", "") or "")
    normalized = {
        "hand_type": hand_type or "左手",
        "peak_force": grip_data.get("peak_force", 0),
        "peak_force_kg": _round((grip_data.get("peak_force", 0) or 0) / 9.8, 2),
        "total_force": grip_data.get("total_force", 0),
        "total_area": grip_data.get("total_area", 0),
        "total_frames": grip_data.get("total_frames", 0),
        "time_range": grip_data.get("time_range", "-"),
        "fingers": grip_data.get("fingers", []),
        "grip_start_time": grip_data.get("grip_start_time", "未知"),
        "time_to_peak": grip_data.get("time_to_peak", "未知"),
        "peak_time": grip_data.get("peak_time", "未知"),
        "peak_duration": grip_data.get("peak_duration", "未知"),
        "shake_count": grip_data.get("shake_count", 0),
        "avg_angular_velocity": grip_data.get("avg_angular_velocity", 0),
        "max_angular_velocity": grip_data.get("max_angular_velocity", 0),
        "euler_range": grip_data.get("euler_range", {}),
    }

    if "右" in hand_type:
        return {"left_hand": None, "right_hand": normalized, "bilateral_comparison": {}}
    return {"left_hand": normalized, "right_hand": None, "bilateral_comparison": {}}


def _format_fingers(hand_data: dict) -> str:
    fingers = hand_data.get("fingers") or []
    total_force = hand_data.get("total_force") or 0
    if not fingers:
        return "  - 无手指分区数据"

    lines = []
    for finger in fingers:
        force = _round(finger.get("force", 0), 2)
        area = _round(finger.get("area", 0), 2)
        adc = finger.get("adc", 0)
        points = finger.get("points", "-")
        ratio = round((force / total_force) * 100, 1) if total_force else 0
        lines.append(
            f"  - {finger.get('name', '未知部位')}: {force}N，占比 {ratio}%，面积 {area}mm²，ADC {adc}，点位 {points}"
        )
    return "\n".join(lines)


def _format_hand_section(title: str, hand_data: dict | None) -> str:
    if not hand_data:
        return f"""## {title}
- 无该侧数据
"""

    euler_range = hand_data.get("euler_range") or {}
    return f"""## {title}
- 手别: {hand_data.get("hand_type", title)}
- 峰值握力: {_round(hand_data.get("peak_force", 0), 2)}N（约 {_round(hand_data.get("peak_force_kg", 0), 2)}kg）
- 总握力: {_round(hand_data.get("total_force", 0), 2)}N
- 总接触面积: {_round(hand_data.get("total_area", 0), 2)}mm²
- 采样帧数: {hand_data.get("total_frames", 0)}
- 采集时长: {hand_data.get("time_range", "-")}
- 开始发力时间: {hand_data.get("grip_start_time", "未知")}
- 达峰耗时: {hand_data.get("time_to_peak", "未知")}
- 峰值时刻: {hand_data.get("peak_time", "未知")}
- 峰值持续时间: {hand_data.get("peak_duration", "未知")}
- 抖动次数: {hand_data.get("shake_count", 0)}
- 平均角速度: {_round(hand_data.get("avg_angular_velocity", 0), 2)}°/s
- 最大角速度: {_round(hand_data.get("max_angular_velocity", 0), 2)}°/s
- Roll 范围: {_normalize_range(euler_range.get("roll"))}
- Pitch 范围: {_normalize_range(euler_range.get("pitch"))}
- Yaw 范围: {_normalize_range(euler_range.get("yaw"))}
- 手指/掌部受力:
{_format_fingers(hand_data)}
"""


def build_grip_user_prompt(patient_info: dict, grip_data: dict) -> str:
    """Build the grip assessment user prompt."""

    if "left_hand" not in grip_data and "right_hand" not in grip_data:
        grip_data = _normalize_legacy_payload(grip_data)

    left_hand = grip_data.get("left_hand")
    right_hand = grip_data.get("right_hand")
    bilateral = grip_data.get("bilateral_comparison") or {}

    name = patient_info.get("name", "未知")
    gender = patient_info.get("gender", "未知")
    age = patient_info.get("age", "未知")
    weight = patient_info.get("weight", "未知")

    bilateral_lines = [
        f"- 已采集手别: {', '.join(bilateral.get('available_hands', [])) or '未知'}",
        f"- 峰值握力差值: {bilateral.get('peak_force_diff', '未知')}",
        f"- 总握力差值: {bilateral.get('total_force_diff', '未知')}",
        f"- 峰值握力比值: {bilateral.get('peak_force_ratio', '未知')}",
        f"- 总握力比值: {bilateral.get('total_force_ratio', '未知')}",
        f"- 峰值更强侧: {bilateral.get('stronger_hand', '未知')}",
    ]

    return f"""请根据以下握力评估量化数据生成 AI综合评估。

## 患者信息
- 姓名: {name}
- 性别: {gender}
- 年龄: {age}
- 体重: {weight}kg

{_format_hand_section("左手量化数据", left_hand)}
{_format_hand_section("右手量化数据", right_hand)}
## 双手补充对比信息
{chr(10).join(bilateral_lines)}

请严格按以下 JSON 格式返回，不要输出任何额外文字：
{{
  "data_quality": {{
    "is_valid": true,
    "issues": [],
    "suggestion": ""
  }},
  "eval_level": {{
    "text": "正常/偏低/低握力",
    "standard": "采用的判断标准与理由"
  }},
  "overview": "对本次测试的整体概括",
  "left_hand_analysis": "只分析左手，不要夹带右手内容；如果左手缺失，就明确说明缺失",
  "right_hand_analysis": "只分析右手，不要夹带左手内容；如果右手缺失，就明确说明缺失",
  "bilateral_comparison": "只分析左右手差异、优势侧、对称性，不要重复单手细节；如果只有单手数据，就说明无法进行双手对比",
  "clinical_suggestion": "给出训练与干预建议；如果左右手情况不同，要明确分别说明重点",
  "disclaimer": "本报告由 AI 辅助生成，仅供参考，最终请结合临床判断"
}}

额外要求：
1. left_hand_analysis 和 right_hand_analysis 必须分别写。
2. 不要把左手和右手揉成一段。
3. bilateral_comparison 只写双手差异。
4. 如果数据异常，先在 data_quality 中指出，再给出保守建议。
"""
