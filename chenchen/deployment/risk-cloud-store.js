import { createHash, randomUUID } from "node:crypto";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function failure(code, message, status = 409) { return Object.assign(new Error(message), { code, status }); }

// The Owner's synchronous store interface, backed by one SQLite Durable Object.
// Audit intents must be flushed before an outgoing request (see risk-worker.js).
export class RiskCloudStore {
  constructor(storage) {
    this.sql = storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS risk_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS risk_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)");
    const row = [...this.sql.exec("SELECT body FROM risk_state WHERE id=1")][0];
    this.data = row ? JSON.parse(row.body) : { requests: {} };
    this.events = [...this.sql.exec("SELECT body FROM risk_events ORDER BY seq")].map(row => JSON.parse(row.body));
    let previous = "GENESIS";
    for (const event of this.events) {
      const { event_hash, ...body } = event;
      if (body.previous_hash !== previous || hash(body) !== event_hash) throw failure("AUDIT_CHAIN_INVALID", "审计链校验失败，服务保持阻断。", 503);
      previous = event_hash;
    }
    let interrupted = false;
    for (const record of Object.values(this.data.requests)) {
      if (record.status === "RUNNING") { record.status = "UNKNOWN"; record.error_code = "INTERRUPTED_REQUEST_REQUIRES_RECONCILIATION"; interrupted = true; }
    }
    if (!row || interrupted) this.save(this.data);
  }
  save(data) {
    this.sql.exec("INSERT INTO risk_state (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", JSON.stringify(data));
    this.data = data;
  }
  update(id, patch) {
    const copy = structuredClone(this.data);
    copy.requests[id] = { ...copy.requests[id], ...structuredClone(patch) };
    this.save(copy);
    return structuredClone(copy.requests[id]);
  }
  begin(id, fingerprint) {
    const old = this.data.requests[id];
    if (old) {
      if (old.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONTENT_CONFLICT", "同一请求编号对应的资料不能改变。");
      if (old.status === "COMPLETE" && old.response) return { replay: true, response: structuredClone(old.response) };
      throw failure("REQUEST_RECONCILIATION_REQUIRED", "原请求仍在处理或待核查，不会自动重复发送。");
    }
    if (Object.keys(this.data.requests).length >= 1000) throw failure("VALIDATION_STORAGE_LIMIT", "联调记录已达上限，请先由管理员核查归档，不自动删除记录。", 429);
    this.update(id, { fingerprint, status: "RUNNING", created_at: new Date().toISOString() });
    return { replay: false };
  }
  audit(id, type, value) {
    if (this.events.length >= 20000) throw failure("VALIDATION_AUDIT_LIMIT", "联调审计已达上限，后续操作暂停。", 503);
    const body = { event_id: `conversation-audit-${randomUUID()}`, request_key: id, occurred_at: new Date().toISOString(),
      event_type: type, ...structuredClone(value), previous_hash: this.events.at(-1)?.event_hash || "GENESIS" };
    const event = { ...body, event_hash: hash(body) };
    this.sql.exec("INSERT INTO risk_events (body) VALUES (?)", JSON.stringify(event));
    this.events.push(event);
    return structuredClone(event);
  }
}
export { hash };
