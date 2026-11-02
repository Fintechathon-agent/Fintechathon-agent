"""MCP Server：JSON-RPC 2.0 能力中心（stdio + HTTP 共用）。

协议实现只依赖标准库，演示机器无需安装 MCP SDK：
  · initialize / tools.list / tools.call
  · resources.list / resources.read
  · prompts.list / prompts.get
  · ping / logging.setLevel

传输：
  · stdio：python -m mcp_center.server --stdio（供 Claude Desktop 等客户端）
  · HTTP ：Web 服务 POST /mcp（供前端 Agent 平台 / 远程调用）

治理：
  · tools/call 全部走 mcp_center.capabilities 的注册表；
  · 动作类工具只入队，不提供 confirm 工具；
  · 每次调用写 mcp_tool_call 审计（工具、级别、结果、客户端、耗时）。
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import uuid
from datetime import datetime
from typing import Any

from mcp_center.capabilities import (
    CAPABILITIES,
    PROTOCOL_LATEST,
    PROTOCOL_SUPPORTED,
    SERVER_INSTRUCTIONS,
    CapabilityInputError,
    get_capability,
    get_prompt,
    prompt_descriptors,
    read_resource,
    resource_descriptors,
    tool_descriptors,
)
from agent.risk.audit import log_action
from agent.risk.circuit_breaker import get_breaker

logger = logging.getLogger("mcp_center")

SERVER_INFO = {
    "name": "finance-lab-mcp-capability-center",
    "title": "Finance Lab 银行 AI · MCP 能力中心",
    "version": "1.0.0",
}


class RpcError(Exception):
    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def _error(msg_id: Any, code: int, message: str, data: Any = None) -> dict:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": msg_id, "error": error}


def _client_label(context: dict | None) -> str:
    info = (context or {}).get("client_info") or {}
    name = str(info.get("name") or "").strip()
    version = str(info.get("version") or "").strip()
    if name and version:
        return f"{name}/{version}"
    return name or "unknown"


def _audit_tool_call(tool: str, capability, arguments: dict, structured: dict | None,
                     is_error: bool, started: float, context: dict | None) -> None:
    status = str((structured or {}).get("status") or "")
    if is_error:
        result = "failure"
    elif status in ("pending_confirmation", "scheduled", "needs_clarification"):
        result = "pending"
    elif status == "blocked":
        result = "failure"
    else:
        result = "success"
    try:
        log_action(
            "mcp_tool_call",
            "demo_user",
            str((context or {}).get("session_id") or ""),
            {
                "tool": tool,
                "kind": capability.kind,
                "tier": capability.tier,
                "status": status or "ok",
                "is_error": is_error,
                "pending_ids": (structured or {}).get("pending_ids") or [],
                "client": _client_label(context),
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "arguments": arguments,
            },
            result,
        )
    except Exception:      # noqa: BLE001 — 审计失败不得把业务结果变成异常
        logger.exception("MCP 审计写入失败：%s", tool)


def _tool_text(structured: dict) -> str:
    message = str(structured.get("message") or "").strip()
    if message:
        pending_ids = structured.get("pending_ids") or []
        if pending_ids:
            message += (
                "\n待人工确认：" + "、".join(pending_ids)
                + "（由前端平台人审界面执行确认/强验证，MCP 不提供确认工具）"
            )
        return message
    return json.dumps(structured, ensure_ascii=False, indent=2)


def _validate_arguments(capability, arguments: dict) -> None:
    """按注册表中的 inputSchema 做最小契约校验（必填/未知字段/基础类型/枚举）。"""
    schema = capability.input_schema or {}
    properties = schema.get("properties") or {}
    unknown = sorted(set(arguments) - set(properties))
    if unknown:
        raise CapabilityInputError(f"不支持的参数：{', '.join(unknown)}")
    missing = [name for name in (schema.get("required") or []) if name not in arguments]
    if missing:
        raise CapabilityInputError(f"缺少必填参数：{', '.join(missing)}")

    for name, spec in properties.items():
        if name not in arguments:
            continue
        value = arguments[name]
        expected = spec.get("type")
        if expected == "boolean" and not isinstance(value, bool):
            raise CapabilityInputError(f"{name} 必须是布尔值")
        if expected == "integer" and (isinstance(value, bool) or not isinstance(value, int)):
            raise CapabilityInputError(f"{name} 必须是整数")
        if expected == "number" and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise CapabilityInputError(f"{name} 必须是数字")
        if expected == "string" and not isinstance(value, str):
            raise CapabilityInputError(f"{name} 必须是字符串")
        if spec.get("enum") and value not in spec["enum"]:
            raise CapabilityInputError(f"{name} 必须是：{', '.join(spec['enum'])}")


def _call_tool(params: dict, context: dict | None) -> dict:
    name = str(params.get("name") or "").strip()
    arguments = params.get("arguments") or {}
    if not isinstance(arguments, dict):
        raise RpcError(-32602, "tools/call 的 arguments 必须是对象")

    capability = get_capability(name)
    if capability is None:
        raise RpcError(-32602, f"未知工具：{name}")

    # HTTP 传输下每个请求独立，客户端可在 _meta 中带身份，便于审计归因。
    meta_client = (params.get("_meta") or {}).get("clientInfo")
    if meta_client and context is not None and not context.get("client_info"):
        context["client_info"] = meta_client

    started = time.perf_counter()
    if capability.kind != "query" and get_breaker().is_locked():
        structured = {
            "message": "系统熔断锁定中：资金与敏感操作已暂停，查询能力仍可用。请先由人工确认恢复。",
            "status": "blocked",
            "tier": capability.tier,
            "next_action": "human_reset_breaker",
            "reset_endpoint": "/api/breaker/reset",
        }
        _audit_tool_call(name, capability, arguments, structured, True, started, context)
        return {
            "content": [{"type": "text", "text": structured["message"]}],
            "structuredContent": structured,
            "isError": True,
        }

    try:
        _validate_arguments(capability, arguments)
        structured = capability.handler(arguments)
        if not isinstance(structured, dict):
            raise TypeError("能力处理器必须返回对象")
    except CapabilityInputError as exc:
        structured = {
            "message": str(exc),
            "status": "invalid_arguments",
            "tier": capability.tier,
            "error": "CapabilityInputError",
        }
        _audit_tool_call(name, capability, arguments, structured, True, started, context)
        return {
            "content": [{"type": "text", "text": str(exc)}],
            "structuredContent": structured,
            "isError": True,
        }
    except Exception as exc:      # noqa: BLE001 — 工具错误按 MCP 约定返回 isError
        logger.exception("MCP 工具执行失败：%s", name)
        structured = {
            "message": f"工具执行失败：{type(exc).__name__}: {exc}",
            "status": "error",
            "tier": capability.tier,
            "error": type(exc).__name__,
        }
        _audit_tool_call(name, capability, arguments, structured, True, started, context)
        return {
            "content": [{"type": "text", "text": structured["message"]}],
            "structuredContent": structured,
            "isError": True,
        }

    _audit_tool_call(name, capability, arguments, structured, False, started, context)
    return {
        "content": [{"type": "text", "text": _tool_text(structured)}],
        "structuredContent": structured,
        "isError": False,
    }


def _initialize(params: dict, context: dict | None) -> dict:
    requested = str(params.get("protocolVersion") or PROTOCOL_LATEST)
    version = requested if requested in PROTOCOL_SUPPORTED else PROTOCOL_LATEST
    if context is not None:
        context["client_info"] = params.get("clientInfo") or {}
        context["protocol_version"] = version
    return {
        "protocolVersion": version,
        "capabilities": {
            "tools": {"listChanged": False},
            "resources": {"subscribe": False, "listChanged": False},
            "prompts": {"listChanged": False},
            "logging": {},
        },
        "serverInfo": SERVER_INFO,
        "instructions": SERVER_INSTRUCTIONS,
    }


def _dispatch(method: str, params: dict, context: dict | None) -> Any:
    if method == "initialize":
        return _initialize(params, context)
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None
    if method == "ping":
        return {}
    if method == "logging/setLevel":
        return {}
    if method == "tools/list":
        return {"tools": tool_descriptors()}
    if method == "tools/call":
        return _call_tool(params, context)
    if method == "resources/list":
        return {"resources": resource_descriptors()}
    if method == "resources/read":
        uri = str(params.get("uri") or "").strip()
        if not uri:
            raise RpcError(-32602, "resources/read 缺少 uri")
        try:
            payload = read_resource(uri)
        except CapabilityInputError as exc:
            raise RpcError(-32602, str(exc)) from exc
        return {
            "contents": [{
                "uri": uri,
                "mimeType": "application/json",
                "text": json.dumps(payload, ensure_ascii=False, indent=2, default=str),
            }],
        }
    if method == "prompts/list":
        return {"prompts": prompt_descriptors()}
    if method == "prompts/get":
        name = str(params.get("name") or "").strip()
        try:
            return get_prompt(name, params.get("arguments") or {})
        except CapabilityInputError as exc:
            raise RpcError(-32602, str(exc)) from exc
    raise RpcError(-32601, f"Method not found: {method}")


def _handle_one(message: Any, context: dict | None) -> dict | None:
    if not isinstance(message, dict):
        return _error(None, -32600, "Invalid Request：消息必须是 JSON 对象")
    msg_id = message.get("id")
    is_notification = "id" not in message
    if message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return None if is_notification else _error(
            msg_id, -32600, "Invalid Request：需要 jsonrpc=2.0 与 method"
        )

    method = message["method"]
    params = message.get("params") or {}
    if not isinstance(params, dict):
        return None if is_notification else _error(msg_id, -32602, "params 必须是对象")

    try:
        result = _dispatch(method, params, context)
    except RpcError as exc:
        return None if is_notification else _error(msg_id, exc.code, exc.message, exc.data)
    except CapabilityInputError as exc:
        return None if is_notification else _error(msg_id, -32602, str(exc))
    except Exception as exc:      # noqa: BLE001
        logger.exception("MCP 请求处理失败：%s", method)
        return None if is_notification else _error(
            msg_id, -32603, f"Internal error: {type(exc).__name__}"
        )

    if is_notification:
        return None
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def handle_message(payload: Any, context: dict | None = None) -> Any:
    """处理单条或批量 JSON-RPC 消息；通知返回 None。"""
    if isinstance(payload, list):
        if not payload:
            return _error(None, -32600, "Invalid Request：空批量")
        responses = [r for r in (_handle_one(item, context) for item in payload) if r is not None]
        return responses or None
    return _handle_one(payload, context)


def handle_raw(raw: bytes, context: dict | None = None) -> tuple[Any, int]:
    """HTTP 入口：返回 (JSON-RPC 响应或 None, HTTP 状态码)。"""
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _error(None, -32700, "Parse error：请求体不是合法 JSON"), 400
    return handle_message(payload, context), 200


def run_stdio() -> int:
    try:
        sys.stdin.reconfigure(encoding="utf-8")      # type: ignore[union-attr]
        sys.stdout.reconfigure(encoding="utf-8")     # type: ignore[union-attr]
    except Exception:      # noqa: BLE001
        pass
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    )
    context = {
        "session_id": "mcp_stdio_" + uuid.uuid4().hex[:12],
        "client_info": {},
        "started_at": datetime.now().isoformat(timespec="seconds"),
    }
    logger.info("MCP 能力中心已启动（stdio），工具数 %d", len(CAPABILITIES))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            response = _error(None, -32700, "Parse error：输入不是合法 JSON")
        else:
            response = handle_message(payload, context)
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False, default=str) + "\n")
            sys.stdout.flush()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Finance Lab MCP 能力中心")
    parser.add_argument("--stdio", action="store_true", help="使用 stdio 传输（默认）")
    parser.add_argument("--manifest", action="store_true", help="打印能力清单后退出")
    args = parser.parse_args(argv)
    if args.manifest:
        from mcp_center.capabilities import manifest
        print(json.dumps(manifest(), ensure_ascii=False, indent=2, default=str))
        return 0
    return run_stdio()


if __name__ == "__main__":
    raise SystemExit(main())
