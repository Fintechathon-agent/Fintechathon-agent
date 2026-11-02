import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import path from 'node:path';

// One Node process, one persistent SQLite volume. No process-local data fallback.
export class SqliteStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS kv (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key));');
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.read = this.db.prepare('SELECT value FROM kv WHERE scope=? AND key=?');
    this.write = this.db.prepare('INSERT INTO kv(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value');
    this.remove = this.db.prepare('DELETE FROM kv WHERE scope=? AND key=?');
    this.tail = Promise.resolve();
  }
  exclusive(fn) {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  view(scope) {
    return {
      get: async key => {
        const value = this.read.get(scope, key)?.value;
        return value === undefined ? undefined : JSON.parse(value);
      },
      put: async (key, value) => {
        const entries = typeof key === 'string' ? [[key, value]] : Object.entries(key);
        for (const [name, item] of entries) this.write.run(scope, name, JSON.stringify(item));
      },
      delete: async key => {
        for (const name of Array.isArray(key) ? key : [key]) this.remove.run(scope, name);
      },
    };
  }
  namespace(scope) {
    const view = this.view(scope);
    const transaction = fn => this.exclusive(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(view);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
    return {
      get: key => this.exclusive(() => view.get(key)),
      put: (key, value) => transaction(tx => tx.put(key, value)),
      delete: key => transaction(tx => tx.delete(key)),
      transaction,
    };
  }
  async close() {await this.tail; this.db.close();}
}
