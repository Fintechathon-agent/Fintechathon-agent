"""Financial Tools 模块——行情、新闻、组合分析、回测、纸交易、金融 LLM。
"""
from .market import MarketDataTool, get_price, get_batch_prices
from .news import NewsTool, get_related_news
from .portfolio import PortfolioAnalyzer, analyze_portfolio, suggest_rebalance
from .backtest import BacktestEngine, run_backtest
from .paper_trade import PaperTradingTool, execute_trade
from .financial_llm import FinancialLLM

__all__ = [
    "MarketDataTool",
    "get_price",
    "get_batch_prices",
    "NewsTool",
    "get_related_news",
    "PortfolioAnalyzer",
    "analyze_portfolio",
    "suggest_rebalance",
    "BacktestEngine",
    "run_backtest",
    "PaperTradingTool",
    "execute_trade",
    "FinancialLLM",
]
