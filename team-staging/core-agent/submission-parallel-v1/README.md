# 国内比赛入口：两条部署路线候选交付

日期：2026-10-29。状态：**临时共创区候选，尚未部署国内公网，尚未联合验收**。

本次准备 Cloudflare China Network 和国内服务器两条路线。现有 Cloudflare 站点、访问路径和团队其他文件不变。本目录不会自动发布或替换团队正式版。

## 先看有什么、缺什么

| 路线 | 已准备 | 仍需要 |
| --- | --- | --- |
| 国内服务器 | 独立 Node 服务、持久化存储、HTTPS 配置、部署脚本、验收脚本 | 服务器、域名与备案/接入条件；实际部署和关闭代理后的网络测试 |
| China Network | 供应商对接清单、兼容性清单、域名与回源方案 | Enterprise 与单独订阅、备案、内容审核、供应商配置和实际验收 |

**没有新的国内演示地址。** 原 workers.dev 地址已收到国内无代理访问失败反馈，不能把原地址写成已通过国内验收。

## 怎么查看和验证

运行源码在 [runtime-source](runtime-source/)，部署说明在 [模块 README](runtime-source/chenchen/deployment/submission-parallel-v1/README.md)。这是一个带必要依赖的独立快照，避免依赖团队根目录中缺少或版本不同的文件。

安装 Node.js 22.13 或以上版本后，在本目录执行：

```sh
cd runtime-source/chenchen/deployment/submission-parallel-v1
npm test
npm run build
```

这两个命令不调用收费模型、不需要提供密钥。服务器部署另按模块 README 执行；`.env`、数据库和日志不提交 GitHub。

默认关闭模型。固定回复演示会清晰标注测试替身；真实模型启用必须另行确认供应商、单价、余额、Secret 和费用授权。此版默认只接原有签名只读 Risk 分支，没有新增资金执行权限，也不代表完整 Risk/审批链路已经联合验收。

## 来源和验证范围

- 个人来源仓库：`realchenchenluo/agent`。
- 来源分支：`codex/submission-china-domestic-v1`。
- 来源提交：`7f76a6bbe6802d0aa113e23b3f4380677d7c25a6`。
- 文件来源清单：[PACKAGE-MANIFEST.json](runtime-source/PACKAGE-MANIFEST.json)。本目录 `.gitattributes` 保留快照原始字节，便于跨系统复核哈希。
- 个人来源项目回归：414 项，413 通过、1 跳过、0 失败；独立模块 10 项通过；本地 HTTP 检查 8 项通过，商业模型调用 0 次。
- 本目录另外执行哈希校验与 10 项独立测试，结果见 [TEAM-VALIDATION.json](TEAM-VALIDATION.json)。这些结果不能称为整个团队仓库回归通过。
- Docker 引擎本轮未运行；国内云端、真实模型、China Network 和正式 Risk 联合验收均未完成。

## 资源到位后怎么继续

1. 核实团队或学校是否已有获准使用的已备案域名和 Linux 服务器。没有资源时，先向接入服务商确认办理条件和时间，再决定购买；不承诺新资源能赶在 11 月 2 日前上线。
2. China Network 按 [供应商对接清单](runtime-source/chenchen/deployment/submission-parallel-v1/china-network/SALES-HANDOFF.md) 询价并确认功能。不能假定现有 Worker 及 Durable Objects 可以原样迁移。
3. 在新入口部署并用合成数据验收；国内移动、电信、联通关闭代理分别实测首页、API 和 SSE。真实模型与正式 Risk 要单独留证。
4. 团队审核通过后再遴选进入正式交付区，不在本轮替换现有版本。

回滚仅影响新部署，保留旧镜像、原 `.env` 和同一数据库卷；不得删除预算账本或持久卷制造新额度。原站点仍保持原样。
