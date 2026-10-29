import { deriveAssessment } from "./assessment.mjs";
import { authorizeCapability } from "./permission.mjs";
import matrix from "./permission-catalog.mjs";

const environment = "ISOLATED_SYNTHETIC_WORKBENCH";
export function describeUnifiedPolicy() {
  const request = { capability: "public.read", resource_id: "unified-policy-help", purpose: "POLICY_HELP", audience: "PUBLIC", environment };
  const permission = authorizeCapability({ now: new Date().toISOString(), environment, public_resources: [{ resource_id: request.resource_id, purpose: request.purpose, audience: request.audience, environment }] }, request);
  return { contract_version: "unified-workbench-info.v1", policy_version: "risk-policy.v1.0", permission_policy_version: matrix.policy_version,
    permission, execution_allowed: false, joint_acceptance: "NOT_VERIFIED",
    implemented: ["DAILY_ASSESSMENT_SIDECAR", "SCOPED_PERMISSION_EVALUATOR", "WORKBENCH_PAPER_WRITE_DENIAL"],
    not_integrated: ["UNIFIED_END_USER_APPROVAL", "TEAM_HOSTED_SHARED_LEDGER", "PORTFOLIO_ASSESSMENT_ADAPTER", "ALL_CAPABILITY_ROUTE_ENFORCEMENT"],
    bands: [{code:"LOW",label:"低"},{code:"NOTICE",label:"关注"},{code:"ELEVATED",label:"较高"},{code:"HIGH",label:"高"},{code:"UNKNOWN",label:"未知"}],
    capabilities: matrix.capabilities.map(row => ({ capability: row.id, label: row.label, permission_level: row.permission_level,
      workbench_status: row.id === "public.read" ? "REGISTERED_POLICY_HELP_ONLY" : ["paper.reserve", "paper.commit", "real_trade.*"].includes(row.id) ? "CLOSED" : "EXISTING_OR_UNWIRED_SCOPE_NOT_UNIFIED_ACCEPTED" })) };
}

// The caller has already checked the server session and task ownership. This
// context grants nothing; an isolated demo cookie is not a verified bank user.
export function paperWritePermission(taskId) {
  return authorizeCapability({ environment, now: new Date().toISOString() }, {
    capability: "paper.commit", resource_id: taskId, purpose: "COMPLETE_PAPER_PLAN", audience: "UNIQUE_ACTION_GATEWAY", environment
  });
}

export function enrichDailyRecord(record) {
  if (record?.kind !== "DAILY_CASHFLOW" || !record.review) return record;
  return { ...record, unified_assessment: deriveAssessment(record.review),
    unified_permission: paperWritePermission(record.input.binding.task_id) };
}
