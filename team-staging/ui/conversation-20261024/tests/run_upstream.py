"""Run upstream regression tests against the staged dependency snapshots."""
import json
from pathlib import Path
import sys
import unittest

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / 'vendor' / 'conversation'))
import serve
serve.ROOT = source
suite = unittest.defaultTestLoader.discover(str(source / 'tests'))
result = unittest.TextTestRunner(verbosity=1).run(suite)
report = {'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
          'result': 'PASSED' if result.wasSuccessful() else 'FAILED',
          'scope': 'upstream deterministic regression; not evidence of real AI calls'}
(root / 'evidence' / 'upstream-tests.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
sys.exit(0 if result.wasSuccessful() else 1)
