"""
Learner modeling agent.

Builds a lightweight closed loop for:
1) Knowledge-map based prerequisite expansion.
2) Simplified Bayesian-style mastery updates from learner events.
3) Gap analysis and adaptive strategy dispatch for script/voice/animation.
"""

from __future__ import annotations

from typing import Any, Dict, List, Set

from ..foundation.base_agent import BaseAgent


DEFAULT_KNOWLEDGE_MAP: Dict[str, Dict[str, Any]] = {
    "整式运算": {
        "difficulty": 0.35,
        "prerequisites": [],
        "common_mistakes": ["去括号漏符号", "同类项合并错误"],
        "explanations": ["规则清单", "错题对比法"],
    },
    "一次方程": {
        "difficulty": 0.4,
        "prerequisites": ["整式运算"],
        "common_mistakes": ["移项符号错误", "两边未同时运算"],
        "explanations": ["天平平衡类比", "逐步等价变形"],
    },
    "三角形基础": {
        "difficulty": 0.45,
        "prerequisites": ["整式运算"],
        "common_mistakes": ["角边关系混淆", "图形条件遗漏"],
        "explanations": ["图形拆分法", "定义回忆法"],
    },
    "直角三角形": {
        "difficulty": 0.5,
        "prerequisites": ["三角形基础"],
        "common_mistakes": ["斜边识别错误", "直角位置判断失误"],
        "explanations": ["图像识别法", "边角对应法"],
    },
    "勾股定理": {
        "difficulty": 0.6,
        "prerequisites": ["直角三角形", "整式运算"],
        "common_mistakes": ["把斜边当直角边", "平方与开方计算错误"],
        "explanations": ["面积拼图法", "公式推导法", "几何证明法"],
    },
    "相似三角形": {
        "difficulty": 0.65,
        "prerequisites": ["三角形基础", "一次方程"],
        "common_mistakes": ["对应边配对错误", "比例式列错"],
        "explanations": ["角角判定", "比例映射"],
    },
}


