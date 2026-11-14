"use strict";

const { riskCallbackReadiness } = require("../integrations/service-security");
const status = riskCallbackReadiness(process.env);
console.log(JSON.stringify(status, null, 2));
process.exitCode = status.callback_ready ? 0 : 2;
