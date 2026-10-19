"""Finance Lab MCP 能力中心。

把既有银行业务系统（六场景路由 + Web 服务层）逆向蒸馏为可发现、可调用、
可治理的 MCP 工具面。第三方 Agent 平台通过 tools/list 发现能力、
tools/call 发起业务请求；所有资金动作只进入人工确认队列，不能在 MCP 内闭环。
"""
from mcp_center.capabilities import (  # noqa: F401
    CapabilityInputError,
    get_capability,
    manifest,
    tool_descriptors,
)

__all__ = [
    "CapabilityInputError",
    "get_capability",
    "manifest",
    "tool_descriptors",
]
