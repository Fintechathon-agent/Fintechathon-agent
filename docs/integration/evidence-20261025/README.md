# 2026-10-25 本轮验收证据

所有业务资料均为虚构。这里保存本轮实际运行输出，不复用队友旧报告作为本轮通过声明。

| 文件 | 内容与边界 |
| --- | --- |
| current-core-risk-http.json | 当前工作树 Core/Risk 的 12 项 HTTP 用例；模型、Core 存储和批准身份均为替身；正常确认、冲突、拒绝、故障和重放 |
| current-three-service-http.json | Finance Python → Risk Node → Core Worker handler → HMAC 回调，6 项检查；模型替身调用 2 次、真实调用 0 |
| core-tests.txt | Core 317/317 完整回归 stdout；含确定性和 Mock |
| finance-tests.txt | Finance 251/251 完整回归；audit unavailable/fake timeout 为预期故障注入 |
| risk-tests.txt | Risk 677/677 完整回归 stdout；含确定性和 Mock |
| deterministic-tests.txt | 持仓与上传 10/10 专项，是 Finance 完整回归的子集 |

CURRENT_TRACKED_WORKTREE 取样基于 HEAD 91411251fe538edd4bc47df0f2ad2aeb37ab4e9c 加当时当前已跟踪文件内容，报告包含逐文件哈希；最终交付提交还包括该修复及文档。风险规则和 Finance 适配哈希亦在报告。报告 task_id/时间随机，复测不应固定这些值。

## 四类可展示证据

- 正常：normal_confirmed_plan 经有效测试服务批准后产生一次模拟效果，重放不重复；三场景主聊天与最终用户登录尚未完成。
- 待审批/拒绝：normal_confirmed_plan 批准前模拟接口 409；approval_rejected 保持未执行。Windows 浏览器另行展示张伟 700 元待确认。
- 阻断：rent_conflict、tuition_conflict；三服务报告的保护用途 10,000 元、可用 2,000 元、投资 8,000 元 BLOCK，不生成执行回执。
- 故障：unknown_callback_response、result_storage_unknown 及缺失费用 REVIEW，不将未知结果变成成功。

## 浏览器人工验收记录

2026-10-25 14:39—14:43（北京时间），本机 Windows Chrome，地址 http://127.0.0.1:8876/ ，隔离启动器 run_competition_demo.py，未使用模型。网络代理状态未核实，不代表大陆直连或公网验收。

1. 输入“基金是什么”：返回内置知识解释，无交易计划或待审批操作。
2. 输入“给张伟转账700元，备注房租”：显示正确对象与金额、黄色待确认；确认后生成演示模拟成功回执，余额 25,680.50 → 24,980.50，当日转账 700。此为虚构资金。
3. 点击“看本月账单”：28 笔、总额 17,559.70；分类 14,523 + 694.60 + 657.50 + 583.10 + 576.50 + 277 + 148 + 100 = 17,559.70，差 0 分。
4. 修正回执显示后重载页面：审计摘要显示“转账成功（演示模拟）：向 张伟 转出 700.00 元。”，不再出现 [object Object]。这是 UI 修复复核，不额外计一个业务场景。

截图保存在用户工作区 output/competition-20261025/finance-browser.png（账单页面）；未将任何账户控制台或密钥截图上传。模拟转账回执编号 p_4a3dccea0e9a42919c551dd6412b0b67。银行与投资现金为不同夹具；不宣称同一账户。

## 尚未通过的范围

真实模型、本任务收费预算、团队 staging、主聊天三场景同任务链、真实批准身份、集成用户/模式隔离、大陆直连、iOS/Android/macOS 均未完成。Windows 通过数仅本地三个流程。复现命令与剩余 Owner 见 [交接单](../competition-handoff-2026-10-25.md)。
