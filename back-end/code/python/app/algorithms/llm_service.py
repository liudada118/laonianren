"""
LLM service for assessment reports.
"""

import json

from openai import OpenAI

from llm_config import get_llm_config
from prompts import ASSESSMENT_PROMPTS, append_common_user_rules


def _normalize_optional_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _merge_llm_overrides(config: dict, llm_overrides: dict | None):
    if not llm_overrides:
        return config

    merged = dict(config)

    api_key = _normalize_optional_text(llm_overrides.get("api_key"))
    if api_key:
        merged["api_key"] = api_key

    base_url = _normalize_optional_text(llm_overrides.get("base_url"))
    if base_url:
        merged["base_url"] = base_url

    model = _normalize_optional_text(llm_overrides.get("model"))
    if model:
        merged["model"] = model

    if llm_overrides.get("max_tokens") is not None:
        merged["max_tokens"] = llm_overrides.get("max_tokens")

    if llm_overrides.get("timeout") is not None:
        merged["timeout"] = llm_overrides.get("timeout")

    if llm_overrides.get("extra_body") is not None:
        merged["extra_body"] = llm_overrides.get("extra_body")

    if llm_overrides.get("thinking") is not None:
        merged["thinking"] = llm_overrides.get("thinking")

    return merged


def _get_client_and_config(llm_overrides: dict | None = None):
    config = _merge_llm_overrides(get_llm_config(), llm_overrides)

    api_key = _normalize_optional_text(config.get("api_key"))
    if not api_key or api_key == "sk-xxx":
        raise ValueError("没有api-key，无法使用AI综合评估功能")
    config["api_key"] = api_key

    client = OpenAI(
        api_key=config["api_key"],
        base_url=config["base_url"] or None,
        timeout=config.get("timeout") or None,
    )
    return client, config


def _build_messages(assessment_type: str, patient_info: dict, assessment_data: dict):
    if assessment_type not in ASSESSMENT_PROMPTS:
        raise ValueError(f"不支持的 assessment_type: {assessment_type}")

    system_prompt, prompt_builder = ASSESSMENT_PROMPTS[assessment_type]
    user_prompt = append_common_user_rules(prompt_builder(patient_info, assessment_data))
    messages = [
        {"role": "system", "content": system_prompt},
    ]

    messages.append({"role": "user", "content": user_prompt})
    return messages


def _build_request_kwargs(config: dict, messages: list, stream: bool = False):
    request_kwargs = {
        "model": config["model"],
        "messages": messages,
    }

    if stream:
        request_kwargs["stream"] = True

    # Put provider-specific fields into extra_body so OpenAI SDK accepts them.
    extra_body = dict(config.get("extra_body") or {})
    if config.get("thinking") is not None:
        extra_body["thinking"] = config["thinking"]
    if extra_body:
        request_kwargs["extra_body"] = extra_body

    if config.get("max_tokens") is not None:
        request_kwargs["max_tokens"] = config["max_tokens"]

    return request_kwargs


def _create_completion_with_fallback(client: OpenAI, request_kwargs: dict):
    try:
        return client.chat.completions.create(**request_kwargs)
    except TypeError as e:
        # Some OpenAI-compatible endpoints/SDK versions don't accept extra_body.
        if "extra_body" in request_kwargs and "unexpected keyword argument 'extra_body'" in str(e):
            retry_kwargs = dict(request_kwargs)
            retry_kwargs.pop("extra_body", None)
            return client.chat.completions.create(**retry_kwargs)
        raise


def _strip_markdown_fence(content: str) -> str:
    content = (content or "").strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1]
    if content.endswith("```"):
        content = content.rsplit("```", 1)[0]
    return content.strip()


def _extract_json_object(content: str) -> str | None:
    start = content.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escape = False

    for index in range(start, len(content)):
        char = content[index]

        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return content[start:index + 1]

    return None


def _parse_json_response(content: str) -> dict:
    content = _strip_markdown_fence(content)

    try:
        return json.loads(content)
    except json.JSONDecodeError as original_error:
        extracted = _extract_json_object(content)
        if extracted:
            try:
                return json.loads(extracted)
            except json.JSONDecodeError:
                pass
        raise ValueError(f"AI response is not valid JSON: {content[:200]}") from original_error


async def call_assessment_ai_report(
    assessment_type: str,
    patient_info: dict,
    assessment_data: dict,
    llm_overrides: dict | None = None,
) -> dict:
    client, config = _get_client_and_config(llm_overrides=llm_overrides)
    messages = _build_messages(assessment_type, patient_info, assessment_data)
    request_kwargs = _build_request_kwargs(config=config, messages=messages, stream=False)

    response = _create_completion_with_fallback(client, request_kwargs)
    content = response.choices[0].message.content
    return _parse_json_response(content)


def stream_assessment_ai_report(
    assessment_type: str,
    patient_info: dict,
    assessment_data: dict,
    llm_overrides: dict | None = None,
):
    client, config = _get_client_and_config(llm_overrides=llm_overrides)
    messages = _build_messages(assessment_type, patient_info, assessment_data)
    request_kwargs = _build_request_kwargs(config=config, messages=messages, stream=True)

    stream = _create_completion_with_fallback(client, request_kwargs)
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


async def call_grip_ai_report(
    patient_info: dict,
    grip_data: dict,
    llm_overrides: dict | None = None,
) -> dict:
    return await call_assessment_ai_report(
        "grip",
        patient_info,
        grip_data,
        llm_overrides=llm_overrides,
    )


def stream_grip_ai_report(
    patient_info: dict,
    grip_data: dict,
    llm_overrides: dict | None = None,
):
    return stream_assessment_ai_report(
        "grip",
        patient_info,
        grip_data,
        llm_overrides=llm_overrides,
    )
