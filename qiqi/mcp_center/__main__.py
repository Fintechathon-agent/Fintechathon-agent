"""允许 `python -m mcp_center` 直接启动 stdio MCP Server。"""
from mcp_center.server import main

raise SystemExit(main())
