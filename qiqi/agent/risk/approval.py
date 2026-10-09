"""Human Approval 管理器——管理待审批队列，支持审批通过/拒绝/评论。
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from contracts.types import ApprovalRequest


class ApprovalManager:
    """人工审批管理器——维护待审批队列，处理审批响应"""

    def __init__(self, storage_dir: Path | str = "data/approvals"):
        self.dir = Path(storage_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._pending: dict[str, ApprovalRequest] = {}

    def submit(self, request: ApprovalRequest) -> str:
        """提交审批请求，返回审批 ID"""
        self._pending[request.id] = request
        self._save(request)
        return request.id

    def get(self, approval_id: str) -> Optional[ApprovalRequest]:
        """查询审批请求"""
        if approval_id in self._pending:
            return self._pending[approval_id]
        # 尝试从文件加载
        p = self._file_path(approval_id)
        if p.exists():
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
                req = self._dict_to_request(d)
                self._pending[approval_id] = req
                return req
            except (json.JSONDecodeError, KeyError):
                return None
        return None

    def approve(self, approval_id: str, comment: str = "") -> bool:
        """审批通过"""
        req = self.get(approval_id)
        if not req:
            return False
        req.status = "approved"
        req.approver_comment = comment
        self._pending[approval_id] = req
        self._save(req)
        return True

    def reject(self, approval_id: str, comment: str = "") -> bool:
        """审批拒绝"""
        req = self.get(approval_id)
        if not req:
            return False
        req.status = "rejected"
        req.approver_comment = comment
        self._pending[approval_id] = req
        self._save(req)
        return True

    def list_pending(self, user_id: str = "") -> list[ApprovalRequest]:
        """列出待审批请求。

        以磁盘为准（含重启后仍未处理的历史请求），按 user_id 过滤时
        同时纳入"未标注归属"的旧记录——早期落盘的文件没有 user_id 字段，
        直接排除会让升级前的待办凭空消失。
        """
        out: list[ApprovalRequest] = []
        for f in sorted(self.dir.glob("*.json")):
            try:
                raw = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if raw.get("status") != "pending":
                continue
            if user_id:
                owner = raw.get("user_id", "")
                if owner and owner != user_id:
                    continue
            aid = raw.get("id", "")
            req = self._pending.get(aid) or self._load_file(f)
            if req is not None:
                out.append(req)
        return out

    def _load_file(self, path: Path) -> Optional[ApprovalRequest]:
        """从单个落盘文件恢复审批请求（失败返回 None，不抛异常）"""
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            req = self._dict_to_request(d)
            self._pending[req.id] = req
            return req
        except (OSError, json.JSONDecodeError, KeyError, ValueError):
            return None

    def _save(self, request: ApprovalRequest) -> None:
        p = self._file_path(request.id)
        p.write_text(
            json.dumps(self._request_to_dict(request), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _file_path(self, approval_id: str) -> Path:
        return self.dir / f"{approval_id}.json"

    @staticmethod
    def _request_to_dict(r: ApprovalRequest) -> dict:
        """序列化。

        除建议本身外，额外保存组合与风险的**摘要**（非全量对象）：
        审批是"基于当时状态放行"的动作，事后复核需要知道批准时的组合
        与风险全貌；全量对象体积大且含不可序列化字段，故取关键指标。
        """
        pf = r.portfolio_snapshot
        rr = r.risk_report
        d = {
            "id": r.id,
            "user_id": r.user_id,
            "created_at": r.created_at,
            "status": r.status,
            "approver_comment": r.approver_comment,
            "recommendation": {
                "action": r.recommendation.action.value,
                "symbol": r.recommendation.symbol,
                "quantity": r.recommendation.quantity,
                "price": r.recommendation.price,
                "reason": r.recommendation.reason,
                "confidence": r.recommendation.confidence,
                "evidence": list(r.recommendation.evidence or []),
                "risk_impact": r.recommendation.risk_impact,
            },
        }
        if pf is not None:
            d["portfolio_summary"] = {
                "date": pf.date,
                "total_value": pf.total_value,
                "cash": pf.cash,
                "position_count": pf.position_count,
                "positions": [p.symbol for p in pf.positions],
            }
        if rr is not None:
            d["risk_summary"] = {
                "risk_score": rr.risk_score,
                "warnings": list(rr.warnings or []),
                "violations": [p.symbol for p in rr.forbidden_violations],
            }
        return d

    @staticmethod
    def _dict_to_request(d: dict) -> ApprovalRequest:
        from contracts.types import ActionType, Recommendation
        rec_d = d["recommendation"]
        rec = Recommendation(
            action=ActionType(rec_d["action"]),
            symbol=rec_d["symbol"],
            quantity=rec_d["quantity"],
            price=rec_d["price"],
            reason=rec_d["reason"],
            confidence=rec_d["confidence"],
            evidence=list(rec_d.get("evidence", [])),
            risk_impact=rec_d.get("risk_impact", ""),
        )
        return ApprovalRequest(
            id=d["id"],
            recommendation=rec,
            portfolio_snapshot=None,   # 只持久化摘要；需要全量请从组合快照文件取
            risk_report=None,
            created_at=d["created_at"],
            status=d["status"],
            approver_comment=d.get("approver_comment", ""),
            user_id=d.get("user_id", ""),
        )
