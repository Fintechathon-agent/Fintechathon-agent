"""金融 Agent 配置加载——读取 config.fund.yaml，支持环境变量回退。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = PROJECT_ROOT / "config.fund.yaml"


@dataclass
class LLMConfig:
    provider: str = "deepseek"
    api_key: str = ""
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"
    temperature: float = 0.3
    timeout: int = 180
    max_retries: int = 3

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key.strip())


@dataclass
class FinancialDataConfig:
    market_source: str = "mock"    # akshare | tushare | mock
    tushare_token: str = ""
    news_source: str = "mock"
    backtest_initial_cash: float = 100000.0


@dataclass
class RiskConfig:
    default_risk_tolerance: str = "稳健"
    default_max_single_loss: float = 0.10
    default_max_total_loss: float = 0.20
    default_investment_horizon: str = "1年以内"
    approval_threshold: float = 0.70


@dataclass
class SessionConfig:
    ttl_minutes: int = 30
    max_retries: int = 3


@dataclass
class FundConfig:
    llm: LLMConfig = field(default_factory=LLMConfig)
    financial: FinancialDataConfig = field(default_factory=FinancialDataConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    session: SessionConfig = field(default_factory=SessionConfig)
    memory_dir: Path = PROJECT_ROOT / "data" / "memory"
    audit_dir: Path = PROJECT_ROOT / "data" / "audit"
    approval_dir: Path = PROJECT_ROOT / "data" / "approvals"
    paper_trade_dir: Path = PROJECT_ROOT / "data" / "paper_trades"


def load_fund_config(path: str | Path | None = None) -> FundConfig:
    """加载金融 Agent 配置"""
    cfg_file = Path(path) if path else DEFAULT_CONFIG
    raw: dict = {}
    if cfg_file.exists():
        raw = yaml.safe_load(cfg_file.read_text(encoding="utf-8")) or {}

    llm_raw = raw.get("llm") or {}
    llm = LLMConfig(
        provider=llm_raw.get("provider", "deepseek"),
        api_key=llm_raw.get("api_key") or os.environ.get("DEEPSEEK_API_KEY", ""),
        base_url=llm_raw.get("base_url", "https://api.deepseek.com"),
        model=llm_raw.get("model", "deepseek-chat"),
        temperature=float(llm_raw.get("temperature", 0.3)),
        timeout=int(llm_raw.get("timeout", 180)),
        max_retries=int(llm_raw.get("max_retries", 3)),
    )

    fin_raw = raw.get("financial") or {}
    financial = FinancialDataConfig(
        market_source=fin_raw.get("market_source", "mock"),
        tushare_token=fin_raw.get("tushare_token", ""),
        news_source=fin_raw.get("news_source", "mock"),
        backtest_initial_cash=float(fin_raw.get("backtest_initial_cash", 100000.0)),
    )

    risk_raw = raw.get("risk") or {}
    risk = RiskConfig(
        default_risk_tolerance=risk_raw.get("default_risk_tolerance", "稳健"),
        default_max_single_loss=float(risk_raw.get("default_max_single_loss", 0.10)),
        default_max_total_loss=float(risk_raw.get("default_max_total_loss", 0.20)),
        default_investment_horizon=risk_raw.get("default_investment_horizon", "1年以内"),
        approval_threshold=float(risk_raw.get("approval_threshold", 0.70)),
    )

    session_raw = raw.get("session") or {}
    session_cfg = SessionConfig(
        ttl_minutes=int(session_raw.get("ttl_minutes", 30)),
        max_retries=int(session_raw.get("max_retries", 3)),
    )

    paths_raw = raw.get("paths") or {}
    return FundConfig(
        llm=llm,
        financial=financial,
        risk=risk,
        session=session_cfg,
        memory_dir=_resolve(paths_raw.get("memory_dir", "data/memory")),
        audit_dir=_resolve(paths_raw.get("audit_dir", "data/audit")),
        approval_dir=_resolve(paths_raw.get("approval_dir", "data/approvals")),
        paper_trade_dir=_resolve(paths_raw.get("paper_trade_dir", "data/paper_trades")),
    )


def _resolve(p: str) -> Path:
    path = Path(p).expanduser()
    return path if path.is_absolute() else (PROJECT_ROOT / path)
