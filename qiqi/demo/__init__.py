"""可复现的演示用户与持仓 fixture。"""
from __future__ import annotations

from datetime import date

from contracts.types import (
    ExperienceLevel,
    Portfolio,
    Position,
    RiskTolerance,
    UserProfile,
)


def create_demo_portfolio() -> Portfolio:
    """创建与 Web Demo 共用的固定组合。"""
    return Portfolio(
        user_id="demo_user",
        date=date.today().isoformat(),
        positions=[
            Position(
                symbol="600036", name="招商银行", quantity=1000, avg_cost=35.0,
                current_price=36.5, market_value=36500.0, return_pct=4.29,
                day_change_pct=1.2, sector="银行", asset_type="stock",
            ),
            Position(
                symbol="600519", name="贵州茅台", quantity=50, avg_cost=1700.0,
                current_price=1650.0, market_value=82500.0, return_pct=-2.94,
                day_change_pct=-0.5, sector="白酒", asset_type="stock",
            ),
            Position(
                symbol="000001", name="平安银行", quantity=5000, avg_cost=12.0,
                current_price=10.5, market_value=52500.0, return_pct=-12.5,
                day_change_pct=-1.8, sector="银行", asset_type="stock",
            ),
            Position(
                symbol="601318", name="中国平安", quantity=800, avg_cost=48.0,
                current_price=50.2, market_value=40160.0, return_pct=4.58,
                day_change_pct=0.3, sector="保险", asset_type="stock",
            ),
            Position(
                symbol="000858", name="五粮液", quantity=300, avg_cost=160.0,
                current_price=155.0, market_value=46500.0, return_pct=-3.13,
                day_change_pct=-0.2, sector="白酒", asset_type="stock",
            ),
        ],
        total_value=258160.0,
        cash=50000.0,
        daily_return=-0.45,
        total_return=-2.1,
    )


def create_demo_user() -> UserProfile:
    return UserProfile(
        user_id="demo_user",
        name="演示用户",
        risk_tolerance=RiskTolerance.MODERATE,
        investment_horizon="3-5年",
        max_single_loss=0.10,
        max_total_loss=0.20,
        forbidden_sectors=["煤炭", "烟草"],
        annual_income_range="20-50万",
        experience=ExperienceLevel.INTERMEDIATE,
    )
