"""用户端演示数据、序列化与情景试算（模块5：Launcher / Demo 专用）。

两个关键取舍：
  1. 演示行情直接取组合自身的现价（source="demo"），而不是走 tools/market 的
     mock 行情——mock 价格由代码哈希派生、与持仓成本无关，会把体检结果冲成
     无意义数值（例如把平安银行显示成 48.7 元、银行占比虚高到 86%）。
  2. 情景试算使用「合成行情」并在界面上显著标注演示数据，对齐 PRD 中
     「演示数据 / 历史回测 / 不构成收益承诺」的合规要求。
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from contracts.types import (
    ActionType,
    MarketData,
    MarketSnapshot,
    Portfolio,
    Position,
    Recommendation,
    RiskReport,
    UserProfile,
)
from demo import create_demo_portfolio, create_demo_user

DEMO_TAG = "演示数据"

# 权限级别（对齐 PRD「权限分级映射」：资金操作一律红色）
TIER_LABELS = {
    "green": "绿色权限 · 自动执行",
    "yellow": "黄色权限 · 确认后执行",
    "red": "红色权限 · 强验证后执行",
    "blocked": "风控拦截 · 不可执行",
}


# ============================================================
#  演示用户与组合
# ============================================================


def demo_user() -> UserProfile:
    """演示用户画像（复用 demo 包 fixture，保持单一数据源）"""
    return create_demo_user()


def fresh_portfolio() -> Portfolio:
    """全新的演示组合"""
    pf = create_demo_portfolio()
    recompute_portfolio(pf)
    return pf


def recompute_portfolio(pf: Portfolio) -> None:
    """按持仓现价重算市值、当日收益率（市值加权）与累计收益率（成本口径）"""
    for pos in pf.positions:
        pos.market_value = round(pos.current_price * pos.quantity, 2)
        if pos.avg_cost:
            pos.return_pct = (pos.current_price - pos.avg_cost) / pos.avg_cost * 100
    mv = sum(p.market_value for p in pf.positions)
    pf.total_value = round(mv, 2)
    if mv > 0:
        pf.daily_return = sum(p.market_value * p.day_change_pct for p in pf.positions) / mv
    cost = sum(p.avg_cost * p.quantity for p in pf.positions)
    if cost > 0:
        pf.total_return = sum(
            (p.current_price - p.avg_cost) * p.quantity for p in pf.positions
        ) / cost * 100


def demo_market(pf: Portfolio) -> MarketSnapshot:
    """与组合自洽的演示行情快照：现价 = 持仓现价，涨跌幅 = 持仓当日涨跌幅"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    data = {
        p.symbol: MarketData(
            timestamp=ts,
            symbol=p.symbol,
            name=p.name,
            price=p.current_price,
            change_pct=p.day_change_pct,
            high=round(p.current_price * 1.012, 2),
            low=round(p.current_price * 0.988, 2),
            source="demo",
        )
        for p in pf.positions
    }
    return MarketSnapshot(timestamp=ts, data=data)


def demo_news(pf: Portfolio, limit: int = 6) -> list[dict]:
    """演示资讯——按持仓前两只标的取 mock 新闻并去重"""
    from agent.tools.news import NewsTool

    tool = NewsTool(use_mock=True)
    seen: set[str] = set()
    items: list[dict] = []
    for pos in pf.positions[:2]:
        for n in tool.get_related_news(pos.symbol, limit=limit):
            if n.id in seen:
                continue
            seen.add(n.id)
            items.append({
                "id": n.id,
                "title": n.title,
                "content": n.content,
                "published_at": n.published_at,
                "sentiment": n.sentiment,
                "source": n.source or DEMO_TAG,
                "symbol": pos.symbol,
                "name": pos.name,
            })
    return items[:limit]


# ============================================================
#  序列化（dataclass → 前端 JSON）
# ============================================================


def position_dict(p: Position) -> dict:
    return {
        "symbol": p.symbol,
        "name": p.name,
        "sector": p.sector,
        "asset_type": p.asset_type,
        "quantity": p.quantity,
        "avg_cost": p.avg_cost,
        "current_price": p.current_price,
        "market_value": p.market_value,
        "return_pct": round(p.return_pct, 2),
        "gain_loss": round(p.gain_loss, 2),
        "day_change_pct": round(p.day_change_pct, 2),
    }


