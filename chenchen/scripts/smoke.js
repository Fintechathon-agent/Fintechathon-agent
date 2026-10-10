"use strict";
// Verifies the running process, not just the source tree. Run after npm start.
const fs = require("node:fs"), path = require("node:path");
const base = "http://127.0.0.1:" + (process.env.PORT || 4175);
(async()=>{
  for (const [route,file] of [
    ["/","versions/investment.html"],["/investment","versions/investment.html"],["/investment-v0.10","versions/investment-legacy.html"],["/merchant","versions/merchant.html"],
    ["/contracts/investment-agent.v1.schema.json","contracts/investment-agent.v1.schema.json"],
    ["/contracts/examples/health-check.request.json","contracts/examples/health-check.request.json"],
    ["/contracts/examples/health-check.response.json","contracts/examples/health-check.response.json"],
    ["/data/market-brief-2026-10-08.json","data/market-brief-2026-10-08.json"],
    ["/data/market-brief-2026-10-09.json","data/market-brief-2026-10-09.json"],
    ...["style.css","product-overrides.css","common.js","presentation.mjs","investment.js","investment-legacy.js","merchant.js"].map(file=>["/versions/"+file,"versions/"+file])
  ]) {
    const response=await fetch(base+route,{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error(route+" HTTP "+response.status+"; stop the old server and restart npm start.");
    const expectedType=file.endsWith(".html")?"text/html":file.endsWith(".css")?"text/css":file.endsWith(".json")?"application/json":"javascript";
    if(!response.headers.get("content-type")?.includes(expectedType))throw new Error(route+" has the wrong content type");
    const actual=await response.text(), expected=fs.readFileSync(path.join(__dirname,"..",file),"utf8");
    if(actual.replace(/\r\n/g,"\n")!==expected.replace(/\r\n/g,"\n"))throw new Error(route+" does not match this checkout");
  }
  console.log("Running server pages and assets verified at "+base);
})().catch(error=>{console.error("Smoke check failed:",error.message);process.exitCode=1;});
