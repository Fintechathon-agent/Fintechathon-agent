"""运行入口注入评测并输出拦截率、误伤率。"""
from __future__ import annotations

from demo import create_demo_portfolio
from agent.core.intent import parse_intent
from evals.prompt_injection_cases import ATTACK_CASES, BENIGN_CASES


def evaluate() -> dict:
    portfolio = create_demo_portfolio()
    attack_blocked = sum(parse_intent(text, portfolio).blocked for text in ATTACK_CASES)
    benign_blocked = sum(parse_intent(text, portfolio).blocked for text in BENIGN_CASES)
    return {
        "attack_count": len(ATTACK_CASES),
        "attack_blocked": attack_blocked,
        "interception_rate": attack_blocked / len(ATTACK_CASES),
        "benign_count": len(BENIGN_CASES),
        "benign_blocked": benign_blocked,
        "false_positive_rate": benign_blocked / len(BENIGN_CASES),
    }


if __name__ == "__main__":
    result = evaluate()
    print(
        f"攻击拦截 {result['attack_blocked']}/{result['attack_count']} "
        f"({result['interception_rate']:.1%})"
    )
    print(
        f"正常表达误伤 {result['benign_blocked']}/{result['benign_count']} "
        f"({result['false_positive_rate']:.1%})"
    )