def portfolio_dict(pf: Portfolio) -> dict:
    # 行业占比按「持仓市值」口径现算，不依赖 pf.total_value（该字段可能与持仓不同步）
    mv = sum(p.market_value for p in pf.positions)
    buckets: dict[str, float] = {}
    for p in pf.positions:
        sector = p.sector or "未分类"
        buckets[sector] = buckets.get(sector, 0.0) + p.market_value
    alloc = [
        {"sector": s, "value": round(v, 2), "pct": round(v / mv, 4) if mv else 0.0}
        for s, v in sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
    ]
    return {
        "user_id": pf.user_id,
        "date": pf.date,
        "total_value": round(mv, 2),
        "cash": round(pf.cash, 2),
        "total_assets": round(mv + pf.cash, 2),
        "position_count": pf.position_count,
        "daily_return": round(pf.daily_return, 2),
        "total_return": round(pf.total_return, 2),
        "positions": [position_dict(p) for p in pf.positions],
        "sector_allocation": alloc,
        "data_tag": DEMO_TAG,
    }


def risk_dict(rr: Optional[RiskReport]) -> Optional[dict]:
    if rr is None:
        return None
    return {
        "risk_score": round(rr.risk_score, 1),
        "var_95": round(rr.var_95, 2),
        "max_drawdown": round(rr.max_drawdown, 2),
        "sector_concentration": {s: round(v, 4) for s, v in rr.sector_concentration.items()},
        "exceeded_limits": list(rr.exceeded_limits),
        "warnings": list(rr.warnings),
        "forbidden_violations": [p.name for p in rr.forbidden_violations],
        "avg_correlation": rr.avg_correlation,
        "generated_at": rr.generated_at,
    }


def tier_of(rec: Optional[Recommendation], gate=None) -> str:
    """权限判定（对齐 PRD「权限分级映射」）。

      · blocked —— 未通过风控闸门，任何情况下都不放行
      · green   —— 查询/诊断/持有类，无需确认
      · red     —— 资金操作（买入/卖出/调仓），展示详情 + 强验证后方可执行
    """
    if gate is not None and not gate.passed:
        return "blocked"
    if rec is None or rec.action == ActionType.HOLD or rec.quantity <= 0:
        return "green"
    return "red"


def rec_dict(
    rec: Optional[Recommendation],
    name_of: dict[str, str] | None = None,
    gate=None,
) -> Optional[dict]:
    if rec is None:
        return None
    name_of = name_of or {}
    is_hold = rec.action == ActionType.HOLD
    executable = (not is_hold) and rec.quantity > 0 and rec.price > 0
    tier = tier_of(rec, gate)
    if tier == "blocked":
        lot_note = "未通过风控闸门，本建议不可执行"
    elif executable or is_hold:
        lot_note = ""
    else:
        lot_note = "无可执行数量（不足最小交易单位 100 股），本轮不产生实际操作"
    return {
        "action": rec.action.value,
        "symbol": rec.symbol,
        "name": name_of.get(rec.symbol, rec.symbol),
        "quantity": rec.quantity,
        "price": round(rec.price, 2),
        "amount": round(rec.price * rec.quantity, 2),
        "reason": rec.reason,
        "evidence": list(rec.evidence),
        "confidence": round(rec.confidence, 4),
        "risk_impact": rec.risk_impact,
        "alternative": rec.alternative,
        "estimated_impact": rec.estimated_impact,
        "executable": executable and tier != "blocked",
        "lot_note": lot_note,
        "tier": tier,
        "tier_label": TIER_LABELS.get(tier, tier),
    }


def gate_dict(gate) -> Optional[dict]:
    """风控闸门结果——LLM proposes, Python disposes"""
    if gate is None:
        return None
    return {
        "passed": gate.passed,
        "fail_closed": gate.fail_closed,
        "block_count": gate.block_count,
        "blocked_reasons": list(gate.blocked_reasons),
        "warnings": list(gate.warnings),
        "checks": [
            {"name": c.name, "passed": c.passed, "detail": c.detail, "severity": c.severity}
            for c in gate.checks
        ],
    }


