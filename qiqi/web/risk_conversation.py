"""Opt-in server proxy for the existing read-only conversation entry."""
from __future__ import annotations

import ipaddress
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date
from decimal import Decimal
from typing import Any

MAX_RESPONSE_BYTES = 512 * 1024
MAX_AMOUNT_MINOR = 10**12
MONEY_FIELDS = frozenset({"cash_yuan", "amount_yuan", "fees_yuan", "holds_yuan",
                          "floor_yuan", "purpose_yuan", "due_yuan"})
FINANCE_FIELDS = MONEY_FIELDS | {"due_date", "purpose_label", "facts_confirmed", "purpose_confirmed"}
REQUEST_FIELDS = frozenset({"question", "daily_finance_yuan", "idempotency_key"})


class ConversationError(Exception):
    def __init__(self, code: str, message: str, status: int = 503):
        super().__init__(message)
        self.code, self.status = code, status

    def payload(self) -> dict[str, Any]:
        return {"error": str(self), "error_code": self.code, "decision_source": "unavailable",
                "model_status": "unavailable", "execution_allowed": False,
                "executed": False, "queued": False, "execution_state": "not_executed"}


def configured() -> bool:
    """Only expose readiness, never the upstream URL or credential."""
    try:
        _configuration()
        return True
    except ConversationError:
        return False


def requested(body: dict[str, Any]) -> bool:
    """Invalid/partial configuration must fail, rather than select the old service."""
    return bool(os.environ.get("RISK_CONVERSATION_BASE_URL", "").strip()
                or os.environ.get("RISK_CONVERSATION_API_KEY", "").strip()
                or "daily_finance_yuan" in body or "daily_finance" in body)


def _configuration() -> tuple[str, str]:
    raw = os.environ.get("RISK_CONVERSATION_BASE_URL", "").strip()
    key = os.environ.get("RISK_CONVERSATION_API_KEY", "").strip()
    if not raw or not key:
        raise ConversationError("RISK_CONVERSATION_NOT_CONFIGURED", "日常资金核对服务尚未配置，本次未调用模型或执行操作。请联系团队完成服务接入。")
    try:
        url = urllib.parse.urlsplit(raw)
        hostname = url.hostname or ""
        port = url.port
        loopback = hostname.lower() == "localhost"
        if not loopback:
            try:
                loopback = ipaddress.ip_address(hostname).is_loopback
            except ValueError:
                pass
        if (not hostname or url.username is not None or url.password is not None
                or url.query or url.fragment or url.path not in ("", "/")
                or url.scheme not in ("http", "https")
                or url.scheme == "http" and not loopback or port == 0):
            raise ValueError("invalid origin")
    except ValueError:
        raise ConversationError("RISK_CONVERSATION_CONFIG_INVALID", "日常资金核对服务配置无效，需使用 HTTPS 来源或本机回环地址。") from None
    if not 24 <= len(key) <= 10000 or any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise ConversationError("RISK_CONVERSATION_CONFIG_INVALID", "日常资金核对服务鉴权配置无效。")
    return raw.rstrip("/"), key


