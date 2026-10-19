# 账户汇总核对实验 v1

用来回答“截图里的数字是否对得上、是否足够进入持仓分析”。独立于已上线网页，接收人工转录的 JSON，不提供 OCR、账户登录或真实模型调用。原 CSV 导入与历史版本保留。

## 已支持

- 校验金额格式与精度；用整数分核对资产变化与页面盈亏，用有理数核对收益率显示的四舍五入。该计算只在导入实验中做显示一致性检查，不替代 Quant 的收益率算法。
- 将总资产减可用资金标为“未分类差额”，不生成持仓、现金余额或可投资额度。
- 创建时间与数据快照时间分开；缺少明细、口径或上一日基数就标明不能验证。
- 通过已有 `model-review.v1` 的 `context.account_summary_candidate` 生成只读候选请求。公共 Schema 不变，该候选字段还需 UI、数据和 Risk Owner 确认语义。
- 用现有 Worker 处理代码验证同任务交接、重复请求复用、补资料与拒绝阻断、审计查询和 TXT 导出。

这不是安全认证：`capability` 与 context 描述不能替代统一 Risk、可信审批或执行网关。截图和显示匹配从不等于交易授权。测试中的模型输出、Risk 决定和签名身份均为本地替身；正式网关缺失仍返回 503。

## 运行

Node.js 22+，从 `chenchen/` 运行，无额外依赖、无外部请求。每次指定新的输出目录，拒绝覆盖历史证据。

```powershell
node --test tests/account-summary.test.mjs
node holdings-intake/experiments/account-summary-v1/verify.mjs --output-dir "$env:TEMP/account-summary-synthetic-v1"
```

真实截图先由用户逐项核对转录字段；保持在仓库外，仅运行离线核对和本地替身联调：

```powershell
node holdings-intake/experiments/account-summary-v1/check.js <私有input.json> <新的私有输出目录> <稳定请求标识>
node holdings-intake/experiments/account-summary-v1/verify.mjs --private-input <私有input.json> --output-dir <另一个私有输出目录>
```

输入形状参考 [synthetic.json](synthetic.json)，其中全部数据为独立虚构样例。金钱必须为十进制字符串、最多两位小数，允许标准千分位和“元”；收益率必须带 `%`。本轮只检查“元”同币种假设，未验证币种。`created_on` 为 YYYY/MM/DD，`created_days` 为正整数；拒绝其他字段，避免夹带执行授权。导出请求默认 `REFERENCE_FIXTURE`、`REVIEW_ONLY`、`PAPER`、关闭规则回退与记忆授权，不自动 POST 到任何地址。

私有输出包含原始金额，不要提交 GitHub。公开证据只使用独立合成样例。`verification.json` 含逐步请求响应；`*-audit.txt` 为可读任务记录；记录中的供应商编号以 synthetic 开头，不是真实模型回执。

## 下一步接入边界

先补账户来源、快照时间、持仓明细及可用资金定义，再由对应模块校验。原 `holdings-intake.v0` 要求明细和快照；当前汇总不能填入它，更不能用创建日期和差额凑出通过的导入包。资金冲突分析还需用户已确认的房租、学费等用途。该候选只传递资料，不更改 Memory 规则，也不自行判定 Risk。
