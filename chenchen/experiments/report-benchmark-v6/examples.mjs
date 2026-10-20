import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import harness from "../../core/harness.js";
import { buildInvestmentReport, investmentReportText } from "../../versions/investment-report.mjs";

const directory = fileURLToPath(new URL("../../docs/readable-report-2026-10-20/", import.meta.url));
const result = new harness.Harness().runHealthCheck({risk_profile:{investment_horizon_days:30,max_drawdown:.1,liquidity_need:"high"}});
const report = buildInvestmentReport(result, {observedOn:"2026-10-20"});
fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,"投资分析示例.txt"),"\ufeff"+investmentReportText(report),{flag:"wx"});
fs.writeFileSync(path.join(directory,"investment-example.json"),JSON.stringify({synthetic:true,model_called:false,report,result},null,2)+"\n",{flag:"wx"});
console.log("Synthetic example saved; no network or model call.");
