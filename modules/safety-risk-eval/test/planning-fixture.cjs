"use strict";
// Synthetic contract substitute. Never use it as evidence of a live model call.
const f = require("./daily-fixture.cjs");
const text = "现金24万元。留学一年9万元，往返机票1.5万元，生活费4到6万元。剩余资金想all in科技基金，还想投资指数基金。想去欧洲旅游。";
function response(request) {
  const facts = JSON.parse(request.text), cash = facts.cash_yuan, expense = facts.known_expense_total_yuan.max, rest = facts.remainder_before_other_budgets_yuan.min;
  return f.modelResponse(request, { summary: `现金${cash}元，已知支出最高${expense}元，保守余款${rest}元；旅游、独立保底、占用与费用尚待核对。`,
    risk_level: "medium", proposed_action: "HOLD_FOR_REVIEW",
    action_reason: `【资金安排】先按支出上限预留${expense}元，余下${rest}元是旅游、应急和投资共同使用的预算。投资上限应从余款继续扣除尚未计入的旅游、应急保底、已有占用与费用，未知金额不能视为零。${facts.all_in_stress ? `假设投入乐观余款${facts.all_in_stress.hypothetical_investment_yuan}元，支出达到上限时缺口${facts.all_in_stress.shortfall_before_other_budgets_yuan}元。` : ""}【风险说明】一年内要使用的生活资金投入股票会面临波动，可能在付款时被迫亏损卖出。主题基金与指数可能有重叠，应查看实际持仓；海外支出涉及不同货币，也需为预算变化留出空间，不能依赖预期收益补齐缺口。`,
    missing_information: facts.question_candidates.slice(0, 5), evidence: [`现金${cash}元`, `支出上限${expense}元`, `保守余款${rest}元`, ...facts.expenses.filter(x => x.amount_range_yuan).map(x => `${x.purpose}预留${x.amount_range_yuan.max}元`)] });
}
module.exports = { text, response };
