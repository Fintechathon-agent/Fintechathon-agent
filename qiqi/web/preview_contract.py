"""Compatibility adapter for the isolated Finance Lab UI Preview.

The public Pages build speaks ``investment-agent.v1`` while this repository's
native UI speaks ``/api/review``.  This module keeps that boundary explicit:
it only produces a read-only ``HANDOFF_REQUIRED`` response, uses deterministic
synthetic replay data, and never creates an approval or execution request.
"""
from __future__ import annotations

import math
import random
import uuid
from datetime import date, datetime, timedelta
from typing import Any


CONTRACT_VERSION = "investment-agent.v1"
OPERATION = "PORTFOLIO_HEALTH_CHECK"
DATA_MODE = "SYNTHETIC_REPLAY"
WINDOW_DAYS = 20
SIMULATION_PATHS = 2000
TRANSACTION_COST_RATE = 0.0003


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _date(value: Any) -> str:
    text = str(value or "")[:10]
    try:
        date.fromisoformat(text)
        return text
    except ValueError:
        return date.today().isoformat()


def _quantile(values: list[float], probability: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = (len(ordered) - 1) * probability
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def _portfolio_snapshot(raw: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    missing: list[str] = []
    if not isinstance(raw, dict):
        return None, ["input.portfolio"]

    portfolio_id = str(raw.get("portfolio_id") or "preview-demo").strip()
    as_of = _date(raw.get("as_of"))
    cash = _number(raw.get("cash"), math.nan)
    if isinstance(raw.get("cash"), bool) or not math.isfinite(cash) or cash < 0:
        missing.append("input.portfolio.cash")

    positions: list[dict[str, Any]] = []
    source_positions = raw.get("positions")
    if not isinstance(source_positions, list) or not source_positions:
        missing.append("input.portfolio.positions")
        source_positions = []
    for index, item in enumerate(source_positions):
        if not isinstance(item, dict):
            missing.append(f"input.portfolio.positions[{index}]")
            continue
        instrument_id = str(item.get("instrument_id") or item.get("symbol") or "").strip()
        quantity = _number(item.get("quantity"), 0.0)
        price = _number(item.get("price", item.get("current_price")), 0.0)
        if not instrument_id:
            missing.append(f"input.portfolio.positions[{index}].instrument_id")
        if isinstance(item.get("quantity"), bool) or quantity <= 0:
            missing.append(f"input.portfolio.positions[{index}].quantity")
        if isinstance(item.get("price", item.get("current_price")), bool) or price <= 0:
            missing.append(f"input.portfolio.positions[{index}].price")
        if not instrument_id or quantity <= 0 or price <= 0:
            continue
        positions.append({
            "instrument_id": instrument_id,
            "type": str(item.get("type") or item.get("asset_type") or "stock"),
            "quantity": quantity,
            "price": price,
            "name": str(item.get("name") or instrument_id),
            "sector": str(item.get("sector") or "未分类"),
        })

    invested = sum(item["quantity"] * item["price"] for item in positions)
    total_assets = invested + cash
    if total_assets <= 0:
        missing.append("input.portfolio.total_assets")
    if missing:
        return None, missing

    for item in positions:
        item["market_value"] = round(item["quantity"] * item["price"], 2)
        item["weight"] = item["market_value"] / total_assets
    snapshot = {
        "portfolio_id": portfolio_id,
        "as_of": as_of,
        "cash": round(cash, 2),
        "total_value": round(invested, 2),
        "total_assets": round(total_assets, 2),
        "cash_weight": round(cash / total_assets, 6),
        "positions": positions,
        "data_mode": DATA_MODE,
        "source": "local demo fixture",
    }
    return snapshot, []


def portfolio_contract_from_dict(portfolio: dict[str, Any]) -> dict[str, Any]:
    """Convert the repository's ``portfolio_dict`` into the Preview shape."""
    positions = []
    for item in portfolio.get("positions", []):
        positions.append({
            "instrument_id": item.get("symbol", ""),
            "type": item.get("asset_type", "stock"),
            "quantity": item.get("quantity", 0),
            "price": item.get("current_price", 0),
            "name": item.get("name", item.get("symbol", "")),
            "sector": item.get("sector", "未分类"),
            "market_value": item.get("market_value", 0),
            "weight": 0.0,
        })
    raw = {
        "portfolio_id": portfolio.get("user_id", "preview-demo"),
        "as_of": portfolio.get("date", date.today().isoformat()),
        "cash": portfolio.get("cash", 0),
        "positions": positions,
    }
    snapshot, missing = _portfolio_snapshot(raw)
    if snapshot is None:
        raise ValueError("演示组合无法转换为 Preview 契约：" + "、".join(missing))
    snapshot["data_mode"] = DATA_MODE
    snapshot["source"] = "local demo fixture"
    return snapshot


def _weights(snapshot: dict[str, Any]) -> dict[str, float]:
    return {item["instrument_id"]: float(item["weight"]) for item in snapshot["positions"]}


def _candidate_weights(snapshot: dict[str, Any]) -> dict[str, dict[str, float]]:
    current = _weights(snapshot)
    if not current:
        return {key: {} for key in ("CURRENT", "A", "B", "C")}
    invested_total = sum(current.values())
    largest = max(current, key=current.get)

    a = dict(current)
    b = dict(current)
    shift = min(b[largest] * 0.25, 0.10)
    b[largest] -= shift
    others = [key for key in b if key != largest]
    if others:
        base = sum(b[key] for key in others) or 1.0
        for key in others:
            b[key] += shift * b[key] / base

    c = dict(current)
    for key, value in list(c.items()):
        if value > 0.25:
            c[key] = 0.25
    remainder = max(0.0, invested_total - sum(c.values()))
    while remainder > 1e-9:
        receivers = [key for key, value in c.items() if value < 0.25 - 1e-9]
        capacity = sum(0.25 - c[key] for key in receivers)
        if not receivers or capacity <= 1e-9:
            break
        allocated = 0.0
        for key in receivers:
            add = min(0.25 - c[key], remainder * (0.25 - c[key]) / capacity)
            c[key] += add
            allocated += add
        if allocated <= 1e-12:
            break
        remainder -= allocated

    # Keep the same cash weight in every plan; cash is intentionally omitted
    # from this map and is represented by ``cash_weight`` in the snapshot.
    return {"CURRENT": a, "A": a, "B": b, "C": c}


def _daily_returns(snapshot: dict[str, Any]) -> dict[str, list[float]]:
    """A fixed synthetic replay series, never presented as live market data."""
    series: dict[str, list[float]] = {}
    for index, item in enumerate(snapshot["positions"]):
        phase = (sum(ord(char) for char in item["instrument_id"]) % 17) / 17
        values = []
        for day in range(WINDOW_DAYS):
            seasonal = math.sin((day + phase * 3.0) * 0.72 + index) * 0.0012
            drift = (index - 2) * 0.00008
            values.append(seasonal + drift)
        series[item["instrument_id"]] = values
    return series


def _curve(weights: dict[str, float], returns: dict[str, list[float]], as_of: str) -> tuple[list[dict[str, Any]], dict[str, float]]:
    curve = [{"date": as_of, "value": 1.0}]
    daily: list[float] = []
    value = 1.0
    for day in range(WINDOW_DAYS):
        daily_return = sum(weight * returns.get(symbol, [0.0] * WINDOW_DAYS)[day] for symbol, weight in weights.items())
        daily_return -= TRANSACTION_COST_RATE * (0.02 if day == 0 else 0.0)
        daily.append(daily_return)
        value *= 1.0 + daily_return
        curve.append({
            "date": (datetime.fromisoformat(as_of) + timedelta(days=day + 1)).date().isoformat(),
            "value": round(value, 8),
        })
    peak = 1.0
    max_drawdown = 0.0
    for point in curve:
        peak = max(peak, point["value"])
        max_drawdown = max(max_drawdown, (peak - point["value"]) / peak)
    variance = sum((item - (sum(daily) / len(daily))) ** 2 for item in daily) / max(1, len(daily) - 1)
    metrics = {
        "cumulative_return": round(value - 1.0, 8),
        "max_drawdown": round(-max_drawdown, 8),
        "annualized_volatility": round(math.sqrt(max(variance, 0.0)) * math.sqrt(252), 8),
    }
    return curve, metrics


def _scenario_distribution(daily: list[float], seed: int) -> dict[str, float]:
    rng = random.Random(seed)
    paths: list[float] = []
    block = 3
    for _ in range(SIMULATION_PATHS):
        value = 1.0
        day = 0
        while day < WINDOW_DAYS:
            start = rng.randrange(max(1, len(daily) - block + 1))
            for ret in daily[start:start + block]:
                if day >= WINDOW_DAYS:
                    break
                value *= 1.0 + ret
                day += 1
        paths.append(value - 1.0)
    return {"p10": round(_quantile(paths, 0.10), 8), "p50": round(_quantile(paths, 0.50), 8), "p90": round(_quantile(paths, 0.90), 8)}


def _audit(task_id: str, session_id: str, request_id: str, timestamp: str) -> dict[str, Any]:
    events = []
    for event_type, actor in (
        ("session.created", "core"),
        ("contract.accepted", "core"),
        ("stage.started", "core"),
        ("stage.completed", "core"),
        ("checkpoint.saved", "core"),
        ("risk.handoff", "core"),
    ):
        events.append({
            "event_id": _id("evt"),
            "event_type": event_type,
            "task_id": task_id,
            "session_id": session_id,
            "request_id": request_id,
            "timestamp": timestamp,
            "actor": actor,
        })
    return {"task_id": task_id, "events": events}


def health_check_response(payload: dict[str, Any], portfolio: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a safe read-only response for the public Preview contract."""
    request_id = str(payload.get("request_id") or _id("req"))
    task_id = _id("task")
    session_id = str(payload.get("context", {}).get("session_id") or _id("sess"))
    timestamp = datetime.now().isoformat(timespec="seconds")
    raw_portfolio = payload.get("input", {}).get("portfolio") if isinstance(payload.get("input"), dict) else None
    missing: list[str] = []
    if not isinstance(raw_portfolio, dict) and portfolio is None:
        missing.append("input.portfolio")
    snapshot, portfolio_missing = _portfolio_snapshot(raw_portfolio or portfolio or {})
    missing.extend(portfolio_missing)
    risk_profile = payload.get("input", {}).get("risk_profile") if isinstance(payload.get("input"), dict) else None
    if not isinstance(risk_profile, dict):
        missing.append("input.risk_profile")
    else:
        for field in ("investment_horizon_days", "max_drawdown", "liquidity_need"):
            if risk_profile.get(field) in (None, ""):
                missing.append(f"input.risk_profile.{field}")

    trace = {"task_id": task_id, "session_id": session_id, "request_id": request_id, "data_mode": DATA_MODE}
    if missing or snapshot is None:
        state = {
            "contract_version": CONTRACT_VERSION,
            "task_id": task_id, "session_id": session_id, "status": "WAITING_INPUT",
            "stage": "INPUT", "checkpoint": "INPUT", "execution_allowed": False,
            "missing_fields": sorted(set(missing)),
        }
        audit = _audit(task_id, session_id, request_id, timestamp)
        return {
            "contract_version": CONTRACT_VERSION, "operation": OPERATION,
            "request_id": request_id, "context": {"data_mode": DATA_MODE},
            "task_state": state, "trace": trace, "audit_evidence": audit,
        }

    returns = _daily_returns(snapshot)
    plans = _candidate_weights(snapshot)
    comparisons: list[dict[str, Any]] = []
    scenarios: list[dict[str, Any]] = []
    daily_by_plan: dict[str, list[float]] = {}
    current = plans["CURRENT"]
    for plan_index, plan_id in enumerate(("CURRENT", "A", "B", "C")):
        weights = plans[plan_id]
        curve, metrics = _curve(weights, returns, snapshot["as_of"])
        daily = [(curve[i + 1]["value"] / curve[i]["value"] - 1.0) for i in range(len(curve) - 1)]
        daily_by_plan[plan_id] = daily
        turnover = 0.0 if plan_id == "CURRENT" else sum(abs(weights.get(key, 0.0) - current.get(key, 0.0)) for key in set(weights) | set(current)) / 2
        comparisons.append({"plan_id": plan_id, "metrics": metrics, "turnover": round(turnover, 8), "curve": curve})
        scenarios.append({"plan_id": plan_id, "distribution": _scenario_distribution(daily, 20261016 + plan_index)})

    top = sorted(snapshot["positions"], key=lambda item: item["weight"], reverse=True)
    by_sector: dict[str, float] = {}
    for item in snapshot["positions"]:
        by_sector[item["sector"]] = by_sector.get(item["sector"], 0.0) + item["weight"]
    baseline_metrics = comparisons[0]["metrics"]
    health_report = {
        "concentration": {
            "largest_instrument": top[0]["instrument_id"],
            "top_1": round(top[0]["weight"], 8),
            "top_3": round(sum(item["weight"] for item in top[:3]), 8),
            "by_sector": {key: round(value, 8) for key, value in by_sector.items()},
        },
        "metrics": {
            "max_drawdown": baseline_metrics["max_drawdown"],
            "annualized_volatility": baseline_metrics["annualized_volatility"],
        },
        "hidden_clusters": [],
        "data_mode": DATA_MODE,
    }
    state = {
        "contract_version": CONTRACT_VERSION,
        "task_id": task_id, "session_id": session_id, "status": "HANDOFF_REQUIRED",
        "stage": "RISK_HANDOFF", "checkpoint": "RISK", "execution_allowed": False,
        "missing_fields": [],
    }
    audit = _audit(task_id, session_id, request_id, timestamp)
    return {
        "contract_version": CONTRACT_VERSION,
        "operation": OPERATION,
        "request_id": request_id,
        "context": {"actor": "agent", "environment": "demo", "data_mode": DATA_MODE, "task_id": task_id, "session_id": session_id},
        "data_mode": DATA_MODE,
        "task_state": state,
        "trace": trace,
        "risk_handoff": {
            "task_id": task_id, "session_id": session_id, "status": "REVIEW",
            "checkpoint": "RISK", "execution_allowed": False,
            "reason": "仅完成本地只读诊断，未接入团队 Risk 审核或审批网关。",
        },
        "artifacts": {
            "portfolio_snapshot": snapshot,
            "health_report": health_report,
            "candidates": [
                {"plan_id": plan_id, "target_weights": {key: round(value, 8) for key, value in weights.items()}}
                for plan_id, weights in plans.items() if plan_id != "CURRENT"
            ],
            "simulation": {
                "comparisons": comparisons,
                "scenarios": scenarios,
                "assumptions": {
                    "initial_capital": snapshot["total_assets"],
                    "window_days": WINDOW_DAYS,
                    "annualization": 252,
                    "risk_free_rate": 0.02,
                    "paths": SIMULATION_PATHS,
                    "seed": 20261016,
                    "data_mode": DATA_MODE,
                },
                "transaction_cost_rate": TRANSACTION_COST_RATE,
            },
        },
        "tool_results": {
            "portfolio": {"status": "SUCCEEDED", "data_mode": DATA_MODE},
            "risk": {"status": "REVIEW", "execution_allowed": False},
            "simulation": {"status": "SUCCEEDED", "data_mode": DATA_MODE, "paths": SIMULATION_PATHS},
        },
        "audit_evidence": audit,
    }


def error_response(message: str, code: str = "REQUEST_FAILED") -> dict[str, Any]:
    return {"status": "error", "error": {"code": code, "message": message, "recovery": "请补齐请求字段后重试。"}}
