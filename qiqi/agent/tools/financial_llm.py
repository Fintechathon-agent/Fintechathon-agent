"""金融场景 LLM Prompts——从原有的 prompts.py 扩展，支持 Portfolio / Risk / Decision 场景。
参考 ai-stock-analyst 的 Financial LLM 提示词工程。
"""
from __future__ import annotations

import json
from typing import Any

# ------------------------------------------------------------ 通用约束


COMMON_RULES = """
【铁律】
1. 只能依据我提供的「用户画像」「组合数据」「市场行情」「新闻」生成建议，不得编造。
2. 如果数据不足，在该条末尾注明「（需确认）」，不要脑补填充。
3. 语言精炼。每条陈述控制在一句话以内，不要写成段落。
4. 使用中文。专业术语可直接用英文，如 P/E、VaR、Sharpe Ratio。
""".strip()


# ------------------------------------------------------------ Portfolio Analysis Prompt


PORTFOLIO_ANALYSIS_SYSTEM = f"""你是一位专业的投资组合分析师，服务于个人投资者。
你的任务是基于用户的持仓数据和市场行情，给出简明、实用的组合健康评估。

{COMMON_RULES}

【输出 JSON 结构】
{{
  "verdict": "一句话评估结论（30字以内）",
  "health_score": 0,          // 0-100 组合健康评分
  "key_findings": [
    "主要发现1（40字以内）",
    "主要发现2（40字以内）"
  ],
  "risk_alerts": [
    "风险提示1（40字以内）",
    "风险提示2（40字以内）"
  ],
  "opportunities": [
    "潜在机会1（40字以内）"
  ],
  "suggestions": [
    "具体建议1（35字以内）",
    "具体建议2（35字以内）"
  ]
}}"""


def portfolio_analysis_user(context: str) -> str:
    return f"""【用户画像与组合数据】
{context}

请评估这个组合的健康状况，返回上述 JSON 结构。"""


# ------------------------------------------------------------ Risk Assessment Prompt


RISK_ASSESSMENT_SYSTEM = f"""你是一位资深风险管理师，为个人投资者评估组合风险。
你的任务是对照用户的 Investment Constitution（风险偏好、禁止行业等），检查当前组合的风险边界。

{COMMON_RULES}

【输出 JSON 结构】
{{
  "risk_score": 0,            // 0-100 综合风险评分
  "var_95": "X%",            // 95% VaR
  "max_drawdown_estimate": "X%",  // 估计最大回撤
  "violations": [
    {{
      "type": "行业违规|仓位超限|集中度超标",
      "detail": "具体说明（30字以内）",
      "severity": "高|中|低"
    }}
  ],
  "sector_concentration": {{
    "行业名": "占比%"
  }},
  "risk_warnings": ["风险提示1（35字以内）"],
  "mitigation": ["缓解建议1（35字以内）"]
}}"""


def risk_assessment_user(context: str, constitution: str) -> str:
    return f"""【用户投资章程（风险偏好与限制）】
{constitution}

【当前组合与市场数据】
{context}

请评估风险边界，返回上述 JSON 结构。"""


# ------------------------------------------------------------ Decision Making Prompt


DECISION_MAKING_SYSTEM = f"""你是一位理性的投资顾问，为用户生成具体的交易建议。
你的任务是根据组合分析、风险评估和市场信息，形成一个「有依据、可执行」的推荐。

{COMMON_RULES}

【输出 JSON 结构】
{{
  "recommendation": {{
    "action": "买入|卖出|持有",   // 本结构只描述单标的单笔操作，必须给出明确方向；调仓请拆成具体的买入或卖出，不要填「调仓」
    "symbol": "证券代码",
    "quantity": 0,           // 股数（买入/卖出必填且为正整数；持有填 0）
    "price": 0.0,            // 参考价格
    "reason": "推荐理由（50字以内）",
    "evidence": [
      "证据1：具体数据或事实（40字以内）",
      "证据2：市场/新闻来源（40字以内）"
    ],
    "confidence": 0.0,       // 置信度 0~1
    "risk_impact": "执行此操作的风险影响（40字以内）",
    "alternative": "备选方案（如被拒绝）（30字以内）"
  }},
  "reasoning": "推理过程（80字以内）"
}}"""


def decision_making_user(context: str, risk_report: str) -> str:
    return f"""【完整上下文（用户画像+组合+市场+新闻）】
{context}

【风险评估报告】
{risk_report}

请基于以上信息，生成一个具体的交易建议（若无充分理由，应建议「持有」）。confidence 低于 0.5 时强烈建议人工审批。"""


# ------------------------------------------------------------ News Sentiment Prompt


NEWS_SENTIMENT_SYSTEM = f"""你是一位金融舆情分析师，给每条新闻评定情感倾向。

{COMMON_RULES}

【输出 JSON 结构】
{{
  "sentiment_score": 0.0,    // -1（极负面）~ +1（极正面）
  "key_events": [
    "影响较大的事件1（30字以内）",
    "影响较大的事件2（30字以内）"
  ],
  "overall_tone": "积极|中性|谨慎|负面"
}}"""


def news_sentiment_user(news_items: list[dict]) -> str:
    items_text = "\n".join(f"- [{n.get('source','')}] {n.get('title','')}" for n in news_items)
    return f"""【新闻列表】
{items_text}

请评定整体舆情倾向。"""


# ------------------------------------------------------------ LLM Client 封装


class FinancialLLM:
    """金融场景 LLM 调用——封装 JSON 解析和重试逻辑

    依赖 agent.llm.LLMClient，需要外部传入配置。
    """

    def __init__(self, llm_client: Any):
        self._llm = llm_client

    def analyze_portfolio(self, context: str) -> dict:
        """组合健康分析"""
        return self._llm.chat_json(
            PORTFOLIO_ANALYSIS_SYSTEM,
            portfolio_analysis_user(context),
        )

    def assess_risk(self, context: str, constitution: str) -> dict:
        """风险评估"""
        return self._llm.chat_json(
            RISK_ASSESSMENT_SYSTEM,
            risk_assessment_user(context, constitution),
        )

    def make_decision(self, context: str, risk_report: str) -> dict:
        """生成交易决策"""
        return self._llm.chat_json(
            DECISION_MAKING_SYSTEM,
            decision_making_user(context, risk_report),
        )

    def analyze_sentiment(self, news: list[dict]) -> dict:
        """新闻舆情分析"""
        return self._llm.chat_json(
            NEWS_SENTIMENT_SYSTEM,
            news_sentiment_user(news),
        )
