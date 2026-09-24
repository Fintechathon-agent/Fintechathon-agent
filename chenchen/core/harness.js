"use strict";

const crypto = require("node:crypto");
const { MemoryStore } = require("./memory");
const financialTools = require("../tools/financial-tools");

const REQUIRED_RISK_FIELDS = ["investment_horizon_days", "max_drawdown", "liquidity_need"];
const OWNED_STAGES = ["VALIDATE_INPUT", "DIAGNOSE", "GENERATE_CANDIDATES", "SIMULATE"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function missingRiskFields(riskProfile) {
  return REQUIRED_RISK_FIELDS.filter((field) => riskProfile === null || riskProfile === undefined || riskProfile[field] === undefined || riskProfile[field] === null || riskProfile[field] === "");
}

class Harness {
  constructor({ toolset = financialTools, memory = new MemoryStore() } = {}) {
    this.toolset = toolset;
    this.memory = memory;
    this.tasks = new Map();
  }

  createSession({ intent = "PORTFOLIO_HEALTH_CHECK", risk_profile: riskProfile = null } = {}) {
    const sessionId = id("session");
    const taskId = id("task");
    const missingFields = missingRiskFields(riskProfile);
    const state = {
      task_id: taskId,
      session_id: sessionId,
      intent,
      stage: missingFields.length ? "MINIMUM_CLARIFICATION" : "VALIDATE_INPUT",
      status: missingFields.length ? "WAITING_INPUT" : "READY",
      risk_profile: riskProfile,
      missing_fields: missingFields,
      portfolio_snapshot_id: null,
      risk_profile_id: riskProfile ? `risk-profile-${crypto.randomUUID()}` : null,
      tool_result_refs: [],
      proposed_action_ids: [],
      risk_decision_id: null,
      approval_id: null,
      error_state: null,
      checkpoint: {
        stage: missingFields.length ? "MINIMUM_CLARIFICATION" : "VALIDATE_INPUT",
        completed: [],
        resume_token: id("resume")
      }
    };
    const task = { state, artifacts: {}, events: [], failures: {} };
    this.tasks.set(taskId, task);
    this.addEvent(task, "session.created", { missing_fields: missingFields });
    return this.getTask(taskId);
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);
    return task ? clone({ task_state: task.state, artifacts: task.artifacts }) : null;
  }

  getAudit(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return clone({ task_id: taskId, task_state: task.state, events: task.events });
  }

  addEvent(task, eventType, payload = {}) {
    task.events.push({
      event_id: id("event"),
      task_id: task.state.task_id,
      actor: "harness",
      event_type: eventType,
      payload: clone(payload),
      timestamp: new Date().toISOString()
    });
  }

  checkpoint(task, stage, resultRef = null) {
    if (!task.state.checkpoint.completed.includes(stage)) task.state.checkpoint.completed.push(stage);
    task.state.checkpoint.stage = stage;
    task.state.checkpoint.last_tool_result_ref = resultRef;
  }

  runNode(task, stage, operation) {
    if (!OWNED_STAGES.includes(stage)) throw new Error(`stage is outside Harness ownership: ${stage}`);
    task.state.stage = stage;
    task.state.status = "RUNNING";
    this.addEvent(task, "stage.started", { stage });
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = operation();
        const resultRef = result.trace_id || `tool-result-${crypto.randomUUID()}`;
        task.state.tool_result_refs.push(resultRef);
        this.checkpoint(task, stage, resultRef);
        this.addEvent(task, "stage.completed", { stage, attempt, result_ref: resultRef });
        return result;
      } catch (error) {
        lastError = error;
        task.failures[stage] = (task.failures[stage] || 0) + 1;
        this.addEvent(task, "stage.failed", { stage, attempt, code: error.code || "TOOL_ERROR", message: error.message });
        if (attempt === 1) this.addEvent(task, "stage.retry_scheduled", { stage, reason: error.message });
      }
    }
    task.state.status = Object.values(task.failures).some((count) => count >= 3) ? "CIRCUIT_OPEN" : "FAILED";
    task.state.error_state = {
      code: lastError.code || "TOOL_ERROR",
      message: lastError.message,
      stage,
      retryable: false,
      recovery: "Fix the input or data source and resume from the latest checkpoint."
    };
    this.addEvent(task, "task.failed", task.state.error_state);
    throw lastError;
  }

  runHealthCheck({ task_id: taskId, session_id: sessionId, risk_profile: riskProfile, portfolio } = {}) {
    let task = taskId ? this.tasks.get(taskId) : null;
    if (!task) {
      const created = this.createSession({ risk_profile: riskProfile });
      task = this.tasks.get(created.task_state.task_id);
    }
    if (sessionId && task.state.session_id !== sessionId) throw new Error("session_id does not match task");
    if (riskProfile) {
      task.state.risk_profile = riskProfile;
      task.state.missing_fields = missingRiskFields(riskProfile);
    }
    if (task.state.missing_fields.length) {
      task.state.stage = "MINIMUM_CLARIFICATION";
      task.state.status = "WAITING_INPUT";
      this.addEvent(task, "clarification.required", { missing_fields: task.state.missing_fields });
      return this.getTask(task.state.task_id);
    }

    const validation = this.runNode(task, "VALIDATE_INPUT", () => this.toolset.validatePortfolio(portfolio || this.toolset.getDemoPortfolio()));
    if (!validation.output.valid) {
      task.state.status = "BLOCKED";
      task.state.error_state = { code: "INVALID_PORTFOLIO", reasons: validation.output.errors, recovery: "Correct the portfolio snapshot and run validation again." };
      this.addEvent(task, "task.blocked", task.state.error_state);
      return this.getTask(task.state.task_id);
    }
    const snapshot = validation.output.snapshot;
    task.state.portfolio_snapshot_id = snapshot.snapshot_id;
    task.artifacts.portfolio_snapshot = snapshot;

    const diagnosis = this.runNode(task, "DIAGNOSE", () => this.toolset.diagnosePortfolio(snapshot));
    task.artifacts.health_report = diagnosis.output;

    const candidates = this.runNode(task, "GENERATE_CANDIDATES", () => this.toolset.generateCandidates(snapshot, diagnosis.output));
    task.state.proposed_action_ids = candidates.output.candidates.map((candidate) => candidate.proposal_id);
    task.artifacts.candidates = candidates.output.candidates;

    const simulation = this.runNode(task, "SIMULATE", () => this.toolset.runSimulation(snapshot, candidates.output.candidates));
    task.artifacts.simulation = simulation.output;
    task.state.stage = "RISK_CHECK";
    task.state.status = "HANDOFF_REQUIRED";
    task.state.checkpoint.stage = "RISK_CHECK";
    task.state.handoff = { owner: "Safety/Risk/Eval", reason: "Risk decision is outside Agent Core and Tools ownership." };
    this.addEvent(task, "stage.handoff", task.state.handoff);
    return this.getTask(task.state.task_id);
  }

  resume(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (["FAILED", "BLOCKED"].includes(task.state.status)) {
      task.state.status = "READY";
      task.state.error_state = null;
      this.addEvent(task, "task.resumed", { checkpoint: task.state.checkpoint });
    }
    return this.getTask(taskId);
  }

  saveMemory(taskId, record) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("task not found");
    const entry = this.memory.save(task.state.session_id, record);
    this.addEvent(task, "memory.saved", { memory_id: entry.memory_id, type: entry.type });
    return entry;
  }

  listMemory(sessionId) {
    return this.memory.list(sessionId);
  }

  reset() {
    this.tasks.clear();
    this.memory.reset();
  }
}

module.exports = { Harness, REQUIRED_RISK_FIELDS };
