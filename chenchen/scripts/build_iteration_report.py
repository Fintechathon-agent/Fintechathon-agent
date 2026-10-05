"""Build the short v0.5.0 iteration note with python-docx."""
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = Path(__file__).resolve().parents[1]
doc = Document()
section = doc.sections[0]
section.page_width, section.page_height = Inches(8.5), Inches(11)
section.top_margin = section.bottom_margin = Inches(0.72)
section.left_margin = section.right_margin = Inches(0.8)
for name, size in [('Normal', 11), ('Title', 23), ('Heading 1', 15), ('Heading 2', 12)]:
    style = doc.styles[name]
    style.font.name = 'Microsoft YaHei'
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    style.paragraph_format.space_after = Pt(6)
    style.paragraph_format.line_spacing = Pt(17 if name == 'Normal' else size * 1.3)
    ppr = style.element.get_or_add_pPr()
    snap = OxmlElement('w:snapToGrid')
    snap.set(qn('w:val'), '0')
    ppr.append(snap)
doc.styles['Heading 1'].paragraph_format.space_before = Pt(10)
doc.styles['Heading 2'].paragraph_format.space_before = Pt(7)
# Remove inherited title rules and grid effects from the default template.
for border in list(doc.styles.element.iter(qn('w:pBdr'))):
    border.getparent().remove(border)
for grid in list(section._sectPr.iter(qn('w:docGrid'))):
    grid.getparent().remove(grid)
doc.core_properties.title = '两款财务助手本轮改动与功能候选'
doc.core_properties.author = 'Chenchen'
doc.core_properties.subject = 'v0.5.0 产品迭代说明'

def para(text):
    return doc.add_paragraph(text)

doc.add_heading('两款财务助手本轮改动与功能候选', 0)
para('2026 年 10 月 5 日  |  v0.5.0  |  本地演示版')
para('这轮我们重点解决“打开后先看什么”和“结果能不能信”的问题。投资顾问与店主助手保留独立入口、页面和操作流程，共用本地演示服务。改动只放在 chenchen 文件夹，不改仓库其他成员的内容。')

doc.add_heading('打开页面后有什么不同', 1)
doc.add_heading('两个产品各自展示重点', 2)
para('产品目录改成两张独立卡片。投资顾问使用蓝色，店主助手使用绿色；进入后只保留本产品操作和返回目录的入口。目录上的数字是固定样例，不读取导入账本。手机上卡片纵向排列。')
doc.add_heading('投资页先看收益和风险', 2)
para('运行后先展示演示区间收益、历史最大回撤和现金占比，再看 A、B、C 三条路径。点开方案才能看到资产比例与情景区间；曲线和运行记录收进详情。页面标出样本内回撤较小的路径，但明确说明这不是个性化推荐。')
para('例如固定样例中，当前组合的历史最大回撤约为 2.79%，C 路径约为 2.01%，差约 0.78 个百分点。这只比较 7 个虚构价格观测，不是实际账户盈亏，也不能据此预测未来收益。')
doc.add_heading('店主页先看钱和日期', 2)
para('首屏突出当前余额、首个资金缺口、最近一笔付款。待核对账单排在前面，查看后立即更新进度。采购支出先展示两项主要涨幅，其余点开看；提醒的理由和相关账单也能展开。切换到账延迟后，首屏日期和提醒同步变化。')

doc.add_heading('减少看错结果的情况', 1)
para('修改投资输入后隐藏旧结果，避免把上次分析当成新结论。两个页面都标明数据日期及非实时状态。当前余额已为负数时，系统直接指出已有缺口，不把它说成未来风险。完整运行记录读取失败也不会抹掉已经算出的有效结果。')
para('检查还发现旧服务没有加载新增样式。我们修正资源加载配置，增加样式缺失提示和运行中服务检查命令，帮助区分“代码已更新”与“网页实际用上新代码”。')

doc.add_heading('还可以加什么', 1).paragraph_format.page_break_before = True
para('下面都是未实现的候选功能，先供选择。它们对应已约定的 Agent 运行与记忆、工具与金融数据职责，不代表比赛新增硬性要求。建议下一轮优先选“与上次相比”和“提醒处理记录”。')
doc.add_heading('与上次相比', 2)
para('记录每次诊断或账本快照，直接告诉用户哪些数字发生变化，并可点回旧数据核对。归属记忆与状态管理；保存前需要用户同意，并提供清除入口。')
doc.add_heading('提醒处理记录', 2)
para('让店主把一条提醒标为待办、已核实或已处理，附一小段备注。下次打开先看尚未处理的事情。归属 Agent 状态与记忆；不代替银行确认，也不自动付款。')
doc.add_heading('单笔到账试算', 2)
para('在现有统一延迟之外，选择一笔收入，试算晚到账几天会影响哪次付款。归属金融数据工具；只生成情景，不修改原账单或承诺平台到账。')
doc.add_heading('新账单追加与关账核对', 2)
para('导入新账单时先显示新增、重复和冲突项，确认后再合并；日终对照手工余额，指出未核对差异。归属账单工具；不能把差异自动认定为利润或亏损。')
doc.add_heading('工具失败后的恢复演示', 2)
para('增加可控的超时与失败场景，演示重试、停止和从上一步恢复。归属 Agent 运行机制；先保留模拟环境，不接真实交易或支付。')

doc.add_heading('本轮怎么验证', 1)
para('语法检查通过，40 项自动测试通过。新增检查覆盖数据日期、方案比较、账单排序、当前负余额和页面资源加载。浏览器已检查桌面及 390 像素窄屏，并实际操作诊断、改输入、展开账单、确认、延迟切换与导出。通过测试不等于没有任何缺陷。')
para('仍使用固定虚构数据，不接真实行情、银行、支付平台或大模型。投资流程停在团队风控交接点；店主数据只存于当前服务进程，重启会清空。上传 GitHub 供查看和下载代码，不等于网页已经公网部署。')

doc.add_heading('设计参考与原创处理', 1)
para('参考 Shopify 的卡片分组与主操作原则，以及 Stripe 的到账金额核对机制。我们自行设计两产品目录、数字优先布局和账单确认流程，未复制品牌视觉或页面；是否能提高持续使用意愿，仍需店主试用验证。')
for source in [
    'Shopify Layout  https://shopify.dev/docs/apps/design/layout',
    'Stripe Payout reconciliation  https://docs.stripe.com/reports/payout-reconciliation',
]:
    p=para(source)
    for run in p.runs:
        run.font.size=Pt(9)

output = ROOT / 'docs' / '2026-10-05产品迭代与功能候选.docx'
output.parent.mkdir(parents=True, exist_ok=True)
doc.save(output)
print(output)
