# 续办：权限、预算、访客隔离与统一账本（2026-10-25）

本文件更新上一轮交接中的预算、Finance 访客隔离及双账本问题。**完成的是本机 Finance 访客入口；公开主聊天、团队 staging、真实模型、多设备验收尚未完成。** 没有修改或部署任何公开 Worker，也没有发送团队消息。

## 当前状态与唯一 Owner

| 项目 | 本轮结果 | 下一步与 Owner |
| --- | --- | --- |
| 主聊天源码 | 已 fetch 全部团队分支；当前 Git 凭据只列出团队集成仓库。工作区代码中未找到 personal-ai-fund-chat、LLM_A_API_KEY、/api/local 的实际实现，只有交接文档引用 | 理想提供实际源仓/分支/SHA 或匹配线上版本的 Worker 导出 |
| Cloudflare 权限 | 控制台停留登录页；未见团队账户或邀请状态 | Sean 协调管理员邀请；登录后核实实际 staging，不以截图名字当已存在事实 |
| 百炼账户 | 控制台显示登录按钮；余额、免费额度、Key 轮换和空间权限仍未知 | 林粹与账户持有人核实；不从聊天旧截图取 Key |
| 测试预算 | 用户本轮明确批准每日上限 20 元；执行方另加本轮总额 20 元限制，含重试，不自动充值 | 林粹在账户/入口确认后配置现有预算守卫，不清零旧账本 |
| Finance 访客隔离 | 本机已通过：签名 Cookie、每访客/模式独立进程和目录；拒绝客户端指定身份、跨站写入、直接访问私有子进程 | 七七将相同边界适配团队身份与托管环境 |
| Finance 统一账本 | 本机已通过：转账、投资成交、持仓、现金与回执在同一原子文档；金额主账为整数分 | 七七接入团队正式 task/account 契约；旧账本必须明确对账迁移 |
| 真实模型 / 四端 | 本轮新增真实调用 0；Windows Chrome 本机流程通过，iOS/Android/macOS 与大陆直连未测 | 理想组织设备；Sean 收齐线上证据后验收 |

20 元是测试授权，不能当作当前余额、平台硬限额或所有公开服务的已配置额度。本地访客运行器继续禁用外部模型调用。个人公开 Worker 的 paidEnabled 与本轮预算是不同事实。

## 可转交管理员的具体请求（尚未发送）

> 请协助完成 Personal AI Fund Manager 的 staging 联调授权：
>
> 1. 提供当前主聊天 personal-ai-fund-chat.ai-banking-agent.workers.dev 对应的源码仓库、分支、Commit SHA、构建入口，以及当前部署版本；若源码尚未入库，请导出与该部署匹配的 Worker 代码并移除真实密钥。
> 2. 确认团队 Cloudflare 账户及现有 staging 的准确 Worker 名称和 URL。交接截图称 personal-ai-fund-chat-staging，请核实，不能默认它已存在。
> 3. 将我的 Cloudflare 登录邮箱加入团队，并在 Individual Workers 范围给已确认的 staging 授予 Editor；需要读取线上脚本时，仅给对应主聊天 Worker Content Read-Only。无需账户级管理员权限。
> 4. 提供 staging 的环境变量/Secret 变量名、Core/Risk 服务绑定、数据库绑定及回滚版本。个人 Worker 使用 DASHSCOPE_API_KEY，但交接提到 LLM_A_API_KEY，须以主聊天实际源码为准；不要在群里发送密钥值。
> 5. 若 Core/Risk 不在同一账户，请分别给对应 Owner 读取部署信息所需的权限，并确认可用于联合测试的地址与可信服务身份。

