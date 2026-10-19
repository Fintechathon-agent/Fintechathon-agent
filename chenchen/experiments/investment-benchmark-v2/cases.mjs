import { generateCases as generateOriginal } from "../investment-benchmark-v1/cases.mjs";

export const SEED = 2026101902;

// Keep v1 untouched. Both halves use fresh seeds; only the second half adds new
// boundary templates. Expected classifications are authored before execution.
export function generateCases(seed = SEED) {
  const first = generateOriginal(seed);
  const second = generateOriginal((seed + 1) >>> 0);
  const amounts = second.filter(c => c.group === "small_amount");
  for (let i = 0; i < amounts.length; i++) {
    const cents = 1 + (seed + i * 17) % 99;
    const decimal = (cents / 100).toFixed(2);
    const phrases = [
      [`退款-${decimal}元。`, [`-${decimal}元`]],
      ["餐费￥0.00。", ["￥0.00"]],
      [`支付1元0角${cents % 10}分。`, [`1元0角${cents % 10}分`]],
      [`支付¥ ${decimal.slice(1)}。`, [`¥ ${decimal.slice(1)}`]],
      [`💬先付${decimal}元；再付0.001元。`, [`${decimal}元`, "0.001元"]],
      [`收益率${decimal}%，等待5分钟。`, []],
      [`考试考了${cents}分。`, []],
      [`比赛评分${decimal}分。`, []],
      [`视频时长${cents}分。`, []],
      ["餐费五分。", ["五分"]]
    ];
    const [text, mentions] = phrases[i % phrases.length];
    Object.assign(amounts[i], { template: "boundary-" + i % phrases.length, input: { text }, expected: { mentions } });
  }
  const semantics = second.filter(c => c.group === "life_semantics");
  for (let i = 0; i < semantics.length; i++) {
    const n = 1 + (seed + i * 29) % 10000;
    const phrases = [
      [`我不是不想买基金${n}元。`, "AMBIGUOUS"],
      [`我并非不打算投资${n}元。`, "AMBIGUOUS"],
      [`我没有说不买基金${n}元。`, "AMBIGUOUS"],
      [`我不一定买基金${n}元。`, "AMBIGUOUS"],
      [`我未必会买基金${n}元。`, "AMBIGUOUS"],
      [`我可能会投资${n}元。`, "AMBIGUOUS"],
      [`我是否买基金${n}元？`, "AMBIGUOUS"],
      [`我想买基金${n}元又不想买。`, "AMBIGUOUS"],
      [`我计划买基金${n}元。`, "PLANNED"],
      [`我已付房租${n}元。`, "COMPLETED"]
    ];
    const [text, status] = phrases[i % phrases.length];
    Object.assign(semantics[i], { template: "uncertainty-" + i % phrases.length, input: { text }, expected: { statuses: [status] } });
  }
  const changes = second.filter(c => c.group === "reliability");
  const payloads = [
    { amount: 0.01 }, { currency: "USD" }, { action_parameters: { amount: 8000 } },
    { funding_plan_revision: 999 }, { proposal_sha256: "f".repeat(64) }
  ];
  for (let i = 0; i < changes.length; i++) {
    const variant = i % payloads.length;
    // Every entry here follows an actual signed local Risk and approval path.
    changes[i].template = "post-approval-change-" + variant;
    changes[i].input.mode = "changed-approval";
    changes[i].input.execution_change = structuredClone(payloads[variant]);
    changes[i].expected = { status: "READY_FOR_SIMULATION",
      error_code: variant === 4 ? "PROPOSAL_CHANGED" : "UNEXPECTED_ACTION_FIELDS" };
  }
  return [...first, ...second].map((c, i) => ({ ...c, case_id: "extended-" + String(i + 1).padStart(4, "0") }));
}
