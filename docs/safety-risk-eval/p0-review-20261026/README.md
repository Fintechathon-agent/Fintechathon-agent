# P0 接口、规则覆盖与联合验收评审包

日期：2026-10-26（北京时间）。负责人：Vesper／第四板块 Safety、Risk、Eval。状态：**第四板块评审提案；跨模块字段、接口与责任待团队确认**。

## 1. 本轮交付

| 材料 | 用途 |
| --- | --- |
| [接口差异表](接口差异表-v0.1.md) | 核对现有入口、字段、信任来源、金额转换与适配缺口。 |
| [风险规则覆盖表](风险规则覆盖表-v0.1.md) | 分开记录规则定义、分支实现、入口接线和同版本云端验证。 |
| [联合验收用例](联合验收用例-v0.1.md) | 20 组正常及负向场景、数值边界向量、执行与证据门槛。 |
| [结构化用例清单](联合验收用例-v0.1.json) | 可供 Owner 转为 HTTP／自动评测脚本；不是已经执行的测试报告。 |

本轮只编写、交叉核对与检查文档及用例，不新增运行接口，不应用交接补丁，不修改或部署 Worker，不调用真实模型，不进行资金操作。Cloudflare 登录状态不影响先完成这份评审包。

**当前结论：本机及候选分支已有成果；可信最终用户批准、Finance/Risk/Core 同一托管账本的线上完整闭环仍未验收。所有本包 staging 用例初始均为 `NOT_RUN`。**

## 2. 可复核来源快照

下列 SHA 于本轮 fetch 后固定。来源代码与历史证据分开阅读，不能将附件、本机未提交修复或其他分支的测试数当成 main 同版本验证。

