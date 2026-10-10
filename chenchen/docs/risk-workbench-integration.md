# Core Agent × 风控工作台 Demo 接入说明

## 现在做成了什么

新增 /risk-workbench 页面和 /api/risk-workbench/handoff 适配接口。页面会用固定演示持仓运行 Core Agent，取得 investment-agent.v1 响应，再把 Risk Handoff 转成风控工作台容易核对的只读交接包。

~~~text
固定演示持仓
  -> Core Agent /api/health-check/run
  -> investment-agent.v1 Response
  -> risk-workbench-adapter.js
  -> READ_ONLY_HANDOFF_PREVIEW
  -> 打开远程风控工作台人工复核
~~~

## 接口示例

~~~http
POST /api/risk-workbench/handoff
Content-Type: application/json
~~~

请求可以直接放统一 Contract，也可以放在 request 字段里：

~~~json
{
  "request": {
    "contract_version": "investment-agent.v1",
    "request_id": "req-demo-001",
    "operation": "PORTFOLIO_HEALTH_CHECK",
    "context": {
      "actor": "agent",
      "environment": "demo",
      "data_mode": "SYNTHETIC_REPLAY",
      "task_id": null,
      "session_id": null
    },
    "input": {
      "risk_profile": {
        "investment_horizon_days": 365,
        "max_drawdown": 0.1,
        "liquidity_need": "medium"
      },
      "portfolio": null
    }
  }
}
~~~

响应包含两部分：

- agent_response：原始 investment-agent.v1 响应，作为唯一事实来源。
- risk_workbench：只读适配包，包含 request_id、task_id、session_id、audit_id、持仓快照、健康报告、候选方案、模拟结果和市场复核项。

## 当前没有做的事

- 没有伪造远程风控工作台的任务写入。
- 没有自动提交用户确认。
- 没有调用模拟执行或真实交易。
- 没有把新闻、账单备注等外部业务内容提升为系统指令。
- 没有重新计算 Quant，也没有改变 Memory 规则。

原因是远程工作台当前只公开了自己的浏览器会话和 /api/safety/* 内部流程，没有公开可供 Core Agent 调用的外部 Handoff 导入接口。真正接入时，建议由风控工作台 Owner 提供一个版本化的接收接口，至少冻结：

contract_version、request_id、task_id、session_id、audit_id、evidence、decision、execution_allowed、rejection_reason 和 review_status。

## 如何查看

本地启动后打开：

http://127.0.0.1:4175/risk-workbench

点击“运行一次联调 Demo”，再点击“打开安全攻防与风控工作台”进行人工对照。页面明确显示“只读联调 Demo”和“尚未写入远程工作台”，避免把适配层预览误认为线上接入。
