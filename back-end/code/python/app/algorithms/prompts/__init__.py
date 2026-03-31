"""
LLM prompt exports for all assessment modules.
"""

from .grip_prompt import GRIP_SYSTEM_PROMPT, build_grip_user_prompt
from .sitstand_prompt import SITSTAND_SYSTEM_PROMPT, build_sitstand_user_prompt
from .standing_prompt import STANDING_SYSTEM_PROMPT, build_standing_user_prompt
from .gait_prompt import GAIT_SYSTEM_PROMPT, build_gait_user_prompt
from .common_rules import (
    COMMON_ASSESSMENT_SYSTEM_PROMPT,
    COMMON_ASSESSMENT_USER_NOTE,
    with_common_system_rules,
    append_common_user_rules,
)

ASSESSMENT_PROMPTS = {
    "grip": (with_common_system_rules(GRIP_SYSTEM_PROMPT), build_grip_user_prompt),
    "sitstand": (with_common_system_rules(SITSTAND_SYSTEM_PROMPT), build_sitstand_user_prompt),
    "standing": (with_common_system_rules(STANDING_SYSTEM_PROMPT), build_standing_user_prompt),
    "gait": (with_common_system_rules(GAIT_SYSTEM_PROMPT), build_gait_user_prompt),
}

__all__ = [
    "GRIP_SYSTEM_PROMPT",
    "build_grip_user_prompt",
    "SITSTAND_SYSTEM_PROMPT",
    "build_sitstand_user_prompt",
    "STANDING_SYSTEM_PROMPT",
    "build_standing_user_prompt",
    "GAIT_SYSTEM_PROMPT",
    "build_gait_user_prompt",
    "COMMON_ASSESSMENT_SYSTEM_PROMPT",
    "COMMON_ASSESSMENT_USER_NOTE",
    "with_common_system_rules",
    "append_common_user_rules",
    "ASSESSMENT_PROMPTS",
]
