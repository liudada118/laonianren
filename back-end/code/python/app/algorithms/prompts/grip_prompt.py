"""
Grip assessment LLM prompt helpers.
"""

from __future__ import annotations


GRIP_SYSTEM_PROMPT = """你是老年功能评估报告分析师，负责生成握力模块的专业判读。

## 专业表达要求
- 使用规范术语：最大握力、峰值力、双侧差异、手指力分布、抓握稳定性、姿态稳定性、功能风险分层。
- 可以说明 AWGS 2019 握力参考阈值，但必须表述为早筛参考，不得写成诊断。
- 抖动、欧拉角、角速度可作为姿态稳定性指标解释，但避免上升到具体神经系统疾病判断。
- 建议部分使用专业但可执行的抗阻训练、营养支持、复测和转诊建议。

## 文案库话术参考
- 握力表现较好：说明上肢力量和整体肌肉力量基础尚可，建议保持规律活动和力量训练。
- 握力轻度不足：提示肌肉力量储备可能开始下降，建议增加握力训练和全身抗阻训练。
- 握力明显不足：提示肌肉力量不足风险增加，建议关注蛋白质摄入、规律力量训练，并结合步速和起坐结果综合评估。
- 左右差异明显：提示两侧力量不均，需结合惯用手、疼痛、既往损伤或活动习惯解释，并给出分侧训练建议。
- 输出时可以借鉴以上句式，但必须结合 score_context 和实际数据改写。

## 内部判断标准
- 男性最大握力 ≥ 28 公斤：表现挺好
- 男性最大握力 < 28 公斤：稍弱，需要锻炼
- 女性最大握力 ≥ 18 公斤：表现挺好
- 女性最大握力 < 18 公斤：稍弱，需要锻炼

## 分析要求
1. 左右手必须分开讲，不能揉成一段
2. 如果同时有左右手，要单独写一段双手对比（哪边更有劲、差距大不大）
3. 如果某一侧没数据，要直接说明缺失，不要编造
4. 数据质量有问题，优先在 data_quality 提示并给重测建议
5. grip_start_time 是“开始发力时刻”，表示相对采集开始的时间点，不是抓握持续时长；不要把它写成“抓握时间为X秒”
6. grip_duration 才是有效抓握时长；peak_duration 是峰值平台持续时间。若 grip_duration 或 peak_duration 为“未知”或 null，不要写成“0秒”

## 输出要求
1. 严格 JSON，不要带 markdown 代码块
2. 每段内容要扎实，目标 130-180 字，先结论、再依据、最后给出功能意义或建议方向。
3. 中文，专业、简洁、可读。
"""


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
        "grip_duration": grip_data.get("grip_duration", "未知"),
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
- 开始发力时刻: {hand_data.get("grip_start_time", "未知")}（相对采集开始的时间点，不是抓握持续时长）
- 有效抓握时长: {hand_data.get("grip_duration", "未知")}（开始发力到结束发力的持续时间）
- 达峰耗时: {hand_data.get("time_to_peak", "未知")}
- 峰值时刻: {hand_data.get("peak_time", "未知")}
- 峰值平台持续时间: {hand_data.get("peak_duration", "未知")}（接近峰值水平的维持时间，不等同于有效抓握时长）
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
  "overview": "用于报告顶部评分卡。结合 score_context 的评分等级，用老人/家属能理解的话概述最大握力、是否触发性别阈值、双侧差异和主要功能风险。可使用'提示肌肉力量储备可能下降/不足风险增加'等文案库话术，约 120-160 字。",
  "left_hand_analysis": "只分析左手。围绕峰值握力、达峰过程、手指/掌部力分布、姿态稳定性和数据可靠性进行专业判读；无数据时说明缺失。约 130-180 字。",
  "right_hand_analysis": "只分析右手。围绕峰值握力、达峰过程、手指/掌部力分布、姿态稳定性和数据可靠性进行专业判读；无数据时说明缺失。约 130-180 字。",
  "bilateral_comparison": "分析双侧握力差、优势侧、双侧对称性及可能的功能意义；只有单侧数据时说明无法完成双侧比较。约 120-160 字。",
  "clinical_suggestion": "给出 3-4 条专业建议，覆盖握力球/弹力带/提物等抗阻训练、手功能训练、蛋白/营养支持、结合步速和起坐结果复测或进一步评估。每条 50-75 字。",
  "disclaimer": "本报告仅用于老年功能早筛和健康管理提示，不作为疾病诊断依据。"
}}

额外要求：
1. left_hand_analysis 和 right_hand_analysis 必须分别写。
2. 不要把左手和右手揉成一段。
3. bilateral_comparison 只写双手差异。
4. 如果数据异常，先在 data_quality 中指出，再给出保守建议。
"""
