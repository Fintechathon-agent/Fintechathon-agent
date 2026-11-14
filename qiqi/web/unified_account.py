"""One atomic synthetic account for transfers, investment fills and preferences.

Used only by the isolated guest runtime. Legacy data is never silently migrated.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
import hashlib
import json

from agent.tools.paper_trade import PaperTradingTool, PaperTradingResult, TradeRecord, apply_trade_record
from contracts.types import Position
from web.banking_demo import BankingState, demo_balance
from web.demo_data import fresh_portfolio, recompute_portfolio


def minor(value) -> int:
    if isinstance(value, bool):
        raise ValueError("金额无效")
    try:
        number = Decimal(str(value))
        if not number.is_finite() or number < 0 or number > Decimal("1000000000") or number * 100 != (number * 100).to_integral_value():
            raise ValueError("金额须非负、最多两位小数且不超过演示限额")
        return int(number * 100)
    except (InvalidOperation, TypeError):
        raise ValueError("金额无效") from None


class PreferenceConflict(ValueError):
    pass


class UnifiedAccount(BankingState):
    def __init__(self, directory: Path, owner: str, mode: str):
        self.directory, self.owner, self.mode = Path(directory), owner, mode
        super().__init__()

    def _path(self):
        return self.directory / "account.json"

    def _restore(self, raw):
        if raw and raw.get("schema_version") != 4:
            raise ValueError("旧账本需显式核对迁移，未自动覆盖")
        if raw and not {"cash_minor", "balance", "positions", "fills", "preferences"}.issubset(raw):
            raise ValueError("统一账本缺失关键状态，未补入默认资金")
        if raw and (raw.get("owner") != self.owner or raw.get("mode") != self.mode):
            raise ValueError("账本身份或模式不匹配")
        super()._restore(raw)
        self.cash_minor = raw.get("cash_minor", minor(demo_balance()))
        if type(self.cash_minor) is not int or self.cash_minor < 0 or minor(self.balance) != self.cash_minor:
            raise ValueError("统一现金账本损坏，暂停执行")
        self.positions = deepcopy(raw.get("positions", [asdict(p) for p in fresh_portfolio().positions]))
        self.fills = deepcopy(raw.get("fills", {}))
        self.preferences = deepcopy(raw.get("preferences", {
            "minimum_cash_minor": None, "version": 0, "updated_at": None, "source": None}))
        floor = self.preferences.get("minimum_cash_minor")
        if floor is not None and (type(floor) is not int or floor < 0):
            raise ValueError("用户现金约束无效，暂停执行")

    def _dump(self):
        if minor(self.balance) != self.cash_minor:
            raise ValueError("现金视图与统一账本不一致，暂停执行")
        return {**super()._dump(), "schema_version": 4, "owner": self.owner, "mode": self.mode,
                "cash_minor": self.cash_minor, "positions": deepcopy(self.positions),
                "fills": deepcopy(self.fills), "preferences": deepcopy(self.preferences)}

    @property
    def spendable_balance(self):
        return max(0, self.cash_minor - (self.preferences["minimum_cash_minor"] or 0)) / 100

    def portfolio(self):
        with self._lock:
            pf = fresh_portfolio()
            pf.user_id, pf.cash = self.owner, self.cash_minor / 100
            pf.positions = [Position(**p) for p in deepcopy(self.positions)]
            recompute_portfolio(pf)
            return pf

    def summary(self):
        with self._lock:
            return {"user_id": self.owner, "mode": self.mode, "identity": "BROWSER_GUEST",
                    "scope": "THIS_BROWSER_AND_MODE", "cash_minor": self.cash_minor,
                    "cash": self.cash_minor / 100, "spendable_cash": self.spendable_balance,
                    "preferences": deepcopy(self.preferences), "simulation": True}

    def record_transfer(self, amount):
        with self.transaction():
            debit = minor(amount)
            if debit <= 0 or debit > self.cash_minor - (self.preferences["minimum_cash_minor"] or 0):
                raise ValueError("余额不足或触及用户确认的最低现金约束")
            self.cash_minor -= debit
            self.balance = self.cash_minor / 100
            self.daily_cumulative = (minor(self.daily_cumulative) + debit) / 100

    def update_preferences(self, payload):
        if set(payload) != {"minimum_cash", "expected_version"}:
            raise ValueError("仅允许显式修改最低现金约束和版本")
        with self.transaction():
            if type(payload["expected_version"]) is not int or payload["expected_version"] != self.preferences["version"]:
                raise PreferenceConflict("偏好已更新，请刷新后重试")
            value = payload["minimum_cash"]
            amount = None if value is None else minor(value)
            self.preferences = {"minimum_cash_minor": amount, "version": self.preferences["version"] + 1,
                                "updated_at": datetime.now(timezone.utc).isoformat(), "source": "USER_CONFIRMED_FORM"}
            # Audit intent and preference commit together; deleted values are not
            # copied into history or model memory.
            from web.banking_service import _audit_event
            _audit_event(self, "cash_preference_deleted" if amount is None else "cash_preference_updated", "",
                         {"version": self.preferences["version"], "source": "USER_CONFIRMED_FORM"})
        return self.summary()

    def reset(self):
        with self.transaction():
            preferences = deepcopy(self.preferences)
            self._restore({})
            self.demo_seeded = True
            self.preferences = preferences


class UnifiedPaperTrader(PaperTradingTool):
    def __init__(self, account: UnifiedAccount, storage_dir: Path):
        super().__init__(storage_dir)
        self.account = account

    def get_trade_history(self, session_id):
        with self.account._lock:
            saved = self.account.fills.get(session_id)
            return [TradeRecord(**deepcopy(saved["receipt"]))] if saved else []

    def execute_once(self, rec, approval_id, portfolio=None):
        fingerprint = hashlib.sha256(json.dumps(asdict(rec), sort_keys=True, default=str).encode()).hexdigest()
        try:
            with self.account.transaction():
                existing = self.account.fills.get(approval_id)
                if existing:
                    if existing["fingerprint"] != fingerprint:
                        return PaperTradingResult(False, message="同一批准编号对应不同交易参数")
                    return PaperTradingResult(True, TradeRecord(**existing["receipt"]), "返回原统一账本回执")
                updated = self.account.portfolio()
                before = self.account.cash_minor
                record = self._do_trade(rec, approval_id)
                apply_trade_record(updated, record)
                after = minor(updated.cash)
                if after < before and after < (self.account.preferences["minimum_cash_minor"] or 0):
                    raise ValueError("成交后现金低于用户已确认的最低现金约束")
                self.account.cash_minor, self.account.balance = after, after / 100
                self.account.positions = [asdict(p) for p in updated.positions]
                self.account.fills[approval_id] = {"fingerprint": fingerprint, "receipt": asdict(record)}
                from web.banking_service import _audit_event
                _audit_event(self.account, "unified_investment_filled", approval_id,
                             {"receipt_id": record.id, "cash_change_minor": after - before, "simulation": True})
            return PaperTradingResult(True, record, "模拟成交已记入统一账本", updated)
        except Exception as exc:
            return PaperTradingResult(False, message=str(exc))

    def execute(self, rec, session_id, portfolio=None):
        # Automatic execution must still use the caller's durable approval key.
        return self.execute_once(rec, session_id, portfolio)
