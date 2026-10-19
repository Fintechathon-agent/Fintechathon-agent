import assert from "node:assert/strict";
import test from "node:test";
import { runGoldenPath } from "../experiments/golden-path-v1/run.mjs";

test("Golden Path binds model, Risk, approval, PAPER and audit to one task", async () => {
  const { result, log } = await runGoldenPath({ writeArtifacts: false });
  assert.equal(result.status, "PASS");
  assert.equal(log.length, 12);
  assert.equal(result.external_model_calls, 0);
  assert.equal(result.paid_model_calls, 0);
  assert.equal(result.formal_risk_service_called, false);
  assert.equal(result.real_execution_gateway_called, false);
  assert.equal(result.approved_flow.execution.side_effects, false);
  assert.equal(result.approved_flow.execution.execution_allowed, false);
  assert.equal(result.rejected_flow.execution_blocked_after_reject, true);
  assert.equal(result.assertions.same_task_bound_across_handoff_risk_approval_execution, true);
});

