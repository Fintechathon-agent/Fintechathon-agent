import { $, esc, money, pct, api, toast, downloadLink, chart } from "./common.js";
let result;
const names = { CURRENT:"当前组合", A:"A 保持或最小动作", B:"B 温和调整", C:"C 风险优先" };
async function init() {
  const data = await api("/api/demo/portfolio"), p = data.output.snapshot;
  const raw = { portfolio_id:p.portfolio_id, as_of:p.as_of, cash:p.cash, positions:p.positions.map(({instrument_id,type,quantity,price,name,sector})=>({instrument_id,type,quantity,price,name,sector})) };
  $("#portfolio-json").value = JSON.stringify(raw, null, 2);
  renderHoldings(p);
}
function renderHoldings(p) {
  $("#holdings").innerHTML = '<div class="table-wrap"><table><thead><tr><th>本次证券</th><th>类型</th><th class="num">市值</th><th class="num">占比</th></tr></thead><tbody>'+
    p.positions.map(p=>'<tr><td>'+esc(p.name)+'<small>'+esc(p.instrument_id)+'</small></td><td>'+esc(p.type)+'</td><td class="num">'+money(p.market_value*100)+'</td><td class="num">'+pct(p.weight)+'</td></tr>').join("")+
    '<tr><td>现金</td><td>备用资金</td><td class="num">'+money(p.cash*100)+'</td><td class="num">'+pct(p.cash_weight)+'</td></tr></tbody></table></div><p class="small muted">合计 '+money(p.total_value*100)+' · 数据截至 '+esc(p.as_of.slice(0,10))+'</p>';
}
$("#demo-profile").onclick = () => { $("#horizon").value=365; $("#drawdown").value=10; $("#liquidity").value="medium"; toast("已填入虚构用户偏好，可自行修改。"); };
$("#check-form").onsubmit = async event => {
  event.preventDefault(); $("#run").disabled=true; $("#results").hidden=true;
  try {
    result=await api("/api/health-check/run", { risk_profile:{investment_horizon_days:Number($("#horizon").value),max_drawdown:Number($("#drawdown").value)/100,liquidity_need:$("#liquidity").value},portfolio:JSON.parse($("#portfolio-json").value) });
    if (result.task_state.status !== "HANDOFF_REQUIRED") throw new Error(result.task_state.error_state?.reasons?.join("；") || "请补齐有效的持仓与风险信息。");
    const a=result.artifacts, m=a.health_report.metrics, s=a.simulation;
    renderHoldings(a.portfolio_snapshot);
    $("#risk-metrics").innerHTML = [["历史窗口回撤",pct(m.max_drawdown),"7 个观测值"],["年化波动率",pct(m.annualized_volatility),"短样本年化，仅演示公式"],["现金占比",pct(a.portfolio_snapshot.cash_weight),"现金单独展示"]].map(v=>'<article class="metric"><small>'+v[0]+'</small><strong>'+v[1]+'</strong><small>'+v[2]+'</small></article>').join("");
    $("#findings").innerHTML='<p>最大证券仓位为 <b>'+esc(a.health_report.concentration.largest_instrument)+'</b>，占比 <b>'+pct(a.health_report.concentration.top_1)+'</b>。</p>'+a.health_report.hidden_clusters.map(c=>'<p class="small">'+esc(c.instruments.join(" / "))+' · 相关系数 <b>'+c.correlation.toFixed(3)+'</b></p>').join("");
    $("#comparison").innerHTML='<div class="table-wrap"><table><thead><tr><th>方案</th><th class="num">历史收益</th><th class="num">最大回撤</th><th class="num">换手率</th><th class="num">情景 P10 / P50 / P90</th></tr></thead><tbody>'+s.comparisons.map((c,i)=>{const d=s.scenarios[i].distribution;return '<tr><td>'+names[c.plan_id]+'</td><td class="num">'+pct(c.metrics.cumulative_return)+'</td><td class="num">'+pct(c.metrics.max_drawdown)+'</td><td class="num">'+pct(c.turnover)+'</td><td class="num">'+[d.p10,d.p50,d.p90].map(pct).join(" / ")+'</td></tr>';}).join("")+'</tbody></table></div>';
    $("#investment-chart").innerHTML=chart(s.comparisons.map(c=>({name:names[c.plan_id],values:c.curve.map(p=>Number(((p.value-1)*100).toFixed(4)))})),s.comparisons[0].curve.map(p=>p.date.slice(5)));
    $("#weights").innerHTML='<div class="table-wrap"><table><thead><tr><th>标的</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>'+[...new Set(a.candidates.flatMap(c=>Object.keys(c.target_weights)))].map(id=>'<tr><td>'+esc(id)+'</td>'+a.candidates.map(c=>'<td>'+pct(c.target_weights[id]||0)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';
    $("#assumptions").textContent="曲线单位为 %；统一起始资金 "+money(s.assumptions.initial_capital*100)+"。交易成本按单向换手 × "+pct(s.transaction_cost_rate)+" 一次扣除；2,000 条联合收益区块重采样路径，固定种子，20 个交易日情景。无风险利率 2%，年化系数 252。";
    $("#task-status").textContent="当前阶段 "+result.task_state.stage+" · 等待团队风控接入";
    $("#assumptions").textContent += " 风险偏好随任务交接；A/B/C 为固定规则示例，尚未完成个性化适配与风控审批。";
    const audit=await api("/api/audit/"+encodeURIComponent(result.task_state.task_id));
    $("#evidence").textContent=JSON.stringify({task_state:result.task_state,tool_results:result.tool_results,audit:audit.events},null,2);
    $("#results").hidden=false; $("#results").scrollIntoView({behavior:"smooth"}); toast("诊断与模拟完成，结果可下载核对。");
  } catch(error) { toast(error.message); } finally {$("#run").disabled=false;}
};
$("#export").onclick=()=>downloadLink("/api/task/"+encodeURIComponent(result.task_state.task_id)+"/export");
init().catch(error=>toast(error.message));
