"""
Shared style rules for all assessment prompts.
"""


COMMON_ASSESSMENT_SYSTEM_PROMPT = """
统一写作约束：
1. 本系统传感器存在代际差异、标定误差和一定噪声，绝对数值只可作为趋势参考，不能围绕单个精确点下确定性结论。
2. 默认不要在最终输出中引用具体牛顿力、真实绝对压力值或其他细碎力学点值。即使输入里提供了这类数据，也优先改写为“偏高、偏低、波动较大、左右差异明显、整体较稳定”等相对表述。
3. 优先使用相对表达和百分比表达，更强调趋势、波动、对称性、稳定性、一致性、风险倾向和相对差异。
4. 输出风格以“综合判断 + 实用建议”为主，不要逐项复述原始数据，不要写成流水账。
5. 保持专业、克制、易懂，避免夸张、绝对化和过度确定性的表述。
6. 必须继续输出合法 JSON，不要附加 markdown、代码块或 JSON 外文本。
""".strip()


COMMON_ASSESSMENT_USER_NOTE = """
## 统一输出限制
- 除 `data_quality` 和 `eval_level` 外，其余文本字段默认写成中等篇幅。
- `overview` 控制在约 60 个汉字，建议范围 50 到 80 字，突出综合结论。
- 各类 `analysis`、`comparison` 字段控制在约 60 个汉字，建议范围 50 到 80 字，以趋势判断为主。
- `clinical_suggestion` 保持 2 到 3 条短建议的密度，总体约 60 到 100 个汉字，不要展开成长段。
- `disclaimer` 保持 1 句简短提醒即可。
- 默认不要输出具体牛顿值或真实绝对力学数值；如需提及数据，请优先改写成百分比、占比、相对差异、波动程度、稳定性或风险倾向。
""".strip()


def with_common_system_rules(system_prompt: str) -> str:
    system_prompt = (system_prompt or "").strip()
    if not system_prompt:
        return COMMON_ASSESSMENT_SYSTEM_PROMPT
    return f"{system_prompt}\n\n{COMMON_ASSESSMENT_SYSTEM_PROMPT}"


def append_common_user_rules(user_prompt: str) -> str:
    user_prompt = (user_prompt or "").strip()
    if not user_prompt:
        return COMMON_ASSESSMENT_USER_NOTE
    return f"{user_prompt}\n\n{COMMON_ASSESSMENT_USER_NOTE}"
