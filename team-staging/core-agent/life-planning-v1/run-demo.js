"use strict";
require("../../../chenchen/experiments/life-planning-v1/fixture").runFixture()
  .then(result => process.stdout.write(JSON.stringify(result, null, 2) + "\n"))
  .catch(error => { console.error(error.code || "DEMO_FAILED", error.message); process.exitCode = 1; });
