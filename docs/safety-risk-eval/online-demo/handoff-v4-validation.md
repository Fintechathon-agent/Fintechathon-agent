# 交接接收接口验证记录

日期：2026-10-10。虚构数据；不代表服务身份认证、实时模型调用或完整攻防联调已完成。

## 后端

执行 `node --test modules/safety-risk-eval/test/*.test.cjs modules/safety-risk-eval/hosting/test/*.test.mjs`：81 项通过，0 失败。最终补齐冲突审计与原 Core 审计查询后，再运行 handoff.test.cjs 与 http.test.cjs：14 项通过，0 失败。

新增验证覆盖：最新 Core 完整响应、原件保留、来源摘要与编号映射、重复导入、冲突、不同用户隔离、缺失成果、自报身份、trace 错配、审计串任务、证据错配、伪造执行授权、修改画像后保持阻止、CSRF 和跨来源请求拒绝、直接执行零调用。

## 本地实际浏览器

目标 `http://127.0.0.1:8781/risk`，使用 Codex 浏览器操作真实控件：

| 路径 | 观察结果 |
| --- | --- |
| 加载记录的 Core 响应 → 校验并导入 | 创建本地任务，展示原 request/task/session/handoff/audit、source_digest 与新的 task；审计包含 HANDOFF_IMPORTED；Policy BLOCK，确认/执行禁用 |
| 再次导入相同内容 | 提示重复交接返回原任务，没有重复创建 |
| 确认画像 → 修改约束并重新检查 | 金融 Risk 可为 ALLOW；Policy 仍 BLOCK，原因 POLICY_HANDOFF_UNVERIFIED；确认/执行仍禁用 |
| 输入空对象并导入 | 明确拒绝不完整 Core 响应，提示缺少 trace/artifacts/tool_results/audit_evidence |

已检查当前桌面视口不存在页面横向溢出。本轮未重新进行整套手机视觉验收。

## 来源

完整示例由主分支 `4a1f4fe9737af12250ddcb6f0b9b51edaaf437a9` 的 `Harness.runHealthCheckContract` 使用固定健康检查请求实际生成。只运行仓库内 Core 与固定工具，未调用外部大模型。

原件规范化摘要：`8141ea085ee3a60083cbe5749c4ab10670448e5ba14db76e069e5eb28ef82717`。摘要用于内容关联，不证明来源服务已认证。

## 发布与公网验证限制

Sites 确认版本 4 发布成功，源码提交 `12979d4b9efe7d74d8aa45648fc125c54a855e59`，部署标识 `appgdep_6aca0840487081918e6661c284dc029c`。公网浏览器导航与恢复绑定两次超时，本轮没有取得公网导入交互的确认结果。保留上述本地验证证据，不将其表述为公网复测结果。
