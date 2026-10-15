param(
  [string]$BaseUrl = 'https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev',
  [string]$ProxyUrl,
  [Parameter(Mandatory=$true)][string]$Deployment
)
$ErrorActionPreference = 'Stop'
$steps = [System.Collections.Generic.List[object]]::new()
function Call-Api([string]$Path, $Body, [int]$Expected = 200) {
  $requestOptions = @{ Uri = $BaseUrl + $Path; TimeoutSec = 60; SkipHttpErrorCheck = $true }
  if ($ProxyUrl) { $requestOptions.Proxy = $ProxyUrl }
  if ($null -ne $Body) {
    $requestOptions.Method = 'Post'; $requestOptions.ContentType = 'application/json'
    $requestOptions.Body = $Body | ConvertTo-Json -Depth 30 -Compress
  } else { $requestOptions.Method = 'Get' }
  $response = Invoke-WebRequest @requestOptions
  $data = $response.Content | ConvertFrom-Json
  $steps.Add([pscustomobject]@{path=$Path;http=[int]$response.StatusCode;code=$data.error.code;task_id=$data.task_id;trace_task_id=$data.trace.task_id})
  if ([int]$response.StatusCode -ne $Expected) { throw "Unexpected HTTP $($response.StatusCode) on $Path" }
  return $data
}
function Require($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$plan = Call-Api '/api/funding-demo/plan' @{
  synthetic=$true; confirmed=$true; currency='CNY'; cash_minor=1000000
  protected_purposes=@(@{purpose_id='rent';label='虚构房租';amount_minor=400000})
}
$results = [System.Collections.Generic.List[object]]::new()
foreach ($scenario in @('cancel_after_approval', 'normal_simulation')) {
  $record = Call-Api '/api/review' @{
    kind='combined';source='synthetic-decision-integrity-release'
    text='虚构案例：现金10000元，为房租保留4000元，拟投资1000元。核对用途冲突；不能执行真实交易。'
    action_parameters=@{synthetic=$true;currency='CNY';amount=1000;funding_plan_id=$plan.plan_id;funding_plan_revision=$plan.revision}
    context=@{synthetic=$true}
  }
  Require ($record.model.source -eq 'model' -and $record.model.model_response.call_succeeded -eq $true) 'No real model response'
  $binding = @{task_id=$record.task_id;proposal_sha256=$record.proposed_action.proposal_sha256}
  $blocked = Call-Api '/api/review/simulate' $binding 409
  Require ($blocked.error.code -eq 'EXECUTION_BLOCKED') 'Missing Risk gate'
  $callback = @{} + $binding
  $callback.callback_version='risk-callback.v1'; $callback.handoff_id=$record.risk_handoff.handoff_id
  $callback.request_id=$record.request_id; $callback.run_id=$record.run_id; $callback.audit_id=$record.audit.audit_id
  $callback.decision='APPROVE'; $callback.reviewer='synthetic-risk-owner'; $callback.reason='仅虚构复核，非独立Risk验收'
  $risk = Call-Api '/api/review/risk-callback' $callback
  Require ($risk.workflow.status -eq 'PENDING_APPROVAL') 'Missing approval gate'
  $approval = @{} + $binding
  $approval.decision='APPROVE'; $approval.approver='synthetic-user'; $approval.reason='只同意这次1000元模拟'
  $approved = Call-Api '/api/review/approval' $approval
  if ($scenario -eq 'cancel_after_approval') {
    $repeat = Call-Api '/api/review/approval' $approval
    Require ($repeat.approval.approval_id -eq $approved.approval.approval_id -and $repeat.audit.events.Count -eq $approved.audit.events.Count) 'Duplicate added evidence'
    foreach ($patch in @(@{approver='different-user'}, @{reason='different-reason'})) {
      $changed = @{} + $approval
      foreach ($key in $patch.Keys) { $changed[$key]=$patch[$key] }
      $conflict = Call-Api '/api/review/approval' $changed 409
      Require ($conflict.error.code -eq 'APPROVAL_IMMUTABLE' -and $conflict.trace.task_id -eq $record.task_id) 'Wrong conflict or trace'
      Require ($conflict.workflow.approval.approver -eq $approval.approver) 'Changed approval identity'
    }
    $invalid = @{} + $approval; $invalid.Remove('reason')
    $bad = Call-Api '/api/review/approval' $invalid 422
    Require ($bad.error.code -eq 'INVALID_WORKFLOW_INPUT') 'Invalid input accepted'
    $riskRequest = @{} + $binding; $riskRequest.decision='APPROVE'; $riskRequest.reviewer=$callback.reviewer; $riskRequest.reason=$callback.reason
    $null = Call-Api '/api/review/risk-decision' $riskRequest
    $riskRequest.reviewer='different-risk'
    $riskConflict = Call-Api '/api/review/risk-decision' $riskRequest 409
    Require ($riskConflict.error.code -eq 'RISK_DECISION_IMMUTABLE') 'Risk identity silently replaced'
    $cancel = @{} + $binding; $cancel.canceler='synthetic-user'; $cancel.reason='停止这次模拟'
    $cancelled = Call-Api '/api/review/cancel' $cancel
    $duplicate = Call-Api '/api/review/risk-callback' $callback
    Require ($cancelled.status -eq 'CANCELLED' -and $duplicate.workflow.status -eq 'CANCELLED' -and $duplicate.callback_status -eq 'DUPLICATE') 'Callback restored cancelled task'
    $blockedAgain = Call-Api '/api/review/simulate' $binding 409
    Require ($blockedAgain.error.code -eq 'EXECUTION_BLOCKED') 'Cancelled task executed'
  } else {
    $simulated = Call-Api '/api/review/simulate' $binding
    $repeat = Call-Api '/api/review/simulate' $binding
    Require ($simulated.status -eq 'SIMULATED' -and $simulated.execution.execution_id -eq $repeat.execution.execution_id) 'Normal path or dedup failed'
    Require ($simulated.execution.receipt.side_effects -eq $false) 'Unexpected financial effect'
  }
  $final = Call-Api ('/api/review/task/'+$record.task_id) $null
  $handoff = Call-Api ('/api/review/task/'+$record.task_id+'/risk-handoff') $null
  Require ($final.execution.execution_allowed -eq $false -and $handoff.execution_allowed -eq $false) 'Real execution enabled'
  if ($scenario -eq 'cancel_after_approval') {
    Require (@($final.audit.events | Where-Object {$_.event_type -eq 'workflow.operation_blocked'}).Count -ge 4) 'Missing blocked audit'
  }
  $results.Add([pscustomobject]@{scenario=$scenario;workflow=$final;handoff=$handoff})
}
[pscustomobject]@{
  checked_at=[DateTime]::UtcNow.ToString('o');deployment=$Deployment;passed=$true
  evidence_type='PUBLIC_REAL_MODEL_SYNTHETIC_DATA';network_route=$(if($ProxyUrl){'explicit-proxy'}else{'direct'})
  limitations='Public Risk/approval remain demo labels. Local concurrency is tested separately; no real transactions.'
  steps=$steps;results=$results
} | ConvertTo-Json -Depth 50
