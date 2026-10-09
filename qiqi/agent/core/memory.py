"""Hindsight 四层记忆——Meta 启发版。
基于 ams-poc / jedisos / mindOS 三个开源实现设计：
  1. World Facts（世界事实）—— 客观数据，可验证
  2. Experiences（经验）—— 交易结果、推荐反馈
  3. Observations（观察）—— 市场判断、风险识别
  4. Mental Models（心智模型）—— 自我生成的规则

核心机制：
  - 置信度演化：同类证据越多置信度越高，被反驳则降低
  - RRF 检索：融合关键词匹配 + 置信度 + 时效性
  - Reflect：观察积累到阈值后自动生成/更新心智模型
"""
from __future__ import annotations

import json
import math
import re
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from contracts.types import (
    MemoryEntry,
    MemoryExperience,
    MemoryFact,
    MemoryLayer,
    MemoryMentalModel,
    MemoryObservation,
    MemoryUser,
    Portfolio,
    Recommendation,
    SessionRecord,
    UserProfile,
)


# ============================================================
#  置信度演化
# ============================================================

CONFidence_SUPPORT = 0.10   # 新证据支持，置信度 +
CONFidence_CONTRADICT = 0.20  # 矛盾证据，置信度 -
CONFidence_DECAY_PER_DAY = 0.005  # 每日自然衰减


def evolve_confidence(entry: MemoryEntry, support: bool, contradict: bool = False) -> float:
    """计算新的置信度"""
    c = entry.confidence
    if support:
        c = min(1.0, c + CONFidence_SUPPORT)
    if contradict:
        c = max(0.0, c - CONFidence_CONTRADICT)
    return c


# ============================================================
#  RRF（Reciprocal Rank Fusion）检索
# ============================================================

RRF_K = 60  # RRF 公式参数


def rrf_score(rank: int, k: int = RRF_K) -> float:
    """计算单条检索结果的 RRF 分数"""
    return 1.0 / (k + rank)


def rrf_fuse(ranked_lists: list[list[tuple[str, float]]]) -> list[tuple[str, float]]:
    """对多条排序结果做 RRF 融合"""
    scores: dict[str, float] = {}
    for ranked_list in ranked_lists:
        for rank, (mem_id, _) in enumerate(ranked_list):
            scores[mem_id] = scores.get(mem_id, 0.0) + rrf_score(rank)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


# ============================================================
#  HindsightMemoryStore
# ============================================================

