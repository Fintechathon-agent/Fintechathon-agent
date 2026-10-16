from __future__ import annotations

import math
import unittest

from web.demo_data import fresh_portfolio, portfolio_dict
from web.preview_contract import (
    CONTRACT_VERSION,
    DATA_MODE,
    OPERATION,
    health_check_response,
    portfolio_contract_from_dict,
)


def _request():
    portfolio = portfolio_contract_from_dict(portfolio_dict(fresh_portfolio()))
    return {
        "contract_version": CONTRACT_VERSION,
        "request_id": "req-contract-test",
        "operation": OPERATION,
        "context": {"actor": "agent", "environment": "demo", "data_mode": DATA_MODE},
        "input": {
            "risk_profile": {
                "investment_horizon_days": 365,
                "max_drawdown": 0.1,
                "liquidity_need": "medium",
            },
            "portfolio": portfolio,
        },
    }


class PreviewContractTests(unittest.TestCase):
    def test_valid_request_returns_read_only_handoff_with_traceable_artifacts(self):
        response = health_check_response(_request())
        task = response["task_state"]
        self.assertEqual(response["contract_version"], CONTRACT_VERSION)
        self.assertEqual(response["operation"], OPERATION)
        self.assertEqual(task["status"], "HANDOFF_REQUIRED")
        self.assertFalse(task["execution_allowed"])
        self.assertEqual(response["trace"]["task_id"], task["task_id"])
        self.assertEqual(response["trace"]["request_id"], response["request_id"])
        self.assertEqual(response["risk_handoff"]["session_id"], task["session_id"])

        artifacts = response["artifacts"]
        self.assertEqual(artifacts["portfolio_snapshot"]["data_mode"], DATA_MODE)
        self.assertEqual(len(artifacts["candidates"]), 3)
        self.assertEqual(len(artifacts["simulation"]["comparisons"]), 4)  # CURRENT + A/B/C
        self.assertEqual(len(artifacts["simulation"]["scenarios"]), 4)
        for comparison in artifacts["simulation"]["comparisons"]:
            self.assertTrue(math.isfinite(comparison["metrics"]["max_drawdown"]))
            self.assertLessEqual(comparison["metrics"]["max_drawdown"], 0)
            self.assertTrue(comparison["curve"])

        audit = response["audit_evidence"]
        self.assertEqual(audit["task_id"], task["task_id"])
        self.assertTrue(audit["events"])
        self.assertTrue(all(event["task_id"] == task["task_id"] for event in audit["events"]))

    def test_missing_input_stops_before_analysis(self):
        response = health_check_response({
            "contract_version": CONTRACT_VERSION,
            "request_id": "req-missing",
            "operation": OPERATION,
            "input": {},
        })
        self.assertEqual(response["task_state"]["status"], "WAITING_INPUT")
        self.assertFalse(response["task_state"]["execution_allowed"])
        self.assertIn("input.portfolio", response["task_state"]["missing_fields"])
        self.assertIn("input.risk_profile", response["task_state"]["missing_fields"])
        self.assertNotIn("artifacts", response)

    def test_demo_portfolio_keeps_cash_out_of_security_weights(self):
        snapshot = portfolio_contract_from_dict(portfolio_dict(fresh_portfolio()))
        security_weight = sum(item["weight"] for item in snapshot["positions"])
        self.assertAlmostEqual(security_weight + snapshot["cash_weight"], 1.0, places=5)
        self.assertEqual(snapshot["data_mode"], DATA_MODE)


if __name__ == "__main__":
    unittest.main()
