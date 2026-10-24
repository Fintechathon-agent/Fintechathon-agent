"""Inspect retention candidates read-only; never delete or rewrite user data."""
import argparse
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import sqlite3


def inspect_database(file, days=90):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = {'sessions': 0, 'records': 0, 'inactive_candidates': 0, 'unknown_dates': 0,
              'automatic_cleanup': False, 'deleted': 0, 'candidate_age_days': days,
              'warning': 'Candidates are for review only; ledger and memories are not scheduled for deletion.'}
    db = sqlite3.connect(Path(file).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        for state_json, in db.execute('SELECT state FROM sessions'):
            state = json.loads(state_json)
            result['sessions'] += 1
            result['records'] += len(state.get('records', []))
            dates = [message.get('created_at') for thread in state.get('threads', []) for message in thread.get('messages', [])]
            try:
                last = max(datetime.fromisoformat(value.replace('Z', '+00:00')) for value in dates if value)
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                result['inactive_candidates'] += int(last < cutoff)
            except (ValueError, TypeError):
                result['unknown_dates'] += 1
    finally:
        db.close()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('database', type=Path)
    parser.add_argument('--inactive-days', type=int, default=90)
    args = parser.parse_args()
    if args.inactive_days < 1:
        parser.error('inactive-days must be positive')
    print(json.dumps(inspect_database(args.database, args.inactive_days), ensure_ascii=False, indent=2))
