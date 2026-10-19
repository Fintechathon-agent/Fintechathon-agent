import { generateCases as recoveryCases } from "../recovery-benchmark-v4/cases.mjs";

export const SEED = 2026101906;
export const FUNDING_MODES = ["exact-fit", "one-cent-short", "capacity-one", "rent-increase", "same-plan-reorder",
  "cancel-one", "risk-reject-one", "approval-expired", "post-execution-revise", "cross-plan-isolation"];
export const OWNER_MODES = ["risk-wrong-key", "approval-wrong-key", "risk-tampered", "approval-tampered", "callback-cross-task",
  "approval-cross-task", "callback-extra-field", "key-rotation", "api-missing", "canonical-retry"];

export function generateCases(seed = SEED) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError("seed must be uint32");
  let state = seed;
  const random = max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
  const rows = recoveryCases(seed);
  for (let i = 0; i < 2500; i++) {
    const mode = FUNDING_MODES[i % FUNDING_MODES.length], tasks = 2 + random(5), unit = i % 31 === 0 ? 1 : 1 + random(500000);
    const available = mode === "capacity-one" || mode === "cross-plan-isolation" ? unit : tasks * unit - (mode === "one-cent-short" ? 1 : 0);
    const successes = ["rent-increase", "approval-expired"].includes(mode) ? 0 : mode === "capacity-one" ? 1 : mode === "cross-plan-isolation" ? 2 :
      ["one-cent-short", "cancel-one", "risk-reject-one"].includes(mode) ? tasks - 1 : tasks;
    rows.push({ group: "funding_batch", template: mode, data_mode: "SYNTHETIC_REPLAY",
      input: { mode, tasks, unit_minor: unit, available_minor: available, rent_minor: 1 + random(1000000), tuition_minor: 1 + random(500000),
        retries: 2 + random(4), text: "合成多任务" + seed + "-" + i + "：房租学费不挪用。" },
      expected: { simulated_tasks: successes, allocated_minor: successes * unit } });
  }
  for (let i = 0; i < 2500; i++) {
    const mode = OWNER_MODES[i % OWNER_MODES.length];
    const code = mode === "api-missing" ? "AUTHENTICATION_REQUIRED" : mode === "callback-cross-task" ? "RISK_HANDOFF_MISMATCH" :
      mode === "approval-cross-task" ? "PROPOSAL_CHANGED" : mode === "callback-extra-field" ? "INVALID_RISK_CALLBACK" :
      mode === "canonical-retry" ? null : "OWNER_AUTH_INVALID";
    const status = code === "AUTHENTICATION_REQUIRED" || code === "OWNER_AUTH_INVALID" ? 401 :
      code === "INVALID_RISK_CALLBACK" ? 422 : code ? 409 : 200;
    rows.push({ group: "signed_owner_boundary", template: mode, data_mode: "SYNTHETIC_REPLAY",
      input: { mode, unit_minor: 1 + random(1000000), rent_minor: 1 + random(1000000), retries: 2 + random(4),
        trace_field: ["task_id", "request_id", "run_id", "audit_id", "handoff_id", "proposal_sha256"][Math.floor(i / OWNER_MODES.length) % 6],
        text: "合成签名与任务归属" + seed + "-" + i }, expected: { status, code, allocations: 1 } });
  }
  return rows.map((c, i) => ({ ...c, case_id: "integration-" + String(i + 1).padStart(5, "0") }));
}
