# 两批独立验证：投资 5000 例 + 其他功能 5000 例

Node.js 22+，在 chenchen/ 中运行，不需要密钥、安装依赖或付费服务：

```powershell
node experiments/dual-benchmark-v3/run.mjs --suite investment --output-dir "$env:TEMP/investment-5000-new-run"
node experiments/dual-benchmark-v3/run.mjs --suite other --output-dir "$env:TEMP/other-5000-new-run"
```

输出目录必须不存在，拒绝覆盖旧证据。两批分开生成、执行和报告；进程任一案例失败或尝试外部 fetch 时以非零退出。模型、Risk、审批使用本地替身，不加载环境密钥。不能将脚本执行时长作为公网响应速度或将通过率作为模型判断准确率。

## 投资专项

种子 2026101903；7 组，48 个参数化模板，5000 次案例执行，按完整 input 去重 4832 份输入。固定边界可能重复。复用 v1/v2 模板并扩展投资生活资金链路：

| 分组 | 数量 | 检查内容 |
| --- | ---: | --- |
| account_summary | 1000 | 盈亏、收益率显示一致性；不将汇总推断成持仓 |
| portfolio_validation | 1000 | 合法持仓与异常金额、份额、价格、类型、日期等；部分异常输入包含多个问题 |
| portfolio_chain | 500 | 原工具诊断、候选与模拟；缺偏好等待、完成后交 Risk |
| funding_multitask | 500 | 两个合成任务争用同笔预算、重复调用不重复占用 |
| risk_workflow | 500 | 拒绝、补资料、批准、缺网关；真实 Worker 代码的本地路由 |
| reliability | 500 | 替身失败、超时、幂等、过期及审批后改参数 |
| investment_lifecycle | 1000 | 房租与学费预留、刚好够用、差一分、用途变更、撤回、拒绝、未审批、小于一分金额 |

investment_lifecycle 的 10 个模板各 100 例。模型固定返回 NO_ACTION，验证有资金绑定时仍不能跳过审批；外部输入伪造余额被本地确认的演示资金安排替换。允许模拟的任务并发重试返回同一回执，其他路径没有回执或资金占用。审计事件逐一检查任务、请求、运行、会话和审计编号。

## 其他功能专项

种子 2026101904；7 组，79 个参数化模板，5000 次执行，按完整 input 去重 4672 份输入。

| 分组 | 数量 | 检查内容 |
| --- | ---: | --- |
| small_amount | 1000 | 小额、角分、评分/时长；不支持数字格式不能截成尾数 |
| life_semantics | 800 | 否定、条件、他人情况、纠正、犹豫及双重否定 |
| quote_subscription | 800 | 人工转录报价、小额优惠和下一笔订阅支出联动 |
| intake_lifecycle | 800 | 未确认、部分确认、幂等确认、编辑、过期、容量、语音中间稿、报价修改 |
| quote_edges | 600 | 不叠券、门槛、时限、费用不全、币种、同款确认、日期和重复编号 |
| subscription_edges | 500 | 逾期、窗口边界、取消申请、已付、取消、缺资料和负金额 |
| merchant_ledger | 500 | 独立账本净收款、现金预测、重复与冲突导入、坏金额、重新查看确认 |

店主账本保持独立，只测试既有模块，未并入投资产品。语音只测已转写文本，报价只测人工转录数据，订阅不会自动取消或推送。

## 证据

cases.jsonl：固定输入和预期；results.jsonl：每例结果、耗时、观察值或错误；workflow-evidence.jsonl：成功的投资流程案例记录、模型替身请求响应和审计；report.json 与测试报告.txt：摘要。

其他功能没有调用 Review 工作流，其 workflow-evidence.jsonl 为空行，证据在 results.jsonl；不伪造模型调用或成交记录。投资流程文件较大，GitHub 可能只允许下载，阅读摘要请看报告。

验证本轮已归档记录的案例数量、数据指纹、前后预期/执行器一致性：

```powershell
node experiments/dual-benchmark-v3/verify-results.mjs
```

JSONL 指纹按 UTF-8/LF 计算，校验器兼容 Windows 的换行转换。source_head 是运行时 Git 基线，source_sha256 记录当时工作区字节；不是将尚未提交的修复冒充已经存在的提交。

完整结论见 [10000 例结果与功能边界](../../docs/benchmark-10000-2026-10-19.md)。旧 v1/v2 生成器及结果保留。
