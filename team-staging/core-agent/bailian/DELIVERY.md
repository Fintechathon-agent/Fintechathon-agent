# 百炼接入 · 临时共创交付

维护账号：realchenchenluo。阶段：本地验证通过、真实接入未开通。只放在临时共创区，尚未进入正式交付区。

- [开通步骤](../../../chenchen/docs/bailian-setup-guide-2026-10-17.md)
- [实现、配置和六类验收边界](../../../chenchen/docs/bailian-integration-2026-10-17.md)
- [本地测试原始输出](../../../chenchen/docs/bailian-local-tests-2026-10-17.txt)
- [尚未执行的真实验收记录模板](../../../chenchen/docs/bailian-live-acceptance-template.json)

从仓库根目录运行：

```sh
node --test chenchen/tests/bailian.test.mjs chenchen/tests/bailian-worker.test.mjs
node chenchen/scripts/bailian-preflight.js
```

前者全部使用虚构数据和 HTTP 替身，不访问阿里云；后者仅检查本地环境，当前应返回 NOT_READY。需要 Node.js 22+。无需购买服务、充值或填写真实密钥即可运行测试。

源码统一维护在 chenchen/，本目录仅作为共同交付入口，不复制另一套后端。team-release/ 保持不动。原有 API、Memory 规则、Risk 判定和其他成员代码不变。

待配合事项：由账号使用者开通百炼和安全设置 Key；模型调用费用须明确授权。由各模块 Owner 确认真实账户数据、只读工具、身份、Risk 与审批的联合测试。没有这些证据，不能宣称正式接通。
