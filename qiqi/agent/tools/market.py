"""行情数据工具——封装 akshare / tushare，屏蔽数据源差异。
参考 PanWatch 的行情获取方式，支持 A 股、基金、指数。
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from contracts.types import MarketData, MarketSnapshot

logger = logging.getLogger(__name__)

# ------------------------------------------------------------ 尝试导入 akshare


def _get_akshare():
    """延迟导入 akshare，缺失时返回 mock 模式"""
    try:
        import akshare as ak
        return ak
    except ImportError:
        logger.warning("akshare 未安装，行情数据将使用模拟数据")
        return None


# ------------------------------------------------------------ MarketDataTool


class MarketDataTool:
    """行情数据统一接口——优先用 akshare，缺失时降级为模拟数据"""

    def __init__(self, use_mock: bool = False):
        self._use_mock = use_mock or _get_akshare() is None
        self._ak = None if self._use_mock else _get_akshare()

    def get_price(self, symbol: str) -> MarketData:
        """获取单个证券实时行情"""
        if self._use_mock:
            return self._mock_price(symbol)
        try:
            return self._akshare_price(symbol)
        except Exception as exc:
            logger.warning("akshare 获取 %s 失败: %s，降级为模拟数据", symbol, exc)
            return self._mock_price(symbol)

    def get_batch(self, symbols: list[str]) -> dict[str, MarketData]:
        """批量获取行情"""
        return {sym: self.get_price(sym) for sym in symbols}

    def get_history(self, symbol: str, days: int = 120) -> Optional[list[float]]:
        """获取近 N 个交易日的前复权收盘价序列（真实数据）。

        用于真实 VaR / 最大回撤计算；mock 模式或抓取失败时返回 None，
        调用方应回退到简化估算并在结果中标注。
        """
        if self._use_mock:
            return None
        try:
            import akshare as ak

            end = datetime.now().strftime("%Y%m%d")
            sym = symbol.strip()
            df = ak.stock_zh_a_hist(
                symbol=sym,
                period="daily",
                start_date="20200101",
                end_date=end,
                adjust="qfq",
            )
            # ETF/LOF 走东财基金接口（列名相同，但股票接口对部分 ETF 无数据）
            if df is None or df.empty or "收盘" not in df.columns:
                df = ak.fund_etf_hist_em(
                    symbol=sym,
                    period="daily",
                    start_date="20200101",
                    end_date=end,
                    adjust="qfq",
                )
            if df is None or df.empty or "收盘" not in df.columns:
                return None
            closes = [float(v) for v in df["收盘"].tolist()[-days:]]
            return closes if closes else None
        except Exception as exc:      # noqa: BLE001
            logger.warning("akshare 历史行情 %s 获取失败: %s", symbol, exc)
            return None

    def get_history_batch(self, symbols: list[str], days: int = 120) -> dict[str, list[float]]:
        """批量历史收盘价：{symbol: [closes]}，缺失的 symbol 不出现。"""
        out: dict[str, list[float]] = {}
        for sym in symbols:
            hist = self.get_history(sym, days)
            if hist:
                out[sym] = hist
        return out

    # ---- akshare 实现 ----

    def _akshare_price(self, symbol: str) -> MarketData:
        """真实行情：取最近一个交易日的日线末行（收盘价口径）。

        用日线而非全市场快照：速度快、稳定，且与历史法风险计算同口径。
        股票走 stock_zh_a_hist，ETF/LOF 走 fund_etf_hist_em。
        """
        import akshare as ak

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        sym = symbol.strip()
        end = now[:10].replace("-", "")
        start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")

        try:
            if sym.startswith(("51", "56", "58", "15", "16", "18", "50")):
                # ETF/LOF：股票接口对部分 ETF 无数据或返回错误标的
                df = ak.fund_etf_hist_em(
                    symbol=sym, period="daily",
                    start_date=start, end_date=end, adjust="",
                )
            else:
                df = ak.stock_zh_a_hist(
                    symbol=sym, period="daily",
                    start_date=start, end_date=end, adjust="",
                )
            if df is not None and not df.empty and "收盘" in df.columns:
                row = df.iloc[-1]
                return MarketData(
                    timestamp=now,
                    symbol=sym,
                    name="",
                    price=float(row.get("收盘", 0) or 0),
                    change_pct=float(row.get("涨跌幅", 0) or 0),
                    volume=float(row.get("成交量", 0) or 0),
                    amount=float(row.get("成交额", 0) or 0),
                    high=float(row.get("最高", 0) or 0),
                    low=float(row.get("最低", 0) or 0),
                    source="akshare",
                )
        except Exception as exc:      # noqa: BLE001
            logger.warning("akshare 获取 %s 失败: %s，降级为模拟数据", sym, exc)

        return self._mock_price(symbol)

    # ---- Mock 实现（无 akshare 时）----

    # 已知标的的参考价（元）——锚定真实量级，避免 mock 随机价把演示逻辑带偏。
    # 前 5 个与 demo 组合的成本价配套，使演示的盈亏叙事保持自洽。
    _MOCK_REFERENCE_PRICES: dict[str, tuple[str, float]] = {
        # symbol: (name, price)
        "000001": ("平安银行", 10.50),
        "600036": ("招商银行", 36.50),
        "600519": ("贵州茅台", 1650.00),
        "601318": ("中国平安", 50.20),
        "000858": ("五粮液", 155.00),
        "000002": ("万科A", 8.60),
        "000333": ("美的集团", 62.00),
        "002594": ("比亚迪", 105.00),
        "600900": ("长江电力", 28.00),
        "510310": ("沪深300ETF", 3.85),
        "159915": ("创业板ETF", 2.20),
    }

    @classmethod
    def _mock_price(cls, symbol: str) -> MarketData:
        """返回模拟行情数据（用于开发测试）

        已知标的用参考价，未知标的用 symbol 哈希生成稳定价格（10~60 元）。
        涨跌幅同样由哈希决定，保证同一 symbol 每次调用结果一致。
        """
        import hashlib

        h = int(hashlib.md5(symbol.encode()).hexdigest(), 16)

        if symbol in cls._MOCK_REFERENCE_PRICES:
            name, base = cls._MOCK_REFERENCE_PRICES[symbol]
        else:
            name = f"股票{symbol}"
            base = 10.0 + (h % 500) / 10.0          # 10 ~ 60 元

        # 日内波动 ±3%，由哈希稳定决定（同一天同一标的不跳变）
        change = ((h % 61) - 30) / 10.0             # -3% ~ +3%
        price = round(base * (1 + change / 100), 2)

        return MarketData(
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            symbol=symbol,
            name=name,
            price=price,
            change_pct=round(change, 2),
            volume=h % 100000000,
            amount=round(price * (h % 100000000), 2),
            high=round(price * 1.05, 2),
            low=round(price * 0.95, 2),
            source="mock",
        )

    def get_historical(self, symbol: str, days: int = 30) -> list[MarketData]:
        """获取历史 K 线（用于回测），目前仅支持 mock"""
        if self._use_mock:
            return self._mock_historical(symbol, days)
        try:
            import akshare as ak
            df = ak.stock_zh_a_hist(symbol=symbol, period="daily", adjust="qfq")
            df = df.tail(days)
            results = []
            for _, row in df.iterrows():
                results.append(MarketData(
                    timestamp=str(row["日期"]),
                    symbol=symbol,
                    name="",
                    price=float(row["收盘"]),
                    change_pct=float(row["涨跌幅"]),
                    volume=float(row["成交量"]),
                    amount=float(row["成交额"]),
                    high=float(row["最高"]),
                    low=float(row["最低"]),
                    source="akshare",
                ))
            return results
        except Exception as exc:
            logger.warning("akshare historical %s 失败: %s", symbol, exc)
            return self._mock_historical(symbol, days)

    @classmethod
    def _mock_historical(cls, symbol: str, days: int) -> list[MarketData]:
        """生成稳定的模拟历史数据"""
        import hashlib
        h = int(hashlib.md5(symbol.encode()).hexdigest(), 16)
        # 未知标的用哈希价，已知标的锚定参考价
        ref = cls._MOCK_REFERENCE_PRICES.get(symbol)
        base_price = ref[1] if ref else 10.0 + (h % 500) / 10.0
        results = []
        import datetime as dt
        for i in range(days):
            d = dt.date.today() - dt.timedelta(days=days - i - 1)
            noise = ((h >> i) % 101 - 50) / 500.0
            price = base_price * (1 + noise + i * 0.002)
            results.append(MarketData(
                timestamp=d.isoformat(),
                symbol=symbol,
                name="",
                price=round(price, 2),
                change_pct=round(noise * 100, 2),
                volume=h % 100000000,
                source="mock",
            ))
        return results


# ------------------------------------------------------------ 快捷函数


_market_tool: Optional[MarketDataTool] = None


def get_market_tool() -> MarketDataTool:
    global _market_tool
    if _market_tool is None:
        _market_tool = MarketDataTool()
    return _market_tool


def get_price(symbol: str) -> MarketData:
    return get_market_tool().get_price(symbol)


def get_batch_prices(symbols: list[str]) -> dict[str, MarketData]:
    return get_market_tool().get_batch(symbols)


def fetch_market_snapshot(symbols: list[str]) -> MarketSnapshot:
    """获取市场快照（供 AgentLoop 使用）"""
    tool = get_market_tool()
    data = tool.get_batch(symbols)
    return MarketSnapshot(timestamp=datetime.now().isoformat(), data=data)
