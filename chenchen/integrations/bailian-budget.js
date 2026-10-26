"use strict";

const { ReviewError } = require("./model-review");
const { REQUEST_BYTES_LIMIT, RESERVATION_CNY_PER_ATTEMPT } = require("./bailian-provider");

const BUDGET_KEY = "bailian-budget:v1"; // Preserve the existing durable ledger.
const MICROS_PER_CNY = 1000000;
const INPUT_RATE = 0.8; // Micro-CNY per token at the Beijing list price.
const OUTPUT_RATE = 2.7;

function amountMicros(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number * MICROS_PER_CNY + 1e-7) : 0;
}

function beijingDay(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function quoteMicros(bytes, maxOutput) {
  // UTF-8 bytes upper-bound text tokens. Include protocol overhead; this is
  // an internal list-price estimate, not a provider billing guarantee.
  return Math.max(Math.round(RESERVATION_CNY_PER_ATTEMPT * MICROS_PER_CNY),
    Math.ceil((bytes + 1024) * INPUT_RATE + maxOutput * OUTPUT_RATE));
}

function normalizeBudget(value) {
  const original = value || { reserved_cents: 0, attempts: 0, minute: 0, minute_count: 0 };
  for (const key of ["reserved_cents", "attempts", "minute", "minute_count"]) {
    if (!Number.isSafeInteger(original[key]) || original[key] < 0) throw new Error("invalid legacy budget record");
  }
  const budget = original.version === 2 ? { ...original } : {
    ...original, version: 2, spent_micros: original.reserved_cents * 10000,
    held_micros: 0, day: "", daily_spent_micros: 0, daily_held_micros: 0
  };
  for (const key of ["spent_micros", "held_micros", "daily_spent_micros", "daily_held_micros"]) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < 0) throw new Error("invalid budget record");
  }
  return budget;
}

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
      const totalLimit = amountMicros(this.env.BAILIAN_TEST_BUDGET_CNY);
      const dailyLimit = amountMicros(this.env.BAILIAN_DAILY_BUDGET_CNY);
      if (this.env.BAILIAN_ALLOW_PAID_CALLS !== "true" || totalLimit <= 0 || totalLimit > 5 * MICROS_PER_CNY ||
        dailyLimit <= 0 || dailyLimit > totalLimit) {
        throw new ReviewError("MODEL_NOT_CONFIGURED", "Bailian paid calls are disabled", { statusCode: 503, stage: "CONFIGURATION" });
      }
      const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
      if (bytes > REQUEST_BYTES_LIMIT) throw new ReviewError("INVALID_REVIEW_INPUT", "Bailian test input exceeds the 24000-byte request limit", { statusCode: 422, stage: "VALIDATION" });
      const maxOutput = Number(request?.max_tokens || this.env.BAILIAN_MAX_OUTPUT_TOKENS || 1600);
      if (!Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > 1600) {
        throw new ReviewError("MODEL_NOT_CONFIGURED", "Bailian output limit is invalid", { statusCode: 503, stage: "CONFIGURATION" });
      }
      const reservedMicros = quoteMicros(bytes, maxOutput);
      const key = "bailian-attempt:" + run_id + ":" + attempt;
      try {
        if (await this.storage.get(key)) throw new ReviewError("RATE_LIMITED", "This model attempt has already been reserved", { statusCode: 429, stage: "MODEL" });
        const budget = normalizeBudget(await this.storage.get(BUDGET_KEY));
        const minute = Math.floor(this.now() / 60000);
        const count = budget.minute === minute ? budget.minute_count : 0;
        const day = beijingDay(this.now());
        if (budget.day !== day) {
          budget.day = day;
          budget.daily_spent_micros = 0;
          budget.daily_held_micros = 0;
        }
        if (count >= 6) {
          throw new ReviewError("RATE_LIMITED", "Bailian global attempt rate reached", { statusCode: 429, stage: "MODEL" });
        }
        const totalExhausted = budget.spent_micros + budget.held_micros + reservedMicros > totalLimit;
        const dailyExhausted = budget.daily_spent_micros + budget.daily_held_micros + reservedMicros > dailyLimit;
        if (totalExhausted || dailyExhausted) {
          throw new ReviewError("DAILY_BUDGET_EXHAUSTED", "Bailian internal test budget reached", {
            statusCode: 429, stage: "MODEL", details: { budget_scope: totalExhausted ? "TOTAL" : "DAILY" },
            recovery: "Inspect the internal ledger and provider bill before authorizing further calls."
          });
        }
        const reservation = { run_id, attempt, model, status: "RESERVED", received_at: new Date(this.now()).toISOString(),
          request_bytes: bytes, reserved_cny: reservedMicros / MICROS_PER_CNY, reserved_micros: reservedMicros,
          budget_day: day, accounting: "LIST_PRICE_ESTIMATE_NOT_PROVIDER_BILL", usage: null };
        await this.storage.put({ [key]: reservation, [BUDGET_KEY]: {
          ...budget, held_micros: budget.held_micros + reservedMicros,
          daily_held_micros: budget.daily_held_micros + reservedMicros,
          attempts: budget.attempts + 1, minute, minute_count: count + 1
        } });
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
        if (entry.status !== "RESERVED") return entry;
        const counts = {};
        for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
          counts[key] = Number.isSafeInteger(usage?.[key]) && usage[key] >= 0 ? usage[key] : null;
        }
        const knownUsage = !error_code && counts.prompt_tokens !== null && counts.completion_tokens !== null;
        const chargedMicros = knownUsage
          ? Math.ceil(counts.prompt_tokens * INPUT_RATE + counts.completion_tokens * OUTPUT_RATE)
          : entry.reserved_micros;
        const completed = { ...entry, completed_at: new Date(this.now()).toISOString(),
          status: error_code ? "FAILED" : "RESPONDED", error_code: error_code || null,
          usage: counts, provider_response_id: typeof provider_response_id === "string" ? provider_response_id.slice(0, 200) : null,
          elapsed_ms: Math.max(0, elapsed_ms), charged_micros: chargedMicros,
          accounting: knownUsage ? "TOKEN_LIST_PRICE_ESTIMATE_NOT_PROVIDER_BILL" : "CONSERVATIVE_RESERVATION_NOT_PROVIDER_BILL" };
        if (!Number.isSafeInteger(entry.reserved_micros)) {
          await this.storage.put({ [reservation]: completed }); // Legacy reservation already counted in reserved_cents.
          return completed;
        }
        const budget = normalizeBudget(await this.storage.get(BUDGET_KEY));
        if (budget.held_micros < entry.reserved_micros) throw new Error("missing budget hold");
        budget.held_micros -= entry.reserved_micros;
        budget.spent_micros += chargedMicros;
        if (budget.day === entry.budget_day) {
          if (budget.daily_held_micros < entry.reserved_micros) throw new Error("missing daily hold");
          budget.daily_held_micros -= entry.reserved_micros;
          budget.daily_spent_micros += chargedMicros;
        }
        await this.storage.put({ [reservation]: completed, [BUDGET_KEY]: budget });
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

module.exports = { BailianBudget, quoteMicros };