class HindsightMemoryStore:
    """四层记忆存储——支持置信度演化 + RRF 检索 + 自动 Reflect"""

    # 触发心智模型生成的观察阈值
    REFLECT_OBSERVATION_THRESHOLD = 3
    # 同一规则的矛盾阈值（超过则降级规则）
    CONTRADICTION_THRESHOLD = 2

    def __init__(self, storage_dir: Path):
        self.dir = Path(storage_dir)
        self.dir.mkdir(parents=True, exist_ok=True)

    # ---- 路径工具 ----

    def _user_dir(self, user_id: str) -> Path:
        ud = self.dir / user_id
        ud.mkdir(parents=True, exist_ok=True)
        return ud

    def _layer_file(self, user_id: str, layer: MemoryLayer) -> Path:
        return self._user_dir(user_id) / f"mem_{layer.value}.json"

    def _load_layer(self, user_id: str, layer: MemoryLayer) -> list[dict]:
        p = self._layer_file(user_id, layer)
        if not p.exists():
            return []
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []

    def _save_layer(self, user_id: str, layer: MemoryLayer, data: list[dict]) -> Path:
        p = self._layer_file(user_id, layer)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return p

    def _now_iso(self) -> str:
        return datetime.now().isoformat()

    # ---- MCP 风格核心 API ----

    def retain(
        self,
        user_id: str,
        layer: MemoryLayer,
        content: str,
        source: str = "agent",
        tags: Optional[list[str]] = None,
        **kwargs,
    ) -> MemoryEntry:
        """
        【MCP retain】写入一条记忆，自动处理置信度演化和矛盾检测。

        去重规则：同一层内已有等价内容时，不新增记录，而是"增强"它
        （置信度 +0.10、刷新时间），返回被增强的那条。
        """
        now = self._now_iso()
        new_id = str(uuid.uuid4())[:8]

        existing = self._load_layer(user_id, layer)

        # 0. 去重增强：等价内容不新增记录。
        #    跨天重复出现才算"新证据"（+置信度）；同日重复只刷新时间和计数，
        #    因为同一天反复体检同一个组合并不构成增量信息。
        dup = self._find_duplicate(existing, content)
        if dup is not None:
            today = now[:10]
            same_day = dup.get("updated_at", "")[:10] == today
            if not same_day:
                dup["confidence"] = min(1.0, dup.get("confidence", 0.5) + CONFidence_SUPPORT)
            dup["updated_at"] = now
            dup["tags"] = sorted(set(dup.get("tags", [])) | set(tags or []))
            dup["reinforce_count"] = dup.get("reinforce_count", 1) + 1
            # 记录这条记忆在哪些日期被再次观察到。reflect 用它判断证据积累，
            # 因为去重后观测条数恒为 1，"条数 >= 阈值" 永远无法成立。
            days = dup.get("evidence_days") or [dup.get("created_at", now)[:10]]
            if today not in days:
                days.append(today)
            dup["evidence_days"] = sorted(set(days))
            self._save_layer(user_id, layer, existing)
            # 重复观察同样要检查是否够格提炼规则——这条路径才是证据积累的主路径，
            # 早退会跳过 reflect，导致心智模型永远无法生成。
            if layer == MemoryLayer.OBSERVATION:
                self._maybe_reflect(user_id)
            return self._dict_to_entry(dup)

        # 检查与现有记忆的矛盾
        contradictory_ids: list[str] = []
        supporting_ids: list[str] = []

        content_lower = content.lower()
        for entry in existing:
            existing_content = entry.get("content", "").lower()
            if self._is_contradictory(content_lower, existing_content):
                contradictory_ids.append(entry["id"])
            elif self._is_supporting(content_lower, existing_content):
                supporting_ids.append(entry["id"])

        # 计算初始置信度
        base_conf = 0.6 if (supporting_ids or contradictory_ids) else 0.5
        if supporting_ids:
            base_conf = min(1.0, base_conf + CONFidence_SUPPORT * len(supporting_ids))
        if contradictory_ids:
            base_conf = max(0.1, base_conf - CONFidence_CONTRADICT * len(contradictory_ids))

        # 构建记忆对象
        if layer == MemoryLayer.FACT:
            entry = MemoryFact(
                id=new_id, layer=layer, content=content,
                created_at=now, updated_at=now, confidence=base_conf,
                source=source, tags=tags or [],
                superseded_by=kwargs.get("superseded_by", ""),
                supporting_ids=supporting_ids, contradictory_ids=contradictory_ids,
                verify_after=kwargs.get("verify_after", ""),
                last_verified=kwargs.get("last_verified", now),
            )
        elif layer == MemoryLayer.EXPERIENCE:
            entry = MemoryExperience(
                id=new_id, layer=layer, content=content,
                created_at=now, updated_at=now, confidence=base_conf,
                source=source, tags=tags or [],
                superseded_by=kwargs.get("superseded_by", ""),
                supporting_ids=supporting_ids, contradictory_ids=contradictory_ids,
                outcome=kwargs.get("outcome", "pending"),
                recommendation_ref=kwargs.get("recommendation_ref", ""),
                actual_return_pct=kwargs.get("actual_return_pct", 0.0),
            )
        elif layer == MemoryLayer.OBSERVATION:
            entry = MemoryObservation(
                id=new_id, layer=layer, content=content,
                created_at=now, updated_at=now, confidence=base_conf,
                source=source, tags=tags or [],
                superseded_by=kwargs.get("superseded_by", ""),
                supporting_ids=supporting_ids, contradictory_ids=contradictory_ids,
                observation_type=kwargs.get("observation_type", "general"),
                symbols=kwargs.get("symbols", []),
                market_context=kwargs.get("market_context", ""),
            )
        elif layer == MemoryLayer.USER:
            entry = MemoryUser(
                id=new_id, layer=layer, content=content,
                created_at=now, updated_at=now, confidence=base_conf,
                source=source, tags=tags or [],
                superseded_by=kwargs.get("superseded_by", ""),
                supporting_ids=supporting_ids, contradictory_ids=contradictory_ids,
                preference_type=kwargs.get("preference_type", ""),
                confirmed_by_user=bool(kwargs.get("confirmed_by_user", False)),
                scope=kwargs.get("scope", ""),
            )
        else:  # MENTAL_MODEL
            entry = MemoryMentalModel(
                id=new_id, layer=layer, content=content,
                created_at=now, updated_at=now, confidence=base_conf,
                source=source, tags=tags or [],
                superseded_by=kwargs.get("superseded_by", ""),
                supporting_ids=supporting_ids, contradictory_ids=contradictory_ids,
                rule_text=kwargs.get("rule_text", content),
                trigger_conditions=kwargs.get("trigger_conditions", []),
                success_count=kwargs.get("success_count", 0),
                failure_count=kwargs.get("failure_count", 0),
                version=kwargs.get("version", 1),
            )

        # 持久化
        entry_dict = self._entry_to_dict(entry)
        # 记录首次被观察到的日期，供 reflect 判断证据积累
        entry_dict["evidence_days"] = [now[:10]]
        existing.append(entry_dict)
        self._save_layer(user_id, layer, existing)

        # 更新被矛盾/支持记忆的引用
        self._update_relations(user_id, layer, new_id, supporting_ids, contradictory_ids)

        # 自动 Reflect（观察层积累到阈值时生成心智模型）
        if layer == MemoryLayer.OBSERVATION:
            self._maybe_reflect(user_id)

        return entry

    def recall(
        self,
        user_id: str,
        query: str,
        layers: Optional[list[MemoryLayer]] = None,
        top_k: int = 5,
    ) -> list[MemoryEntry]:
        """
        【MCP recall】检索记忆，使用 RRF 融合：
          - 关键词命中排名
          - 置信度排名
          - 时效性排名（越新越好）
        """
        if layers is None:
            layers = list(MemoryLayer)

        query_lower = query.lower()
        query_keywords = set(re.findall(r"\w+", query_lower))

        all_entries: list[MemoryEntry] = []
        for layer in layers:
            raw = self._load_layer(user_id, layer)
            for d in raw:
                try:
                    entry = self._dict_to_entry(d)
                    # 跳过已废弃的记忆
                    if entry.superseded_by:
                        continue
                    all_entries.append(entry)
                except (KeyError, ValueError, TypeError):
                    continue

        # 三个独立排名。
        # 候选闸门：先按关键词（含 tags）筛出相关条目，再让置信度/时效性
        # 在这批候选内排序。置信度与时效性是与查询无关的信号，若对全库排名，
        # 零命中的条目也能拿到 RRF 分——日报事实逐日累积后会挤占检索结果。
        # 全部未命中时退回全集，保证"问不到"返回最近/最可信的记忆而非空列表。
        keyword_hits = [
            e for e in all_entries
            if any(kw in (e.content + " ".join(e.tags)).lower() for kw in query_keywords)
        ]
        candidates = keyword_hits or all_entries

        keyword_ranks = self._rank_by_keyword(candidates, query_keywords)
        confidence_ranks = self._rank_by_confidence(candidates)
        recency_ranks = self._rank_by_recency(candidates)

        # 转为 [(id, score)] 格式
        keyword_list = [(e.id, 1.0 / (i + 1)) for i, e in enumerate(keyword_ranks)]
        conf_list = [(e.id, 1.0 / (i + 1)) for i, e in enumerate(confidence_ranks)]
        recency_list = [(e.id, 1.0 / (i + 1)) for i, e in enumerate(recency_ranks)]

        fused = rrf_fuse([keyword_list, conf_list, recency_list])

        # 返回 top_k，去重
        result: list[MemoryEntry] = []
        seen_ids: set[str] = set()
        for mem_id, _ in fused:
            for e in all_entries:
                if e.id == mem_id and mem_id not in seen_ids:
                    result.append(e)
                    seen_ids.add(mem_id)
                    if len(result) >= top_k:
                        break
            if len(result) >= top_k:
                break
        return result

    def reflect(self, user_id: str) -> list[MemoryMentalModel]:
        """
        【MCP reflect】从观察层自动生成/更新心智模型。
        当同一触发条件的观察出现 >= REFLECT_OBSERVATION_THRESHOLD 次时，
        生成或更新对应的心智模型。
        """
        observations = self._load_layer(user_id, MemoryLayer.OBSERVATION)
        mental_models = self._load_layer(user_id, MemoryLayer.MENTAL_MODEL)

        # 按 observation_type + 相关符号聚类
        clusters: dict[str, list[dict]] = {}
        for obs in observations:
            if obs.get("superseded_by"):
                continue
            key = self._cluster_key(
                obs.get("observation_type", "general"),
                obs.get("symbols", []),
            )
            clusters.setdefault(key, []).append(obs)

        updated_models: list[MemoryMentalModel] = []

        for key, obs_list in clusters.items():
            # 证据量按"出现在多少个不同日期"衡量，而不是观测条数：
            # 去重后同类观测只保留一条，按条数判断会让规则永远无法生成。
            if self._evidence_days(obs_list) < self.REFLECT_OBSERVATION_THRESHOLD:
                continue

            # 找现有模型（用同一个 cluster_key 保证能匹配上）
            existing_model = None
            for m in mental_models:
                if self._cluster_key(
                    m.get("observation_type", "general"),
                    m.get("symbols", []),
                ) == key:
                    existing_model = m
                    break

            now = self._now_iso()
            # 该聚类覆盖的所有证据日期（去重后即"有效证据量"）
            cluster_days: set[str] = set()
            for o in obs_list:
                cluster_days.update(o.get("evidence_days") or [])
                stamp = o.get("created_at") or o.get("updated_at") or ""
                if stamp:
                    cluster_days.add(str(stamp)[:10])
            cluster_days.discard("")
            content = self._compose_rule_text(obs_list, len(cluster_days))

            if existing_model:
                # 只统计"新增证据日期"，避免同一批观察反复推高置信度
                model_days = set(existing_model.get("evidence_days") or [])
                new_days = cluster_days - model_days
                if not new_days:
                    # 无新证据，只刷新支撑集合，不涨版本不涨置信度
                    existing_model["supporting_ids"] = [o["id"] for o in obs_list]
                    existing_model["evidence_days"] = sorted(model_days | cluster_days)
                    updated_models.append(self._dict_to_entry(existing_model))
                    continue

                new_version = existing_model.get("version", 1) + 1
                # 置信度按新增证据天数增长，一次最多 +0.3
                gain = min(0.3, CONFidence_SUPPORT * len(new_days))
                new_conf = min(1.0, existing_model.get("confidence", 0.5) + gain)
                existing_model["content"] = content
                existing_model["rule_text"] = content
                existing_model["confidence"] = new_conf
                existing_model["version"] = new_version
                existing_model["updated_at"] = now
                existing_model["supporting_ids"] = [o["id"] for o in obs_list]
                existing_model["evidence_days"] = sorted(model_days | cluster_days)
                existing_model["success_count"] = len(model_days | cluster_days)
                model_entry = self._dict_to_entry(existing_model)
            else:
                # 新建模型
                new_id = str(uuid.uuid4())[:8]
                new_model_dict = {
                    "id": new_id,
                    "layer": MemoryLayer.MENTAL_MODEL.value,
                    "content": content,
                    "created_at": now,
                    "updated_at": now,
                    "confidence": 0.6,
                    "source": "reflect",
                    "tags": [obs_list[0].get("observation_type", "general")],
                    "superseded_by": "",
                    "supporting_ids": [o["id"] for o in obs_list],
                    "contradictory_ids": [],
                    "rule_text": content,
                    "trigger_conditions": [obs_list[0].get("observation_type", "")],
                    "success_count": len(cluster_days),
                    "failure_count": 0,
                    "version": 1,
                    "evidence_days": sorted(cluster_days),
                    "observation_type": obs_list[0].get("observation_type", "general"),
                    "symbols": obs_list[0].get("symbols", []),
                }
                mental_models.append(new_model_dict)
                model_entry = self._dict_to_entry(new_model_dict)

            updated_models.append(model_entry)

        if updated_models:
            self._save_layer(user_id, MemoryLayer.MENTAL_MODEL, mental_models)

        return updated_models

    # ---- 辅助方法 ----

    @staticmethod
    def _normalize(text: str) -> str:
        """归一化文本用于去重比较：去空白、去标点、全角转半角近似"""
        return re.sub(r"[\s，。、：；！？（）()\[\]【】,.:;!?%]+", "", text).lower()

    def _find_duplicate(self, entries: list[dict], content: str) -> Optional[dict]:
        """在同一层里找等价记忆（归一化后完全一致）"""
        norm = self._normalize(content)
        if not norm:
            return None
        for e in entries:
            if e.get("superseded_by"):
                continue
            if self._normalize(e.get("content", "")) == norm:
                return e
        return None

    @staticmethod
    def _evidence_days(entries: list[dict]) -> int:
        """一组记忆覆盖的不同日期数。

        优先读 reinforce 时累积的 evidence_days；老数据没有该字段时退回
        各自的创建日期，保证历史记忆不被算法变更作废。
        """
        days: set[str] = set()
        for e in entries:
            recorded = e.get("evidence_days")
            if recorded:
                days.update(recorded)
            else:
                stamp = e.get("created_at") or e.get("updated_at") or ""
                if stamp:
                    days.add(str(stamp)[:10])
        return len(days)

    @staticmethod
    def _cluster_key(obs_type: str, symbols: list[str]) -> str:
        """聚类键——observation_type + 排序后的符号，两处调用保持一致。

        符号为空时 key 就是 obs_type，保证"全部 symbol 为空的同类观察"能聚到一起。
        """
        if symbols:
            return f"{obs_type}|{','.join(sorted(symbols))}"
        return obs_type

    @staticmethod
    def _compose_rule_text(obs_list: list[dict], evidence_days: int = 0) -> str:
        """把一组同类观察合成一句规则文本（取最新一条的上下文，附证据天数）

        evidence_days 是对外呈现的次数口径：同类观察按内容去重后只剩一条记录，
        用"出现天数"表达它被反复观察到多少次才符合直觉。
        """
        latest = obs_list[-1]
        obs_type = latest.get("observation_type", "市场")
        symbols = latest.get("symbols", [])
        context = latest.get("market_context", "")
        n = evidence_days or len(obs_list)

        if obs_type == "sector_concentration":
            rule = f"组合行业集中度多次超标（累计 {n} 次），应检查并分散行业配置"
        elif obs_type == "loss_warning":
            rule = f"组合亏损持仓多次过半（累计 {n} 次），应关注止损纪律"
        elif obs_type == "forbidden_sector":
            rule = f"多次检出禁止行业持仓（累计 {n} 次），应优先清理"
        elif obs_type == "risk_score_high":
            rule = f"组合风险评分多次处于高位（累计 {n} 次），应触发调仓检查"
        elif obs_type == "risk_warning":
            rule = f"组合风险信号反复出现（累计 {n} 次），应触发调仓检查"
        else:
            rule = f"同类信号重复出现 {n} 次，建议触发调仓检查"

        if symbols:
            rule += f"（涉及 {','.join(symbols)}）"
        if context:
            rule += f"。背景：{context}"
        return rule

    def _is_contradictory(self, content_a: str, content_b: str) -> bool:
        """简单矛盾检测：正负情感词冲突"""
        positive = ["增持", "买入", "看好", "加仓", "上升", "涨", "利好"]
        negative = ["减持", "卖出", "看空", "减仓", "下跌", "跌", "利空"]
        pos_a = any(w in content_a for w in positive)
        neg_a = any(w in content_a for w in negative)
        pos_b = any(w in content_b for w in positive)
        neg_b = any(w in content_b for w in negative)
        return (pos_a and neg_b) or (neg_a and pos_b)

    def _is_supporting(self, content_a: str, content_b: str) -> bool:
        """简单支持检测：同向情感"""
        positive = ["增持", "买入", "看好", "加仓", "上升", "涨", "利好"]
        negative = ["减持", "卖出", "看空", "减仓", "下跌", "跌", "利空"]
        has_pos = any(w in content_a for w in positive)
        has_neg = any(w in content_a for w in negative)
        if has_pos:
            return any(w in content_b for w in positive)
        if has_neg:
            return any(w in content_b for w in negative)
        return False

    def _entry_to_dict(self, entry: MemoryEntry) -> dict:
        """MemoryEntry → plain dict（去掉 dataclass 类型信息）"""
        result = {
            "id": entry.id,
            "layer": entry.layer.value,
            "content": entry.content,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
            "confidence": entry.confidence,
            "source": entry.source,
            "tags": entry.tags,
            "superseded_by": entry.superseded_by,
            "supporting_ids": entry.supporting_ids,
            "contradictory_ids": entry.contradictory_ids,
        }
        if isinstance(entry, MemoryFact):
            result["verify_after"] = entry.verify_after
            result["last_verified"] = entry.last_verified
        elif isinstance(entry, MemoryExperience):
            result["outcome"] = entry.outcome
            result["recommendation_ref"] = entry.recommendation_ref
            result["actual_return_pct"] = entry.actual_return_pct
        elif isinstance(entry, MemoryObservation):
            result["observation_type"] = entry.observation_type
            result["symbols"] = entry.symbols
            result["market_context"] = entry.market_context
        elif isinstance(entry, MemoryUser):
            result["preference_type"] = entry.preference_type
            result["confirmed_by_user"] = entry.confirmed_by_user
            result["scope"] = entry.scope
        elif isinstance(entry, MemoryMentalModel):
            result["rule_text"] = entry.rule_text
            result["trigger_conditions"] = entry.trigger_conditions
            result["success_count"] = entry.success_count
            result["failure_count"] = entry.failure_count
            result["version"] = entry.version
        return result

    def _dict_to_entry(self, d: dict) -> MemoryEntry:
        """plain dict → 对应的 MemoryEntry 子类"""
        layer = MemoryLayer(d["layer"])
        base = dict(
            id=d["id"], layer=layer, content=d["content"],
            created_at=d["created_at"], updated_at=d["updated_at"],
            confidence=d.get("confidence", 0.5), source=d.get("source", ""),
            tags=d.get("tags", []), superseded_by=d.get("superseded_by", ""),
            supporting_ids=d.get("supporting_ids", []),
            contradictory_ids=d.get("contradictory_ids", []),
        )
        if layer == MemoryLayer.FACT:
            return MemoryFact(**base,
                verify_after=d.get("verify_after", ""),
                last_verified=d.get("last_verified", ""))
        elif layer == MemoryLayer.EXPERIENCE:
            return MemoryExperience(**base,
                outcome=d.get("outcome", ""),
                recommendation_ref=d.get("recommendation_ref", ""),
                actual_return_pct=d.get("actual_return_pct", 0.0))
        elif layer == MemoryLayer.OBSERVATION:
            return MemoryObservation(**base,
                observation_type=d.get("observation_type", ""),
                symbols=d.get("symbols", []),
                market_context=d.get("market_context", ""))
        elif layer == MemoryLayer.USER:
            return MemoryUser(**base,
                preference_type=d.get("preference_type", ""),
                confirmed_by_user=bool(d.get("confirmed_by_user", False)),
                scope=d.get("scope", ""))
        else:
            return MemoryMentalModel(**base,
                rule_text=d.get("rule_text", d["content"]),
                trigger_conditions=d.get("trigger_conditions", []),
                success_count=d.get("success_count", 0),
                failure_count=d.get("failure_count", 0),
                version=d.get("version", 1))

    def _rank_by_keyword(self, entries: list[MemoryEntry], keywords: set[str]) -> list[MemoryEntry]:
        """按关键词命中数排序。

        只保留有命中的条目：RRF 是把各排名列表当"证据来源"融合，
        0 命中的条目进不了关键词这个证据维度，若仍按名次得分，
        会让大量无关记忆（如每日行情事实）仅凭置信度/时效性挤占检索结果。
        """
        def score(e: MemoryEntry) -> int:
            text = (e.content + " ".join(e.tags)).lower()
            return sum(1 for kw in keywords if kw in text)
        hits = [(e, score(e)) for e in entries]
        return [e for e, s in sorted(hits, key=lambda x: x[1], reverse=True) if s > 0]

    def _rank_by_confidence(self, entries: list[MemoryEntry]) -> list[MemoryEntry]:
        """按置信度排序"""
        return sorted(entries, key=lambda e: e.confidence, reverse=True)

    def _rank_by_recency(self, entries: list[MemoryEntry]) -> list[MemoryEntry]:
        """按时效性排序（越新越好，加轻微衰减）"""
        now = datetime.now()
        def recency_score(e: MemoryEntry) -> float:
            try:
                age_days = (now - datetime.fromisoformat(e.updated_at)).days
            except (ValueError, TypeError):
                age_days = 0
            # 衰减：每天 -0.005，上限 30 天
            decay = max(-0.15, -age_days * CONFidence_DECAY_PER_DAY)
            return e.confidence + decay
        return sorted(entries, key=recency_score, reverse=True)

    def _update_relations(
        self,
        user_id: str,
        layer: MemoryLayer,
        new_id: str,
        supporting_ids: list[str],
        contradictory_ids: list[str],
    ):
        """更新被引用记忆的 supporting/contradictory_ids"""
        all_entries = self._load_layer(user_id, layer)
        changed = False
        for entry in all_entries:
            if entry["id"] in supporting_ids:
                if new_id not in entry.get("supporting_ids", []):
                    entry.setdefault("supporting_ids", []).append(new_id)
                    changed = True
            if entry["id"] in contradictory_ids:
                if new_id not in entry.get("contradictory_ids", []):
                    entry.setdefault("contradictory_ids", []).append(new_id)
                    changed = True
        if changed:
            self._save_layer(user_id, layer, all_entries)

    def _maybe_reflect(self, user_id: str):
        """观察积累足够时触发 reflect"""
        try:
            self.reflect(user_id)
        except Exception:
            # reflect 失败不阻塞主流程
            pass

    # ---- 兼容旧 API ----

    def save_session(self, record: SessionRecord) -> Path:
        """保存会话记录（兼容旧接口）"""
        p = self._user_dir(record.user_id) / f"session_{record.session_id}.json"
        p.write_text(
            json.dumps({
                "session_id": record.session_id,
                "user_id": record.user_id,
                "created_at": record.created_at,
                "last_active": record.last_active,
                "phase": record.phase,
                "errors": record.errors,
                "user_feedback": record.user_feedback,
                "memory_summary": getattr(record, "memory_summary", ""),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        return p

    def save_recommendation(self, user_id: str, rec: Recommendation, session_id: str) -> Path:
        """保存推荐并写入 experience 层记忆"""
        p = self._user_dir(user_id) / "recommendations.json"
        data = []
        if p.exists():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = []
        now = self._now_iso()
        rec_entry = {
            "session_id": session_id,
            "timestamp": now,
            "action": rec.action.value,
            "symbol": rec.symbol,
            "quantity": rec.quantity,
            "price": rec.price,
            "reason": rec.reason,
            "confidence": rec.confidence,
            "approved": None,
        }
        data.append(rec_entry)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        # 同步写入 experience 层
        self.retain(
            user_id=user_id,
            layer=MemoryLayer.EXPERIENCE,
            content=f"建议{rec.action.value}{rec.symbol} {rec.quantity}股@{rec.price}，理由：{rec.reason}",
            source="recommendation",
            tags=[rec.symbol, rec.action.value],
            recommendation_ref=f"{session_id}_{now}",
            outcome="pending",
        )
        return p

    def update_feedback(self, user_id: str, timestamp: str, approved: bool, comment: str = "") -> bool:
        """更新推荐反馈，并更新对应 experience 记忆的置信度。

        置信度语义：用户采纳是支持信号（+），拒绝是矛盾信号（-）。
        outcome 只在被拒绝时改写为 rejected——「批准」不等于盈利，
        采纳后的记录保持 pending，等实际盈亏出来再由复盘环节落定。
        """
        p = self._user_dir(user_id) / "recommendations.json"
        if not p.exists():
            return False
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return False
        for r in data:
            if r.get("timestamp") == timestamp:
                r["approved"] = approved
                r["feedback_comment"] = comment
                p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

                # 更新 experience 记忆
                experiences = self._load_layer(user_id, MemoryLayer.EXPERIENCE)
                target = self._find_experience(experiences, r, timestamp)
                if target is not None:
                    if not approved:
                        target["outcome"] = "rejected"
                    elif target.get("outcome") == "rejected":
                        # 用户改主意采纳了，撤回此前的拒绝结论
                        target["outcome"] = "pending"
                    conf = target.get("confidence", 0.5)
                    delta = CONFidence_SUPPORT if approved else -CONFidence_CONTRADICT
                    target["confidence"] = min(1.0, max(0.0, conf + delta))
                    target["updated_at"] = self._now_iso()
                    target["user_feedback"] = comment
                    self._save_layer(user_id, MemoryLayer.EXPERIENCE, experiences)
                return True
        return False

    @staticmethod
    def _find_experience(experiences: list[dict], rec: dict, timestamp: str) -> Optional[dict]:
        """在这条建议对应的经验记忆上定位。

        save_recommendation 写入时 recommendation_ref = f"{session_id}_{timestamp}"，
        所以按 timestamp 后缀可精确匹配。

        但 retain() 会对内容等价的记忆去重，同一标的的同类建议会共用同一条经验记录，
        此时后缀匹配会落空，需退回按标的匹配——优先仍在待验证的那条，其次是最近更新的。
        不能无条件取第一条，否则「拒绝 A」会被记到 B 的经验上。
        """
        for exp in experiences:
            if str(exp.get("recommendation_ref", "")).endswith(f"_{timestamp}"):
                return exp
        symbol = rec.get("symbol", "")
        if not symbol:
            return None
        candidates = [e for e in experiences if symbol in str(e.get("content", ""))]
        if not candidates:
            return None
        pending = [e for e in candidates if e.get("outcome") == "pending"]
        pool = pending or candidates
        return max(pool, key=lambda e: e.get("updated_at", ""))

    def save_user_profile(self, user_id: str, profile: UserProfile,
                          confirmed_by_user: bool = False) -> Path:
        """把用户章程写入 user 层记忆。

        与 fact 层的区别：用户偏好不是"外部世界的事实"，而是"用户的要求"，
        必须单独成层、单独可查，并且带 `confirmed_by_user` 标记——
        配置默认值（config.fund.yaml 的 default_*）只是系统假设，
        只有用户显式确认过才置 True（见 MemoryUser 文档）。

        内容变化时旧条目被标记 superseded_by 指向新条目，保留修订链而非静默覆盖。
        本方法一次性读改写（不走 retain）：user 层不是证据驱动的记忆，
        retain 的去重/置信度演化语义不适用于"用户声明"。
        """
        now = self._now_iso()
        fields = [
            ("risk_tolerance", profile.risk_tolerance.value, "风险偏好"),
            ("horizon", profile.investment_horizon, "投资期限"),
            ("loss_limit", f"单笔 {profile.max_single_loss:.0%} / 整体 {profile.max_total_loss:.0%}", "亏损上限"),
            ("forbidden_sector", "、".join(profile.forbidden_sectors) or "（无）", "禁止行业"),
        ]
        entries = self._load_layer(user_id, MemoryLayer.USER)
        changed = False
        for ptype, value, label in fields:
            content = f"用户{user_id} {label}：{value}"
            active = [e for e in entries
                      if e.get("preference_type") == ptype and not e.get("superseded_by")]
            same = next((e for e in active
                         if self._normalize(e.get("content", "")) == self._normalize(content)), None)
            if same is not None:
                # 同值：仅刷新用户确认状态（系统假设 → 用户确认）
                if confirmed_by_user and not same.get("confirmed_by_user"):
                    same["confirmed_by_user"] = True
                    same["updated_at"] = now
                    changed = True
                continue
            # 值变化（或首次写入）：新建条目，旧条目指向它
            new_id = str(uuid.uuid4())[:8]
            for e in active:
                e["superseded_by"] = new_id
                changed = True
            entries.append({
                "id": new_id,
                "layer": MemoryLayer.USER.value,
                "content": content,
                "created_at": now,
                "updated_at": now,
                # user 层置信度不参与证据演化，固定 0.5 占位（语义见报告 §4）
                "confidence": 0.5,
                "source": "user_profile",
                "tags": ["user_memory", ptype],
                "superseded_by": "",
                "supporting_ids": [],
                "contradictory_ids": [],
                "preference_type": ptype,
                "confirmed_by_user": bool(confirmed_by_user),
                "scope": "portfolio",
            })
            changed = True
        if changed:
            self._save_layer(user_id, MemoryLayer.USER, entries)
        return self._layer_file(user_id, MemoryLayer.USER)

    def load_user_profile(self, user_id: str) -> dict:
        """读回 user 层记忆（未替代的条目）。

        返回 {preference_type: {"content":..., "confirmed_by_user": bool}}，
        供上层区分"用户确认过的约束"与"系统默认假设"。
        """
        entries = self._load_layer(user_id, MemoryLayer.USER)
        out: dict[str, dict] = {}
        for e in entries:
            if e.get("superseded_by"):
                continue
            out[e.get("preference_type", "unknown")] = {
                "content": e.get("content", ""),
                "confirmed_by_user": bool(e.get("confirmed_by_user", False)),
                "updated_at": e.get("updated_at", ""),
            }
        return out

    def save_portfolio_snapshot(self, user_id: str, portfolio: Portfolio) -> Path:
        """保存组合快照，并写入 fact 层记忆"""
        stamp = date.today().isoformat()
        p = self._user_dir(user_id) / f"portfolio_{stamp}.json"
        data = {
            "date": portfolio.date,
            "total_value": portfolio.total_value,
            "cash": portfolio.cash,
            "positions": [
                {
                    "symbol": pos.symbol,
                    "name": pos.name,
                    "quantity": pos.quantity,
                    "avg_cost": pos.avg_cost,
                    "current_price": pos.current_price,
                    "return_pct": pos.return_pct,
                    "sector": pos.sector,
                }
                for pos in portfolio.positions
            ],
        }
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        # 同步写入 fact 层
        sector_alloc = portfolio.sector_allocation()
        for sector, pct in sector_alloc.items():
            self.retain(
                user_id=user_id,
                layer=MemoryLayer.FACT,
                content=f"用户{user_id}组合中{sector}占比{pct:.1%}",
                source="portfolio_snapshot",
                tags=["portfolio", "sector_allocation", sector],
            )
        return p

    def load_recent_sessions(self, user_id: str, limit: int = 10) -> list[SessionRecord]:
        """加载最近会话（兼容旧接口）"""
        ud = self._user_dir(user_id)
        files = sorted(ud.glob("session_*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
        out = []
        for f in files[:limit]:
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                out.append(SessionRecord(
                    session_id=d["session_id"],
                    user_id=d["user_id"],
                    created_at=d["created_at"],
                    last_active=d["last_active"],
                    phase=d["phase"],
                    errors=d.get("errors", []),
                    user_feedback=d.get("user_feedback", ""),
                    memory_summary=d.get("memory_summary", ""),
                ))
            except (json.JSONDecodeError, OSError, KeyError):
                continue
        return out

    def get_recommendation_history(self, user_id: str, symbol: str = "", limit: int = 20) -> list[dict]:
        """获取推荐历史（兼容旧接口）"""
        p = self._user_dir(user_id) / "recommendations.json"
        if not p.exists():
            return []
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []
        if symbol:
            data = [r for r in data if r.get("symbol") == symbol]
        return data[-limit:]

    def get_memory_summary(self, user_id: str) -> str:
        """生成四层记忆摘要，供 Context 使用"""
        lines = []
        for layer in MemoryLayer:
            entries = self._load_layer(user_id, layer)
            active = [e for e in entries if not e.get("superseded_by")]
            if active:
                lines.append(f"{layer.value}: {len(active)}条")
        if not lines:
            return "无记忆记录"
        # 加入高置信度心智模型
        models = self._load_layer(user_id, MemoryLayer.MENTAL_MODEL)
        high_conf = [m for m in models if m.get("confidence", 0) >= 0.7 and not m.get("superseded_by")]
        if high_conf:
            rules = [m.get("rule_text", m["content"])[:40] for m in high_conf[:3]]
            lines.append(f"高置信度规则: {'; '.join(rules)}")
        return " | ".join(lines)


# ---- 别名兼容旧代码 ----
MemoryStore = HindsightMemoryStore


class MemoryQuery:
    """Memory 查询接口——给 Orchestrator / Agent Loop 用"""

    def __init__(self, store: HindsightMemoryStore):
        self.store = store

    def recall_memories(self, user_id: str, query: str, top_k: int = 5) -> list[MemoryEntry]:
        """MCP recall 接口"""
        return self.store.recall(user_id, query, top_k=top_k)

    def retain_memory(self, user_id: str, layer: MemoryLayer, content: str, **kwargs) -> MemoryEntry:
        """MCP retain 接口"""
        return self.store.retain(user_id, layer, content, **kwargs)

    def reflect_models(self, user_id: str) -> list[MemoryMentalModel]:
        """MCP reflect 接口"""
        return self.store.reflect(user_id)

    def recent_sessions(self, user_id: str, limit: int = 5) -> list[SessionRecord]:
        return self.store.load_recent_sessions(user_id, limit)

    def recommendation_history(self, user_id: str, symbol: str = "") -> list[dict]:
        return self.store.get_recommendation_history(user_id, symbol)

    def memory_summary(self, user_id: str) -> str:
        return self.store.get_memory_summary(user_id)

    def find_stalled_questions(self, user_id: str, min_hits: int = 3) -> list[tuple[str, int]]:
        """找出反复建议但未获批的交易"""
        recs = self.store.get_recommendation_history(user_id, limit=50)
        pending: dict[str, int] = {}
        for r in recs:
            sym = r.get("symbol", "")
            key = f"建议{r.get('action', '')}{sym}"
            approved = r.get("approved")
            if approved is None:
                pending[key] = pending.get(key, 0) + 1
            elif approved is False:
                pending[key] = 0
        return [(k, v) for k, v in pending.items() if v >= min_hits]
