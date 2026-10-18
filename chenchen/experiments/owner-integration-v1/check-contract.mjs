import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import handoffModule from "../../integrations/risk-handoff.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error("Missing " + name);
  return path.resolve(process.argv[index + 1]);
}

// Validate the unchanged public schemas. A failing result is a real integration
// blocker, never an expected-failure test or an invitation to loosen the schema.
const snapshot = argument("--snapshot");
const evidence = JSON.parse(fs.readFileSync(argument("--evidence"), "utf8"));
const require = createRequire(path.join(snapshot, "source/docs/safety-risk-eval/contracts/package.json"));
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const directory = fileURLToPath(new URL("../../contracts/", import.meta.url));
const schemas = fs.readdirSync(directory).filter(file => file.endsWith(".schema.json"))
  .map(file => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")));
for (const schema of schemas) ajv.addSchema(schema);
const validator = ajv.getSchema("https://fintechathon-agent.github.io/contracts/risk-handoff.v1.schema.json#/$defs/HandoffPackage");
if (!validator) throw new Error("HandoffPackage validator unavailable");
const record = evidence.transport.find(entry => entry.response.workflow_version && entry.response.proposed_action)?.response;
if (!record) throw new Error("No successful Core workflow record in evidence");
const handoff = handoffModule.buildRiskHandoffPackage(record);
const valid = validator(handoff);
const result = { recorded_for_date: evidence.recorded_for_date, schema_modified: false,
  validator: "ajv " + require("ajv/package.json").version, schema: "risk-handoff.v1#/$defs/HandoffPackage",
  status: valid ? "PASS" : "BLOCKED_CONTRACT_MISMATCH", errors: validator.errors || [],
  owner_commit: evidence.owner_commit, input_task_id: record.task_id, handoff,
  resolution_owner: "Core/Backend and Risk must confirm the source task field location and compatibility before changing the frozen contract." };
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
if (!valid) process.exitCode = 1;
