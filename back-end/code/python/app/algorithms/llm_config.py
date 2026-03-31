"""
LLM configuration helpers.

Priority:
1) Environment variables
2) llm_settings.json
3) Built-in defaults
"""

import json
import os

_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "llm_settings.json")

_DEFAULT = {
    "api_key": "",
    "base_url": "",
    "model": "kimi-k2.5",
    "max_tokens": None,
    "timeout": 120,
    "thinking": {"type": "disabled"},
}


def _normalize_thinking(value):
    if value is None:
        return None

    if isinstance(value, dict):
        thinking_type = str(value.get("type", "")).strip()
        if thinking_type:
            return {"type": thinking_type}
        return value

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.startswith("{"):
            try:
                return _normalize_thinking(json.loads(text))
            except Exception:
                return None
        return {"type": text}

    if isinstance(value, bool):
        return {"type": "enabled" if value else "disabled"}

    return None


def get_llm_config():
    config = dict(_DEFAULT)

    if os.path.exists(_CONFIG_FILE):
        try:
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                file_cfg = json.load(f)
                config.update(file_cfg)
        except Exception:
            pass

    if os.environ.get("MOONSHOT_API_KEY"):
        config["api_key"] = os.environ["MOONSHOT_API_KEY"]
    if os.environ.get("MOONSHOT_BASE_URL"):
        config["base_url"] = os.environ["MOONSHOT_BASE_URL"]
    if os.environ.get("MOONSHOT_MODEL"):
        config["model"] = os.environ["MOONSHOT_MODEL"]
    if os.environ.get("MOONSHOT_THINKING"):
        config["thinking"] = os.environ["MOONSHOT_THINKING"]
    if os.environ.get("MOONSHOT_EXTRA_BODY"):
        try:
            config["extra_body"] = json.loads(os.environ["MOONSHOT_EXTRA_BODY"])
        except Exception:
            config["extra_body"] = {}

    # Compatibility with legacy config: infer thinking from extra_body.
    thinking = config.get("thinking")
    extra_body = config.get("extra_body")
    if thinking is None and isinstance(extra_body, dict):
        if extra_body.get("thinking") is not None:
            thinking = extra_body.get("thinking")
        elif "enable_thinking" in extra_body:
            thinking = {"type": "enabled" if bool(extra_body.get("enable_thinking")) else "disabled"}

    config["thinking"] = _normalize_thinking(thinking) or {"type": "disabled"}
    return config
