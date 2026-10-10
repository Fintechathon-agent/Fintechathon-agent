"""用户端 Web 服务——持仓哨兵（模块5：Launcher / Demo）。

只依赖 Python 标准库 http.server，不引入 FastAPI/Flask/pydantic，
保证比赛演示机器零安装即可启动：

    python web/app.py                 # http://127.0.0.1:8765
    python web/launch.py              # 推荐：注入密钥 + 自动开浏览器

职责边界：
  · 把 Orchestrator 与各模块输出翻译成前端 JSON（不改动各模块内部实现）
  · 权限确认闸门：资金操作一律经用户确认（红色权限含演示版强验证）后才执行纸交易
  · 审计时间线 / 四层记忆 / 纸交易记录的读取与展示
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional
from urllib.parse import urlparse

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from agent.config_fund import load_fund_config           # noqa: E402
from agent.core.intent import DEFAULT_QUESTION              # noqa: E402
from agent.orchestrator import build_orchestrator        # noqa: E402
from agent.risk.circuit_breaker import get_breaker       # noqa: E402
from contracts.types import ActionType, Portfolio, Position  # noqa: E402
from web.demo_data import (                              # noqa: E402
    DEMO_TAG,
    approval_dict,
    demo_market,
    demo_news,
    demo_user,
    fresh_portfolio,
    portfolio_dict,
    rec_dict,
    recompute_portfolio,
    response_dict,
    tier_of,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
logger = logging.getLogger("web")

USER_ID = "demo_user"

ACTION_LABELS = {
    "portfolio_review": "发起组合体检",
    "paper_trade_execution": "纸交易执行回执",
    "strong_verification": "红色权限 · 强验证（演示 Mock）",
    "user_confirmation": "用户确认执行",
    "approval_rejected": "用户拒绝建议",
    "portfolio_updated": "组合按成交结果更新",
    "demo_reset": "重置演示状态",
    "memory_write_rejected": "记忆写入被门卫拦截",
    "breaker_locked": "异常熔断 · 执行链路锁定",
    "breaker_reset": "熔断 · 人工确认恢复",
}


# ============================================================
#  应用状态
# ============================================================


class DemoApp:
    """单用户演示应用：持有 Orchestrator、演示组合与审批补充信息"""

    def __init__(self, config_path: Optional[str] = None):
        self.cfg = load_fund_config(config_path or None)
        # 演示场景：LLM 不可用时快速失败并降级为规则决策，避免界面长时间等待
        self.cfg.llm.timeout = min(self.cfg.llm.timeout, 60)
        self.cfg.llm.max_retries = min(self.cfg.llm.max_retries, 2)

        self.llm = None
        if self.cfg.llm.has_api_key:
            try:
                from agent.llm import LLMClient
                self.llm = LLMClient(self.cfg.llm)
                logger.info("LLM 已接入：%s @ %s", self.cfg.llm.model, self.cfg.llm.base_url)
            except Exception as exc:      # noqa: BLE001
                logger.warning("LLM 初始化失败，降级为规则决策：%s", exc)

        self.orch = build_orchestrator(llm_client=self.llm, config_path=config_path or None)
        # 权限闸门：置信度上限为 1.0，阈值取 1.01 表示「所有建议先进入确认流程」，
        # 由 Web 层按 PRD 权限分级决定执行——资金操作必须用户明确确认，
        # 后端不再自行执行纸交易。
        self.orch.loop.approval_threshold = 1.01

        self.state = SimpleNamespace(
            portfolio=self._rehydrate_portfolio(),
            last_health=None,
            last_review=None,
            approval_meta={},
            lock=threading.RLock(),
        )

        # 行情来源改用「与演示组合同源自洽」的快照。
        # 工厂默认接的是 mock 行情（价格由代码哈希派生、与持仓成本无关），
        # 会让体检结果在多次运行之间漂移：同一份组合两次体检读出不同盈亏，
        # 演示不可复现，且建议价与组合现价不一致。这里换成组合自身现价，
        # 数字自洽、结果可复现。接入真实行情源时撤掉这行即可。
        self.orch.loop.market_fetcher = lambda symbols: demo_market(self.state.portfolio)

        # 重启后把磁盘上的审批补回内存元数据，否则待确认卡片会变成孤儿：
        # 点「确认执行」只写纸交易、不更新组合，用户看不出哪里出了问题。
        self._rehydrate_approvals()

        self._refresh_health()

    def _rehydrate_portfolio(self) -> Portfolio:
        """从持久化的纸交易记录重建演示组合。

        重启后内存组合会退回初始 fixture，而纸交易记录仍在磁盘上——
        若不管，「持仓明细」与「纸交易记录」会互相矛盾（成交过却还在持仓）。
        每次运行的起点都是同一份 fixture，因此按时间顺序重放成交即可还原。
        """
        pf = fresh_portfolio()
        rows: list[dict] = []
        d = Path(self.cfg.paper_trade_dir)
        if d.exists():
            for f in d.glob("*_trades.jsonl"):
                try:
                    for line in f.read_text(encoding="utf-8").splitlines():
                        if line.strip():
                            rows.append(json.loads(line))
                except (OSError, json.JSONDecodeError):
                    continue
        if not rows:
            return pf

        rows.sort(key=lambda r: r.get("timestamp", ""))
        fixture_names = {p.symbol: p.name for p in pf.positions}
        for r in rows:
            action = r.get("action", "")
            sym = r.get("symbol", "")
            qty = float(r.get("quantity", 0) or 0)
            price = float(r.get("price", 0) or 0)
            if not sym or qty <= 0 or price <= 0:
                continue
            if action == ActionType.SELL.value:
                for i, p in enumerate(pf.positions):
                    if p.symbol != sym:
                        continue
                    sold = min(p.quantity, qty)
                    p.quantity -= sold
                    pf.cash += round(sold * price, 2)
                    if p.quantity <= 0:
                        pf.positions.pop(i)
                    break
            elif action == ActionType.BUY.value:
                cost = round(qty * price, 2)
                if cost > pf.cash:
                    continue
                pf.cash -= cost
                for p in pf.positions:
                    if p.symbol == sym:
                        total = p.avg_cost * p.quantity + price * qty
                        p.quantity += qty
                        p.avg_cost = total / p.quantity
                        break
                else:
                    pf.positions.append(Position(
                        symbol=sym, name=fixture_names.get(sym, sym), quantity=qty,
                        avg_cost=price, current_price=price, market_value=price * qty,
                        return_pct=0.0, sector="未分类",
                    ))
        recompute_portfolio(pf)
        logger.info("已按 %d 笔历史纸交易还原组合", len(rows))
        return pf

    def _rehydrate_approvals(self) -> None:
        """把磁盘上仍未处理的审批补回内存元数据。

        ApprovalManager 只持久化建议本身（动作/数量/价格），名称、证据、
        权限级别等展示与执行所需的信息在内存里。重启后缺了这些，
        _apply_fill 会因拿不到标的信息而静默跳过，组合不更新。
        """
        d = Path(self.cfg.approval_dir)
        if not d.exists():
            return
        names = {p.symbol: p.name for p in self.state.portfolio.positions}
        restored = 0
        for f in d.glob("*.json"):
            try:
                raw = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if raw.get("status") != "pending":
                continue
            aid = raw.get("id", "")
            rec = raw.get("recommendation", {}) or {}
            action = rec.get("action", "")
            sym = rec.get("symbol", "")
            if not aid or not action:
                continue
            self.state.approval_meta[aid] = {
                "tier": "red" if action in (ActionType.BUY.value, ActionType.SELL.value) else "green",
                "name": names.get(sym, sym),
                "evidence": [],          # 未持久化，界面留空而非编造
                "risk_impact": "",
                "alternative": "",
                "session_id": "",
                "recommendation": {
                    "action": action, "symbol": sym,
                    "name": names.get(sym, sym),
                    "quantity": rec.get("quantity", 0),
                    "price": rec.get("price", 0),
                    "reason": rec.get("reason", ""),
                },
            }
            restored += 1
        if restored:
            logger.info("已恢复 %d 条待确认审批的元数据", restored)

    # ---- 基础 ----

    def engine_info(self) -> dict:
        if self.llm is not None:
            return {
                "kind": "llm",
                "label": f"FinancialLLM · {self.cfg.llm.model}",
                "note": "调用失败时自动降级为规则决策",
            }
        return {
            "kind": "rules",
            "label": "规则引擎（未配置 LLM Key）",
            "note": "设置 DEEPSEEK_API_KEY 后自动切换为 LLM 决策",
        }

    def _log(self, action: str, session_id: str, detail: dict, result: str = "success") -> None:
        try:
            self.orch.audit.log(
                action=action, user_id=USER_ID, session_id=session_id,
                detail=detail, result=result,
            )
        except Exception as exc:      # noqa: BLE001
            logger.warning("写审计日志失败：%s", exc)

    def _refresh_health(self) -> dict:
        recompute_portfolio(self.state.portfolio)
        snapshot = demo_market(self.state.portfolio)
        raw = self.orch.get_portfolio_health(self.state.portfolio, snapshot)
        names = {p.symbol: p.name for p in self.state.portfolio.positions}
        health = {
            "total_value": round(raw["total_value"], 2),
            "cash": round(raw["cash"], 2),
            "position_count": raw["position_count"],
            "winning_positions": raw["winning_positions"],
            "losing_positions": raw["losing_positions"],
            "top_gain": {
                "symbol": raw["top_gain"][0],
                "name": names.get(raw["top_gain"][0], raw["top_gain"][0]),
                "return_pct": round(raw["top_gain"][1], 2),
            },
            "top_loss": {
                "symbol": raw["top_loss"][0],
                "name": names.get(raw["top_loss"][0], raw["top_loss"][0]),
                "return_pct": round(raw["top_loss"][1], 2),
            },
            "sector_concentration": {s: round(v, 4) for s, v in raw["sector_concentration"].items()},
            "avg_return": round(raw["avg_return"], 2),
            "risk_warnings": list(raw["risk_warnings"]),
            "reasoning": raw["reasoning"],
            "next_actions": list(raw["next_actions"]),
        }
        self.state.last_health = health
        return health

    @staticmethod
    def _tier_matrix() -> list[dict]:
        """权限分级映射（对齐 PRD「权限分级映射」章节）"""
        return [
            {
                "tier": "green", "label": "绿色权限",
                "items": "收益与持仓查询、组合诊断、模拟试算、简报生成、审计查询",
                "policy": "确认意图后自动执行，无需二次确认",
            },
            {
                "tier": "yellow", "label": "黄色权限",
                "items": "保存模拟方案、修改监护提醒规则、调整信号阈值",
                "policy": "执行前展示操作详情并获得明确确认（本轮 Demo 未开放）",
            },
            {
                "tier": "red", "label": "红色权限",
                "items": "基金/股票申购、赎回、转换（本 Demo 全程为纸交易）",
                "policy": "展示详情 + 多因子强验证（短信 + 人脸，演示为 Mock）后方可执行",
            },
        ]

    def brief(self) -> dict:
        """今日简报（P0 功能，文本版；TTS 为 Optional 未接）"""
        pf = self.state.portfolio
        h = self.state.last_health or self._refresh_health()
        lines = [
            f"组合总资产 {pf.total_value + pf.cash:,.0f} 元"
            f"（持仓市值 {pf.total_value:,.0f} + 现金 {pf.cash:,.0f}）",
            f"持仓 {h['position_count']} 只，盈利 {h['winning_positions']} / 亏损 {h['losing_positions']}，"
            f"平均收益率 {h['avg_return']:+.2f}%",
        ]
        if h["risk_warnings"]:
            lines.append("风险提示：" + "；".join(h["risk_warnings"]))
        if h["next_actions"]:
            lines.append("下一步建议：" + "；".join(h["next_actions"]))
        mem = ""
        try:
            mem = self.orch.memory.get_memory_summary(USER_ID)
        except Exception:      # noqa: BLE001
            pass
        if mem and mem != "无记忆记录":
            lines.append(f"长期记忆：{mem}")
        return {
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "lines": lines,
            "disclaimer": "演示数据，不构成投资建议。",
        }

    # ---- 接口 ----

    def bootstrap(self) -> dict:
        with self.state.lock:
            pf = self.state.portfolio
            health = self._refresh_health()
            return {
                "meta": {
                    "engine": self.engine_info(),
                    "data_tag": DEMO_TAG,
                    "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "disclaimer": "演示环境：不连接真实账户，不执行真实资金交易；"
                                  "行情与情景数据均为演示数据，不构成收益承诺。",
                },
                "user": {
                    "user_id": USER_ID,
                    "name": demo_user().name,
                    "risk_tolerance": demo_user().risk_tolerance.value,
                    "investment_horizon": demo_user().investment_horizon,
                    "max_single_loss": demo_user().max_single_loss,
                    "max_total_loss": demo_user().max_total_loss,
                    "forbidden_sectors": demo_user().forbidden_sectors,
                },
                "portfolio": portfolio_dict(pf),
                "health": health,
                "news": demo_news(pf),
                "brief": self.brief(),
                "memory_summary": self._memory_summary(),
                "approvals": self.list_approvals(),
                "tier_matrix": self._tier_matrix(),
                "breaker": get_breaker().state(),
            }

    def review(self, question: str = "") -> dict:
        """执行一次完整组合体检（Golden Path）：分析 → 风控 → 决策 → 权限判定"""
        with self.state.lock:
            user = demo_user()
            pf = self.state.portfolio
            recompute_portfolio(pf)
            snapshot = demo_market(pf)
            health = self._refresh_health()

            # Golden Path：Portfolio 快照写入 fact 层长期记忆
            try:
                self.orch.memory.save_portfolio_snapshot(user.user_id, pf)
            except Exception as exc:      # noqa: BLE001
                logger.warning("写入 fact 层记忆失败：%s", exc)

            started = time.time()
            resp = self.orch.handle_review_request(
                user, pf, question=question or DEFAULT_QUESTION
            )
            elapsed_ms = int((time.time() - started) * 1000)

            # 权限闸门：只有「通过风控闸门」且「确实是资金操作」的建议才进入确认队列。
            # 持有类建议与闸门拦截的建议都不占用审批队列。
            queued = False
            rec = resp.recommendation
            gate = getattr(resp, "gate", None)
            tier = tier_of(rec, gate)
            if resp.approval_request is not None and tier == "red" and rec is not None:
                try:
                    self.orch.approvals.submit(resp.approval_request)
                    queued = True
                    self.state.approval_meta[resp.approval_request.id] = {
                        "tier": tier,
                        "name": {p.symbol: p.name for p in pf.positions}.get(rec.symbol, rec.symbol),
                        "evidence": list(rec.evidence),
                        "risk_impact": rec.risk_impact,
                        "alternative": rec.alternative,
                        "session_id": resp.session_id,
                        "recommendation": rec_dict(rec, gate=gate),
                    }
                except Exception as exc:      # noqa: BLE001
                    logger.warning("审批请求落盘失败：%s", exc)

            data = response_dict(resp, pf, health, self.engine_info()["label"])
            data["queued"] = queued
            data["elapsed_ms"] = elapsed_ms
            data["data_tag"] = DEMO_TAG
            data["breaker"] = getattr(resp, "circuit_breaker", None) or get_breaker().state()
            self.state.last_review = data
            return data

    # ---- 审批 ----

    def list_approvals(self) -> list[dict]:
        """待确认队列。同一笔操作（动作 + 标的 + 数量）只保留最新一条，
        旧的在落盘层标记为被替代，避免反复体检堆出重复卡片。"""
        pending: list[tuple[dict, dict]] = []
        d = Path(self.cfg.approval_dir)
        if d.exists():
            for f in d.glob("*.json"):
                try:
                    raw = json.loads(f.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if raw.get("status") != "pending":
                    continue
                pending.append((raw, self.state.approval_meta.get(raw.get("id", ""))))

        pending.sort(key=lambda r: r[0].get("created_at", ""), reverse=True)
        seen: set[tuple] = set()
        out: list[dict] = []
        for raw, meta in pending:
            key = (raw.get("recommendation", {}).get("action"),
                   raw.get("recommendation", {}).get("symbol"),
                   raw.get("recommendation", {}).get("quantity"))
            if key in seen:
                self._supersede(raw.get("id", ""))
                continue
            seen.add(key)
            out.append(approval_dict(raw, meta))
        return out

    def _supersede(self, approval_id: str) -> None:
        """把被新建议取代的旧审批标记掉（保留记录，状态置为 rejected 并注明原因）"""
        try:
            self.orch.approvals.reject(approval_id, "已被同一操作的新建议取代")
            self.state.approval_meta.pop(approval_id, None)
        except Exception as exc:      # noqa: BLE001
            logger.warning("取代旧审批失败 %s：%s", approval_id, exc)

    def decide(self, payload: dict) -> dict:
        """用户对建议的最终裁决：确认执行（含红色权限强验证）或拒绝"""
        approval_id = str(payload.get("id", "")).strip()
        if not approval_id:
            return {"success": False, "message": "缺少审批 ID"}
        approved = bool(payload.get("approved"))
        comment = str(payload.get("comment", "")).strip()

        # 熔断锁定期间拒绝一切裁决（fail-closed，需先人工恢复）
        if approved and get_breaker().is_locked():
            return {
                "success": False,
                "message": "⛔ 系统熔断锁定中：连续安全事件超过阈值，已暂停执行链路，请先人工确认恢复。",
            }

        meta = self.state.approval_meta.get(approval_id, {})
        tier = meta.get("tier", "red")

        if not approved:
            result = self.orch.handle_approval_response(approval_id, False, comment)
            self._mark_feedback(meta.get("session_id", ""), False, comment)
            self._log("approval_rejected", approval_id,
                      {"reason": comment or "用户拒绝该建议", "tier": tier})
            meta.pop(approval_id, None)
            return {**result, "tier": tier, "executed": False}

        # 红色权限：多因子强验证（短信 + 人脸，演示为 Mock）
        if tier == "red":
            sms = str(payload.get("verification", {}).get("sms_code", "")).strip()
            face = bool(payload.get("verification", {}).get("face_verified"))
            sms_ok = len(sms) == 6 and sms.isdigit()
            passed = sms_ok and face
            self._log(
                "strong_verification", approval_id,
                {
                    "method": "短信验证码 + 人脸识别",
                    "channel": "Mock（演示环境不发送真实短信）",
                    "sms_code_ok": sms_ok, "face_ok": face,
                },
                result="success" if passed else "failure",
            )
            if not passed:
                # 强验证连续失败属"可疑行为"——计入熔断（赛题：连续失败触发安全锁定）
                get_breaker().record_failure(
                    "strong_verify_failed",
                    {"approval_id": approval_id, "sms_code_ok": sms_ok, "face_ok": face},
                    USER_ID,
                )
                return {
                    "success": False, "tier": tier, "executed": False,
                    "breaker": get_breaker().state(),
                    "message": "强验证未通过：需要 6 位短信验证码并完成人脸识别（演示为 Mock）。",
                }
            self._log("user_confirmation", approval_id,
                      {"tier": "red", "note": "用户确认执行，强验证通过（演示）"})

        result = self.orch.handle_approval_response(approval_id, True, comment)
        executed = bool(result.get("success"))
        if executed:
            self._apply_fill(approval_id)
            self._mark_feedback(meta.get("session_id", ""), True, comment)
            meta.pop(approval_id, None)
        return {
            **result,
            "tier": tier,
            "executed": executed,
            "portfolio": portfolio_dict(self.state.portfolio),
            "trades": self.trades(limit=10),
        }

    def _mark_feedback(self, session_id: str, approved: bool, comment: str) -> None:
        """把用户的裁决结果回写到建议历史与经验层记忆。

        闭环的后半段：没有这一步，建议历史永远停在「待确认」，
        经验层的 outcome 也停留在 pending，Agent 无法从拒绝/采纳中学习。
        通过 session_id 定位本次体检写入的那条建议，再走 memory 的反馈接口。
        """
        if not session_id:
            return
        path = Path(self.cfg.memory_dir) / USER_ID / "recommendations.json"
        if not path.exists():
            return
        try:
            records = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        for rec in reversed(records):
            if rec.get("session_id") == session_id and rec.get("approved") is None:
                try:
                    self.orch.memory.update_feedback(
                        USER_ID, rec.get("timestamp", ""), approved, comment,
                    )
                except Exception as exc:      # noqa: BLE001
                    logger.warning("回写建议反馈失败：%s", exc)
                return

    @staticmethod
    def _resolve_direction(action: str, rec: dict, pf) -> str:
        """把建议动作归一成「买入」或「卖出」两个执行方向。

        「调仓」本身不含方向，而单个建议对象只带一个标的和数量，无法表达多腿调仓。
        提示词已要求 LLM 直接给出买卖方向，这里作为兜底：先看建议文本里的方向字眼，
        仍不明确时按持仓关系推断（已持有视为减仓，未持有视为建仓）。
        """
        if action in (ActionType.BUY.value, ActionType.SELL.value):
            return action
        text = " ".join(str(rec.get(k, "")) for k in ("reason", "risk_impact", "alternative"))
        buy_hints = ("买入", "加仓", "增持", "建仓", "补仓")
        sell_hints = ("卖出", "减仓", "减持", "清仓", "止损", "止盈")
        has_buy = any(w in text for w in buy_hints)
        has_sell = any(w in text for w in sell_hints)
        if has_sell and not has_buy:
            return ActionType.SELL.value
        if has_buy and not has_sell:
            return ActionType.BUY.value
        return ActionType.SELL.value if any(p.symbol == rec.get("symbol") for p in pf.positions) \
            else ActionType.BUY.value

    def _apply_fill(self, approval_id: str) -> None:
        """把成交结果落到演示组合上（Golden Path：Portfolio 与长期 Memory 更新）"""
        meta = self.state.approval_meta.get(approval_id) or {}
        rec = meta.get("recommendation") or {}
        raw_action = rec.get("action", "")
        sym = rec.get("symbol", "")
        pf = self.state.portfolio
        action = self._resolve_direction(raw_action, rec, pf)
        if action != raw_action:
            self._log("direction_resolved", approval_id, {
                "原始动作": raw_action or "（空）",
                "归一方向": action,
                "说明": "单笔建议必须带明确方向，已按建议文本与持仓关系归一",
            })
        qty = float(rec.get("quantity", 0) or 0)
        price = float(rec.get("price", 0) or 0)
        if not sym or qty <= 0 or price <= 0:
            return

        pf = self.state.portfolio
        if action == ActionType.SELL.value:
            for i, p in enumerate(pf.positions):
                if p.symbol != sym:
                    continue
                sell_qty = min(p.quantity, qty)
                p.quantity -= sell_qty
                pf.cash += round(sell_qty * price, 2)
                if p.quantity <= 0:
                    pf.positions.pop(i)
                break
        elif action == ActionType.BUY.value:
            budget = min(pf.cash, qty * price)
            buy_qty = int(budget / price / 100) * 100     # A 股一手 100 股
            if buy_qty <= 0:
                return
            pf.cash -= round(buy_qty * price, 2)
            for p in pf.positions:
                if p.symbol == sym:
                    total_cost = p.avg_cost * p.quantity + price * buy_qty
                    p.quantity += buy_qty
                    p.avg_cost = total_cost / p.quantity
                    break
            else:
                pf.positions.append(Position(
                    symbol=sym, name=rec.get("name", sym), quantity=buy_qty,
                    avg_cost=price, current_price=price, market_value=price * buy_qty,
                    return_pct=0.0, sector="未分类",
                ))
        recompute_portfolio(pf)
        self._log("portfolio_updated", approval_id, {
            "action": action, "symbol": sym, "quantity": qty, "price": price,
            "note": "组合已按成交结果更新（演示）",
        })

    def breaker_reset(self) -> dict:
        """熔断人工恢复——用户确认系统状态无异常后解锁。"""
        state = get_breaker().reset(note="用户人工确认恢复")
        self._log("breaker_reset", "", {"note": "用户人工确认恢复"}, "success")
        return {"success": True, "breaker": state, "message": "熔断已解除，执行链路恢复。"}

    def reset(self) -> dict:
        """重置演示状态：仅清空审批与纸交易记录，长期记忆不删除"""
        with self.state.lock:
            removed = 0
            for pattern, folder in (("*.json", self.cfg.approval_dir),
                                    ("*_trades.jsonl", self.cfg.paper_trade_dir)):
                d = Path(folder)
                if not d.exists():
                    continue
                for f in d.glob(pattern):
                    try:
                        f.unlink()
                        removed += 1
                    except OSError:
                        pass
            self.state.approval_meta.clear()
            self.state.last_review = None
            self.state.portfolio = fresh_portfolio()
            self._refresh_health()
            self._log("demo_reset", "", {
                "removed_files": removed,
                "note": "仅清空审批与纸交易记录；长期记忆保持不变",
            })
            return {"success": True, "removed_files": removed,
                    "message": f"已重置演示状态（清理 {removed} 个文件，记忆保留）"}

    # ---- 读取类 ----

    def _memory_summary(self) -> str:
        try:
            return self.orch.memory.get_memory_summary(USER_ID)
        except Exception:      # noqa: BLE001
            return ""

    def memory(self) -> dict:
        ud = Path(self.cfg.memory_dir) / USER_ID
        layers = [
            ("user", "用户记忆", "用户确认的偏好与约束（配置默认值标记为未确认）", "USER"),
            ("fact", "世界事实", "客观、可验证的数据：行情快照、行业占比等", "FACT"),
            ("experience", "经验", "交易结果与推荐反馈，决定下次是否重提同类建议", "EXPERIENCE"),
            ("observation", "观察", "组合诊断与风险识别，积累到阈值会触发 reflect", "OBSERVATION"),
            ("mental_model", "心智模型", "由观察自动提炼的规则，随证据演化版本", "MENTAL_MODEL"),
        ]
        out = []
        for key, name, desc, _enum in layers:
            f = ud / f"mem_{key}.json"
            entries: list[dict] = []
            if f.exists():
                try:
                    entries = json.loads(f.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    entries = []
            entries.sort(key=lambda e: (e.get("confidence", 0), e.get("updated_at", "")), reverse=True)
            out.append({
                "key": key, "name": name, "desc": desc,
                "count": len([e for e in entries if not e.get("superseded_by")]),
                "entries": entries,
            })
        recs: list[dict] = []
        rf = ud / "recommendations.json"
        if rf.exists():
            try:
                recs = json.loads(rf.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                recs = []
        return {
            "user_id": USER_ID,
            "summary": self._memory_summary(),
            "layers": out,
            "recommendations": recs[-20:][::-1],
        }

    def audit(self, limit: int = 120) -> list[dict]:
        d = Path(self.cfg.audit_dir)
        entries: list[dict] = []
        if d.exists():
            for f in sorted(d.glob("audit_*.jsonl")):
                try:
                    for line in f.read_text(encoding="utf-8").splitlines():
                        if line.strip():
                            entries.append(json.loads(line))
                except (OSError, json.JSONDecodeError):
                    continue
        entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
        out = []
        for e in entries[:limit]:
            item = dict(e)
            item["label"] = ACTION_LABELS.get(e.get("action", ""), e.get("action", ""))
            out.append(item)
        return out

    def trades(self, limit: int = 100) -> list[dict]:
        d = Path(self.cfg.paper_trade_dir)
        rows: list[dict] = []
        if d.exists():
            for f in d.glob("*_trades.jsonl"):
                try:
                    for line in f.read_text(encoding="utf-8").splitlines():
                        if line.strip():
                            rec = json.loads(line)
                            rec["file"] = f.name
                            rows.append(rec)
                except (OSError, json.JSONDecodeError):
                    continue
        rows.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
        return rows[:limit]


# ============================================================
#  HTTP 服务
# ============================================================


class Handler(BaseHTTPRequestHandler):
    server_version = "PortfolioSentinelWeb/0.1"
    protocol_version = "HTTP/1.1"

    # ---- 基础输出 ----

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, payload: Any, code: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _error(self, exc: Exception) -> None:
        logger.exception("请求处理失败：%s", exc)
        self._json({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def _file(self, rel: str) -> None:
        target = (STATIC_DIR / rel).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) or not target.is_file():
            self._send(404, "404".encode(), "text/plain; charset=utf-8")
            return
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
        }
        self._send(200, target.read_bytes(), types.get(target.suffix, "application/octet-stream"))

    def _body_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    @property
    def app(self) -> DemoApp:
        return self.server.app        # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args: Any) -> None:      # noqa: A003
        logger.info("%s %s", self.address_string(), fmt % args)

    # ---- 路由 ----

    def do_GET(self) -> None:      # noqa: N802
        path = urlparse(self.path).path
        try:
            if path in ("/", "/index.html"):
                return self._file("index.html")
            if path.startswith("/static/"):
                return self._file(path[len("/static/"):])
            if path == "/api/bootstrap":
                return self._json(self.app.bootstrap())
            if path == "/api/approvals":
                return self._json({"approvals": self.app.list_approvals()})
            if path == "/api/memory":
                return self._json(self.app.memory())
            if path == "/api/audit":
                return self._json({"entries": self.app.audit()})
            if path == "/api/trades":
                return self._json({"trades": self.app.trades()})
            if path == "/api/brief":
                return self._json(self.app.brief())
        except Exception as exc:      # noqa: BLE001
            return self._error(exc)
        self._send(404, "404".encode(), "text/plain; charset=utf-8")

    def do_POST(self) -> None:      # noqa: N802
        path = urlparse(self.path).path
        body = self._body_json()
        try:
            if path == "/api/review":
                return self._json(self.app.review(str(body.get("question", ""))))
            if path == "/api/decide":
                return self._json(self.app.decide(body))
            if path == "/api/breaker/reset":
                return self._json(self.app.breaker_reset())
            if path == "/api/reset":
                return self._json(self.app.reset())
        except Exception as exc:      # noqa: BLE001
            return self._error(exc)
        self._send(404, "404".encode(), "text/plain; charset=utf-8")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, handler, app: DemoApp):
        super().__init__(addr, handler)
        self.app = app


# ============================================================
#  入口
# ============================================================


def main(argv: Optional[list[str]] = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")      # type: ignore[union-attr]
    except Exception:      # noqa: BLE001
        pass

    parser = argparse.ArgumentParser(description="持仓哨兵 · 用户端 Web 服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="起始端口，被占用则自动顺延")
    parser.add_argument("--config", default="", help="config.fund.yaml 路径")
    parser.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
        datefmt="%H:%M:%S",
    )

    app = DemoApp(args.config or None)

    httpd: Optional[Server] = None
    for port in range(args.port, args.port + 20):
        try:
            httpd = Server((args.host, port), Handler, app)
            break
        except OSError:
            continue
    if httpd is None:
        print(f"[错误] {args.port}~{args.port + 19} 端口全部被占用，请用 --port 指定其他端口。")
        return 1

    url = f"http://{args.host}:{httpd.server_address[1]}/"
    engine = app.engine_info()

    print("=" * 62)
    print("  持仓哨兵 Personal AI Fund Manager · 用户端")
    print("=" * 62)
    print(f"  地址：{url}")
    print(f"  决策引擎：{engine['label']}")
    if engine["kind"] == "rules":
        print("  提示：未检测到 LLM Key，本次为规则降级决策（功能完整可演示）。")
    print("  演示环境：不连接真实账户，不执行真实资金交易。")
    print("  按 Ctrl+C 停止服务。")
    print("-" * 62)

    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
