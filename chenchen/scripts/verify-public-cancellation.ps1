param([string]$BaseUrl='https://personal-ai-fund-manager-core-agent.realchenchenluo.workers.dev',[string]$ProxyUrl='')
$ErrorActionPreference='Stop'
$http=@{Uri=$BaseUrl.TrimEnd('/')+$args[0];Method='GET';SkipHttpErrorCheck=$true;TimeoutSec=65}; if($ProxyUrl){$http.Proxy=$ProxyUrl}
function Call([string]$Path,$Body,[int]$Expected=200){$o=@{Uri=$BaseUrl.TrimEnd('/')+$Path;Method='GET';SkipHttpErrorCheck=$true;TimeoutSec=65};if($ProxyUrl){$o.Proxy=$ProxyUrl};if($null -ne $Body){$o.Method='POST';$o.ContentType='application/json';$o.Body=$Body|ConvertTo-Json -Depth 30 -Compress};$r=Invoke-WebRequest @o;$d=$r.Content|ConvertFrom-Json -Depth 100;if([int]$r.StatusCode -ne $Expected){throw "$Path returned HTTP $($r.StatusCode)"};return $d}
$plan=Call '/api/funding-demo/plan' @{synthetic=$true;confirmed=$true;currency='CNY';cash_minor=500000;protected_purposes=@(@{purpose_id='rent';label='房租';amount_minor=100000})}
$task=Call '/api/review' @{request_id='req-cancel-20261015-'+[guid]::NewGuid();kind='bill';source='synthetic-cancel-verification';text='虚构案例：请检查投资是否影响房租，随后由用户主动停止。';requested_action='检查投资与生活费冲突';action_parameters=@{amount=1000;currency='CNY';synthetic=$true;funding_plan_id=$plan.plan_id;funding_plan_revision=$plan.revision};context=@{synthetic=$true}}
$base=@{task_id=$task.task_id;proposal_sha256=$task.proposed_action.proposal_sha256}
$cancel=Call '/api/review/cancel' (@{task_id=$task.task_id;proposal_sha256=$base.proposal_sha256;canceler='synthetic-user';reason='停止本次演示'})
$repeat=Call '/api/review/cancel' (@{task_id=$task.task_id;proposal_sha256=$base.proposal_sha256;canceler='synthetic-user';reason='重复停止'}) 409
$final=Call ('/api/review/task/'+$task.task_id) $null; $handoff=Call ('/api/review/task/'+$task.task_id+'/risk-handoff') $null
[ordered]@{task_id=$task.task_id;initial_status=$task.status;cancel_status=$cancel.status;repeat_http=409;final_status=$final.status;execution_allowed=$final.execution.execution_allowed;audit_events=$final.audit.events.Count;handoff_cancellation=$handoff.cancellation}|ConvertTo-Json -Depth 30
