"""Isolated local context and draft integration; no Core/Risk policy mutation."""
from __future__ import annotations
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import threading
import urllib.request
import uuid


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class WorkspaceError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


class FileStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.guard = threading.Lock()
        self.locks = {}

    def path(self, session):
        return self.root / (hashlib.sha256(session.encode()).hexdigest() + '.json')

    @contextmanager
    def transaction(self, session):
        with self.guard:
            lock = self.locks.setdefault(session, threading.RLock())
        with lock:
            file = self.path(session)
            state = json.loads(file.read_text(encoding='utf-8')) if file.exists() else {
                'version': 1, 'sessionId': 'local-session-' + uuid.uuid4().hex, 'analyses': [], 'tasks': [], 'events': [], 'requests': {}}
            yield state
            temporary = file.with_suffix('.' + uuid.uuid4().hex + '.tmp')
            temporary.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
            temporary.replace(file)


class Workspace:
    def __init__(self, store, assistant, env_file, node, core_url, provider_info, module_root):
        self.store, self.assistant = store, assistant
        self.env_file, self.node, self.core_url = env_file, node, core_url
        self.info, self.root = provider_info, Path(module_root)
        self.provider_lock = threading.Lock()

    def portfolio(self):
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(self.core_url + '/api/demo/portfolio', timeout=5) as response:
            data = json.load(response)
        snapshot = data['output']['snapshot']
        return {'id': snapshot['portfolio_id'], 'mode': 'FIXTURE', 'asOf': snapshot['as_of'], 'revision': digest(snapshot), 'snapshot': snapshot}

    def sources(self, session):
        assistant = self.assistant.state(session)
        summary = assistant['summary']
        budget = {'id': 'budget-' + summary['month'], 'mode': 'USER_REPORTED', 'asOf': now(), 'revision': digest(summary), 'summary': summary}
        try:
            portfolio = self.portfolio()
        except Exception:
            portfolio = None
        return {'portfolio': portfolio, 'budget': budget}

    def state(self, session):
        with self.store.transaction(session) as state:
            result = {key: state[key] for key in ('sessionId', 'analyses', 'tasks', 'events')}
        return {**result, 'sources': self.sources(session), 'provider': self.info,
                'identity': {'mode': 'LOCAL_SESSION', 'role': 'UNKNOWN', 'verified': False},
                'formalRisk': 'OWNER_NOT_CONNECTED', 'execution_allowed': False}

    def event(self, state, type, **detail):
        state['events'].append({'id': 'local-event-' + uuid.uuid4().hex, 'mode': 'LOCAL_CANDIDATE',
                                'type': type, 'at': now(), 'sessionId': state['sessionId'], **detail})

    def analyze(self, session, body):
        request_id = body.get('requestId')
        question = body.get('question')
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,100}', request_id):
            raise WorkspaceError('INVALID_REQUEST')
        if not isinstance(question, str) or not question.strip() or len(question) > 4000 or body.get('consent') is not True:
            raise WorkspaceError('CONSENT_OR_QUESTION_REQUIRED')
        input_hash = digest(body)
        with self.store.transaction(session) as state:
            previous = state['requests'].get(request_id)
            if previous:
                if previous['inputHash'] != input_hash:
                    raise WorkspaceError('REQUEST_CONFLICT', 409)
                if previous['status'] != 'SUCCEEDED':
                    raise WorkspaceError('REQUEST_ALREADY_ATTEMPTED', 409)
                return {'analysis': next(a for a in state['analyses'] if a['id'] == previous['analysisId']), 'duplicate': True}
            if re.search(r'(?:直接|立即|自动|帮我|替我).{0,5}(?:转账|下单|买入|卖出|付款|修改.{0,4}账户)|绕过.{0,4}(?:审批|风控)', question):
                self.event(state, 'local.guard.blocked', requestId=request_id, reason='SENSITIVE_EXECUTION_DISABLED', guard='BLOCK', authority='LOCAL_RESTRICTION')
                # Commit the refusal event before returning a failed request.
                state['requests'][request_id] = {'inputHash': input_hash, 'status': 'BLOCKED'}
                blocked = True
            else:
                blocked = False
        if blocked:
            raise WorkspaceError('SENSITIVE_EXECUTION_DISABLED', 403)
        current = self.sources(session)
        sources = {}
        refs = body.get('sources')
        if not isinstance(refs, dict):
            raise WorkspaceError('INVALID_SOURCES')
        for key in ('portfolio', 'budget'):
            if refs.get(key):
                expected = current.get(key)
                if not expected or refs[key].get('id') != expected['id'] or refs[key].get('revision') != expected['revision']:
                    raise WorkspaceError('SOURCE_CHANGED', 409)
                sources[key] = expected
        goal = body.get('goal')
        if goal is not None:
            if not isinstance(goal, dict) or not isinstance(goal.get('name', ''), str) or len(goal.get('name', '')) > 120:
                raise WorkspaceError('INVALID_GOAL')
            amount = goal.get('amountCents')
            if amount is not None and (not isinstance(amount, int) or isinstance(amount, bool) or not 0 <= amount <= 10**12):
                raise WorkspaceError('INVALID_GOAL')
            sources['goal'] = {'mode': 'USER_DRAFT', 'name': goal.get('name', ''), 'amountCents': amount, 'deadline': str(goal.get('deadline', ''))[:20]}
        with self.store.transaction(session) as state:
            previous = state['requests'].get(request_id)
            if previous:
                raise WorkspaceError('REQUEST_ALREADY_ATTEMPTED', 409)
            if len([r for r in state['requests'].values() if r.get('attemptedAt', '')[:16] == now()[:16]]) >= 5:
                raise WorkspaceError('RATE_LIMITED', 429)
            state['requests'][request_id] = {'inputHash': input_hash, 'status': 'ATTEMPTED', 'attemptedAt': now()}
            session_id = state['sessionId']
        if not self.provider_lock.acquire(blocking=False):
            raise WorkspaceError('MODEL_BUSY', 429)
        try:
            prompt = '用户授权的只读分析问题：' + question + '\n来源快照（FIXTURE是虚构演示，USER_REPORTED和USER_DRAFT未经账户核验；缺失值不能推算）：' + json.dumps(sources, ensure_ascii=False) + '\n只进行教育性分析，不修改账本，不推断缺失财务数据，不执行任何资金操作。'
            payload = {'text': prompt, 'synthetic': bool(sources.get('portfolio'))}
            command = [self.node, '--env-file=' + str(self.env_file), str(self.root.parent / 'conversation-20261024' / 'provider.cjs')]
            output = subprocess.run(command, input=json.dumps(payload, ensure_ascii=False), text=True, encoding='utf-8', capture_output=True, timeout=40)
            data = json.loads(output.stdout)
            if data.get('status') != 200 or not data.get('evidence', {}).get('call_succeeded'):
                raise WorkspaceError(data.get('body', {}).get('error', {}).get('code', 'MODEL_UNAVAILABLE'), data.get('status', 502))
            evidence = data['evidence']
            proposal = evidence['proposal']
            analysis = {'id': evidence['run_id'], 'sessionId': session_id, 'requestId': request_id, 'title': question[:80],
                        'mode': 'REAL_MODEL', 'model': evidence['model'], 'createdAt': now(), 'sources': sources,
                        'sourceHash': digest(sources), 'text': proposal['summary'] + '\n\n' + proposal['action_reason'],
                        'proposal': proposal, 'provider': {key: evidence.get(key) for key in ('http_status', 'duration_ms', 'provider_response_id', 'usage', 'attempts')},
                        'risk': {'decision': None, 'status': 'PENDING_OWNER', 'authority': 'NOT_CONNECTED'},
                        'localGuard': {'decision': 'REVIEW', 'authority': 'LOCAL_ADVISORY'}, 'execution_allowed': False}
            with self.store.transaction(session) as state:
                state['analyses'].insert(0, analysis)
                state['requests'][request_id].update(status='SUCCEEDED', analysisId=analysis['id'])
                self.event(state, 'analysis.succeeded', analysisId=analysis['id'], requestId=request_id, sourceHash=analysis['sourceHash'], guard='REVIEW', authority='LOCAL_ADVISORY')
            return {'analysis': analysis, 'duplicate': False, 'providerEvidence': evidence}
        except (subprocess.TimeoutExpired, ValueError, KeyError):
            with self.store.transaction(session) as state:
                self.event(state, 'analysis.failed', requestId=request_id, reason='MODEL_UNAVAILABLE')
            raise WorkspaceError('MODEL_UNAVAILABLE', 502) from None
        except WorkspaceError as error:
            with self.store.transaction(session) as state:
                self.event(state, 'analysis.failed', requestId=request_id, reason=error.code)
            raise
        finally:
            self.provider_lock.release()

    def create_task(self, session, body):
        if body.get('confirm') is not True:
            raise WorkspaceError('CONFIRMATION_REQUIRED')
        with self.store.transaction(session) as state:
            analysis = next((a for a in state['analyses'] if a['id'] == body.get('analysisId')), None)
            if not analysis:
                raise WorkspaceError('ANALYSIS_NOT_FOUND', 404)
            existing = next((t for t in state['tasks'] if t['analysisId'] == analysis['id']), None)
            if existing:
                return {'task': existing, 'duplicate': True}
            task = {'id': 'local-task-' + uuid.uuid4().hex, 'analysisId': analysis['id'], 'sessionId': state['sessionId'],
                    'title': '核对资料：' + analysis['title'][:60], 'mode': 'LOCAL_CANDIDATE', 'createdAt': now(),
                    'sourceHash': analysis['sourceHash'], 'status': 'WAITING_OWNER_RISK', 'risk': 'PENDING_OWNER',
                    'userConfirmed': True, 'execution_allowed': False}
            state['tasks'].insert(0, task)
            self.event(state, 'task.confirmed', taskId=task['id'], analysisId=analysis['id'], sourceHash=analysis['sourceHash'], status=task['status'])
            return {'task': task, 'duplicate': False}
