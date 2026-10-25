param([string]$Base = 'http://127.0.0.1:8780', [string]$Proxy = '', [switch]$LiveModel)
$ErrorActionPreference = 'Stop'
$dailyHttpOptions = @{ TimeoutSec = 85 }
if ($Proxy) { $dailyHttpOptions.Proxy = $Proxy }
$dailySessionResponse = Invoke-WebRequest -Uri ($Base + '/api/safety/session') -SessionVariable dailyWebSession @dailyHttpOptions
$dailySession = $dailySessionResponse.Content | ConvertFrom-Json
$dailyHeaders = @{ 'x-risk-csrf' = $dailySession.csrf }
function Invoke-DailyApi([string]$Route, $Payload = $null) {
    $dailyCall = @{ Uri = ($Base + $Route); WebSession = $dailyWebSession; Headers = $dailyHeaders }
    if ($null -ne $Payload) { $dailyCall.Method = 'Post'; $dailyCall.ContentType = 'application/json; charset=utf-8'; $dailyCall.Body = [System.Text.Encoding]::UTF8.GetBytes(($Payload | ConvertTo-Json -Depth 50 -Compress)) }
    Invoke-RestMethod @dailyCall @dailyHttpOptions
}
function Assert-Daily($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$dailyNow = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
$dailyDue = (Get-Date).ToUniversalTime().AddDays(3).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
$dailyInput = @{ contract_version = 'daily-risk-workbench.v1'; snapshot = @{ currency = 'CNY'; cash_ledger_minor = 1200000; as_of = $dailyNow; purposes = @(@{ purpose_id = 'tuition'; label = 'Synthetic tuition'; reserved_now_minor = 600000; remaining_due_minor = 600000; due_at = $dailyDue }, @{ purpose_id = 'rent'; label = 'Synthetic rent'; reserved_now_minor = 400000; remaining_due_minor = 400000; due_at = $dailyDue }); hard_floor = @{ state = 'DISABLED_CONFIRMED'; amount_minor = 0 }; income_events = @() }; action = @{ type = 'INVESTMENT'; amount_minor = 800000; fees_minor = 0; at = $dailyNow }; facts_confirmed = $true; purposes_confirmed = $true; note = 'Synthetic QA only. No real account.' }
$dailyBlocked = Invoke-DailyApi '/api/safety/daily/tasks' $dailyInput
Assert-Daily ($dailyBlocked.review.decision -eq 'BLOCK') 'Expected a protected-purpose block.'
$dailyInput.action.amount_minor = 100000
$dailyTask = Invoke-DailyApi '/api/safety/daily/tasks' $dailyInput
Assert-Daily ($dailyTask.review.decision -eq 'ALLOW') 'Expected ALLOW for affordable synthetic input.'
$dailyTaskId = $dailyTask.input.binding.task_id
if ($LiveModel) {
    $dailyModel = Invoke-DailyApi '/api/safety/daily/model-review' @{ task_id = $dailyTaskId }
    Assert-Daily ($dailyModel.mode -eq 'LIVE_TEAM_CORE_MODEL_READ_ONLY' -and $dailyModel.run_id -and $dailyModel.raw_text -and -not $dailyModel.execution_allowed) 'Missing actual read-only model evidence.'
    @{ live_model = 'PASS'; task_id = $dailyTaskId; core_task_id = $dailyModel.core_task_id; run_id = $dailyModel.run_id; model = $dailyModel.model; execution_allowed = $false } | ConvertTo-Json -Compress
}
$dailyApproval = Invoke-DailyApi '/api/safety/confirm' @{ task_id = $dailyTaskId; risk_check_id = $dailyTask.review.risk_check_id; binding = $dailyTask.input.binding; accepted_reason_ids = @(); confirmed = $true }
Assert-Daily ($dailyApproval.status -eq 'CONFIRMED') 'Expected independent full-plan confirmation.'
$dailyExecution = Invoke-DailyApi '/api/paper-trade/execute' @{ task_id = $dailyTaskId; idempotency_key = 'daily-ps-once' }
Assert-Daily ($dailyExecution.status -eq 'SUCCEEDED' -and -not $dailyExecution.side_effects) 'Expected synthetic execution receipt.'
$dailyRepeat = Invoke-DailyApi '/api/paper-trade/execute' @{ task_id = $dailyTaskId; idempotency_key = 'daily-ps-once' }
Assert-Daily ($dailyRepeat.replay -and $dailyRepeat.execution_id -eq $dailyExecution.execution_id) 'A repeated request must reuse the receipt.'
$dailyCurrent = Invoke-DailyApi ('/api/safety/task?task_id=' + $dailyTaskId)
Assert-Daily ($dailyCurrent.current_ledger.holds.Count -eq 1) 'Synthetic hold missing or duplicated.'
$dailyAudit = Invoke-DailyApi ('/api/safety/audit?task_id=' + $dailyTaskId)
Assert-Daily (@($dailyAudit | Where-Object { $_.event_type -eq 'DAILY_EXECUTION_SUCCEEDED' }).Count -eq 1) 'Expected one linked execution event.'
@{ checks = 7; status = 'PASS'; base = $Base; task_id = $dailyTaskId; mode = $dailyCurrent.mode; real_transactions = $false } | ConvertTo-Json -Compress