def validate_request(body: Any) -> dict[str, Any]:
    """Whitelist user facts; identities, risk and approval never come from this form."""
    if not isinstance(body, dict) or set(body) - REQUEST_FIELDS:
        raise ConversationError("INVALID_CONVERSATION_INPUT", "请求包含未支持字段，请只提交问题和本次资金安排。", 422)
    question = body.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > 20000:
        raise ConversationError("INVALID_CONVERSATION_INPUT", "请填写 1—20000 字的问题；超出长度不会自动截断。", 422)
    result: dict[str, Any] = {"question": question.strip()}
    if "idempotency_key" in body:
        value = body["idempotency_key"]
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", value):
            raise ConversationError("INVALID_CONVERSATION_INPUT", "本次请求编号无效，请重新发起核对。", 422)
        result["idempotency_key"] = value
    else:
        result["idempotency_key"] = "conversation-" + str(uuid.uuid4())
    if "daily_finance_yuan" in body:
        finance = body["daily_finance_yuan"]
        if not isinstance(finance, dict) or set(finance) - FINANCE_FIELDS:
            raise ConversationError("INVALID_CONVERSATION_INPUT", "资金核对字段无效，不能指定用户身份、权限或审批状态。", 422)
        clean: dict[str, Any] = {}
        for field in MONEY_FIELDS:
            amount = finance.get(field)
            if amount is not None:
                if (not isinstance(amount, str)
                        or not re.fullmatch(r"(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,2})?", amount)
                        or Decimal(amount) * 100 > MAX_AMOUNT_MINOR):
                    raise ConversationError("INVALID_CONVERSATION_INPUT", "金额请用非负元数填写，最多两位小数；不知道的金额请留空。", 422)
            clean[field] = amount
        due = finance.get("due_date")
        if due is not None:
            try:
                if not isinstance(due, str) or len(due) != 10 or date.fromisoformat(due).isoformat() != due:
                    raise ValueError("invalid date")
            except ValueError:
                raise ConversationError("INVALID_CONVERSATION_INPUT", "到期日格式无效，请选择有效日期或留空。", 422) from None
        clean["due_date"] = due
        label = finance.get("purpose_label")
        if label is not None and (not isinstance(label, str) or not 2 <= len(label.strip()) <= 60):
            raise ConversationError("INVALID_CONVERSATION_INPUT", "用途名称请填写 2—60 字，例如房租或学费。", 422)
        clean["purpose_label"] = label.strip() if label is not None else None
        for field in ("facts_confirmed", "purpose_confirmed"):
            value = finance.get(field, False)
            if not isinstance(value, bool):
                raise ConversationError("INVALID_CONVERSATION_INPUT", "请通过独立勾选核对金额事实与保护用途。", 422)
            clean[field] = value
        result["daily_finance_yuan"] = clean
    return result


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def review(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    base, key = _configuration()
    payload = validate_request(body)
    request = urllib.request.Request(base + "/api/review", method="POST",
        data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", "Accept": "application/json",
                 "X-Risk-Conversation-Key": key, "User-Agent": "finance-lab-risk-conversation/1.0"})
    # Do not inherit ambient proxies or send the service credential through redirects.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        response = opener.open(request, timeout=90)
    except urllib.error.HTTPError as exc:
        if 300 <= exc.code < 400:
            raise ConversationError("RISK_CONVERSATION_REDIRECT_REJECTED", "资金核对服务返回重定向，本次已停止，未转发服务凭证。", 502) from None
        response = exc
    except (OSError, urllib.error.URLError, TimeoutError):
        raise ConversationError("RISK_CONVERSATION_UNAVAILABLE", "资金核对服务暂时无法连接，本次失败，未切换到离线结果。", 503) from None
    try:
        with response:
            status = response.status
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("response too large")
        data = json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non-finite JSON")))
        if not isinstance(data, dict):
            raise ValueError("invalid response")
        if 200 <= status < 300:
            advice = data.get("risk_advice")
            if (not isinstance(advice, dict) or advice.get("decision") not in {"ALLOW", "REVIEW", "BLOCK", "ERROR"}
                    or advice.get("program_generated") is not True or advice.get("execution_allowed") is not False
                    or data.get("execution_allowed") is not False or data.get("queued") is not False
                    or data.get("executed") is True or data.get("decision_source") not in {"model", "unavailable"}):
                raise ValueError("invalid read-only response")
        elif not isinstance(data.get("error"), (str, dict)) and not isinstance(data.get("risk_advice"), dict):
            raise ValueError("invalid failure response")
        # The UI must never reuse legacy approval/execute controls for this adapter.
        data.update(execution_allowed=False, executed=False, queued=False, approval_id=None,
                    conversation_mode="READ_ONLY_CONVERSATION")
        return status, data
    except (ValueError, UnicodeError, OSError):
        raise ConversationError("RISK_CONVERSATION_INVALID_RESPONSE", "资金核对服务返回格式或只读状态不一致，本次结果未采用。", 502) from None
