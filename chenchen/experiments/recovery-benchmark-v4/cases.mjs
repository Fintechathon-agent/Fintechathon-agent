import { investmentCases } from "../dual-benchmark-v3/cases.mjs";

export const SEED = 2026101905;
export const STORAGE_MODES = ["reservation-fail", "model-save-fail", "model-ack-loss", "reservation-ack-loss",
  "cancel-save-fail", "approval-save-fail", "simulation-save-fail", "simulation-ack-loss", "plan-save-fail", "invalid-signature"];
export const CONCURRENT_MODES = ["same-key", "changed-key", "model-failure", "dispatch-cancel", "dispatch-reject",
  "dispatch-receipt", "dispatch-duplicate", "callback-duplicate", "approval-duplicate", "execution-changed"];

export function generateCases(seed = SEED) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError("seed must be uint32");
  let state = seed;
  const random = max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
  const rows = investmentCases(seed).filter(c => !["account_summary", "portfolio_validation"].includes(c.group));
  for (const [group, modes] of [["storage_fault", STORAGE_MODES], ["concurrent_workflow", CONCURRENT_MODES]]) {
    for (let i = 0; i < 1000; i++) {
      const mode = modes[i % modes.length], available = 1000 + random(1000000);
      const statuses = { "reservation-fail": "PENDING_RISK", "model-save-fail": "BLOCKED_UNCERTAIN",
        "model-ack-loss": "PENDING_RISK", "reservation-ack-loss": "BLOCKED_UNCERTAIN", "cancel-save-fail": "BLOCKED_UNCERTAIN",
        "approval-save-fail": "BLOCKED_UNCERTAIN", "simulation-save-fail": "BLOCKED_UNCERTAIN", "simulation-ack-loss": "SIMULATED",
        "plan-save-fail": "BLOCKED_UNCERTAIN", "invalid-signature": "PENDING_RISK",
        "same-key": "PENDING_RISK", "changed-key": "PENDING_RISK", "model-failure": "MODEL_FAILED",
        "dispatch-cancel": "CANCELLED", "dispatch-reject": "REJECTED", "dispatch-receipt": "SIMULATED",
        "dispatch-duplicate": "PENDING_RISK", "callback-duplicate": "PENDING_APPROVAL", "approval-duplicate": "READY_FOR_SIMULATION",
        "execution-changed": "READY_FOR_SIMULATION" };
      rows.push({ group, template: mode, data_mode: "SYNTHETIC_REPLAY",
        input: { mode, available_minor: available, rent_minor: 100 + random(1000000), requested_minor: 1 + random(available),
          retries: 2 + random(4), text: "合成测试" + seed + "-" + group + "-" + i + "：先保留房租再安排投资。" },
        expected: { status: statuses[mode], allocations: ["simulation-ack-loss", "dispatch-receipt"].includes(mode) ? 1 : 0 } });
    }
  }
  return rows.map((c, i) => ({ ...c, case_id: "recovery-" + String(i + 1).padStart(5, "0") }));
}
