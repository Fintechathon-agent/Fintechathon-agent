import { randomUUID } from "node:crypto";
import contract from "../../../docs/safety-risk-eval/contracts/validate.cjs";
const { hash } = contract;

export class CloudStore {
  constructor(db, session, lease, payload) {
    Object.assign(this, { db, session, lease });
    this.data = payload.data;
    this.events = payload.events;
    let previous = "GENESIS";
    for (const row of this.events) {
      const { event_hash, ...body } = row;
      if (body.previous_hash !== previous || hash(body) !== event_hash) throw new Error("AUDIT_CHAIN_INVALID");
      previous = event_hash;
    }
    // A durable RUNNING record left by an earlier request is never automatically replayed.
    for (const execution of Object.values(this.data.executions)) if (execution.status === "RUNNING") execution.status = "UNKNOWN";
  }
  static async open(db, session) {
    if (!db) throw new Error("DATABASE_UNAVAILABLE");
    const lease = randomUUID(), now = Date.now();
    const claim = await db.prepare("UPDATE risk_demo_sessions SET lease_owner=?1, lease_until=?2 WHERE session_id=?3 AND lease_until<?4").bind(lease, now + 120000, session.session_id, now).run();
    if (claim.meta.changes !== 1) throw new Error("SESSION_BUSY");
    try {
      const row = await db.prepare("SELECT payload FROM risk_demo_sessions WHERE session_id=?1 AND lease_owner=?2").bind(session.session_id, lease).first();
      return new CloudStore(db, session, lease, JSON.parse(row.payload));
    }
    catch (error) { await db.prepare("UPDATE risk_demo_sessions SET lease_owner=NULL,lease_until=0 WHERE session_id=?1 AND lease_owner=?2").bind(session.session_id, lease).run(); throw error; }
  }
  transaction(fn) {
    const draft = structuredClone(this.data), result = fn(draft);
    this.data = draft; return structuredClone(result);
  }
  append(event) {
    if (this.events.length >= 800) throw new Error("DEMO_EVENT_LIMIT");
    const body = { ...structuredClone(event), previous_hash: this.events.at(-1)?.event_hash || "GENESIS" };
    const row = { ...body, event_hash: hash(body) };
    this.events.push(row); return structuredClone(row);
  }
  async flush() {
    const payload = JSON.stringify({ data: this.data, events: this.events });
    if (new TextEncoder().encode(payload).length > 1800000) throw new Error("DEMO_STORAGE_LIMIT");
    const result = await this.db.prepare("UPDATE risk_demo_sessions SET payload=?1,revision=revision+1,updated_at=?2 WHERE session_id=?3 AND lease_owner=?4 AND lease_until>?2").bind(payload, Date.now(), this.session.session_id, this.lease).run();
    if (!result.success || result.meta.changes !== 1) throw new Error("PERSISTENCE_OR_LEASE_FAILED");
  }
  async close() {
    await this.db.prepare("UPDATE risk_demo_sessions SET lease_owner=NULL,lease_until=0 WHERE session_id=?1 AND lease_owner=?2").bind(this.session.session_id, this.lease).run();
  }
}

export async function getSession(db, request) {
  if (!db) throw new Error("DATABASE_UNAVAILABLE");
  const cookie = /(?:^|;\s*)risk_session=([a-f0-9-]{36})/.exec(request.headers.get("cookie") || "")?.[1];
  if (cookie) {
    const row = await db.prepare("SELECT session_id,user_id,csrf FROM risk_demo_sessions WHERE session_id=?1").bind(cookie).first();
    if (row) return { ...row, fresh: false };
  }
  const session = { session_id: randomUUID(), user_id: `demo-user-${randomUUID()}`, csrf: randomUUID(), fresh: true };
  const payload = JSON.stringify({ data: { tasks: {}, executions: {}, snapshots: {}, memories: [] }, events: [] });
  await db.prepare("INSERT INTO risk_demo_sessions(session_id,user_id,csrf,payload,updated_at) VALUES(?1,?2,?3,?4,?5)").bind(session.session_id, session.user_id, session.csrf, payload, Date.now()).run();
  return session;
}
