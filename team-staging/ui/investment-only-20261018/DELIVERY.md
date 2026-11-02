# 个人投资顾问 UI：独立候选交付

- 维护账号：lixjanus526-art；模块：UI / Demo。
- 阶段：本地测试通过，待团队接口兼容评审；不是正式交付或生产版本。
- 来源仓库：Fintechathon-agent/Fintechathon-agent。
- 来源分支：codex/kosx-landing-glass；基础提交：176ffbadf6bf060efb49b624238562c100f9bf2f。
- 已审查团队基线：c243950a8b3bba1b38fd18647e336627d982d14f。
- 最新源码以 source-overlay 与 source-manifest.json 中逐文件 SHA-256 为准，包含尚未进入原分支提交的候选改动。
- 个人发布入口：https://lixjanus526-art.github.io/finance-lab-ui-preview/investment-only/investment.html
- 个人仓库发布分支：preview；已推送提交：cd1ac68fd9ca09afa64965ac29d692ce5d530e8f。

## 本轮行为

仅保留个人投资顾问，旧店主 URL 跳转到投资工作台。保留个人预览仓库现有统一工作台，通过独立 investment-only/ 子目录发布本轮成果。

静态预览明确标注虚构数据、浏览器模拟计算、AI 后端未连接；AI 按钮禁用。静态 /api/review 返回 503 / STATIC_AI_UNAVAILABLE，不发送真实模型请求；退役店主 API 返回 410。旧 HTML 地址和目录地址使用跳转壳，不再提供店主界面。

个人仓库只保存静态 UI 资源。真实 AI 仅在已安全配置的本机 Node 候选服务中使用；不得把静态预览或历史本机调用记录标称为团队线上真实接入。

## 文件说明

- preview/：可直接静态托管的候选预览，无凭据、无服务端、无真实账户资料。
- source-overlay/：可检查的 UI、构建脚本、测试与本机服务候选源码。属于隔离候选，不覆盖根目录 chenchen/ 的团队实现。
- source-manifest.json：来源及逐文件校验值。
- prepare-source.cjs：从既有 Git 基础提交读取未修改的依赖，再在系统临时目录叠加候选源码。不会覆盖团队工作区。
- evidence/：静态和单产品浏览器检查，以及明确标为历史的本机真实 AI 证据。历史证据不代表本轮新调用或团队后端已开通。

测试源文件在交付区以 .source 后缀保存，避免团队从仓库根目录运行测试时误发现不完整的候选依赖；prepare-source.cjs 会恢复原文件名。

## 如何复现

环境：Node.js 22+，Git。先在仓库内运行以下命令，其用途是生成隔离候选目录；从输出读取 runtimePath。

```sh
node team-staging/ui/investment-only-20261018/prepare-source.cjs
```

在生成的 runtimePath 中运行以下命令。单元测试只用合成输入和 HTTP 替身，不需要真实 Key，也不调用付费模型。

```sh
node --test
```

需要浏览器验证时，在该临时目录安装锁定依赖后运行；Chrome 需已安装。静态预览检查不会调用真实模型。

```sh
npm ci
node scripts/static-check.cjs
node scripts/single-product-check.cjs
```

preview/ 可使用任意静态服务器打开。当前模式为 STATIC_SIMULATION_ONLY、backend=NOT_CONNECTED、execution_allowed=false。禁止在该静态目录填写或托管密钥。

## 真实 AI 的本机配置边界

本机专用候选使用 MODEL_API_KEY、MODEL_API_URL、MODEL_NAME 等服务端环境变量。真实配置只在个人电脑或部署平台 Secret 中填写；交付包不包含 .env 文件。

已有本机请求验证过 qwen3.8-flash，但团队最新 Provider 当前仅允许 qwen3.7-flash 系列，且使用 DASHSCOPE_API_KEY 与持久化预算。团队 ReviewWorkflow 返回结构也与本机候选不同。本轮没有更改这些团队策略，不得用本机 http Provider 绕开团队预算或鉴权。

## 验证结果

- 完整候选 Node 测试：57/57 通过。
- 静态浏览器检查：1440 / 1024 / 375px 通过，包含 AI 安全不可用和旧 URL 跳转。
- 单产品浏览器检查：三种宽度通过，三个方案、风控交接和零店主请求。
- JavaScript 语法与禁用 emoji 字形检查：通过。
- 本轮发布修复没有发起付费模型请求。
- 从 manifest 重建的独立候选再次通过 57/57 测试；团队最新基线 c243950 的原有测试 193/193 通过。
- 最终个人发布目录在 1440 / 1024 / 375px 下通过检查。保留的统一工作台仍会探测 /api/demo/portfolio，静态托管不提供该后端；新版 investment-only 页面完全在浏览器模拟，不发出 API 网络请求。
- 发布目录新增 .gitignore 保护本地配置；逐文件清单和源码叠加包保留原始字节，避免换行转换破坏 SHA-256。
- 敏感检查未发现配置密钥明文、Token 模式或凭据文件；个人既有历史 56 个文本对象与团队历史 1371 个文本对象中未发现当前配置密钥。
- GitHub Pages 构建 39124045423 成功；实际公网地址 HTTP 200。公网浏览器在 1440 / 1024 / 375px 通过三方案、四个店主旧地址跳转、静态 AI 503 与零 API 网络请求检查，见 evidence/personal-preview-live.json。

## 团队集成与回退

本 PR 只新增本目录，不修改团队 main 的业务源码、其他成员目录或 team-release/。没有集成资金执行、审批或持久化数据库变更。

待后端与 Contract Owner 确认：模型白名单、响应结构、预算记录、身份鉴权和统一启动方式。未经确认，不将旧候选 server.js 或 model-review.js 覆盖到团队根目录 chenchen/。

候选撤回时可回退本 PR；个人预览回退本轮发布提交。旧个人仓库 finance-lab-demo 不自动更新。
