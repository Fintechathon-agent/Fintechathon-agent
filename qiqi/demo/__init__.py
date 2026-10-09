"""Demo Launcher——演示入口，模拟完整的 Portfolio Health Check 流程。
"""
from __future__ import annotations
import sys
from pathlib import Path

# 确保项目根目录在 Python 路径中
_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from datetime import date
from pathlib import Path

from agent.orchestrator import build_orchestrator
from contracts.types import (
    Portfolio, Position, UserProfile, RiskTolerance, ExperienceLevel, MarketData, MarketSnapshot
)
from agent.tools.market import MarketDataTool


def create_demo_portfolio() -> Portfolio:
    """创建一个演示用投资组合（持有 5 只股票）"""
    return Portfolio(
        user_id="demo_user",
        date=date.today().isoformat(),
        positions=[
            Position(
                symbol="600036", name="招商银行", quantity=1000, avg_cost=35.0,
                current_price=36.5, market_value=36500.0, return_pct=4.29,
                day_change_pct=1.2, sector="银行", asset_type="stock"
            ),
            Position(
                symbol="600519", name="贵州茅台", quantity=50, avg_cost=1700.0,
                current_price=1650.0, market_value=82500.0, return_pct=-2.94,
                day_change_pct=-0.5, sector="白酒", asset_type="stock"
            ),
            Position(
                symbol="000001", name="平安银行", quantity=5000, avg_cost=12.0,
                current_price=10.5, market_value=52500.0, return_pct=-12.5,
                day_change_pct=-1.8, sector="银行", asset_type="stock"
            ),
            Position(
                symbol="601318", name="中国平安", quantity=800, avg_cost=48.0,
                current_price=50.2, market_value=40160.0, return_pct=4.58,
                day_change_pct=0.3, sector="保险", asset_type="stock"
            ),
            Position(
                symbol="000858", name="五粮液", quantity=300, avg_cost=160.0,
                current_price=155.0, market_value=46500.0, return_pct=-3.13,
                day_change_pct=-0.2, sector="白酒", asset_type="stock"
            ),
        ],
        total_value=308160.0,
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


def run_demo():
    """运行演示流程——完整 Portfolio Health Check"""
    print("=" * 60)
    print("  Personal AI Fund Manager — Portfolio Health Check Demo")
    print("=" * 60)

    # 1. 构建 Orchestrator
    orch = build_orchestrator()

    # 2. 准备演示数据
    user = create_demo_user()
    portfolio = create_demo_portfolio()

    print(f"\n👤 用户：{user.name} | 风险偏好：{user.risk_tolerance.value}")
    print(f"💼 组合：总市值 {portfolio.total_value:,.0f} 元 | 现金 {portfolio.cash:,.0f} 元 | {portfolio.position_count} 只持仓")
    print()

    # 3. 获取实时行情（mock）
    tool = MarketDataTool(use_mock=True)  # 无 akshare 时用模拟数据
    symbols = [p.symbol for p in portfolio.positions]
    market = tool.get_batch(symbols)
    snapshot = MarketSnapshot(
        timestamp=date.today().isoformat(),
        data=market,
    )

    # 4. 组合健康检查
    print("🔍 正在分析持仓健康状况...")
    health = orch.get_portfolio_health(portfolio, snapshot)

    print(f"\n📊 组合健康报告")
    print(f"  盈利持仓：{health['winning_positions']} 只 | 亏损持仓：{health['losing_positions']} 只")
    print(f"  平均收益率：{health['avg_return']:+.2f}%")
    print(f"  行业分布：{health['sector_concentration']}")
    if health['risk_warnings']:
        for w in health['risk_warnings']:
            print(f"  ⚠️  {w}")
    print(f"\n💡 {health['reasoning']}")

    if health['next_actions']:
        print("\n📋 下一步建议：")
        for i, action in enumerate(health['next_actions'], 1):
            print(f"  {i}. {action}")

    # 5. 完整 Agent 流程（带 LLM 决策）
    print("\n🤖 运行 Agent 决策流程...")
    response = orch.handle_review_request(user, portfolio, question="请检查我的持仓健康状况")

    print(f"\n📤 Agent 响应")
    print(f"  会话ID：{response.session_id}")
    print(f"  置信度：{response.confidence:.0%}" if response.confidence else "  置信度：N/A")
    if response.recommendation:
        rec = response.recommendation
        print(f"  建议：{rec.action.value} {rec.symbol} {rec.quantity}股 @{rec.price}")
        print(f"  理由：{rec.reason}")
    if response.risk_alert:
        print(f"  风险提示：{response.risk_alert}")

    # 5.1 情景推演——"执行后会怎样"
    if response.whatif:
        wi = response.whatif
        print(f"\n🔮 情景推演：{wi.scenario}")
        if not wi.executable:
            print(f"  ✗ 无法执行：{wi.infeasible_reason}")
        else:
            for d in wi.deltas:
                mark = "" if d.counted else "（参考）"
                flag = "➖" if abs(d.delta) < 1e-9 else ("✅" if d.improved else "⚠️")
                print(f"  {flag} {d.format()}{mark}")
            print(f"  结论：{wi.verdict}")

    # 5.1.1 备选方案——主推不佳时系统自己找的更优做法
    if response.alternatives:
        print(f"\n🔄 主推方案效果不佳，系统扫描出 {len(response.alternatives)} 个更优备选：")
        for i, alt in enumerate(response.alternatives, 1):
            print(f"  备选{i}：{alt.scenario}")
            print(f"         改善{alt.improved_count}项 / 恶化{alt.worsened_count}项，"
                  f"风险{alt.net_risk_delta:+.1f}分")
            print(f"         {alt.verdict}")

    # 5.2 风控闸门
    if response.gate:
        g = response.gate
        if g.passed:
            print(f"\n🛡️  风控闸门：通过（{len(g.checks)} 项检查）")
            for w in g.warnings:
                print(f"    ⚠️  {w}")
        else:
            print(f"\n🛡️  风控闸门：拦截")
            for b in g.blocked_reasons:
                print(f"    ⛔ {b}")

    # 5.3 执行状态
    if response.executed:
        print(f"\n✅ 已自动执行纸交易")
    elif response.requires_approval:
        print(f"\n⏸️  需要人工审批（置信度 {response.confidence:.0%} < 70%）")
        print(f"  审批ID：{response.approval_request.id if response.approval_request else 'N/A'}")

    print("\n" + "=" * 60)
    print("  Demo 完成！")
    print("=" * 60)


if __name__ == "__main__":
    run_demo()
