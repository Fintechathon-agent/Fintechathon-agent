# 提案：听澜浏览器安全复用既有 Review

状态：候选代码与 Mock 已准备，等待后端/Contract Owner 确认后部署。没有修改团队根目录 API 或正式交付区。

保持 POST /api/review 的 model-review.v1 输入和 review-workflow.v1 响应、PENDING_RISK、execution_allowed=false。仅通过已有 context 携带风险偏好，不增加必填共享 Schema 字段，不修改 Risk、Approval、PAPER 或 Audit。

新增外围身份保护采用 Cloudflare Access 签名验证；浏览器不能拿到 CORE_AGENT_API_KEY。Wrapper 只允许创建只读任务，构造服务端请求并绑定主体/幂等键；持久化每用户请求限额，复用原总预算。拟新增 GET /api/tinglan/status 只读状态（不推理）；同源静态配置路径返回非敏感 endpoint/model。两条辅助路由仅存在隔离候选，未注册到团队生产服务。

Owner 需确认：允许的 Access 应用与账号名单、同源资产及自定义域名、每用户限额、日志保留、现有机器调用兼容性；放行 qwen3.8-flash 的精确白名单与供应商模型一致性校验；保留原 3.7 行为与全部249项回归。

prepare.cjs 将修改应用在系统临时副本供检查，不会把后端直接覆盖进当前工作区。Owner 审核后才能将候选部署为现有 Worker 的版本。不得将当前草稿 PR 的合并等同于付费调用授权。
