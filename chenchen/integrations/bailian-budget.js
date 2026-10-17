"use strict";

const { ReviewError } = require("./model-review");
const { REQUEST_BYTES_LIMIT, RESERVATION_CNY_PER_ATTEMPT } = require("./bailian-provider");

// The durable coordinator serializes access. The local queue also protects tests
// and callers sharing one guard instance. Reserve before HTTP; never refund an
// ambiguous timeout or failed provider request, which may still be billable.
class BailianBudget {
  constructor({ storage, env, now = Date.now }) {
    this.storage = storage;
    this.env = env;
    this.now = now;
    this.queue = Promise.resolve();
  }

  exclusive(work) {
    const pending = this.queue.then(work);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async reserve({ run_id, attempt, request, model }) {
    return this.exclusive(async () => {
      const limit = Number(this.env.BAILIAN_TEST_BUDGET_CNY || 0);
      if (this.env.BAILIAN_ALLOW_PAID_CALLS !== "true" || !Number.isFinite(limit) || limit <= 0 || limit > 5) {
        throw new ReviewError("MODEL_NOT_CONFIGURED", "Bailian paid calls are disabled", { statusCode: 503, stage: "CONFIGURATION" });
      }
      const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
      if (bytes > REQUEST_BYTES_LIMIT) throw new ReviewError("INVALID_REVIEW_INPUT", "Bailian test input exceeds the 24000-byte request limit", { statusCode: 422, stage: "VALIDATION" });
      const key = "bailian-attempt:" + run_id + ":" + attempt;
      const budgetKey = "bailian-budget:v1";
      try {
        const existing = await this.storage.get(key);
        if (existing) throw new ReviewError("RATE_LIMITED", "This model attempt has already been reserved", { statusCode: 429, stage: "MODEL" });
        const budget = await this.storage.get(budgetKey) || { reserved_cents: 0, attempts: 0, minute: 0, minute_count: 0 };
        if ([budget.reserved_cents, budget.attempts, budget.minute, budget.minute_count].some(value => !Number.isSafeInteger(value) || value < 0)) {
          throw new Error("invalid budget record");
        }
        const minute = Math.floor(this.now() / 60000);
        const count = budget.minute === minute ? budget.minute_count : 0;
        if (budget.reserved_cents + 1 > Math.floor(limit * 100 + 1e-8) || count >= 6) {
          throw new ReviewError("RATE_LIMITED", "Bailian test budget or global attempt rate reached", {
            statusCode: 429, stage: "MODEL", recovery: "Check the reserved test budget and billing records before explicitly authorizing more calls."
          });
        }
        const reservation = { run_id, attempt, model, status: "RESERVED", received_at: new Date(this.now()).toISOString(),
          request_bytes: bytes, reserved_cny: RESERVATION_CNY_PER_ATTEMPT,
          accounting: "CONSERVATIVE_TEST_RESERVATION_NOT_PROVIDER_BILL", usage: null };
        await this.storage.put({
          [key]: reservation,
          [budgetKey]: { reserved_cents: budget.reserved_cents + 1, attempts: budget.attempts + 1, minute, minute_count: count + 1 }
        });
        return key;
      } catch (error) {
        if (error instanceof ReviewError) throw error;
        throw new ReviewError("MODEL_NOT_CONFIGURED", "Bailian durable budget storage is unavailable", { statusCode: 503, stage: "BACKEND" });
      }
    });
  }

  async finish({ reservation, usage, provider_response_id, elapsed_ms, error_code }) {
    return this.exclusive(async () => {
      try {
        const entry = await this.storage.get(reservation);
        if (!entry) throw new Error("missing reservation");
        const counts = {};
        for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
          counts[key] = Number.isSafeInteger(usage?.[key]) && usage[key] >= 0 ? usage[key] : null;
        }
        const completed = { ...entry, completed_at: new Date(this.now()).toISOString(),
          status: error_code ? "FAILED" : "RESPONDED", error_code: error_code || null,
          usage: counts, provider_response_id: typeof provider_response_id === "string" ? provider_response_id.slice(0,200) : null,
          elapsed_ms: Math.max(0, elapsed_ms) };
        await this.storage.put({ [reservation]: completed });
        return completed;
      } catch {
        throw new ReviewError("MODEL_NOT_CONFIGURED", "Bailian usage evidence could not be persisted", { statusCode: 503, stage: "BACKEND" });
      }
    });
  }

  hooks() {
    return { beforeModelAttempt: input => this.reserve(input), afterModelAttempt: input => this.finish(input) };
  }
}

module.exports = { BailianBudget };
