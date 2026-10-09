"""用户端 Web Demo——持仓哨兵（模块5：Launcher / Demo）。

把 Orchestrator 与各模块的输出翻译成一个可交互的网页界面：
  · 组合总览（持仓、行业分布、风险提示）
  · 组合体检（Agent 建议卡：理由 / 依据 / 置信度 / 风险影响 / 备选方案）
  · 权限分级与确认闸门（资金操作必须用户确认 + 演示强验证）
  · 审计时间线 / 四层记忆 / 纸交易记录

启动方式：
    python web/launch.py          # 推荐：注入密钥 + 打开浏览器
    python web/app.py             # 纯服务，默认 http://127.0.0.1:8765
"""
import sys
from pathlib import Path

# 让 web 子模块能直接 import contracts / agent / demo（项目根目录进 sys.path）
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
