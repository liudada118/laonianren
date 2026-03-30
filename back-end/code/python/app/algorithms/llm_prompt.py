"""
兼容层 — 已迁移到 prompts/ 目录，按模块拆分
"""
from prompts import GRIP_SYSTEM_PROMPT, build_grip_user_prompt

__all__ = ["GRIP_SYSTEM_PROMPT", "build_grip_user_prompt"]
