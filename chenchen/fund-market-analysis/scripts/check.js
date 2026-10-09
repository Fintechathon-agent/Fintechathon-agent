"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sample = JSON.parse(fs.readFileSync(path.join(root, "data", "sample-market-context.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "contracts", "market-analysis.v0.schema.json"), "utf8"));
if (sample.contract_version !== schema.properties.contract_version.const) throw new Error("market analysis Contract version mismatch");
if (!/^\d{4}-\d{2}-\d{2}$/.test(sample.as_of)) throw new Error("invalid sample date");
if (sample.data_mode !== "REFERENCE_FIXTURE") throw new Error("sample must be marked as a reference fixture");
if (!schema.properties.regime.enum.includes(sample.regime)) throw new Error("unsupported sample regime");
if (!sample.observations.length || !sample.evidence.length) throw new Error("sample is missing observations or evidence");
for (const signal of sample.signals) {
  if (!signal.signal_id || !["OBSERVED", "REVIEW_REQUIRED", "CONFIRMED"].includes(signal.status) || !signal.reason) throw new Error("invalid signal: " + signal.signal_id);
}
console.log("Fund Market Analysis check passed: " + sample.observations.length + " observations and " + sample.signals.length + " signals validated.");
