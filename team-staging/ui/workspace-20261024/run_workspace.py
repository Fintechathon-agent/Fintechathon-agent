"""Local integration candidate with isolated persistent drafts and no executor."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'conversation-20261024'))
from run_local import LocalHandler, BailianReviewer, serve, Assistant, Store
from service import Workspace, WorkspaceError, FileStore


class Handler(LocalHandler):
    def _local(self):
        host = self.headers.get('Host', '')
        if self.client_address[0] not in ('127.0.0.1', '::1') or urlparse('http://' + host).hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise WorkspaceError('LOCAL_ONLY', 403)
        if self.headers.get('Origin') and self.headers['Origin'] != 'http://' + host:
            raise WorkspaceError('ORIGIN_DENIED', 403)

    def _workspace(self, method, path):
        try:
            self._local()
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get('Cookie', ''))
            except Exception:
                pass
            value = cookie.get('finance_session')
            session = value.value if value and re.fullmatch(r'[a-f0-9]{64}', value.value) else secrets.token_hex(32)
            self.assistant_cookie = 'finance_session=' + session + '; HttpOnly; SameSite=Strict; Path=/api/assistant; Max-Age=31536000'
            if method == 'GET' and path == '/api/assistant/workspace/state':
                return self._json(200, self.server.workspace.state(session))
            if method != 'POST' or self.headers.get('X-Finance-Request') != '1' or not self.headers.get('Content-Type', '').startswith('application/json'):
                raise WorkspaceError('INVALID_REQUEST', 403)
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 32768:
                raise WorkspaceError('INVALID_REQUEST', 413)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise WorkspaceError('INVALID_REQUEST')
            if path == '/api/assistant/workspace/analysis':
                result = self.server.workspace.analyze(session, body)
            elif path == '/api/assistant/workspace/task':
                result = self.server.workspace.create_task(session, body)
            else:
                raise WorkspaceError('NOT_FOUND', 404)
            return self._json(200, result)
        except WorkspaceError as error:
            return self._json(error.status, {'error': {'code': error.code, 'message': {
                'SOURCE_CHANGED': '来源数据已变化，请刷新来源并重新确认。',
                'SENSITIVE_EXECUTION_DISABLED': '当前候选不允许资金执行或绕过审批，已记录阻止原因。',
                'REQUEST_ALREADY_ATTEMPTED': '该请求已尝试过，不会自动重复调用模型。请先核查状态。',
                'RATE_LIMITED': '请求过于频繁，请稍后再试。',
                'MODEL_BUSY': '已有模型请求正在处理，请稍后再试。',
                'CONSENT_OR_QUESTION_REQUIRED': '请填写问题并确认发送范围。'
            }.get(error.code, '本次操作未完成，请核对输入、来源和服务状态。')}, 'execution_allowed': False})
        except (ValueError, TypeError, AttributeError):
            return self._json(400, {'error': {'code': 'INVALID_REQUEST', 'message': '请求格式无效。'}, 'execution_allowed': False})
        except Exception:
            return self._json(500, {'error': {'code': 'UNAVAILABLE', 'message': '服务暂时不可用，没有执行资金操作。'}, 'execution_allowed': False})

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/assistant/workspace/'):
            return self._workspace('GET', path)
        if path.startswith('/api/assistant/'):
            return self._assistant('GET', path)
        if path == '/api/demo/portfolio' or re.fullmatch(r'/api/(?:task|audit|run)/[A-Za-z0-9_-]+(?:/export)?', path):
            try:
                self._local()
            except WorkspaceError:
                return self._json(403, {'error': {'code': 'ORIGIN_DENIED'}})
            return self._proxy('GET', self.path, base=self.server.core_url)
        if path.startswith('/api/'):
            return self._json(404, {'error': {'code': 'NOT_CONNECTED'}, 'execution_allowed': False})
        return self._static('workspace.html' if path == '/' else path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith('/api/assistant/workspace/'):
            return self._workspace('POST', path)
        if path in ('/api/assistant/message', '/api/assistant/record'):
            return self._assistant('POST', path)
        if path == '/api/health-check/run':
            try:
                self._local()
            except WorkspaceError:
                return self._json(403, {'error': {'code': 'ORIGIN_DENIED'}})
            return self._proxy('POST', self.path, base=self.server.core_url)
        return self._json(403, {'error': {'code': 'SENSITIVE_EXECUTION_DISABLED', 'message': '候选不提供资金执行或正式风控写入。'}, 'execution_allowed': False})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--site-root', type=Path, required=True)
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8897)
    parser.add_argument('--core-port', type=int, default=4189)
    parser.add_argument('--assistant-db', type=Path, default=ROOT / 'runtime/assistant.sqlite')
    args = parser.parse_args()
    node = shutil.which('node')
    if not node or not args.env_file.is_file() or not (args.site_root / 'workspace.html').is_file():
        parser.error('需要Node.js、网页目录和本机服务端环境文件。')
    core_file = ROOT / 'runtime/core/chenchen/server.js'
    if not core_file.is_file():
        parser.error('请先执行 node prepare-core.cjs 准备只读Core快照。')
    info = json.loads(subprocess.run([node, '--env-file=' + str(args.env_file), str(ROOT / 'provider-info.cjs')], capture_output=True, text=True, encoding='utf-8', check=True).stdout)
    environment = {k: v for k, v in os.environ.items() if not any(token in k.upper() for token in ('API_KEY', 'MODEL_', 'DASHSCOPE', 'ACCESS_TOKEN'))}
    environment['PORT'] = str(args.core_port)
    log = (ROOT / 'runtime/core.log').open('a', encoding='utf-8')
    core = subprocess.Popen([node, str(core_file)], env=environment, stdout=log, stderr=log)
    serve.ROOT = args.site_root.resolve()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    reviewer = BailianReviewer(args.env_file, ROOT / 'runtime/conversation-provider.jsonl', node)
    server.assistant = Assistant(Store(args.assistant_db), reviewer=reviewer)
    server.core_url = 'http://127.0.0.1:' + str(args.core_port)
    server.workspace = Workspace(FileStore(ROOT / 'runtime/workspaces'), server.assistant, args.env_file, node, server.core_url, info, ROOT)
    print(f'Unified candidate: http://127.0.0.1:{args.port}/workspace.html', flush=True)
    print('Local candidate only; formal Risk and execution are disabled.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        core.terminate()
        core.wait(timeout=10)
        log.close()


if __name__ == '__main__':
    main()
