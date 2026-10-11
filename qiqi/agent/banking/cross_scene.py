"""跨场景联动（场景 6）——赛题示例：检测「我爱人生日」→ 当月锁定 1000 元活期，
生日前 2 天订购鲜花、蛋糕。

本模块输出：
  · CrossScenePlan：有序子任务（含依赖与状态，可直接渲染 DAG）
  · 记忆写入计划：生日 → User Memory（confirmed_by_user，需用户确认过才算数）
  · 计划任务：锁定活期（走理财侧审批，黄/红按金额）＋ 生日前 2 天订花订蛋糕
    （外部服务为 Mock，明确标注未接真实 API）
  · 诚实口径：外部下单不自动执行，只生成到期待办与提醒。
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from contracts.banking import CrossScenePlan

_MONTH_RE = re.compile(r"(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]")
_AMOUNT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(万|千|百)?\s*元")
_RELATION_RE = re.compile(r"(爱人|老婆|老公|妻子|丈夫|对象|女朋友|男朋友|妈妈|爸爸|女儿|儿子|孩子|家人|朋友)")


def parse_cross_scene(text: str) -> dict:
    """抽取跨场景任务要素：人物关系、生日日期、锁定金额、外部动作。"""
    relation = ""
    rm = _RELATION_RE.search(text)
    if rm:
        relation = rm.group(1)

    birthday = ""
    mm = _MONTH_RE.search(text)
    if mm:
        month, day = int(mm.group(1)), int(mm.group(2))
        if 1 <= month <= 12 and 1 <= day <= 31:
            year = datetime.now().year
            candidate = datetime(year, month, day)
            if candidate < datetime.now():
                candidate = datetime(year + 1, month, day)   # 今年已过，算明年
            birthday = candidate.strftime("%Y-%m-%d")
    if not birthday:
        # 相对日期：明天/后天（赛题示例「我爱人生日」常省略具体日期）
        if re.search(r"(明天|明日)", text):
            birthday = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        elif re.search(r"(后天|後天)", text):
            birthday = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")

    lock_amount = 0.0
    am = _AMOUNT_RE.search(text)
    if am:
        lock_amount = float(am.group(1))
        unit = am.group(2)
        lock_amount *= {"万": 10000, "千": 1000, "百": 100}.get(unit or "", 1)

    wants_order = bool(re.search(r"(订|买|送|准备)\s*(?:个|一个|束|份)?\s*(花|鲜花|蛋糕|礼物)", text))
    return {
        "relation": relation,
        "birthday": birthday,
        "lock_amount": round(lock_amount, 2),
        "wants_order": wants_order,
    }


def build_cross_scene_plan(text: str) -> CrossScenePlan:
    """构建跨场景联动任务 DAG。"""
    parts = parse_cross_scene(text)
    now = datetime.now()
    plan_id = f"cs_{now.strftime('%Y%m%d%H%M%S%f')}"

    if not parts["birthday"]:
        return CrossScenePlan(
            plan_id=plan_id,
            summary="信息不足",
            steps=[],
            caveats=["需要生日日期才能生成联动计划，例如「我爱人 10 月 25 日生日」。"],
        )

    birthday_dt = datetime.strptime(parts["birthday"], "%Y-%m-%d")
    # 若「生日前 2 天」已过去（如明天生日），订花/订蛋糕计划改从今天起
    order_date = max(
        birthday_dt - timedelta(days=2),
        datetime.now().replace(hour=0, minute=0, second=0, microsecond=0),
    ).strftime("%Y-%m-%d")
    relation_label = parts["relation"] or "家人"
    relation_holder = {
        "爱人": "爱人", "老婆": "爱人", "老公": "爱人", "妻子": "爱人", "丈夫": "爱人",
        "女朋友": "女朋友", "男朋友": "男朋友", "对象": "对象",
        "妈妈": "妈妈", "爸爸": "爸爸", "女儿": "女儿", "儿子": "儿子",
        "孩子": "孩子", "家人": "家人", "朋友": "朋友",
    }.get(relation_label, relation_label)

    steps: list[dict] = [
        {
            "id": "detect", "label": "识别隐含意图与要素",
            "tool": "intent_router",
            "depends_on": [], "status": "done",
            "detail": f"识别出 {relation_holder} 生日 {parts['birthday']}，"
                      f"计划锁定 {parts['lock_amount']:,.0f} 元活期"
                      f"{'，生日前 2 天订花与蛋糕' if parts['wants_order'] else ''}",
        },
        {
            "id": "memory", "label": "生日信息写入用户记忆",
            "tool": "memory_store",
            "depends_on": ["detect"], "status": "done",
            "detail": f"写入 User Memory：{relation_holder}生日={parts['birthday']}"
                      f"（confirmed_by_user，用户确认后生效）",
        },
    ]

    if parts["lock_amount"] > 0:
        steps.append({
            "id": "lock", "label": f"锁定 {parts['lock_amount']:,.0f} 元活期",
            "tool": "savings_lock",
            "depends_on": ["memory"], "status": "pending_confirmation",
            "detail": "黄色权限：需用户确认后执行（资金操作不自动执行）",
        })

    if parts["wants_order"]:
        steps.append({
            "id": "order_flowers", "label": f"{order_date} 订购鲜花",
            "tool": "external_order",
            "depends_on": ["memory"], "status": "scheduled",
            "detail": f"计划任务：{order_date} 执行（外部服务 Mock，未接真实 API）",
        })
        steps.append({
            "id": "order_cake", "label": f"{order_date} 订购蛋糕",
            "tool": "external_order",
            "depends_on": ["memory"], "status": "scheduled",
            "detail": f"计划任务：{order_date} 执行（外部服务 Mock，未接真实 API）",
        })
    else:
        steps.append({
            "id": "reminder", "label": "生日提醒",
            "tool": "reminder",
            "depends_on": ["memory"], "status": "scheduled",
            "detail": f"计划任务：{parts['birthday']} 当天提醒送祝福",
        })

    summary = (
        f"已生成跨场景联动计划：{relation_holder} {parts['birthday']} 生日。"
        f"{('锁定 ' + format(parts['lock_amount'], ',.0f') + ' 元活期（待确认）。') if parts['lock_amount'] else ''}"
        f"{('生日前 2 天（' + order_date + '）订鲜花与蛋糕。') if parts['wants_order'] else ''}"
    )

    return CrossScenePlan(
        plan_id=plan_id,
        summary=summary,
        steps=steps,
        memory_writes=[{
            "layer": "USER", "preference_type": "family_event",
            "content": f"{relation_holder}生日={parts['birthday']}",
            "confirmed_by_user": False,
            "note": "生日信息来自用户口头提供，需用户确认后置 confirmed_by_user=true",
        }],
        scheduled=[
            {"at": order_date, "action": "订购鲜花", "mock": True},
            {"at": order_date, "action": "订购蛋糕", "mock": True},
        ] if parts["wants_order"] else [
            {"at": parts["birthday"], "action": f"{relation_holder}生日提醒", "mock": True},
        ],
        pending_confirmations=([
            {
                "step_id": "lock", "tier": "yellow",
                "detail": f"锁定 {parts['lock_amount']:,.0f} 元活期资金（资金操作需用户确认）",
            },
        ] if parts["lock_amount"] > 0 else []),
        caveats=[
            "外部订花/订蛋糕为演示 Mock，未接真实服务",
            "锁定活期为演示模拟，不涉及真实资金",
        ],
    )
