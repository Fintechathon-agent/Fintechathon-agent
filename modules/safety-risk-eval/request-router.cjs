"use strict";
const { extract } = require("../../chenchen/experiments/life-planning-v1/intake.js");
const { parseAmount, hash, fail } = require("../../team-staging/risk/long-text/parser.cjs");
const VERSION = "assistant-intents.v1";
// Intent routing describes capabilities, never approval or execution authority.
const CATEGORIES = [
  ["BUDGET_PLAN", "整体资金安排", "BUDGET", "按已知金额先算预算，再确认时间与用途"],
  ["CASH", "余额与可用资金", "BUDGET", "区分可用余额、已冻结资金与现有资产"],
  ["INCOME", "收入与退款", "BUDGET", "区分已到账、预计到账和已包含在余额中的收入"],
  ["EXPENSE", "生活支出与消费", "BUDGET", "归集必要支出与可选消费，核对金额和日期"],
  ["DEBT", "借款与还款", "BUDGET", "先纳入现金流；利息比较和提前还款决策另需合同资料"],
  ["SAVINGS", "储蓄与应急金", "BUDGET", "区分自由现金、专款预留与不可赎回资产"],
  ["INVESTMENT", "投资意向与资金安排", "BUDGET", "先检查资金是否被生活用途占用，再核对投资期限和风险"],
  ["PORTFOLIO", "持仓与投资风险分析", "PORTFOLIO", "进入投资演示，实际分析仍需持仓、成本和可核验行情"],
  ["COMPARISON", "商品比价", "NOT_CONNECTED", "已归类；当前工作台未接通比价工具，需商品规格与有效报价"],
  ["SUBSCRIPTION", "订阅与自动续费", "BUDGET_ONLY", "可以测算扣费影响；取消订阅仍须到服务商确认"],
  ["TRANSFER", "转账与资金调拨", "NOT_CONNECTED", "已归类；当前工作台没有真实转账或账户操作通道"],
  ["ACCOUNT_SECURITY", "账户安全与异常交易", "OFFICIAL_CHANNEL", "涉及挂失、盗刷或冻结，应联系银行官方渠道核实处理"],
  ["EXPLANATION", "概念与规则咨询", "NOT_CONNECTED", "属于知识咨询，不应自动生成一笔投资或支出"],
  ["CONTEXT", "背景与表达", "CONTEXT", "保留为背景，不作为独立资金操作"],
  ["UNKNOWN", "尚不能可靠归类", "CLARIFY", "先明确希望办理的事情，不猜金额或业务类型"]
].map(([code, label, capability, next_step]) => ({ code, label, capability, next_step }));
const byCode = Object.fromEntries(CATEGORIES.map(x => [x.code, x]));
function codesFor(s) {
  const codes = new Set(), add = c => codes.add(c);
  const security = /盗刷|挂失|丢(?:了|失).*卡|卡.*丢(?:了|失)|陌生扣款|异常交易|账户.*(?:冻结|被盗)|密码.*泄露|诈骗/u.test(s);
  const concept = /是什么|什么意思|什么叫|怎么理解|解释一下|有什么区别|如何计算|为什么.*(?:涨|跌)|什么是/u.test(s);
  const comparison = /比价|比较.*(?:价格|报价)|哪(?:里|个|家).*(?:便宜|划算)|同款.*(?:平台|价格)|(?:京东|淘宝|拼多多).*(?:便宜|优惠|价格)/u.test(s);
  const subscription = /订阅|续费|自动扣费|自动扣款|会员/u.test(s);
  const debt = /房贷|车贷|信用卡.*(?:还|欠|账单)|(?:还|偿还|欠).*信用卡|还款|还债|还贷|借款|贷款|花呗|白条/u.test(s);
  const portfolio = /持仓|持有|仓位|市值|组合.*(?:风险|分析|诊断)|(?:诊断|分析|检查).*组合|调仓|赎回|卖出/u.test(s);
  const budget = /资金.*(?:规划|安排|分配)|规划.*(?:资金|预算)|预算.*(?:规划|安排|够)|(?:钱|余额).*(?:怎么分|怎么安排|够不够|不够|紧张)|(?:能|可以).*(?:投资多少|投多少)|帮我.*(?:做预算|规划开销)/u.test(s);
  if (security) add("ACCOUNT_SECURITY");
  if (comparison) add("COMPARISON");
  if (concept) add("EXPLANATION");
  if (subscription && !security && !concept) add("SUBSCRIPTION");
  if (debt && !security && !concept) add("DEBT");
  if (/转账|转给|汇款|转入|转出|划转|转到/u.test(s) && !concept && !security) add("TRANSFER");
  if (/工资|薪水|月薪|收入|奖金|报销|回款|退款|退回|奖学金/u.test(s) && !concept) add("INCOME");
  if (/应急|备用金|保底|存钱|储蓄|定期存款|存(?:个|一|三|五|十|\d)|养老金/u.test(s) && !concept) add("SAVINGS");
  if (portfolio && !concept) add("PORTFOLIO");
  if (/投资|定投|买(?:入|基金|股票)|申购|加仓|all\s*in|梭哈|纳斯达克|纳指/iu.test(s) && !concept && !comparison && !budget && (!portfolio || /定投|买(?:入|基金|股票)|申购|加仓/u.test(s))) add("INVESTMENT");
  if (/现金|余额|活期|手头|可用资金|银行卡.*(?:有|剩)/u.test(s) && !security && !concept) add("CASH");
  const refund = /退款|退回|报销/u.test(s);
  if (/房租|租金|学费|教育费|培训费|生活费|水电|医疗|看病|手术|保费|保险费|消费|支出|开销|购物|(?:买|换|购置).{0,4}(?:手机|电脑)|留学.*(?:费|花)|机票|车票|住宿|旅游|旅行|签证|交通费|吃饭|餐费|装修|婚礼/u.test(s) && !refund && !comparison && !concept && !security && !subscription && !debt) add("EXPENSE");
  if (budget) add("BUDGET_PLAN");
  if (!codes.size) add(/你好|谢谢|好的|如下[：:]?$|想法[：:]?$|在(?:德国|法国|英国|日本|美国)(?:留学|上学)|留学的(?:地方|地点)/u.test(s) ? "CONTEXT" : "UNKNOWN");
  return [...codes];
}
function classify(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => k !== "text")) fail("INVALID_FIELDS", "需求分类只接收原文text");
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 20000) fail("INVALID_TEXT", "请填写1至20,000字的需求");
  let source;
  try { source = extract({ text: input.text, data_mode: "SYNTHETIC_REPLAY" }); } catch { fail("INVALID_TEXT", "请缩短原文，每次最多80个基础语句"); }
  const clauses = source.candidates.map((c, index) => {
    const codes = codesFor(c.text), amounts = parseAmount(c.text);
    const suppressed = ["CANCELLED", "COMPLETED"].includes(c.classification.status) || c.classification.subject === "THIRD_PARTY";
    const uncertain = ["NEGATED", "AMBIGUOUS", "CORRECTION", "CONDITIONAL", "CANCELLATION_REQUESTED"].includes(c.classification.status);
    return { id: "request-part-" + index, text: c.text, source_span: c.source_span, categories: codes,
      state: suppressed ? "BACKGROUND" : uncertain ? "NEEDS_CONFIRMATION" : "ACTIVE", classification: c.classification,
      amounts: amounts.amounts, amount_range_minor: amounts.amount_range_minor, amount_issues: amounts.issues,
      routing_note: suppressed ? "已发生、取消或他人情况，仅保留背景" : uncertain ? "条件、否定或更正需要核对，不能直接执行" : "识别为候选需求，请核对分类" };
  });
  const groups = CATEGORIES.map(category => ({ ...category, clauses: clauses.filter(c => c.categories.includes(category.code)).map(c => c.id) })).filter(x => x.clauses.length);
  const active = groups.filter(g => g.capability !== "CONTEXT" && clauses.some(c => g.clauses.includes(c.id) && c.state !== "BACKGROUND"));
  const funding = active.filter(g => ["BUDGET", "BUDGET_ONLY"].includes(g.capability));
  const questions = [];
  for (const group of active) {
    const selected = clauses.filter(c => group.clauses.includes(c.id) && c.state !== "BACKGROUND"), anyMoney = selected.some(c => c.amounts.length);
    if (group.code === "UNKNOWN") questions.push({ category: group.code, question: "这部分是想查询、规划、比较还是办理一项操作？请具体描述。" });
    if (group.code === "COMPARISON") questions.push({ category: group.code, question: "要比较的商品型号、配置、平台到手价和报价时间分别是什么？" });
    if (group.code === "PORTFOLIO") questions.push({ category: group.code, question: "要分析哪些持仓，其份额、成本、持有期限和数据日期是什么？" });
    if (group.code === "TRANSFER") questions.push({ category: group.code, question: "这是自己账户之间调拨还是对外转账，是否已经完成？请勿在此填写密码或验证码。" });
    if (group.code === "ACCOUNT_SECURITY") questions.push({ category: group.code, question: "是哪类异常、何时发现，是否已通过银行官方渠道挂失或核实？" });
    if (group.code === "SUBSCRIPTION") questions.push({ category: group.code, question: "希望计算续费影响还是取消订阅？扣费周期和下一次扣费日是什么？" });
    if (group.code === "DEBT") questions.push({ category: group.code, question: "这是新增借款还是偿还现有债务？到期日、最低应还额及利率是什么？" });
    if (["CASH", "INCOME", "EXPENSE", "SAVINGS", "INVESTMENT"].includes(group.code) && !anyMoney) questions.push({ category: group.code, question: `${group.label}涉及的金额或预算范围是多少？` });
  }
  return { schema_version: VERSION, method: "EXPLAINABLE_RULE_ROUTING", source_sha256: hash(input.text), source_text: input.text, clauses, groups,
    relationships: funding.length > 1 ? [{ type: "SHARED_BUDGET", categories: funding.map(g => g.code), message: "这些事项共用同一笔资金：统一核对预算，收入到账前不当作可用现金，投资不能重复使用余款。" }] : [],
    next_actions: [
      ...(funding.length ? [{ code: "BUDGET", label: "带着原文进入预算核对", available: true, route: "/risk/long-text", description: "继续拆分金额与日期，再生成资金建议；未确认事项不会获得执行权。" }] : []),
      ...(active.some(g => g.code === "PORTFOLIO") ? [{ code: "PORTFOLIO", label: "进入持仓风险演示", available: true, route: "/risk?mode=investment", description: "仅演示数据；本段原文不会冒充真实持仓。" }] : [])
    ], questions, execution_allowed: false, risk_approval_granted: false, side_effects: false };
}
function coverage(corpus) {
  const outcomes = corpus.cases.map(row => {
    const actual = classify({ text: row.text }).groups.map(x => x.code).sort();
    return { id: row.id, split: row.split, passed: JSON.stringify(actual) === JSON.stringify([...row.expected].sort()), actual, expected: row.expected };
  });
  return { taxonomy_version: VERSION, dataset_version: corpus.version, provenance: corpus.provenance, total: outcomes.length,
    passed: outcomes.filter(x => x.passed).length, failures: outcomes.filter(x => !x.passed),
    splits: ["development", "regression"].map(split => ({ split, count: outcomes.filter(x => x.split === split).length, passed: outcomes.filter(x => x.split === split && x.passed).length })),
    categories: CATEGORIES.map(c => ({ ...c, samples: corpus.cases.filter(x => x.expected.includes(c.code)).length })),
    limitations: "这是开发时编写的合成回归集，不是训练数据，也不是独立真实用户准确率；真实匿名样本仍需经同意采集与人工标注。" };
}
module.exports = { VERSION, CATEGORIES, classify, coverage };