| 来源 | 资料 | 完整 SHA | 示例入口 | 适用边界 |
| --- | --- | --- | --- | --- |
| S01 | 团队 main | `4f0144715fa78114741139f22b76fbefb70cc14f` | [chenchen/docs/core-agent-daily-update-2026-10-25.md](https://github.com/Fintechathon-agent/Fintechathon-agent/blob/4f0144715fa78114741139f22b76fbefb70cc14f/chenchen/docs/core-agent-daily-update-2026-10-25.md) | 共享主分支；报告中的测试数只适用于其注明的版本。 |
| S02 | 本机集成候选（PR #31） | `3c66ff812e9a1cc3f03e81d2e55eabea8be11d55` | [docs/integration/competition-handoff-2026-10-25.md](https://github.com/Fintechathon-agent/Fintechathon-agent/blob/3c66ff812e9a1cc3f03e81d2e55eabea8be11d55/docs/integration/competition-handoff-2026-10-25.md) | Finance 访客隔离、同访客统一现金、本机三服务链路；线上未验收。 |
| S03 | 长文本及完整 Risk 候选（PR #21） | `d63bf444cb1d6ced99977994d2be04359c724445` | [docs/safety-risk-eval/contracts/rules/R01.json](https://github.com/Fintechathon-agent/Fintechathon-agent/blob/d63bf444cb1d6ced99977994d2be04359c724445/docs/safety-risk-eval/contracts/rules/R01.json) | 固定 R01—R10、日常 D01—D08 的规则、实现与候选证据；不是 main 已合并。 |
| S04 | Core/Risk 云适配（PR #28） | `9e6bed133c36f7fa42fc15f4dc7a8791049b0841` | [chenchen/docs/core-risk-cloud-deployment-2026-10-21.md](https://github.com/Fintechathon-agent/Fintechathon-agent/blob/9e6bed133c36f7fa42fc15f4dc7a8791049b0841/chenchen/docs/core-risk-cloud-deployment-2026-10-21.md) | 独立云联调部署历史报告；不代表本轮同版本线上复验。 |
| S05 | 对话风控与回调（PR #27） | `27bdefbbb38c7d4e7b7dc1f975217862832d1d6f` | [docs/safety-risk-eval/接口字段对应与回调适配-v1.0.md](https://github.com/Fintechathon-agent/Fintechathon-agent/blob/27bdefbbb38c7d4e7b7dc1f975217862832d1d6f/docs/safety-risk-eval/%E6%8E%A5%E5%8F%A3%E5%AD%97%E6%AE%B5%E5%AF%B9%E5%BA%94%E4%B8%8E%E5%9B%9E%E8%B0%83%E9%80%82%E9%85%8D-v1.0.md) | 元/分、四态与冻结回调适配；接口信任边界。 |
| S06 | 统一界面候选（PR #26） | `cf0687962bcdcdd6ea4a48481c59532926a91f9c` | [team-staging/ui/tinglan-ai-20261018/share-worker.mjs](https://github.com/Fintechathon-agent/Fintechathon-agent/blob/cf0687962bcdcdd6ea4a48481c59532926a91f9c/team-staging/ui/tinglan-ai-20261018/share-worker.mjs) | 统一工作区与 Worker 候选；公网静态入口和本机运行证据须分别说明。 |
| S07 | 连接错误提示（PR #30） | `4b351560743fde5038eefef7cbd89413bddbe9cd` | [docs/safety-risk-eval/网络异常监测与恢复-v1.0.md](https://github.com/Fintechathon-agent/Fintechathon-agent/blob/4b351560743fde5038eefef7cbd89413bddbe9cd/docs/safety-risk-eval/%E7%BD%91%E7%BB%9C%E5%BC%82%E5%B8%B8%E7%9B%91%E6%B5%8B%E4%B8%8E%E6%81%A2%E5%A4%8D-v1.0.md) | 工作台前台健康、错误通知与未知结果保护；不授予执行权限。 |

附件来源（原文件不复制入仓库）：

| 来源 | 文件及核对值 | 证据属性 |
| --- | --- | --- |
| H01 | `team-api-handoff-20261024.zip`；SHA-256 `62aa41fd7f46e49df924cd4076fa0497f1924796a11c39d0b841e3aabe441481` | 3 个文本项：README、交接文档、45 文件源码补丁；已读、未执行。 |
| H01-P | `0001-team-api-handoff.patch`；SHA-256 `564f1228d5db1f03fdc490b7ca7be4c584ab4a72f3701df4a697c754cc4ac1ec` | 包内 README 声明目标仓库 `realchenchenluo/agent`、基线 `2735ade933d123281dd583174697e0560a735afe`、交接提交 `29aaae2a337ab930a9116fe70afb08e18a3f6f59`，且未推送、未生产部署。本轮不把声明当成已取得远端提交。 |
| H02 | `p0-2-identity-funds-closure-2026-10-25(1).md`；SHA-256 `24e057ff6268d9235b076e1f256933211a4ba36c8d7fb07f93b7baa6428973a9` | 用户提供的本机复核说明；318／263／677 等数字是原报告口径，本轮未复跑。 |

重要差异：H02 声明身份就绪误报已修，但 S02 的 `chenchen/integrations/service-security.js` 仍将 `approvalSecretConfigured` 用于 `trusted_identity_ready`。**修复是否已提交、合入并发布，须 Core Owner 对应版本证明**，不得据此放行。H01 虽已提供主聊天待审源码补丁，仍未证明它对应现行生产部署。

## 3. 统一阅读与验收口径

- `实现可见`：指定 SHA 有源码；不等于接口已接入或部署。
- `历史证据`：文件记录曾执行；只对其时间、版本、替身与范围负责。
- `待接入`：字段、身份、账本或路由尚未在指定链路证明。
- `NOT_RUN`：本次用例设计未执行。
- `BLOCKED_BY_DEPENDENCY`：计划执行时发现来源版本、身份服务、账本或权限条件缺失；需记录具体 Owner，不记为通过。
- `PASS/FAIL`：仅执行同版本用例并关联完整 HTTP、任务、审批、回执、账本及审计证据后才能填写。
- Risk 结果只使用 `ALLOW/REVIEW/BLOCK/ERROR`。`risk_decision:null` 表示尚未产生 Risk 结果，不是第五态。
- Risk 决策、用户批准、执行资格、执行结果分别记录。旧 Core 回调中的 `APPROVE` 是机器风控回调结论，不能冒充用户本人批准。
- 金额以整数分计算，元字符串只在明确来源映射时转换；模型费用微元另计。未知不得填零，已有到账收入不能重复计入现金。
- 一次模型解释或静态页面可达，不能证明本人批准、同账本原子写入或端到端成功。
- “同一版本联合验收”指各服务自己的源码SHA和部署ID均匹配同一发布清单，不要求不同服务共享一个部署ID。

## 4. 需要一次会议定下的事项

| 编号 | 待确认决策 | 提议牵头／配合方 | 对应交付 |
| --- | --- | --- | --- |
| T01 | 主聊天补丁的接收仓库、当前部署 SHA、实际 staging 与 `xinlan-qwen38-share` 的关系 | 架构负责人／理想、林粹 | 同版本来源记录、可回滚部署标识。 |
| T02 | 登录或可信访客主体怎样关联账户、谁提供最终用户批准服务 | 理想、林粹／Vesper | 服务端可信身份、审批凭据与重放校验契约。 |
| T03 | Finance 唯一托管资金账本、账户版本、原子预留／提交／释放 | 七七、林粹／Vesper | 共享资金 API 与并发、故障恢复证据。 |
| T04 | `amount-risk.v1` 如何适配团队 Risk；冻结回调外怎样承载扩展上下文 | Vesper、林粹／架构负责人 | 不绕过 Schema 的字段对照与固定原因代码。 |
| T05 | 模型预算、真实模型测试窗口、失败提示与生产边界 | 模型／费用 Owner、前端 Owner、Vesper | 明确费用许可、真实与替身标识、错误显示、全程执行门禁。 |

以上是分工提案，不替队友承诺工作。团队未确认具体接口前，文档中的新字段和建议 HTTP 行为不能写成已部署事实。

## 5. 交付检查范围

本包核对 Markdown 链接、来源 SHA／附件哈希、规则与用例关联、JSON 可读性、金额算术、状态及证据字段。通过这些检查只说明**材料内部一致且可评审**，不等于所设计的联合验收已经通过。

本轮结果见[材料检查记录](材料检查记录-2026-10-26.json)。记录中的检查数含逐行表格结构检查，不是应用测试数；文件哈希对应评审时UTF-8工作区字节。团队确认B01—B05后，再按用例收集实际staging报告。
