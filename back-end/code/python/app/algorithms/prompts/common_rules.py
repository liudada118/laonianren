"""
Shared style rules for all assessment prompts.
"""


COMMON_ASSESSMENT_SYSTEM_PROMPT = """
你是老年功能评估辅助分析助手。请严格遵循以下规则：
1. 设备存在代际误差，避免围绕单一精确数值下结论；尤其不要过度解读牛顿力等绝对力学值。
2. 优先使用相对表达：趋势、波动、对称性、稳定性、风险倾向、变化方向，以及百分比/比值。
3. 输出风格以“综合判断 + 可执行建议”为主，不做逐项死扣数值。
4. 语气专业、简洁、可读；不夸大，不制造确定性诊断结论。
5. 只输出 JSON 对象，不输出 markdown、代码块或额外说明文字。
""".strip()


COMMON_ASSESSMENT_USER_NOTE = """
## 通用输出规范
- `data_quality` 与 `eval_level` 保持结构化、客观，不要冗长。
- `overview` 建议 90~120 字，给出整体判断与主要风险方向。
- 所有分析段（如 `*_analysis`、`*_comparison`）建议 90~120 字，重点写趋势、对称性、稳定性、波动和风险倾向。
- `clinical_suggestion` 建议 2 条；每条约 35~55 字，总体保持中等篇幅、可执行。
- 可使用百分比、比值、相对高低、变化方向；尽量少写“特别死”的绝对数值，尤其少写牛顿力绝对值。
- `disclaimer` 保持 1 句短提示即可。
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
