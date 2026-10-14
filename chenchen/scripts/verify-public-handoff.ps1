param(
  [string]$BaseUrl = 'https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev',
  [string]$ProxyUrl = '',
  [string]$DeploymentVersion = ''
)
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
  checked_at = (Get-Date).ToUniversalTime().ToString('o')
  deployment_version = $DeploymentVersion
  base_url = $BaseUrl
  synthetic = $true
  risk_actor = 'scripted-demo-reviewer; not an authenticated external Risk service'
  network = $(if ($ProxyUrl) { 'local HTTP proxy' } else { 'direct' })
  checks = [System.Collections.Generic.List[object]]::new()
  passed = $false
}
function Assert-Condition($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Invoke-Check([string]$Name, [string]$Path, $Body, [int]$ExpectedStatus = 200) {
  $options = @{ Uri = $BaseUrl.TrimEnd('/') + $Path; TimeoutSec = 65; SkipHttpErrorCheck = $true; Method = 'GET' }
  if ($ProxyUrl) { $options.Proxy = $ProxyUrl }
  if ($null -ne $Body) {
    $options.Method = 'POST'
    $options.ContentType = 'application/json; charset=utf-8'
    $options.Body = $Body | ConvertTo-Json -Depth 30 -Compress
  }
  if ($env:CORE_AGENT_API_KEY) { $options.Headers = @{ 'X-Core-Agent-Key' = $env:CORE_AGENT_API_KEY } }
  $response = Invoke-WebRequest @options
  $data = $response.Content | ConvertFrom-Json -Depth 100
  $report.checks.Add([ordered]@{ name = $Name; at = (Get-Date).ToUniversalTime().ToString('o'); method = $options.Method; path = $Path; http_status = [int]$response.StatusCode; request = $Body; response = $data })
  Assert-Condition ($response.StatusCode -eq $ExpectedStatus) "$Name returned HTTP $($response.StatusCode), expected $ExpectedStatus"
  return $data
}
try {
  $null = Invoke-Check 'health' '/health' $null
  foreach ($decision in @('APPROVE', 'REJECT', 'REQUEST_MORE_INFO')) {
    $created = Invoke-Check "$decision/model" '/api/review' @{
      request_id = 'req-handoff-20261014-' + [guid]::NewGuid().ToString()
      kind = 'bill'; source = 'synthetic-public-handoff-verification'
      text = '虚构案例：可用现金10000元，下个月房租4000元，拟再投入8000元买基金。请检查用途冲突，并把拟议动作交给Risk复核，不能直接执行。'
      requested_action = '检查追加投资是否影响房租安排'
      action_parameters = @{ amount = 8000; currency = 'CNY'; synthetic = $true }
      context = @{ synthetic = $true; user_goal = '保护房租安排'; cash_balance = 10000; rent_due = 4000 }
    }
    Assert-Condition ($created.model.source -eq 'model' -and $created.model.model_response.call_succeeded) 'Real model evidence missing'
    Assert-Condition ($created.status -eq 'PENDING_RISK') 'Initial Risk guard missing'
    $handoff = Invoke-Check "$decision/export" "/api/review/$($created.run_id)/risk-handoff" $null
    Assert-Condition ($handoff.audit_id -eq $created.audit.audit_id -and $handoff.handoff_version -eq 'risk-handoff.v1') 'Handoff evidence mismatch'
    $callback = @{
      callback_version = 'risk-callback.v1'; handoff_id = $handoff.handoff_id
      task_id = $handoff.task_id; request_id = $handoff.request_id; run_id = $handoff.run_id
      audit_id = $handoff.audit_id; proposal_sha256 = $handoff.proposal.proposal_sha256
      decision = $decision; reviewer = 'synthetic-public-test-risk'
      reason = "Demo $decision branch for transport and execution guards; not a financial approval"
    }
    $base = @{ task_id = $created.task_id; proposal_sha256 = $created.proposed_action.proposal_sha256 }
    $blocked = Invoke-Check "$decision/pending-risk-guard" '/api/review/simulate' $base 409
    Assert-Condition ($blocked.error.code -eq 'EXECUTION_BLOCKED') 'Pending Risk did not block'
    $bad = $callback.Clone(); $bad.run_id = 'wrong-run'
    $mismatch = Invoke-Check "$decision/mismatch" '/api/review/risk-callback' $bad 409
    Assert-Condition ($mismatch.error.code -eq 'RISK_HANDOFF_MISMATCH') 'Wrong run was not rejected'
    $recorded = Invoke-Check "$decision/callback" '/api/review/risk-callback' $callback
    Assert-Condition ($recorded.callback_status -eq 'RECORDED') 'Callback not recorded'
    $duplicate = Invoke-Check "$decision/retry" '/api/review/risk-callback' $callback
    Assert-Condition ($duplicate.callback_status -eq 'DUPLICATE' -and $duplicate.workflow.audit.events.Count -eq $recorded.workflow.audit.events.Count) 'Duplicate callback changed audit'
    if ($decision -eq 'APPROVE') {
      if ($recorded.workflow.approval.required) {
        $null = Invoke-Check 'APPROVE/pending-approval-guard' '/api/review/simulate' $base 409
        $approval = $base.Clone(); $approval.decision = 'APPROVE'; $approval.approver = 'synthetic-human-test'; $approval.reason = 'Synthetic approval for simulation only'
        $null = Invoke-Check 'APPROVE/approval' '/api/review/approval' $approval
      }
      $simulation = Invoke-Check 'APPROVE/simulation' '/api/review/simulate' $base
      Assert-Condition ($simulation.status -eq 'SIMULATED' -and $simulation.execution.receipt.side_effects -eq $false) 'Simulation receipt invalid'
      $retry = Invoke-Check 'APPROVE/retry-after-terminal' '/api/review/risk-callback' $callback
      Assert-Condition ($retry.callback_status -eq 'DUPLICATE' -and $retry.workflow.status -eq 'SIMULATED') 'Terminal callback retry changed workflow'
    } else {
      $blocked = Invoke-Check "$decision/execution-guard" '/api/review/simulate' $base 409
      Assert-Condition ($blocked.error.code -eq 'EXECUTION_BLOCKED') 'Rejected or pending workflow could execute'
    }
    $changed = $callback.Clone(); $changed.reviewer = 'different-reviewer'
    $conflict = Invoke-Check "$decision/conflict" '/api/review/risk-callback' $changed 409
    Assert-Condition ($conflict.error.code -eq 'RISK_CALLBACK_CONFLICT') 'Changed callback overwrote receipt'
    $final = Invoke-Check "$decision/final-record" "/api/review/task/$($created.task_id)" $null
    $export = Invoke-Check "$decision/final-export" "/api/review/task/$($created.task_id)/risk-handoff" $null
    $expected = switch ($decision) { 'APPROVE' { 'SIMULATED' } 'REJECT' { 'REJECTED' } 'REQUEST_MORE_INFO' { 'PENDING_RISK' } }
    Assert-Condition ($final.status -eq $expected -and $export.workflow_status -eq $expected) 'Final state mismatch'
    Assert-Condition ($final.execution.execution_allowed -eq $false -and $export.execution_allowed -eq $false) 'Real execution must remain disabled'
    Assert-Condition (@($final.audit.events | Where-Object event_type -eq 'risk.callback.recorded').Count -eq 1) 'Callback recorded more than once'
  }
  $report.passed = $true
} catch {
  $report.error = $_.Exception.Message
} finally {
  $report.finished_at = (Get-Date).ToUniversalTime().ToString('o')
  $report | ConvertTo-Json -Depth 100
}
if (-not $report.passed) { exit 1 }
