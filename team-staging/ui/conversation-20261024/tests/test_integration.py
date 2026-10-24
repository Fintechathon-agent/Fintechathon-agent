"""Error and persistence checks; these tests make no paid provider request."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from run_local import BailianReviewer
from assistant.service import Assistant
from assistant.storage import Store
from retention_report import inspect_database


class IntegrationTests(unittest.TestCase):
    def test_invalid_local_config_preserves_records_and_never_claims_ai_success(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            env_file = folder / '.env'
            env_file.write_text('MODEL_API_KEY=\n', encoding='utf-8')
            evidence = folder / 'provider.jsonl'
            reviewer = BailianReviewer(env_file, evidence, shutil.which('node'))
            store = Store(folder / 'data.sqlite')
            assistant = Assistant(store, reviewer=reviewer)
            session = 'negative-test-session'
            assistant.message(session, {'text': '我只想记账。今天工资到账12000元', 'thread_id': 'thread-negative', 'request_id': 'request-first'})
            reply = assistant.message(session, {'text': '请分析生活与投资风险', 'thread_id': 'thread-negative', 'request_id': 'request-analysis'})
            answer = reply['state']['threads'][0]['messages'][-1]
            self.assertEqual(answer['engine'], 'model_unavailable')
            self.assertEqual(answer['model']['http_status'], 503)
            self.assertFalse(answer['model']['execution_allowed'])
            self.assertIn('没有生成投资结论', answer['text'])
            self.assertEqual(len(Store(folder / 'data.sqlite').load(session)['records']), 1)
            event = json.loads(evidence.read_text(encoding='utf-8'))
            self.assertFalse(event['call_succeeded'])
            self.assertEqual(event['error']['code'], 'MODEL_NOT_CONFIGURED')

    def test_retention_report_cannot_change_database(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'data.sqlite'
            store = Store(file)
            store.save('one', {'threads': [{'messages': [{'created_at': '2020-01-01T00:00:00+00:00'}]}], 'records': [{'title': 'Keep this record'}]})
            before = hashlib.sha256(file.read_bytes()).hexdigest()
            report = inspect_database(file)
            self.assertEqual(report['inactive_candidates'], 1)
            self.assertEqual(report['deleted'], 0)
            self.assertFalse(report['automatic_cleanup'])
            self.assertEqual(before, hashlib.sha256(file.read_bytes()).hexdigest())
            self.assertEqual(len(store.load('one')['records']), 1)


if __name__ == '__main__':
    unittest.main()
