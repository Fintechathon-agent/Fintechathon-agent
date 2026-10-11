# 项目协作规则

## 语言

- 默认使用简体中文交流。
- 代码使用英文命名与英文注释；说明文档可使用中文。

## GitHub 同步（必须执行）

- 本项目远程仓库为 `https://github.com/Fintechathon-agent/Fintechathon-agent.git`。
- 每次完成一轮项目文件修改，必须执行适合该改动的检查或测试，审查差异，创建 Git 提交，并推送到该远程仓库。仅保存本地文件或仅创建本地提交不算交付完成。
- 开始修改前检查当前分支、工作区状态及远程更新，保留其他协作者和用户的未提交改动。
- 只提交本轮任务涉及的文件；不得上传密钥、令牌、密码或未经授权的敏感资料。
- 遵循仓库的分支保护与协作约定；需要审核时，推送工作分支并创建拉取请求，不擅自合并或绕过保护。
- 不强制推送，不覆盖协作者的提交。如发生冲突，先妥善解决并重新验证，再推送。
- 推送后核对本地提交与远程分支的提交编号一致，并在交付时报告分支、提交编号和同步结果。
- 如果测试、权限、网络或冲突阻止同步，明确报告原因与尚未完成的步骤，不将未同步的修改称为已完成。
- 仅检查或讨论、没有项目文件变更时，不创建无意义的空提交。

## 团队分工与公共 Contract（必须遵守）

- 本仓库用户负责“产品交互与演示”模块：Web UI、状态可视化、证据展示、Demo Story；不负责后端业务逻辑。
- 可以直接修改：chenchen/versions/、UI 检查脚本、静态演示构建、review/、screenshots/、文档。
- chenchen/core、chenchen/tools、chenchen/merchant、chenchen/data、server.js 的 /api 逻辑、docs/safety-risk-eval 属于其他 Owner，只读。
- Golden Path、API / Shared Schema、Risk 状态、Approval Logic、Audit Log、核心数据结构的变更，必须先在群里或飞书 Wiki 留记录，由对应 Owner 确认后再 merge；不得私改或口头约定后直接改。
- 需要后端新字段或接口：在 docs/contract-proposals/ 写提案并提交，停下等用户确认。不在后端自行添加，不在前端伪造。
- 红线：不接真实资金；不无依据荐股；不绕过审批；核心指标不由 LLM 编造；没有回执只能显示“模拟 / 待确认”；“审批”指用户本人确认完整计划，首版没有人工审核后台。
- 店主财务助手不保留在比赛演示中（入口下线见清单 P0-C），不再扩展；本轮截止：2026-10-11 20:00 前。
- 界面文字不得使用会被 iOS / 安卓画成彩色 emoji 的符号（如 ↗ U+2197、➡、✔ 等）；箭头一律用 inline SVG：`<svg class="arrow-ne" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg>`（样式 `.arrow-ne` 已定义在 landing.css 与 style.css，首页和各工作台页面都已加载）。`npm run check` 会扫描 chenchen/versions/ 并在发现这类符号时失败。
- 进度与待办见 review/CODEX-NEXT-2026-10-08.md。
