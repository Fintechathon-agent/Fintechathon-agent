# 双入口回源与独立验收

## 推荐拓扑

- 直连入口：`https://app.YOUR-DOMAIN.cn` → 国内服务器。
- China Network 入口：`https://cn.YOUR-DOMAIN.cn` → China Network → 同一个国内 HTTPS 源站。
- 原 `workers.dev`：保留原路径、原服务和原数据，不自动迁移。

域名均为占位符，尚未购买或创建 DNS。China Network 入口不是现有 workers.dev 的开关；不要把新增服务描述为已开通。

## 开通后配置顺序

1. 先完成国内入口部署和 HTTPS，运行 Node 与浏览器验收。
2. 供应商完成合同、域名资质和内容审核；按供应商给出的 DNS/CNAME 接入，保留旧记录便于撤销。这里不提供未经分配的 China Network CNAME。
3. 由供应商配置源站地址、TLS SNI 和 HTTP Host，确保存储和 API 在同一后端。浏览器请求应保持 China Network 的公开域名，不将页面重定向到 workers.dev。
4. 在私有 `.env` 的 `ADDITIONAL_PUBLIC_ORIGINS` 加入 China Network 的实际 HTTPS 来源；Caddy 的 `PUBLIC_HOSTS` 加入相应 Host。只有域名真的分配和获准接入后才能添加。
5. `/api/*`、`/health`、带 Cookie 的页面和 `text/event-stream` 全部绕过缓存。禁止缓存 Set-Cookie、账单和用户记录。动态回源与 SSE 超时由供应商按 180 秒以上链路要求确认。
6. 不转发客户端伪造的身份和来源 IP。国内反向代理与 Node 用单独随机的 PROXY_SECRET 验证代理请求；只有验证通过才信任其转发字段。这个 Secret 不等于模型 Key，也不等于 Risk HMAC。
7. 分别验收直连入口与 China Network 入口，记录实际时间、运营商、响应、SSE 和状态变更。两域名的浏览器会话不会自动互通，不宣称一个登录已经跨云同步。

## 回滚

China Network 出现故障时，将提交链接切回已通过验收的国内直连入口。撤销新增的 China Network DNS/路由时保留变更记录，不修改原 workers.dev 或删除数据库。关闭加速入口不意味着可以更换预算账本或重放资金动作。

## 不采用的快捷方式

仅绑定自定义域名到全球 Worker，不能宣称已启用 China Network；只部署首页而把 API 留在大陆无法直连的 workers.dev，也不算完成整段国内访问验收。
