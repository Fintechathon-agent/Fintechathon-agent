"use strict";

const { hash, MODES, fail } = require("./intake");
const { iso } = require("./planning");

// Consume the shared ReportArtifact 1.0 shape; do not introduce a renderer contract.
function buildReport(plan, trace = {}) {
  if (plan?.contract_version !== "life-planning.draft.v1" || !MODES.includes(plan.data_mode)) fail("INVALID_INPUT", "A life planning result is required");
  iso(plan.as_of, "as_of");
  for (const field of ["run_id", "audit_id"]) if (trace[field] != null && (typeof trace[field] !== "string" || trace[field].length > 200)) fail("INVALID_INPUT", "Invalid report trace");
  const demo = plan.data_mode !== "LIVE";
  const disclaimer = demo ? "虚构案例，仅验证整理与比价流程；未调用真实模型、账户或交易。"
    : "用户提供的信息尚未核实；不是账户查询结果、风险结论或付款授权。";
  const provenance = [{ source: demo ? "demo" : "user_import", dataset: "life-planning-" + plan.plan_sha256,
    as_of: plan.as_of, note: "报价、商品对应关系和账单均来自调用者；未抓取平台或查询账户。" }];
  const textStatus = { COMPARABLE: "可比较", EXCLUDED: "信息不齐或不符合条件" };
  return {
    artifact_id: "art_life_" + hash(plan).slice(0, 20), title: "购物与未来账单核对表",
    period: plan.as_of.slice(0, 10), subtitle: "先看清要花哪些钱，再决定下一步",
    meta: { mode: demo ? "demo" : "live", generated_at: plan.as_of, generated_by: "agent",
      contract_version: "1.0", sensitivity: "private", run_id: trace.run_id || "", audit_refs: trace.audit_id ? [trace.audit_id] : [], disclaimer },
    layout: { page_size: "A4", orientation: "portrait", density: "comfortable", show_toc: false },
    provenance, export_formats: [],
    sections: [
      { section_id: "summary", title: "先看这里", page_break_before: false, blocks: [
        { kind: "callout", tone: "warn", text: disclaimer },
        { kind: "metrics", metrics: [{ label: "已知购物与待扣账单合计",
          value: plan.known_purchase_and_bills_minor == null ? "暂不能计算" : plan.known_purchase_and_bills_minor / 100,
          unit: "元", tone: "neutral", note: "不含房租学费等其他用途，不代表可用余额。" }] },
        { kind: "text", text: plan.incomplete ? "有条件或账单待核实，合计不完整。" : "合计基于提供的报价与账单，实际结算前仍需核对。" }
      ] },
      { section_id: "quotes", title: "价格怎么算出来", page_break_before: false, blocks: [
        { kind: "table", columns: ["平台", "商品小计", "运费", "其他费用", "优惠", "合计", "状态", "来源"],
          column_formats: ["text", "money", "money", "money", "money", "money", "text", "text"],
          rows: plan.comparison.quotes.map(q => [q.platform, q.subtotal_minor / 100,
            q.shipping_minor == null ? null : q.shipping_minor / 100,
            q.fees_minor == null ? null : q.fees_minor / 100,
            q.discount_minor == null ? null : q.discount_minor / 100,
            q.total_minor == null ? null : q.total_minor / 100, textStatus[q.status], q.source_ref]) }
      ] },
      { section_id: "bills", title: "接下来可能扣的钱", page_break_before: true, blocks: [
        { kind: "table", columns: ["服务", "预计金额", "到期时间", "核对状态", "来源"],
          column_formats: ["text", "money", "date", "text", "text"], rows: plan.subscriptions.bills.map(b => [b.service,
            b.amount_minor == null ? null : b.amount_minor / 100, b.due_at, b.schedule_status, b.source_ref]) },
        { kind: "bullets", items: plan.follow_up }
      ] }
    ]
  };
}
module.exports = { buildReport };
