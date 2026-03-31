"""
LLM 配置管理
支持 Moonshot (Kimi) API，兼容 OpenAI 接口格式
优先级：环境变量 > llm_settings.json > 默认值
"""

import os
import json

_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "llm_settings.json")

_DEFAULT = {
    "api_key": "",
    "base_url": "",
    "model": "kimi-k2-turbo-preview",
    "max_tokens": None,
    "timeout": 120,
    "extra_body": {"enable_thinking": False},
}


def get_llm_config():
    config = dict(_DEFAULT)

    # 从配置文件读取
    if os.path.exists(_CONFIG_FILE):
        try:
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                file_cfg = json.load(f)
                config.update(file_cfg)
        except Exception:
            pass

    # 环境变量覆盖
    if os.environ.get("MOONSHOT_API_KEY"):
        config["api_key"] = os.environ["MOONSHOT_API_KEY"]
    if os.environ.get("MOONSHOT_BASE_URL"):
        config["base_url"] = os.environ["MOONSHOT_BASE_URL"]
    if os.environ.get("MOONSHOT_MODEL"):
        config["model"] = os.environ["MOONSHOT_MODEL"]
    if os.environ.get("MOONSHOT_EXTRA_BODY"):
        # Accept JSON-like strings, e.g. {"enable_thinking": false}
        try:
            config["extra_body"] = json.loads(os.environ["MOONSHOT_EXTRA_BODY"])
        except Exception:
            config["extra_body"] = {}

    # Backward compatibility: if legacy "thinking" is configured, map to extra_body.
    if "thinking" in config and not config.get("extra_body"):
        if isinstance(config["thinking"], dict):
            # Try to infer disabled thinking from common legacy format.
            thinking_type = str(config["thinking"].get("type", "")).lower()
            config["extra_body"] = {"enable_thinking": thinking_type != "disabled"}
        elif isinstance(config["thinking"], str):
            config["extra_body"] = {"enable_thinking": config["thinking"].lower() != "disabled"}
        else:
            config["extra_body"] = {"enable_thinking": False}

    return config
