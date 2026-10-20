from __future__ import annotations

import unittest

from agent.orchestrator.orchestrator import DecisionMaker
from agent.tools.financial_llm import advisor_voice_issues
from contracts.types import ActionType, Portfolio, Position, RiskReport, UserProfile


def _portfolio() -> Portfolio:
    return Portfolio(
        user_id="u1",
        date="2026-10-20",
        positions=[
            Position(
                symbol="600519", name="贵州茅台", quantity=100, avg_cost=1400.0,
                current_price=1500.0, market_value=150000.0, return_pct=7.14,
                sector="食品饮料",
            ),
        ],
        total_value=150000.0,
        cash=10000.0,
    )


def _profile() -> UserProfile:
    return UserProfile(
        user_id="u1", name="测试用户", risk_tolerance="moderate",
        investment_horizon=365, max_single_loss=0.1, max_total_loss=0.2,
        forbidden_sectors=[],
    )


class AdvisorVoiceTest(unittest.TestCase):
    """用户要的是能照着做的分析，不是免责声明。"""

    def test_disclaimer_answer_is_flagged(self):
        # 这就是截图里那一类回答：把用户的输入复述一遍，然后说无法判断。
        issues = advisor_voice_issues(
            "用户自述风险偏好为中等，计划投入150万元人民币，期限极短（25天），"
            "最大可承受回撤7%，目标为短期冲高。鉴于缺乏实时行情、账户核验及详细财务状况，"
            "无法提供具体投资建议或适当性结论。资金配置思路：建议原则是先确保3-6个月生活支出。"
        )
        self.assertTrue(any("套话" in issue for issue in issues))
        self.assertTrue(any("第三人称" in issue for issue in issues))

    def test_answer_without_numbers_is_flagged(self):
        issues = advisor_voice_issues(
            "你要先把备用金准备好，然后再考虑配置一部分稳健的资产，不要一次性都投进去。"
        )
        self.assertTrue(any("具体金额" in issue or "短" in issue for issue in issues))

    def test_plain_advisor_answer_passes(self):
        issues = advisor_voice_issues(
            "你这 150 万 25 天后要用，先留 140 万货币基金，剩 10 万买沪深300 ETF，"
            "最坏亏 2 万，离你能接受的 10.5 万还有距离。"
        )
        self.assertEqual(issues, [])

    def test_short_answer_is_flagged(self):
        self.assertTrue(advisor_voice_issues("建议你持有。"))


class DecisionMakerVoiceTest(unittest.TestCase):
    """口吻问题只留痕，不改决策：建议仍然照常产生，数字由下游闸门校验。"""

    def test_cliche_model_output_keeps_recommendation_but_records_issues(self):
        dm = DecisionMaker(llm_client=None)
        dm.last_voice_issues = advisor_voice_issues(
            "无法提供具体投资建议或适当性结论，用户情况需要进一步核实。"
        )
        self.assertTrue(dm.last_voice_issues)

    def test_decision_maker_exposes_voice_field(self):
        dm = DecisionMaker(llm_client=None)
        self.assertEqual(dm.last_voice_issues, [])
        self.assertFalse(hasattr(dm, "decision"))


class PortfolioFixtureTest(unittest.TestCase):
    """样例数据能正常构造，确保上面的口吻检查跑在真实结构上。"""

    def test_fixture_matches_contract(self):
        pf = _portfolio()
        profile = _profile()
        report = RiskReport(
            portfolio_id="p1", generated_at="2026-10-20T09:00:00",
            risk_score=62.0, var_95=2.4, max_drawdown=8.1,
            warnings=["单一持仓占比偏高"], forbidden_violations=[],
            sector_concentration={"食品饮料": 0.72},
        )
        self.assertEqual(pf.positions[0].symbol, "600519")
        self.assertEqual(profile.risk_tolerance, "moderate")
        self.assertEqual(report.risk_score, 62.0)
        self.assertNotEqual(ActionType.HOLD, ActionType.BUY)


if __name__ == "__main__":
    unittest.main()
