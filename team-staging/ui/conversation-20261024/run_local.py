"""Run the staged UI and existing assistant contract on loopback only."""
from __future__ import annotations
import argparse
from collections import deque
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'vendor' / 'conversation'))
import serve
from assistant.service import Assistant
from assistant.storage import Store
from assistant.core_client import CoreAgentError


class BailianReviewer:
    def __init__(self, env_file, evidence, node):
        self.env_file, self.evidence, self.node = env_file, evidence, node
        self.lock = threading.Lock()
        self.starts = deque()

    def __call__(self, text, **kwargs):
        if not self.lock.acquire(blocking=False):
            raise CoreAgentError('已有模型请求正在处理。', 429)
        try:
            current = time.monotonic()
            while self.starts and current - self.starts[0] >= 60:
                self.starts.popleft()
            if len(self.starts) >= 5:
                raise CoreAgentError('请求过于频繁，请一分钟后重试。', 429)
            self.starts.append(current)
            command = [self.node, '--env-file=' + str(self.env_file), str(ROOT / 'provider.cjs')]
            result = subprocess.run(command, input=json.dumps({'text': text}, ensure_ascii=False),
                                    capture_output=True, text=True, encoding='utf-8', timeout=40)
            try:
                data = json.loads(result.stdout)
            except (ValueError, TypeError):
                raise CoreAgentError('模型进程未返回有效结果。', 502) from None
            event = data.get('evidence') or {'http_status': data.get('status', 502), 'call_succeeded': False,
                                           'error': data.get('body', {}).get('error'), 'execution_allowed': False}
            self.evidence.parent.mkdir(parents=True, exist_ok=True)
            with self.evidence.open('a', encoding='utf-8') as output:
                output.write(json.dumps(event, ensure_ascii=False) + '\n')
            if data.get('status') != 200:
                raise CoreAgentError('百炼暂时不可用，已保存的记录不受影响。', data.get('status', 502))
            record = data['body']
            model = record['model_response']
            return {'model': {'name': model['model'], 'call_succeeded': model['call_succeeded'], 'raw_text': model['raw_text']},
                    'recommendation': {'reason': model['proposal']['action_reason']}, 'run_id': record['run_id'],
                    'workflow_status': 'ANALYSIS_ONLY', 'execution_allowed': False}
        except subprocess.TimeoutExpired:
            raise CoreAgentError('模型响应超时，本次未取得结果。', 504) from None
        finally:
            self.lock.release()


class LocalHandler(serve.Handler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.split('?')[0] in ('', '/'):
            return self._static('landing.html')
        return super().do_GET()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--site-root', type=Path, default=ROOT / 'public')
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8887)
    parser.add_argument('--db', type=Path, default=ROOT / 'runtime' / 'assistant.sqlite')
    args = parser.parse_args()
    if not (args.site_root / 'conversation.html').is_file() or not args.env_file.is_file():
        parser.error('需要完整网页目录与本机服务端配置文件。')
    node = shutil.which('node')
    if not node:
        parser.error('需要 Node.js 22 或以上版本。')
    serve.ROOT = args.site_root.resolve()
    reviewer = BailianReviewer(args.env_file.resolve(), ROOT / 'runtime' / 'provider-calls.jsonl', node)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), LocalHandler)
    server.assistant = Assistant(Store(args.db), reviewer=reviewer)
    print(f'Finance Lab: http://127.0.0.1:{args.port}/landing.html', flush=True)
    print('Bailian calls are server-side; automatic cleanup is disabled.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
