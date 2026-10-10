"""DeepSeek 客户端：直连 HTTP，强制 JSON 输出，解析失败自动重试。

不依赖 openai SDK，只用已装好的 requests。
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

import requests

from .config import LLMConfig


class LLMError(RuntimeError):
    """API 层错误（网络、鉴权、额度等），调用方据此决定是否降级。"""


class LLMClient:
    def __init__(self, cfg: LLMConfig):
        self.cfg = cfg
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {cfg.api_key}",
                "Content-Type": "application/json",
            }
        )

    # ---------------- 底层请求 ----------------

    def chat(
        self,
        system: str,
        user: str,
        *,
        json_mode: bool = True,
        temperature: float | None = None,
    ) -> str:
        """发一次对话请求，返回正文文本。"""
        if not self.cfg.api_key.strip():
            raise LLMError("未配置 API key")

        payload: dict[str, Any] = {
            "model": self.cfg.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.cfg.temperature if temperature is None else temperature,
            "stream": False,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        url = self.cfg.base_url.rstrip("/") + "/chat/completions"

        last_err: Exception | None = None
        for attempt in range(self.cfg.max_retries):
            try:
                resp = self._session.post(
                    url, json=payload, timeout=self.cfg.timeout
                )
            except requests.RequestException as exc:
                last_err = exc
                time.sleep(1.5 * (attempt + 1))
                continue

            if resp.status_code == 200:
                data = resp.json()
                try:
                    return data["choices"][0]["message"]["content"]
                except (KeyError, IndexError) as exc:
                    last_err = LLMError(f"响应结构异常：{data}")
                    continue

            # 鉴权/额度问题重试无意义，直接抛出
            if resp.status_code in (401, 403):
                raise LLMError(
                    f"鉴权失败（HTTP {resp.status_code}）。请检查 config.yaml 里的 api_key。"
                )
            if resp.status_code == 402:
                raise LLMError("账户余额不足（HTTP 402），请到 DeepSeek 平台充值。")

            last_err = LLMError(f"HTTP {resp.status_code}: {resp.text[:300]}")
            time.sleep(1.5 * (attempt + 1))

        raise LLMError(f"请求失败：{last_err}")

    # ---------------- JSON 解析 ----------------

    @staticmethod
    def _extract_json(text: str) -> dict:
        """模型有时会包 ```json 代码块或加前后说明，这里做容错提取。"""
        text = text.strip()

        # 去掉 ```json ... ``` 包裹
        fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.DOTALL)
        if fence:
            text = fence.group(1).strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # 退一步：抓第一个 { 到最后一个 } 之间的内容
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass

        raise ValueError("无法从模型输出中解析出 JSON")

    def chat_json(
        self,
        system: str,
        user: str,
        *,
        temperature: float | None = None,
    ) -> dict:
        """要求模型返回 JSON，带解析重试。"""
        prompt = user
        last_err: Exception | None = None

        for attempt in range(self.cfg.max_retries):
            try:
                raw = self.chat(
                    system, prompt, json_mode=True, temperature=temperature
                )
                return self._extract_json(raw)
            except (ValueError, json.JSONDecodeError) as exc:
                last_err = exc
                # 把失败原因回灌给模型，让它自己修正
                prompt = (
                    user
                    + "\n\n【重要】上一次输出不是合法 JSON，请只输出一个 JSON 对象，"
                    "不要任何解释文字、不要 markdown 代码块。"
                )
                time.sleep(0.8)

        raise LLMError(f"JSON 解析连续失败：{last_err}")
