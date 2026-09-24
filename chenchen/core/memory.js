"use strict";

const crypto = require("node:crypto");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryStore {
  constructor() {
    this.sessions = new Map();
  }

  ensureSession(sessionId) {
    if (!sessionId) throw new Error("session_id is required");
    if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, []);
    return this.sessions.get(sessionId);
  }

  save(sessionId, record) {
    if (!record || !["preference", "decision"].includes(record.type)) {
      throw new Error("memory type must be preference or decision");
    }
    if (record.consent !== true) throw new Error("explicit consent is required before memory is saved");
    const entries = this.ensureSession(sessionId);
    const entry = {
      memory_id: `memory-${crypto.randomUUID()}`,
      session_id: sessionId,
      type: record.type,
      key: record.key || record.type,
      value: clone(record.value || {}),
      source: "user_confirmed",
      created_at: new Date().toISOString()
    };
    entries.push(entry);
    return clone(entry);
  }

  list(sessionId) {
    return clone(this.sessions.get(sessionId) || []);
  }

  clear(sessionId) {
    this.sessions.delete(sessionId);
    return { session_id: sessionId, cleared: true };
  }

  reset() {
    this.sessions.clear();
  }
}

module.exports = { MemoryStore };
