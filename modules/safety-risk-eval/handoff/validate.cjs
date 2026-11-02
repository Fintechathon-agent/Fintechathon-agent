"use strict";
const Ajv = require("../../../docs/safety-risk-eval/contracts/node_modules/ajv/dist/2020");
const formats = require("../../../docs/safety-risk-eval/contracts/node_modules/ajv-formats");
const schema = require("./upstream.schema.json");
const ajv = new Ajv({ allErrors: true, strict: false, strictNumbers: true });
formats(ajv); ajv.addSchema(schema);
module.exports = ajv.compile({ $ref: `${schema.$id}#/$defs/HealthCheckResponse` });
