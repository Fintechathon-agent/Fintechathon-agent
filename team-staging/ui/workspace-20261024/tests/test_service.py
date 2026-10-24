"""Candidate safety and persistence tests. No model request is made here."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from service import FileStore, Workspace, WorkspaceError, digest


class ExistingAssistant:
    def state(self, session):
        return {'summary': {'month': '2026-10', 'budget': {}, 'available_cents': None}}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = FileStore(Path(self.temp.name) / 'sessions')
        self.service = Workspace(self.store, ExistingAssistant(), Path(self.temp.name) / '.env', 'node',
                                 'http://127.0.0.1:1', {'configured': False}, ROOT)

    def tearDown(self):
        self.temp.cleanup()

    def test_missing_consent_never_records_provider_attempt(self):
        with self.assertRaises(WorkspaceError) as error:
            self.service.analyze('one', {'requestId': 'request-1234', 'question': '核对预算', 'sources': {}})
        self.assertEqual(error.exception.code, 'CONSENT_OR_QUESTION_REQUIRED')
        self.assertEqual(list(self.store.root.glob('*.json')), [])

    def test_block_event_is_persisted_without_sensitive_text(self):
        with self.assertRaises(WorkspaceError) as error:
            self.service.analyze('one', {'requestId': 'request-1234', 'question': '立即转账1000元', 'sources': {}, 'consent': True})
        self.assertEqual(error.exception.status, 403)
        with self.store.transaction('one') as state:
            self.assertEqual(state['events'][0]['guard'], 'BLOCK')
            self.assertEqual(state['requests']['request-1234']['status'], 'BLOCKED')
            self.assertNotIn('question', state['events'][0])

    def test_stale_budget_source_is_rejected_before_model(self):
        with self.assertRaises(WorkspaceError) as error:
            self.service.analyze('one', {'requestId': 'request-1234', 'question': '核对预算', 'consent': True,
                                        'sources': {'budget': {'id': 'not-current', 'revision': 'fake'}}})
        self.assertEqual(error.exception.code, 'SOURCE_CHANGED')

    def test_confirmation_and_analysis_ownership_are_required(self):
        with self.assertRaises(WorkspaceError):
            self.service.create_task('one', {'analysisId': 'analysis-one'})
        with self.assertRaises(WorkspaceError) as error:
            self.service.create_task('two', {'analysisId': 'analysis-one', 'confirm': True, 'role': 'admin'})
        self.assertEqual(error.exception.status, 404)

    def test_candidate_task_is_idempotent_persistent_and_cannot_execute(self):
        with self.store.transaction('one') as state:
            state['analyses'].append({'id': 'test-fixture-analysis', 'mode': 'UNIT_TEST_FIXTURE', 'title': '核对资料', 'sourceHash': 'fixture-hash'})
        body = {'analysisId': 'test-fixture-analysis', 'confirm': True}
        first = self.service.create_task('one', body)
        second = self.service.create_task('one', body)
        self.assertEqual(first['task']['id'], second['task']['id'])
        self.assertTrue(second['duplicate'])
        self.assertFalse(first['task']['execution_allowed'])
        self.assertEqual(first['task']['status'], 'WAITING_OWNER_RISK')
        with FileStore(self.store.root).transaction('one') as state:
            self.assertEqual(len(state['tasks']), 1)
            self.assertEqual(state['events'][0]['analysisId'], body['analysisId'])

    def test_session_files_are_isolated_and_not_named_by_user_paths(self):
        with self.store.transaction('../one') as state:
            state['tasks'].append({'id': 'fixture'})
        with self.store.transaction('two') as state:
            self.assertEqual(state['tasks'], [])
        self.assertEqual(len(list(self.store.root.glob('*.json'))), 2)

    def test_completed_analysis_replay_is_served_without_another_provider_attempt(self):
        body = {'requestId': 'request-replay', 'question': '核对预算', 'consent': True, 'sources': {}}
        with self.store.transaction('one') as state:
            state['analyses'].append({'id': 'test-fixture-analysis', 'mode': 'UNIT_TEST_FIXTURE'})
            state['requests'][body['requestId']] = {'inputHash': digest(body), 'status': 'SUCCEEDED', 'analysisId': 'test-fixture-analysis'}
        result = self.service.analyze('one', body)
        self.assertTrue(result['duplicate'])
        self.assertEqual(result['analysis']['id'], 'test-fixture-analysis')
        with self.assertRaises(WorkspaceError) as error:
            self.service.analyze('one', {**body, 'question': '不同的请求'})
        self.assertEqual(error.exception.code, 'REQUEST_CONFLICT')


if __name__ == '__main__':
    unittest.main()
