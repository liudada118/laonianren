"""
LLM service for assessment reports.
"""

import json

from openai import OpenAI

from llm_config import get_llm_config
from prompts import ASSESSMENT_PROMPTS, append_common_user_rules


def _get_client_and_config():
    config = get_llm_config()
    if not config["api_key"] or config["api_key"] == "sk-xxx":
        raise ValueError("Moonshot API Key 未配置，请在 llm_settings.json 中设置 api_key")

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
) -> dict:
    client, config = _get_client_and_config()
    messages = _build_messages(assessment_type, patient_info, assessment_data)

    request_kwargs = {
        "model": config["model"],
        "messages": messages,
    }
    if config.get("max_tokens") is not None:
        request_kwargs["max_tokens"] = config["max_tokens"]

    response = client.chat.completions.create(**request_kwargs)
    content = response.choices[0].message.content
    return _parse_json_response(content)


def stream_assessment_ai_report(
    assessment_type: str,
    patient_info: dict,
    assessment_data: dict,
):
    client, config = _get_client_and_config()
    messages = _build_messages(assessment_type, patient_info, assessment_data)

    request_kwargs = {
        "model": config["model"],
        "messages": messages,
        "stream": True,
    }
    if config.get("max_tokens") is not None:
        request_kwargs["max_tokens"] = config["max_tokens"]

    stream = client.chat.completions.create(**request_kwargs)
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


async def call_grip_ai_report(patient_info: dict, grip_data: dict) -> dict:
    return await call_assessment_ai_report("grip", patient_info, grip_data)


def stream_grip_ai_report(patient_info: dict, grip_data: dict):
    return stream_assessment_ai_report("grip", patient_info, grip_data)
