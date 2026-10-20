import { generateCases as previous } from "../integration-benchmark-v5/cases.mjs";

export const SEED = 2026102001;
export const REPORT_MODES = ["gain", "loss", "flat", "tiny-loss", "tiny-gain", "same-drop", "worse-drop", "zero-cash",
  "living-soon", "low-tolerance", "missing-metric", "null-plan", "duplicate-plan", "cross-snapshot", "missing-baseline",
  "future-date", "unknown-data-mode", "missing-profile", "escaped-name", "invalid-date"];

export function generateCases(seed = SEED) {
  let state = seed;
  const random = max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
  // Keep 80% of every old template, rather than dropping entire failure categories.
  const groups = Map.groupBy(previous(seed), c => c.group + ":" + c.template);
  const rows = [...groups.values()].flatMap(items => items.slice(0, items.length * 0.8));
  if (rows.length !== 8000) throw new Error("Expected 8000 core cases");
  for (let i = 0; i < 2000; i++) {
    const mode = REPORT_MODES[i % REPORT_MODES.length], unit = (1 + random(900)) / 10000;
    const change = mode === "flat" ? 0 : mode === "tiny-loss" ? -0.000001 : mode === "tiny-gain" ? 0.000001 : mode === "gain" ? unit : -unit;
    const base = -0.04, best = mode === "worse-drop" ? -0.06 : mode === "same-drop" ? base : -0.02;
    const comparison = (id, dd) => ({ plan_id: id, turnover: id === "CURRENT" ? 0 : .1,
      metrics: { cumulative_return: change, max_drawdown: dd } });
    const input = { observedOn: "2026-10-20", result: { task_state: { task_id: "report-fixture-" + seed + "-" + i,
      status: "HANDOFF_REQUIRED", stage: "RISK_CHECK", portfolio_snapshot_id: "synthetic-snapshot",
      risk_profile: { investment_horizon_days: mode === "living-soon" ? 30 : 365, max_drawdown: mode === "low-tolerance" ? .02 : .1, liquidity_need: "medium" } },
      artifacts: { portfolio_snapshot: { snapshot_id: "synthetic-snapshot", as_of: "2026-10-19", cash_weight: mode === "zero-cash" ? 0 : .25,
        positions: [{ instrument_id: "FUND_A", name: mode === "escaped-name" ? '<img src=x onerror="alert(1)">' : "合成基金" + random(100000) }] },
        health_report: { snapshot_id: "synthetic-snapshot", concentration: { top_1: .3, largest_instrument: "FUND_A" },
          data_window: { start: "2026-10-13", end: "2026-10-19", observations: 7 } },
        simulation: { snapshot_id: "synthetic-snapshot", assumptions: { data_mode: "SYNTHETIC_REPLAY" }, historical_window: { start: "2026-10-13", end: "2026-10-19" },
          comparisons: [comparison("CURRENT", base), comparison("A", best - .02), comparison("B", best - .01), comparison("C", best)] } } } };
    const r = input.result, s = r.artifacts.simulation;
    if (mode === "missing-metric") delete s.comparisons[0].metrics.cumulative_return;
    if (mode === "null-plan") s.comparisons[1] = null;
    if (mode === "duplicate-plan") s.comparisons[2] = s.comparisons[1];
    if (mode === "cross-snapshot") s.snapshot_id = "other-snapshot";
    if (mode === "missing-baseline") s.comparisons.shift();
    if (mode === "future-date") r.artifacts.portfolio_snapshot.as_of = "2099-01-01";
    if (mode === "unknown-data-mode") s.assumptions.data_mode = "LIVE";
    if (mode === "missing-profile") r.task_state.risk_profile = null;
    if (mode === "invalid-date") r.artifacts.health_report.data_window.start = "2026-02-30";
    const blocked = ["missing-metric", "null-plan", "duplicate-plan", "cross-snapshot", "missing-baseline", "future-date", "unknown-data-mode", "missing-profile", "invalid-date"].includes(mode);
    rows.push({ group: "readable_report", template: mode, data_mode: "SYNTHETIC_REPLAY", input,
      expected: { available: !blocked, change, drawdown: .04, cash: mode === "zero-cash" ? 0 : .25,
        comparison_code: mode === "worse-drop" ? "MORE_DROP" : mode === "same-drop" ? "SAME_DROP" : "LESS_DROP" } });
  }
  return rows.map((c, i) => ({ ...c, case_id: "readable-" + String(i + 1).padStart(5, "0") }));
}
