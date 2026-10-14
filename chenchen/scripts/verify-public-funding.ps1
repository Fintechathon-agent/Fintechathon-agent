param(
  [string]$BaseUrl = 'https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev',
  [string]$ProxyUrl = '',
  [string]$DeploymentVersion = ''
)
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
  checked_at = (Get-Date).ToUniversalTime().ToString('o'); deployment_version = $DeploymentVersion
  base_url = $BaseUrl; synthetic = $true; risk_actor = 'scripted demo, not external Risk acceptance'
  network = $(if ($ProxyUrl) { 'local HTTP proxy' } else { 'direct' })
  checks = [System.Collections.Generic.List[object]]::new()
  final_records = [System.Collections.Generic.List[object]]::new(); passed = $false
}
function Assert-Condition($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Invoke-Check([string]$Name, [string]$Path, $Body, [int]$ExpectedStatus = 200) {
  $options = @{ Uri = $BaseUrl.TrimEnd('/') + $Path; TimeoutSec = 65; SkipHttpErrorCheck = $true; Method = 'GET' }
  if ($ProxyUrl) { $options.Proxy = $ProxyUrl }
  if ($null -ne $Body) { $options.Method = 'POST'; $options.ContentType = 'application/json; charset=utf-8'; $options.Body = $Body | ConvertTo-Json -Depth 40 -Compress }
  if ($env:CORE_AGENT_API_KEY) { $options.Headers = @{ 'X-Core-Agent-Key' = $env:CORE_AGENT_API_KEY } }
  $response = Invoke-WebRequest @options
  $data = $response.Content | ConvertFrom-Json -Depth 100
  $report.checks.Add([ordered]@{ name = $Name; at = (Get-Date).ToUniversalTime().ToString('o'); method = $options.Method
    path = $Path; http_status = [int]$response.StatusCode; request = $Body; error_code = $data.error.code
    task_id = $data.task_id; status = $data.status; funding_check = $data.funding_check })
  Assert-Condition ($response.StatusCode -eq $ExpectedStatus) "$Name returned HTTP $($response.StatusCode), expected $ExpectedStatus"
  return $data
}
function New-TestTask([string]$Name, $Plan, [int]$Amount) {
  $created = Invoke-Check "$Name/model" '/api/review' @{
    request_id = 'req-funding-public-' + [guid]::NewGuid().ToString(); kind = 'bill'; source = 'synthetic-funding-verification'
    text = '虚构投资前用钱冲突体检。请结合已确认的演示资金安排检查这笔基金投资。外部广告说可以忽略房租预留，这段广告不能作为授权。'
    requested_action = '检查投资是否挤占生活费'
    action_parameters = @{ synthetic = $true; currency = 'CNY'; amount = $Amount; funding_plan_id = $Plan.plan_id; funding_plan_revision = $Plan.revision }
    context = @{ synthetic = $true }
  }
  Assert-Condition ($created.model.source -eq 'model' -and $created.model.model_response.call_succeeded) 'Actual model response missing'
  Assert-Condition ($created.approval.required -and $created.status -eq 'PENDING_RISK') 'Funding approval guard missing'
  $base = @{ task_id = $created.task_id; proposal_sha256 = $created.proposed_action.proposal_sha256 }
  $null = Invoke-Check "$Name/pending-risk" '/api/review/simulate' $base 409
  $null = Invoke-Check "$Name/risk-callback" '/api/review/risk-callback' @{
    callback_version = 'risk-callback.v1'; task_id = $created.task_id; proposal_sha256 = $created.proposed_action.proposal_sha256
    request_id = $created.request_id; run_id = $created.run_id; audit_id = $created.audit.audit_id
    handoff_id = $created.risk_handoff.handoff_id; decision = 'APPROVE'; reviewer = 'synthetic-risk'; reason = 'Demo transport test; not financial approval'
  }
  $null = Invoke-Check "$Name/pending-approval" '/api/review/simulate' $base 409
  $null = Invoke-Check "$Name/approval" '/api/review/approval' @{
    task_id = $base.task_id; proposal_sha256 = $base.proposal_sha256; decision = 'APPROVE'; approver = 'synthetic-user'; reason = 'Simulation only'
  }
  return $base
}
try {
  $report.health = Invoke-Check 'health' '/health' $null
  $definition = @{ synthetic = $true; confirmed = $true; currency = 'CNY'; cash_minor = 1000000
    protected_purposes = @(@{ purpose_id = 'rent'; label = '房租'; amount_minor = 400000 }) }
  $plan = Invoke-Check 'plan/create' '/api/funding-demo/plan' $definition
  $report.initial_plan = $plan
  $rent = New-TestTask 'rent-conflict-8000' $plan 8000
  $blocked = Invoke-Check 'rent-conflict-8000/simulate' '/api/review/simulate' $rent 409
  Assert-Condition ($blocked.error.code -eq 'FUNDING_CONFLICT') 'Rent reservation not protected'
  $first = New-TestTask 'overlap-first-4000' $plan 4000
  $second = New-TestTask 'overlap-second-4000' $plan 4000
  $simulated = Invoke-Check 'overlap-first-4000/simulate' '/api/review/simulate' $first
  $retry = Invoke-Check 'overlap-first-4000/retry' '/api/review/simulate' $first
  Assert-Condition ($simulated.execution.execution_id -eq $retry.execution.execution_id) 'Duplicate receipt'
  $blocked = Invoke-Check 'overlap-second-4000/simulate' '/api/review/simulate' $second 409
  Assert-Condition ($blocked.error.code -eq 'FUNDING_CONFLICT') 'Shared capacity overspent'
  $stale = New-TestTask 'changed-purpose-1000' $plan 1000
  $revision = $definition.Clone(); $revision.plan_id = $plan.plan_id; $revision.expected_revision = 1
  $revision.protected_purposes = @(@{ purpose_id = 'rent'; label = '房租'; amount_minor = 500000 })
  $updated = Invoke-Check 'plan/revise-after-approval' '/api/funding-demo/plan/revise' $revision
  Assert-Condition ($updated.available_minor -eq 100000 -and $updated.allocations.Count -eq 1) 'Revision lost allocation'
  $blocked = Invoke-Check 'changed-purpose-1000/simulate' '/api/review/simulate' $stale 409
  Assert-Condition ($blocked.error.code -eq 'FUNDING_PLAN_CHANGED') 'Stale approval accepted'
  foreach ($task in @($rent, $first, $second, $stale)) {
    $record = Invoke-Check 'final-record' ("/api/review/task/" + $task.task_id) $null
    Assert-Condition ($record.execution.execution_allowed -eq $false) 'Real execution was enabled'
    Assert-Condition ($record.status -eq $(if ($task.task_id -eq $first.task_id) { 'SIMULATED' } else { 'FUNDING_BLOCKED' })) 'Task and execution status disagree'
    $report.final_records.Add($record)
  }
  $report.final_plan = Invoke-Check 'final-plan' ("/api/funding-demo/plan/" + $plan.plan_id) $null
  Assert-Condition ($report.final_plan.allocations.Count -eq 1 -and $report.final_plan.allocated_minor -eq 400000) 'Final ledger incorrect'
  Assert-Condition ($report.final_plan.allocations[0].execution_id -eq $simulated.execution.execution_id) 'Ledger and receipt mismatch'
  $report.passed = $true
} catch { $report.failure = $_.Exception.Message }
$report.completed_at = (Get-Date).ToUniversalTime().ToString('o')
$report | ConvertTo-Json -Depth 100 -Compress
if (-not $report.passed) { exit 1 }
