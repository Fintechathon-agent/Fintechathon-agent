"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { hash } = require("../../docs/safety-risk-eval/contracts/validate.cjs");

class JournalStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.lock = path.join(this.directory, "writer.lock");
    this.lockFd = fs.openSync(this.lock, "wx");
    fs.writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    this.stateFile = path.join(this.directory, "state.json");
    this.auditFile = path.join(this.directory, "audit.jsonl");
    try {
      this.data = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, "utf8")) : { tasks: {}, executions: {}, snapshots: {} };
      this.events = fs.existsSync(this.auditFile) ? fs.readFileSync(this.auditFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
      let previous = "GENESIS";
      for (const event of this.events) {
        const { event_hash, ...body } = event;
        if (body.previous_hash !== previous || hash(body) !== event_hash) throw new Error("AUDIT_CHAIN_INVALID");
        previous = event_hash;
      }
      for (const execution of Object.values(this.data.executions)) if (execution.status === "RUNNING") execution.status = "UNKNOWN";
      this.save(this.data);
    } catch (error) { this.close(); throw error; }
  }
  save(data) {
    const tmp = this.stateFile + "." + randomUUID() + ".tmp";
    const fd = fs.openSync(tmp, "wx");
    try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.stateFile);
  }
  transaction(fn) {
    const draft = structuredClone(this.data);
    const result = fn(draft);
    this.save(draft); this.data = draft;
    return structuredClone(result);
  }
  append(event) {
    const body = { ...structuredClone(event), previous_hash: this.events.at(-1)?.event_hash || "GENESIS" };
    const row = { ...body, event_hash: hash(body) };
    const fd = fs.openSync(this.auditFile, "a");
    try { fs.writeFileSync(fd, JSON.stringify(row) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.events.push(row); return structuredClone(row);
  }
  close() {
    if (this.lockFd === undefined) return;
    fs.closeSync(this.lockFd); this.lockFd = undefined; fs.unlinkSync(this.lock);
  }
}
module.exports = { JournalStore };