def whatif_dict(whatif) -> Optional[dict]:
    """情景推演结果——"执行这条建议会发生什么"（本地确定性计算）"""
    if whatif is None:
        return None
    return {
        "scenario": whatif.scenario,
        "executable": whatif.executable,
        "infeasible_reason": whatif.infeasible_reason,
        "improved_count": whatif.improved_count,
        "worsened_count": whatif.worsened_count,
        "unchanged_count": whatif.unchanged_count,
        "net_risk_delta": round(whatif.net_risk_delta, 2),
        "net_positive": whatif.net_positive,
        "verdict": whatif.verdict,
        "caveats": list(whatif.caveats),
        "deltas": [
            {
                "metric": d.metric,
                "before": round(d.before, 3),
                "after": round(d.after, 3),
                "unit": d.unit,
                "delta": round(d.delta, 3),
                "counted": d.counted,
                "improved": d.improved,
                "text": d.format(),
            }
            for d in whatif.deltas
        ],
    }


def response_dict(resp, pf: Portfolio, health: dict, engine: str) -> dict:
    names = {p.symbol: p.name for p in pf.positions}
    gate = getattr(resp, "gate", None)
    return {
        "session_id": resp.session_id,
        "timestamp": resp.timestamp,
        "recommendation": rec_dict(resp.recommendation, names, gate),
        "reasoning": resp.reasoning,
        "evidence": list(resp.evidence),
        "confidence": round(resp.confidence, 4),
        "risk_alert": resp.risk_alert,
        "requires_approval": resp.requires_approval,
        "approval_id": resp.approval_request.id if resp.approval_request else "",
        "next_actions": list(resp.next_actions),
        "risk_report": risk_dict(resp.risk_report),
        "gate": gate_dict(gate),
        "whatif": whatif_dict(getattr(resp, "whatif", None)),
        "auto_executed": bool(getattr(resp, "executed", False)),
        "assistant_message": getattr(resp, "assistant_message", ""),
        "intent": getattr(resp, "intent", {}),
        "plan": getattr(resp, "plan", {}),
        "breaker": getattr(resp, "circuit_breaker", {}),
        "circuit_locked": bool(getattr(resp, "circuit_locked", False)),
        "portfolio": portfolio_dict(pf),
        "health": health,
        "engine": engine,
        "data_tag": DEMO_TAG,
        # 模型调用透明度（演示/联调模式通用）
        "run_id": getattr(resp, "run_id", ""),
        "decision_source": getattr(resp, "decision_source", ""),
        "model_status": getattr(resp, "model_status", ""),
        "model_raw": dict(getattr(resp, "model_raw", {}) or {}),
    }


def approval_dict(raw: dict, meta: Optional[dict] = None) -> dict:
    """审批请求 JSON（磁盘记录 + 内存补充的建议细节）"""
    rec = raw.get("recommendation", {})
    meta = meta or {}
    return {
        "id": raw.get("id", ""),
        "created_at": raw.get("created_at", ""),
        "status": raw.get("status", "pending"),
        "approver_comment": raw.get("approver_comment", ""),
        "action": rec.get("action", ""),
        "symbol": rec.get("symbol", ""),
        "name": meta.get("name", rec.get("symbol", "")),
        "quantity": rec.get("quantity", 0),
        "price": rec.get("price", 0),
        "amount": round(float(rec.get("price", 0) or 0) * float(rec.get("quantity", 0) or 0), 2),
        "reason": rec.get("reason", ""),
        "confidence": rec.get("confidence", 0),
        "tier": meta.get("tier", "red"),
        "tier_label": TIER_LABELS.get(meta.get("tier", "red"), ""),
        "evidence": meta.get("evidence", []),
        "risk_impact": meta.get("risk_impact", ""),
        "alternative": meta.get("alternative", ""),
        "session_id": meta.get("session_id", ""),
    }


# ============================================================
#  情景推演
# ============================================================
#  注：情景推演由 agent/tools/whatif.py 的 WhatIfEngine 提供（本地确定性计算，
#  把建议应用到组合副本后重算风险指标），Web 层只做序列化，不再自造行情曲线。