管理员入口为 Manage Account → Members → 对应成员权限策略。Cloudflare 当前支持按单个既有 Worker 授予 Editor；Content Read-Only 可读取脚本，Metadata Read-Only 不包含脚本源码。依据：[官方 Workers 角色与范围](https://developers.cloudflare.com/workers/authorization/workers/)。尚不存在的 Worker 不能用单资源策略授权，须由管理员先明确实际目标。

仓库访问和 Cloudflare 访问分别验收：有代码推送权限不代表有部署权限；看到 Worker 名字不代表可以部署；Secret 名存在不代表上游模型请求成功。

## 本机访客入口

从集成仓库根目录运行：

```powershell
.\qiqi\.venv\Scripts\python.exe qiqi/web/guest_gateway.py --port 8877
```

打开 http://127.0.0.1:8877/ 。默认创建新的 fund-guests-* 临时数据目录，启动输出包含目录路径。需要保留相同访客状态时，使用同一 --state-dir；本地长期演示可指定被忽略的 qiqi/data/guest-runtime。只绑定 127.0.0.1，拒绝不匹配的 Host 和跨站 API 请求；不应直接暴露为公网服务。

浏览器签名会话最长 24 小时，Cookie 为 HttpOnly/SameSite=Strict，包含随机服务器身份和签名。每个访客、每种 mode 的现金、持仓、审批、记忆、审计、熔断器独立；服务端不接受 user_id/mode 等请求字段覆盖。最多同时 8 个子进程，闲置 30 分钟可回收，磁盘状态保留。父进程目录有独占锁，子进程回环接口另需随机服务凭据，凭据不进入前端或日志。

这是匿名浏览器隔离，不是实名登录；清 Cookie、会话过期或更换设备后不会自动恢复同一账户。新入口与原 run_competition_demo.py / app.py 单人入口分开；旧入口保留兼容，不应作为多用户服务。demo/live 使用不同签名范围及目录，live 模式仍拒绝以演示短信/人脸标记授权执行。本机运行器两种模式均无收费模型访问能力。

## 统一现金与偏好规则

统一账户初始现金为 25,680.50 元，投资总览读取同一现金；原单人投资夹具的 50,000 元不会被自动加进新账户。旧银行/投资文件未迁移或覆盖。示例持仓继续使用虚构数据。

转账与投资成交都取得同一账户锁；现金、投资持仓、唯一成交回执、审计投递意图写入同一份 account.json，经临时文件、flush/fsync、原子替换提交。写入失败回滚内存状态；重试读取原回执；同一批准编号不同参数拒绝。旧/缺字段/身份或模式不匹配的账本拒绝加载，不补入默认余额。该文件方案限一个访客进程，不能直接当成跨机器分布式事务实现。

最低现金通过明确表单保存，带版本、来源 USER_CONFIRMED_FORM 和更新时间；更新采用 expected_version，过期版本返回 409。删除移除当前约束值，审计只保留操作和版本，不复制已删除金额。账单文本不会自动改变该约束。计划与执行均使用扣除保留后的可安排现金；批准前参数或偏好变化会重新检查。投资实际手续费计入统一现金变化，不重复扣款。

Core/Risk 之前的 HTTP harness 与本入口仍是两种验证环境：本入口不把未绑定可信用户的远程 review 当作本访客任务，也未把 Core 的资金预留账本自动合并为 Finance 成交。取得主聊天身份与正式接口后才能做这一层接线。

## 本轮证据

证据目录：evidence-guests-20261025/。Finance 完整回归 **262/262**；其中新增 **11/11** 隔离/统一账本测试是子集，不额外累加。当前 Finance/Risk/Core HTTP harness **6/6** 复跑通过（模型/存储替身、真实模型调用 0）。Core/Risk 本轮无源码改动，上一轮 317/677 项结果保留，不冒充本轮重跑。

专项覆盖：两访客数据/批准隔离、偏好更新及删除、旧版本冲突、最低现金更新后旧待办拦截、投资与转账同余额、幂等成交、进程重启、签名篡改、模式隔离、跨站请求、伪身份、直接子进程访问、访客内 reset、并发竞争现金、磁盘失败回滚和损坏账本拒绝。

Windows Chrome 约 15:12—15:14 的实际操作：保存最低现金 25,000 元；700 元转账被阻断，余额 25,680.50 不变；服务重启后约束和余额保留；删除约束，重新发起并确认 700 元转账，账户卡与投资总览均显示 24,980.50 元。浏览器首次从外部链接进入时曾被跨站保护误拦；已允许仅首页顶层导航，仍拒绝跨站 API，并加入回归。

```powershell
Push-Location qiqi
.\.venv\Scripts\python.exe -m unittest tests.test_guest_accounts -v
.\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py' -q
Pop-Location
$env:PYTHON_EXECUTABLE = (Resolve-Path 'qiqi/.venv/Scripts/python.exe').Path
node modules/safety-risk-eval/joint-acceptance/verify-current-http.cjs --out new-http-report.json
node --check qiqi/web/static/guest-account.js
```

## 取得账户访问后的执行顺序

1. 读取主聊天源码与部署版本，确认正确账户、staging、Secret 名和绑定；记录回滚部署。先检查，不发布生产。
2. 百炼控制台核实 cn-beijing 的业务空间、模型 ID、专属兼容地址、密钥轮换状态、余额/免费额度。只记录可用性与配置名称，不把 Key 写入证据。
3. 配置当前批准的每日 20 元和本轮总额 20 元守卫，保留旧账本；先 dry-run 和鉴权检查，再做最小模型问答、结构化输出、工具、流式及故障测试。每次记录供应商请求编号、token、耗时、结算状态，平台实际费用另行对账。
4. 将主聊天访客身份映射到 Finance/Risk/Core 的同一可信任务范围，完成三场景与用户隔离的线上验收；不能直接信任浏览器传来的 user_id。
5. 以下设备用同一 staging SHA 跑知识、上传账单、转账确认/拒绝、用途冲突、刷新恢复和跨访客隔离。记录设备/系统/浏览器版本、网络是否代理、时间、任务编号、页面/资源/API 结果和截图。

| 环境 | 本轮状态 |
| --- | --- |
| Windows Chrome 本机 | 上述访客/约束/余额流程通过 |
| Windows 公网 staging | 受账户/部署权限阻塞 |
| iOS Safari | 未提供可操作设备，未实测 |
| Android Chrome | 未提供可操作设备，未实测 |
| macOS Safari/Chrome | 未提供可操作设备，未实测 |
| 中国大陆无代理网络 | 当前代理状态未核实，未验收 |

桌面缩窄窗口或设备模拟不计真实手机/系统验收。任何缺项保留未验证，不汇总为三场景线上闭环完成。
