# -*- coding: utf-8 -*-
"""严格验算：引擎输出 vs 原始历史数据的独立 numpy 参考实现。

参考实现只用 numpy 与原始序列，不引用任何引擎内部函数；
任何不一致都视为引擎缺陷，必须修复。
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from agent.risk.engine import RiskEngine
from agent.tools.backtest import BacktestEngine
from agent.tools.fund_ops import otc_redeem, otc_subscribe
from agent.tools.portfolio import PortfolioAnalyzer
from agent.tools.whatif import WhatIfEngine
from contracts.types import (
    ActionType, MarketData, MarketSnapshot, Portfolio, Position,
    Recommendation, RiskReport, UserProfile,
)
from web.demo_data import recompute_portfolio

PRICES = json.loads((ROOT / "tests/fixtures/real_prices_20261013.json").read_text(encoding="utf-8"))
NAV = json.loads((ROOT / "tests/fixtures/real_nav_000001_of_20261013.json").read_text(encoding="utf-8"))

failures: list[str] = []


def check(name: str, engine_val, ref_val, tol: float = 1e-6, rel: bool = False):
    if isinstance(engine_val, dict) and isinstance(ref_val, dict):
        ok = set(engine_val) == set(ref_val) and all(
            abs(engine_val[k] - ref_val[k]) <= tol for k in ref_val
        )
    elif isinstance(engine_val, float) and isinstance(ref_val, float):
        ok = abs(engine_val - ref_val) <= tol * (abs(ref_val) if rel else 1.0)
    else:
        ok = engine_val == ref_val
    status = "OK " if ok else "FAIL"
    print(f"[{status}] {name}: engine={engine_val!r} ref={ref_val!r}")
    if not ok:
        failures.append(name)


def build_portfolio() -> Portfolio:
    specs = [
        ("600519", "贵州茅台", 100, 1400.0, "食品饮料"),
        ("000001", "平安银行", 5000, 12.5, "银行"),
        ("510300", "沪深300ETF", 20000, 4.5, "宽基指数"),
        ("600036", "招商银行", 1000, 40.0, "银行"),
    ]
    positions = [
        Position(
            symbol=s, name=n, quantity=q, avg_cost=c,
            current_price=PRICES[s][-1], market_value=q * PRICES[s][-1],
            return_pct=(PRICES[s][-1] - c) / c * 100,
            day_change_pct=0.0, sector=sec, asset_type="fund" if s == "510300" else "stock",
        )
        for s, n, q, c, sec in specs
    ]
    return Portfolio(
        user_id="u1", date="2026-10-13", positions=positions,
        total_value=sum(p.market_value for p in positions), cash=50000.0,
    )


# ============================================================
# 1. 组合层（recompute_portfolio / PortfolioAnalyzer）
# ============================================================
print("== 1. 组合层 ==")
pf = build_portfolio()
# 参考：用真实最新价重算市值/收益率/组合收益
ref_mv = {s: q * PRICES[s][-1] for s, _, q, _, _ in [
    ("600519", "", 100, 0, ""), ("000001", "", 5000, 0, ""),
    ("510300", "", 20000, 0, ""), ("600036", "", 1000, 0, "")]}
ref_total = sum(ref_mv.values())
ref_cost = sum(q * c for s, n, q, c, sec in [
    ("600519", "", 100, 1400.0, ""), ("000001", "", 5000, 12.5, ""),
    ("510300", "", 20000, 4.5, ""), ("600036", "", 1000, 40.0, "")])
ref_total_return = (ref_total - ref_cost) / ref_cost * 100
# 参考：加权平均收益率（市值权重）
ref_ret = {s: (PRICES[s][-1] - c) / c * 100 for s, n, q, c, sec in [
    ("600519", "", 100, 1400.0, ""), ("000001", "", 5000, 12.5, ""),
    ("510300", "", 20000, 4.5, ""), ("600036", "", 1000, 40.0, "")]}
ref_wavg = sum(ref_mv[s] * ref_ret[s] for s in ref_mv) / ref_total

recompute_portfolio(pf)
check("total_value", pf.total_value, ref_total, tol=0.02)
check("total_return(成本口径)", pf.total_return, ref_total_return, tol=0.02)
for s in ref_mv:
    pos = next(p for p in pf.positions if p.symbol == s)
    check(f"market_value {s}", pos.market_value, ref_mv[s], tol=0.02)
    check(f"return_pct {s}", pos.return_pct, ref_ret[s], tol=0.02)

report = PortfolioAnalyzer().analyze(pf, MarketSnapshot(timestamp="", data={}))
check("avg_return(市值加权)", report.avg_return, ref_wavg, tol=0.02)
check("sector_concentration", report.sector_concentration,
      {"食品饮料": ref_mv["600519"] / ref_total,
       "银行": (ref_mv["000001"] + ref_mv["600036"]) / ref_total,
       "宽基指数": ref_mv["510300"] / ref_total}, tol=1e-6)
check("winning_positions", report.winning_positions,
      sum(1 for v in ref_ret.values() if v > 0))

# ============================================================
# 2. 风险指标（历史法）
# ============================================================
print("== 2. 风险指标 ==")
user = UserProfile(user_id="u1", name="七七", max_single_loss=0.10)
risk = RiskEngine().check(pf, user, MarketSnapshot(timestamp="", data={}), price_history=PRICES)

series = [np.array(PRICES[s][-120:]) for s in ["600519", "000001", "510300", "600036"]]
min_len = min(len(s) for s in series)
series = [s[-min_len:] for s in series]
w = np.array([ref_mv[s] for s in ["600519", "000001", "510300", "600036"]], dtype=float)
w = w / w.sum()
rets = np.array([
    np.sum(w * (np.array([s[i] for s in series]) - np.array([s[i - 1] for s in series]))
           / np.array([s[i - 1] for s in series]))
    for i in range(1, min_len)
])
ref_var = abs(float(np.quantile(rets, 0.05, method="lower"))) * 100
values = np.array([
    50000.0 + sum(p.quantity * s[i] for p, s in zip(pf.positions, series))
    for i in range(min_len)
])
peak = np.maximum.accumulate(values)
ref_mdd = float(np.max((peak - values) / peak * 100))
corrs = [float(np.corrcoef(np.diff(series[i]) / series[i][:-1],
                           np.diff(series[j]) / series[j][:-1])[0, 1])
         for i in range(4) for j in range(i + 1, 4)]
ref_corr = sum(corrs) / len(corrs)

check("var_95(历史法)", risk.var_95, ref_var, tol=0.01)
check("max_drawdown(历史法)", risk.max_drawdown, ref_mdd, tol=0.01)
check("avg_correlation", risk.avg_correlation, ref_corr, tol=1e-4)

# ============================================================
# 3. 回测（真实多日序列 + 多笔交易）
# ============================================================
print("== 3. 回测 ==")
hist = {
    s: [MarketData(timestamp=f"{d} 15:00:00", symbol=s, price=p)
        for d, p in zip(NAV["dates"], PRICES[s])]
    for s in ["600519", "000001", "510300", "600036"]
}
recs = [
    Recommendation(action=ActionType.BUY, symbol="600519", quantity=10, price=PRICES["600519"][0], reason="", confidence=0.8, risk_impact="", alternative=""),
    Recommendation(action=ActionType.BUY, symbol="510300", quantity=2000, price=PRICES["510300"][1], reason="", confidence=0.8, risk_impact="", alternative=""),
    Recommendation(action=ActionType.SELL, symbol="600519", quantity=10, price=PRICES["600519"][5], reason="", confidence=0.8, risk_impact="", alternative=""),
    Recommendation(action=ActionType.BUY, symbol="000001", quantity=1000, price=PRICES["000001"][10], reason="", confidence=0.8, risk_impact="", alternative=""),
    Recommendation(action=ActionType.SELL, symbol="510300", quantity=2000, price=PRICES["510300"][15], reason="", confidence=0.8, risk_impact="", alternative=""),
]
bt = BacktestEngine(initial_cash=500000.0).run(recs, hist)

# 参考：逐笔独立复算（引擎撮合语义：推荐按顺序在严格递增的交易日撮合 → 0,1,2,3,4 日）
p = {s: np.array(PRICES[s]) for s in ["600519", "000001", "510300"]}
cash = 500000.0
holdings = {s: 0.0 for s in p}
cost_basis = {s: 0.0 for s in p}
exec_plan = [("600519", 0, "BUY", 10, p["600519"][0]),
             ("510300", 1, "BUY", 2000, p["510300"][1]),
             ("600519", 2, "SELL", 10, p["600519"][2]),
             ("000001", 3, "BUY", 1000, p["000001"][3]),
             ("510300", 4, "SELL", 2000, p["510300"][4])]
realized = []
for sym, day, act, qty, price in exec_plan:
    if act == "BUY":
        cost = qty * price * 1.0003
        cash -= cost
        holdings[sym] += qty
        cost_basis[sym] += cost
    else:
        fee = 0.0003 + (0.0 if sym == "510300" else 0.0005)
        revenue = qty * price * (1 - fee)
        avg = cost_basis[sym] / holdings[sym]
        realized.append(revenue - avg * qty)
        cash += revenue
        holdings[sym] -= qty
        cost_basis[sym] -= avg * qty
n_days = 120
values_ref = []
for d in range(n_days):
    v = cash + sum(holdings[s] * p[s][d] for s in p)
    values_ref.append(v)
values_ref = np.array(values_ref)
ref_total_return = (values_ref[-1] - 500000.0) / 500000.0 * 100
peak2 = np.maximum.accumulate(values_ref)
ref_bt_mdd = float(np.max((peak2 - values_ref) / peak2 * 100))
ref_wins = sum(1 for r in realized if r > 0)
ref_win_rate = ref_wins / len(realized)
gp = sum(r for r in realized if r > 0)
gl = abs(sum(r for r in realized if r < 0))
ref_pf = gp / gl if gl > 1e-12 else (99.99 if gp > 0 else 0.0)

check("backtest total_return", bt.total_return, ref_total_return, tol=0.02)
check("backtest max_drawdown", bt.max_drawdown, ref_bt_mdd, tol=0.02)
check("backtest win_rate", bt.win_rate, ref_win_rate, tol=1e-6)
check("backtest profit_factor", bt.profit_factor, ref_pf, tol=0.02)
check("backtest total_trades", bt.total_trades, len(exec_plan))

# ============================================================
# 4. 场外基金申赎（真实净值）
# ============================================================
print("== 4. 基金申赎 ==")
navs = np.array(NAV["navs"])
sub = otc_subscribe(10000.0, navs[0])
ref_sub_fee = 10000.0 - 10000.0 / 1.0015
ref_sub_shares = (10000.0 / 1.0015) / navs[0]
check("申购费", sub.fee, ref_sub_fee, tol=0.01)
check("申购份额", sub.shares, ref_sub_shares, tol=0.01)

# 真实持有天数（日历日）：2026-04-15 申购 → 2026-06-15 赎回
from datetime import date as _date
d0 = _date.fromisoformat(NAV["dates"][0])
d_red = _date.fromisoformat("2026-06-15")
cal_days = (d_red - d0).days
red = otc_redeem(ref_sub_shares, navs[30], cal_days)
if cal_days < 7:
    fee_rate = 0.015
elif cal_days < 30:
    fee_rate = 0.005
elif cal_days < 365:
    fee_rate = 0.0025
else:
    fee_rate = 0.0
ref_red_net = ref_sub_shares * navs[30] * (1 - fee_rate)
check("赎回持有天数", cal_days, 61)
check("赎回到账金额", red.net_amount, ref_red_net, tol=0.01)
check("赎回费率档位", red.fee_rate, 0.0025, tol=1e-9)

# ============================================================
# 5. 情景推演（真实组合上的买卖，使用独立副本避免互相污染）
# ============================================================
print("== 5. 情景推演 ==")
import copy

engine = WhatIfEngine()
pf_buy = copy.deepcopy(pf)
sim, _ = engine._apply_buy(
    pf_buy, Recommendation(action=ActionType.BUY, symbol="600036", quantity=100, price=PRICES["600036"][-1], reason="", confidence=0.8, risk_impact="", alternative=""),
    MarketSnapshot(timestamp="", data={}),
)
pos6 = next(p for p in sim.positions if p.symbol == "600036")
ref_avg = (40.0 * 1000 + PRICES["600036"][-1] * 100 * 1.0003) / 1100
check("推演买入摊薄成本", pos6.avg_cost, ref_avg, tol=0.01)
check("推演买入现金", sim.cash, 50000.0 - PRICES["600036"][-1] * 100 * 1.0003, tol=0.02)

pf_sell = copy.deepcopy(pf)
sim2, _ = engine._apply_sell(
    pf_sell, Recommendation(action=ActionType.SELL, symbol="600036", quantity=100, price=PRICES["600036"][-1], reason="", confidence=0.8, risk_impact="", alternative=""),
)
ref_proceeds = 100 * PRICES["600036"][-1] * (1 - 0.0003 - 0.0005)
check("推演卖出净回款", sim2.cash, 50000.0 + ref_proceeds, tol=0.02)
check("推演卖出后数量", next(p for p in sim2.positions if p.symbol == "600036").quantity, 900.0)

print()
if failures:
    print(f"FAILED: {len(failures)} 项不一致 -> {failures}")
    sys.exit(1)
print("ALL CHECKS PASSED：引擎与历史数据独立复算完全一致")
