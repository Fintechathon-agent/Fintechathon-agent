"""基金操作模型——场外开放式基金申购/赎回的标准化计算。

费用与确认规则（演示口径，以各基金合同为准）：
- 申购：前端收费，净申购金额 = 金额 / (1 + 申购费率)；份额 = 净申购金额 / 申购日净值。
  申购费率按常见打折口径 0.15% 计（原始 1.5% 的一折，注释保留原始费率）。
- 赎回：按持有天数分档收费（<7 天 1.5% / 7-30 天 0.5% / 30-365 天 0.25% / ≥365 天 0），
  到账金额 = 份额 × 赎回日净值 × (1 - 赎回费率)。
- 确认：真实市场 T+1 确认份额；本演示按即日确认计算并如实标注，不做跨日净值猜测。
- 场外基金标识：symbol 带 ".OF" 后缀（如 "000001.OF" 华夏成长），
  与股票代码（000001 平安银行）区分；场内 ETF/LOF 用交易所代码（51/56/58/15/16/18 开头）。
"""
from __future__ import annotations

from dataclasses import dataclass

# 场内基金（ETF/LOF）代码前缀：沪市 51/56/58，深市 15/16/18
_EXCHANGE_FUND_PREFIXES = ("51", "56", "58", "15", "16", "18")


def is_exchange_fund(symbol: str) -> bool:
    """场内 ETF/LOF：按交易所代码前缀判断，交易规则同股票但免印花税。"""
    sym = symbol.strip().upper().split(".")[0]
    return sym.isdigit() and len(sym) == 6 and sym.startswith(_EXCHANGE_FUND_PREFIXES)


def is_otc_fund(symbol: str) -> bool:
    """场外开放式基金：symbol 带 .OF 后缀（避免与股票代码空间冲突）。"""
    return symbol.strip().upper().endswith(".OF")


def otc_subscribe_fee_rate() -> float:
    """申购费率（前端收费）。常见公募权益基金 1.5%，主流平台一折 0.15%。"""
    return 0.0015


def otc_redeem_fee_rate(holding_days: int) -> float:
    """赎回费率（持有天数分档，常见档位）。"""
    if holding_days < 7:
        return 0.015
    if holding_days < 30:
        return 0.005
    if holding_days < 365:
        return 0.0025
    return 0.0


@dataclass
class SubscribeResult:
    """申购结果：金额 → 份额"""
    amount: float            # 申购金额（元）
    fee: float               # 申购费（元）
    net_amount: float        # 净申购金额（元）
    nav: float               # 申购净值
    shares: float            # 确认份额（份）
    note: str = "按申购日净值计算（演示同速确认；真实市场 T+1 确认份额）"


def otc_subscribe(amount: float, nav: float) -> SubscribeResult:
    """按金额申购：净申购金额 = 金额/(1+费率)，份额 = 净申购金额/净值。"""
    if amount <= 0:
        raise ValueError("申购金额必须为正")
    if nav <= 0:
        raise ValueError("申购净值必须为正")
    fee_rate = otc_subscribe_fee_rate()
    net_amount = amount / (1 + fee_rate)
    fee = amount - net_amount
    shares = net_amount / nav
    return SubscribeResult(
        amount=round(amount, 2),
        fee=round(fee, 2),
        net_amount=round(net_amount, 2),
        nav=round(nav, 4),
        shares=round(shares, 2),
    )


@dataclass
class RedeemResult:
    """赎回结果：份额 → 到账金额"""
    shares: float           # 赎回份额（份）
    nav: float              # 赎回净值
    holding_days: int       # 持有天数
    fee_rate: float         # 适用赎回费率
    fee: float              # 赎回费（元）
    gross_amount: float     # 赎回总额（元）
    net_amount: float       # 实际到账（元）
    note: str = "按赎回日净值计算（演示同速确认；真实市场 T+1 后到账，货币基金 T+1，权益基金 T+1~T+4）"


def otc_redeem(shares: float, nav: float, holding_days: int) -> RedeemResult:
    """按份额赎回：到账 = 份额×净值×(1-赎回费率)。"""
    if shares <= 0:
        raise ValueError("赎回份额必须为正")
    if nav <= 0:
        raise ValueError("赎回净值必须为正")
    if holding_days < 0:
        raise ValueError("持有天数不能为负")
    fee_rate = otc_redeem_fee_rate(holding_days)
    gross = shares * nav
    fee = gross * fee_rate
    net = gross - fee
    return RedeemResult(
        shares=round(shares, 2),
        nav=round(nav, 4),
        holding_days=holding_days,
        fee_rate=fee_rate,
        fee=round(fee, 2),
        gross_amount=round(gross, 2),
        net_amount=round(net, 2),
    )
