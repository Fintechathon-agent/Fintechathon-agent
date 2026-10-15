param(
  [string]$BaseUrl = 'https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev',
  [Parameter(Mandatory=$true)][string]$Deployment
)
$ErrorActionPreference = 'Stop'
$steps = [System.Collections.Generic.List[object]]::new()
function Call-Api([string]$Path, $Body, [int]$Expected = 200) {
  $args = @{ Uri = $BaseUrl + $Path; TimeoutSec = 60; SkipHttpErrorCheck = $true }
  if ($null -ne $Body) {
    $args.Method = 'Post'; $args.ContentType = 'application/json'
    $args.Body = $Body | ConvertTo-Json -Depth 30 -Compress
  } else { $args.Method = 'Get' }
  $response = Invoke-WebRequest @args
  $data = $response.Content | ConvertFrom-Json
  $steps.Add([pscustomobject]@{ path = $Path; http = [int]$response.StatusCode; code = $data.error.code })
  if ([int]$response.StatusCode -ne $Expected) { throw "Unexpected HTTP on $Path : $($response.StatusCode)" }
  return $data
}
$plan = Call-Api '/api/funding-demo/plan' @{
  synthetic = $true; confirmed = $true; currency = 'CNY'; cash_minor = 1000000
  protected_purposes = @(@{ purpose_id = 'rent'; label = '虚构房租'; amount_minor = 400000 })
}
$record = Call-Api '/api/review' @{
  kind = 'combined'; source = 'synthetic-retry-release-verification'
  text = '虚构案例：现金10000元，已为房租预留4000元，拟投入2000元。请复核用钱冲突。仅用于演示，不进行真实交易。'
  requested_action = '核对虚构资金用途后交给统一Risk'
  action_parameters = @{ synthetic = $true; currency = 'CNY'; amount = 2000; funding_plan_id = $plan.plan_id; funding_plan_revision = $plan.revision }
  context = @{ synthetic = $true }
}
if ($record.model.source -ne 'model' -or $record.model.model_response.call_succeeded -ne $true) { throw 'No real model response' }
if ($record.model.model_response.attempt_count -lt 1) { throw 'Missing attempt count' }
$binding = @{ task_id = $record.task_id; proposal_sha256 = $record.proposed_action.proposal_sha256 }
$blocked = Call-Api '/api/review/simulate' $binding 409
if ($blocked.error.code -ne 'EXECUTION_BLOCKED') { throw 'Expected Risk gate' }
$callback = @{} + $binding
$callback.callback_version = 'risk-callback.v1'; $callback.handoff_id = $record.risk_handoff.handoff_id
$callback.request_id = $record.request_id; $callback.run_id = $record.run_id; $callback.audit_id = $record.audit.audit_id
$callback.decision = 'APPROVE'; $callback.reviewer = 'synthetic-risk-demo'; $callback.reason = '虚构演示复核，不代表独立Risk联合验收'
$risk = Call-Api '/api/review/risk-callback' $callback
if ($risk.workflow.status -ne 'PENDING_APPROVAL') { throw 'Missing approval gate' }
$approval = @{} + $binding
$approval.decision = 'APPROVE'; $approval.approver = 'synthetic-owner'; $approval.reason = '只同意这笔2000元模拟动作'
$approved = Call-Api '/api/review/approval' $approval
if ($approved.status -ne 'READY_FOR_SIMULATION') { throw 'Expected ready for simulation' }
$simulated = Call-Api '/api/review/simulate' $binding
$repeat = Call-Api '/api/review/simulate' $binding
if ($simulated.status -ne 'SIMULATED' -or $simulated.execution.receipt.side_effects -ne $false) { throw 'Unsafe receipt' }
if ($simulated.execution.execution_id -ne $repeat.execution.execution_id) { throw 'Duplicate receipt' }
$restored = Call-Api ('/api/review/task/' + $record.task_id) $null
$handoff = Call-Api ('/api/review/task/' + $record.task_id + '/risk-handoff') $null
if ($restored.execution.execution_allowed -ne $false -or $handoff.execution_allowed -ne $false) { throw 'Execution unexpectedly enabled' }
if ($handoff.model.attempt_count -ne $restored.model.model_response.attempt_count) { throw 'Count mismatch' }
[pscustomobject]@{
  checked_at = [DateTime]::UtcNow.ToString('o'); deployment = $Deployment; passed = $true
  evidence_type = 'PUBLIC_REAL_MODEL_SYNTHETIC_BUSINESS_DATA'
  limitations = 'Fault recovery tested locally with injected errors; public call does not force upstream failure. Risk and approval are demo labels, not independent authenticated owners.'
  steps = $steps; workflow = $restored; handoff = $handoff
} | ConvertTo-Json -Depth 50