class LearnerModelingAgent(BaseAgent):
    """Build learner model and adaptive strategy before script generation."""

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        project = state.get("project")
        if project is None or getattr(project, "status", "") == "failed":
            return state

        metadata = state.setdefault("metadata", {})
        knowledge_map = self._resolve_knowledge_map(metadata)

        required_knowledge = self._resolve_required_knowledge(project, metadata, knowledge_map)
        learner_profile = self._resolve_or_cold_start_profile(metadata, knowledge_map, required_knowledge)

        learning_events = metadata.get("learning_events") or []
        if isinstance(learning_events, list) and learning_events:
            learner_profile["mastery"] = self._apply_learning_events(
                mastery=dict(learner_profile.get("mastery", {})),
                events=learning_events,
            )

        gap_report = self._analyze_knowledge_gap(
            mastery=dict(learner_profile.get("mastery", {})),
            required_knowledge=required_knowledge,
            knowledge_map=knowledge_map,
        )
        adaptive_plan = self._build_adaptive_plan(learner_profile, gap_report, knowledge_map, metadata)

        metadata["knowledge_map"] = knowledge_map
        metadata["required_knowledge"] = required_knowledge
        metadata["learner_profile"] = learner_profile
        metadata["knowledge_gap"] = gap_report
        metadata["adaptive_plan"] = adaptive_plan

        messages = state.setdefault("messages", [])
        messages.append(
            {
                "role": "assistant",
                "content": (
                    "学情建模完成："
                    f"模式={adaptive_plan.get('mode', 'standard')}，"
                    f"薄弱点={len(gap_report.get('weak_knowledge', []))}"
                ),
            }
        )
        state["current_step"] = "learner_modeling_completed"
        return state

    def _resolve_knowledge_map(self, metadata: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        raw = metadata.get("knowledge_map") or metadata.get("knowledge_graph")
        if not isinstance(raw, dict) or not raw:
            return dict(DEFAULT_KNOWLEDGE_MAP)

        normalized: Dict[str, Dict[str, Any]] = {}
        for key, payload in raw.items():
            if isinstance(payload, dict) and "prerequisites" in payload:
                node_name = str(key).strip()
                if not node_name:
                    continue
                normalized[node_name] = {
                    "difficulty": self._clamp(self._safe_float(payload.get("difficulty", 0.5), 0.5), 0.0, 1.0),
                    "prerequisites": self._normalize_name_list(payload.get("prerequisites")),
                    "common_mistakes": self._normalize_name_list(payload.get("common_mistakes")),
                    "explanations": self._normalize_name_list(payload.get("explanations")),
                }
                continue

            if isinstance(payload, list):
                node_name = str(key).strip()
                if not node_name:
                    continue
                normalized[node_name] = {
                    "difficulty": 0.5,
                    "prerequisites": self._normalize_name_list(payload),
                    "common_mistakes": [],
                    "explanations": [],
                }

        return normalized or dict(DEFAULT_KNOWLEDGE_MAP)

    def _resolve_required_knowledge(
        self,
        project: Any,
        metadata: Dict[str, Any],
        knowledge_map: Dict[str, Dict[str, Any]],
    ) -> List[str]:
        explicit = metadata.get("required_knowledge") or metadata.get("problem_knowledge")
        required = self._normalize_name_list(explicit)
        if required:
            return required

        problem_text = str(getattr(project, "problem_text", "") or "")
        inferred = self._infer_knowledge_from_text(problem_text, knowledge_map)
        if inferred:
            return inferred

        # fallback to central nodes for geometry explanation when no signal is available
        return ["直角三角形", "勾股定理"]

    def _infer_knowledge_from_text(
        self,
        problem_text: str,
        knowledge_map: Dict[str, Dict[str, Any]],
    ) -> List[str]:
        text = problem_text.strip().lower()
        if not text:
            return []

        keyword_to_node = {
            "勾股": "勾股定理",
            "直角三角形": "直角三角形",
            "直角": "直角三角形",
            "相似": "相似三角形",
            "方程": "一次方程",
            "整式": "整式运算",
            "三角形": "三角形基础",
        }
        hits: List[str] = []
        for keyword, node in keyword_to_node.items():
            if keyword in text and node in knowledge_map:
                hits.append(node)
        return sorted(set(hits))

    def _resolve_or_cold_start_profile(
        self,
        metadata: Dict[str, Any],
        knowledge_map: Dict[str, Dict[str, Any]],
        required_knowledge: List[str],
    ) -> Dict[str, Any]:
        raw_profile = metadata.get("learner_profile") if isinstance(metadata.get("learner_profile"), dict) else {}
        grade = self._safe_int(metadata.get("learner_grade", raw_profile.get("grade", 8)), 8)
        learner_id = str(metadata.get("learner_id", raw_profile.get("learner_id", "anonymous")) or "anonymous")

        strengths = self._normalize_name_list(metadata.get("learner_strengths") or raw_profile.get("strengths") or [])
        weaknesses = self._normalize_name_list(metadata.get("learner_weaknesses") or raw_profile.get("weaknesses") or [])

        cold_start = self._grade_cold_start_mastery(grade)
        base_mastery = {
            key: cold_start
            for key in knowledge_map.keys()
        }

        existing_mastery = raw_profile.get("mastery") if isinstance(raw_profile.get("mastery"), dict) else {}
        for key, value in existing_mastery.items():
            point = str(key).strip()
            if not point:
                continue
            base_mastery[point] = self._clamp01(value)

        explicit_mastery = metadata.get("learner_mastery") if isinstance(metadata.get("learner_mastery"), dict) else {}
        for key, value in explicit_mastery.items():
            point = str(key).strip()
            if not point:
                continue
            base_mastery[point] = self._clamp01(value)

        # ensure required knowledge and prerequisites always have values
        for point in self._expand_prerequisites(required_knowledge, knowledge_map):
            base_mastery.setdefault(point, cold_start)

        return {
            "learner_id": learner_id,
            "grade": grade,
            "mastery": base_mastery,
            "strengths": strengths,
            "weaknesses": weaknesses,
        }

    def _apply_learning_events(
        self,
        mastery: Dict[str, float],
        events: List[Any],
    ) -> Dict[str, float]:
        event_delta = {
            "correct": 0.18,
            "quick_correct": 0.24,
            "wrong": -0.22,
            "not_understood": -0.28,
            "voice_confused": -0.2,
            "hint_used": -0.08,
        }

        for raw in events:
            if not isinstance(raw, dict):
                continue

            event_type = str(raw.get("type", "")).strip().lower()
            delta = event_delta.get(event_type)
            if delta is None:
                continue

            weight = self._clamp(self._safe_float(raw.get("weight", 1.0), 1.0), 0.5, 2.0)
            points = self._normalize_name_list(raw.get("knowledge_points") or raw.get("knowledge") or raw.get("concepts"))
            if not points:
                continue

            for point in points:
                old = self._clamp01(mastery.get(point, 0.5))
                if delta >= 0:
                    new_value = old + (1.0 - old) * delta * weight
                else:
                    new_value = old * (1.0 + delta * weight)
                mastery[point] = self._clamp01(new_value)

        return mastery

    def _analyze_knowledge_gap(
        self,
        mastery: Dict[str, float],
        required_knowledge: List[str],
        knowledge_map: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        expanded = self._expand_prerequisites(required_knowledge, knowledge_map)
        required_set = set(required_knowledge)

        weak_prerequisites: List[Dict[str, Any]] = []
        weak_targets: List[Dict[str, Any]] = []

        for point in expanded:
            score = self._clamp01(mastery.get(point, 0.5))
            bucket = {
                "knowledge": point,
                "mastery": round(score, 4),
                "difficulty": round(float(knowledge_map.get(point, {}).get("difficulty", 0.5)), 3),
            }
            if point in required_set and score < 0.72:
                weak_targets.append(bucket)
            if point not in required_set and score < 0.62:
                weak_prerequisites.append(bucket)

        weak_knowledge = sorted(
            weak_targets + weak_prerequisites,
            key=lambda item: float(item.get("mastery", 0.0)),
        )

        required_scores = [self._clamp01(mastery.get(point, 0.5)) for point in required_knowledge] or [0.5]
        prerequisite_only = [point for point in expanded if point not in required_set]
        prerequisite_scores = [self._clamp01(mastery.get(point, 0.5)) for point in prerequisite_only] or [0.5]

        return {
            "required_knowledge": required_knowledge,
            "expanded_knowledge": expanded,
            "required_mastery_avg": round(sum(required_scores) / len(required_scores), 4),
            "prerequisite_mastery_avg": round(sum(prerequisite_scores) / len(prerequisite_scores), 4),
            "weak_knowledge": weak_knowledge,
            "weak_prerequisites": weak_prerequisites,
            "weak_targets": weak_targets,
        }

    def _build_adaptive_plan(
        self,
        learner_profile: Dict[str, Any],
        gap_report: Dict[str, Any],
        knowledge_map: Dict[str, Dict[str, Any]],
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        required_avg = float(gap_report.get("required_mastery_avg", 0.5) or 0.5)
        prerequisite_avg = float(gap_report.get("prerequisite_mastery_avg", 0.5) or 0.5)
        weak_prerequisites = list(gap_report.get("weak_prerequisites", []) or [])

        if weak_prerequisites and prerequisite_avg < 0.62:
            mode = "remedial"
        elif required_avg >= 0.84 and prerequisite_avg >= 0.76:
            mode = "advanced"
        else:
            mode = "standard"

        strengths = set(self._normalize_name_list(learner_profile.get("strengths") or []))
        weaknesses = set(self._normalize_name_list(learner_profile.get("weaknesses") or []))
        preferred_analogy = str(metadata.get("preferred_analogy_domain", "")).strip().lower()

        analogy_mode = bool(preferred_analogy)
        analogy_domain = preferred_analogy
        if not analogy_mode and ("physics" in strengths or "物理" in strengths) and ("math" in weaknesses or "数学" in weaknesses):
            analogy_mode = True
            analogy_domain = "physics"

        weak_knowledge = list(gap_report.get("weak_knowledge", []) or [])
        top_weak_points = [str(item.get("knowledge", "")).strip() for item in weak_knowledge[:3] if str(item.get("knowledge", "")).strip()]

        if mode == "remedial":
            tts_profile = {
                "rate": "-18%",
                "volume": "+12%",
                "pause_style": "strong",
            }
            visual_profile = {
                "scaffold_level": "high",
                "highlight_intensity": "high",
                "blink_auxiliary_lines": True,
                "label_key_entities": True,
            }
        elif mode == "advanced":
            tts_profile = {
                "rate": "+8%",
                "volume": "+6%",
                "pause_style": "light",
            }
            visual_profile = {
                "scaffold_level": "low",
                "highlight_intensity": "low",
                "blink_auxiliary_lines": False,
                "label_key_entities": False,
            }
        else:
            tts_profile = {
                "rate": "-6%",
                "volume": "+10%",
                "pause_style": "normal",
            }
            visual_profile = {
                "scaffold_level": "medium",
                "highlight_intensity": "medium",
                "blink_auxiliary_lines": False,
                "label_key_entities": True,
            }

        review_points = [
            {
                "knowledge": point,
                "common_mistakes": knowledge_map.get(point, {}).get("common_mistakes", []),
                "explanations": knowledge_map.get(point, {}).get("explanations", []),
            }
            for point in top_weak_points
        ]

        return {
            "mode": mode,
            "review_duration_seconds": 30 if mode == "remedial" else 0,
            "review_points": review_points,
            "weak_knowledge": top_weak_points,
            "skip_basic_definition": mode == "advanced",
            "inject_challenge_variant": mode == "advanced",
            "analogy_mode": analogy_mode,
            "analogy_domain": analogy_domain,
            "tts_profile": tts_profile,
            "visual_profile": visual_profile,
            "required_mastery_avg": required_avg,
            "prerequisite_mastery_avg": prerequisite_avg,
        }

    def _expand_prerequisites(
        self,
        required_knowledge: List[str],
        knowledge_map: Dict[str, Dict[str, Any]],
    ) -> List[str]:
        ordered: List[str] = []
        seen: Set[str] = set()

        def visit(point: str) -> None:
            if point in seen:
                return
            seen.add(point)
            node = knowledge_map.get(point, {})
            for pre in self._normalize_name_list(node.get("prerequisites")):
                visit(pre)
            ordered.append(point)

        for item in required_knowledge:
            visit(item)

        return ordered

    def _grade_cold_start_mastery(self, grade: int) -> float:
        if grade <= 6:
            return 0.45
        if grade <= 8:
            return 0.52
        if grade <= 10:
            return 0.58
        return 0.62

    def _normalize_name_list(self, value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            return [text] if text else []
        if isinstance(value, list):
            result: List[str] = []
            seen: Set[str] = set()
            for item in value:
                text = str(item).strip()
                if not text or text in seen:
                    continue
                seen.add(text)
                result.append(text)
            return result
        return []

    def _safe_int(self, value: Any, default: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _safe_float(self, value: Any, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _clamp01(self, value: Any) -> float:
        return self._clamp(self._safe_float(value, 0.0), 0.0, 1.0)

    def _clamp(self, value: float, lower: float, upper: float) -> float:
        if value < lower:
            return lower
        if value > upper:
            return upper
        return value
