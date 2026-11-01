# Personal AI Fund Manager 统一前端候选

此目录保留公开主聊天的侧栏、消息区、输入框和响应式样式，仅将欢迎文案与交互脚本改为银行任务入口。`health.css` 于 2026-11-01 从公开正式站 `/health.css` 取得，SHA-256 为 `F716451A9D3BA129DA262ABDF0DF485281A6454B80BA5CBBB2058759906225E5`。公开 HTML 是页面快照；正式 Worker 的服务端源码与部署 Git SHA 尚未取得。本目录不是当前正式站的源码导出。

## 本机运行

从团队仓库根目录运行：

```powershell
python qiqi/web/guest_gateway.py --port 8879 --frontend personal --joint-core-risk
```

打开输出的 `http://127.0.0.1:8879/`。仅监听本机回环地址。这个启动方式会创建独立的访客 Finance 账本，并启动项目源码的 Risk Node HTTP 和 Core Worker Handler HTTP。Core 模型、存储使用明确的测试替身；不需要云密钥，不调用付费模型。关闭网关后本机 Core/Risk 测试运行时也会关闭。

## 请求路径

```text
同一页面输入
  ├─ 账单、转账 → Finance /api/scenarios/run → 访客模拟账本、待确认和模拟回执
  └─ 理财 → Finance /api/scenarios/run 委派
              → Finance /api/personal-fund/review（从服务端访客账本取现金）
              → Risk /api/review（确定性检查）
              → Core /api/review → Risk HMAC 回写 Core → 同 task_id 只读结果
```

浏览器不能提交 `user_id`、风险结论或批准。Risk 请求编号由服务端访客身份和浏览器本轮编号派生，避免不同访客复用同一个幂等任务。现金取自 Finance 账本，未确认的保护用途、已有占用、投资金额仍为未知；因此程序可能返回 `REVIEW`，不会将问题中的数字当成已确认的金融事实。页面显示 Core `task_id`、Risk 检查号、审计号和签名回写状态。任何不完整回写或身份校验失败都不会成为成功结果。

账单与转账当前由 Finance 确定性服务处理；它们没有伪装成 Core/Risk 的同任务结果。此候选没有真实用户登录、正式审批、真实模型、跨机器持久存储或执行网关，`execution_allowed=false`。它尚未部署到公开主聊天或团队 staging，不能称为三场景线上联合验收。

## 验证

```powershell
python -m unittest qiqi.tests.test_personal_joint -v
node --check qiqi/web/static/personal-fund/integration.js
node --check modules/safety-risk-eval/joint-acceptance/personal-fund-runtime.cjs
```

专项测试覆盖同一 Core/Risk 任务与签名回写、Finance 账本快照、重放与改参冲突、伪造身份拒绝、跨访客任务隔离；现有 Finance 全量回归及三服务 HTTP 验收也应在交付前运行。正式发布需要先取得主聊天 Worker 的现行源码及部署 SHA 映射，再将此入口接到同版本 staging，做真实浏览器与线上联合验收。
