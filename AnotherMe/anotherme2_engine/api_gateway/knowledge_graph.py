"""Knowledge graph and Q-matrix normalization utilities.

This module centralizes event normalization before KT update:
LearningEvent -> normalized question attempt -> resolved knowledge points.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


_ALLOWED_DIFFICULTIES = {"easy", "medium", "hard"}


@dataclass
class NormalizedQuestionAttempt:
    question_id: str
    is_correct: bool
    answer: str | None
    correct_answer: str | None
    attempts: int
    duration_ms: int
    hints_used: int
    knowledge_point_ids: list[str]
    difficulty: str | None
    payload: dict[str, Any]


@dataclass
class ResolvedKnowledgePoint:
    knowledge_point_id: str
    weight: float
    difficulty: str | None


def _clamp_weight(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _normalize_difficulty(value: Any) -> str | None:
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in _ALLOWED_DIFFICULTIES:
            return lowered
    return None


def _normalize_knowledge_points(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    points: list[str] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        points.append(value)
    return points


def normalize_question_attempt(
    *,
    question_id: str | None,
    is_correct: bool,
    payload: dict[str, Any] | None,
    event_knowledge_points: list[str] | None,
    block_id: str | None = None,
    scene_id: str | None = None,
) -> NormalizedQuestionAttempt:
    """Normalize quiz-answer payload into a strict structure for KT updates."""
    raw_payload = payload or {}

    normalized_question_id = (
        question_id
        or raw_payload.get("question_id")
        or raw_payload.get("questionId")
        or block_id
        or scene_id
        or ""
    )
    normalized_question_id = str(normalized_question_id).strip()

    normalized_is_correct = bool(
        raw_payload.get("is_correct")
        if "is_correct" in raw_payload
        else raw_payload.get("isCorrect", is_correct)
    )

    attempts_raw = raw_payload.get("attempts", 1)
    duration_raw = raw_payload.get("duration_ms", raw_payload.get("durationMs", 0))
    hints_raw = raw_payload.get("hints_used", raw_payload.get("hintsUsed", 0))

    try:
        attempts = max(1, int(attempts_raw))
    except (TypeError, ValueError):
        attempts = 1

    try:
        duration_ms = max(0, int(duration_raw))
    except (TypeError, ValueError):
        duration_ms = 0

    try:
        hints_used = max(0, int(hints_raw))
    except (TypeError, ValueError):
        hints_used = 0

    payload_kps = _normalize_knowledge_points(
        raw_payload.get("knowledge_point_ids", raw_payload.get("knowledgePointIds"))
    )
    event_kps = _normalize_knowledge_points(event_knowledge_points)
    merged_kps = payload_kps or event_kps

    answer = raw_payload.get("answer")
    correct_answer = raw_payload.get("correct_answer", raw_payload.get("correctAnswer"))

    normalized_payload = dict(raw_payload)
    normalized_payload["question_id"] = normalized_question_id
    normalized_payload["is_correct"] = normalized_is_correct
    normalized_payload["attempts"] = attempts
    normalized_payload["duration_ms"] = duration_ms
    normalized_payload["hints_used"] = hints_used
    normalized_payload["knowledge_point_ids"] = merged_kps
    normalized_payload["difficulty"] = _normalize_difficulty(raw_payload.get("difficulty"))
    normalized_payload["answer"] = str(answer) if answer is not None else None
    normalized_payload["correct_answer"] = (
        str(correct_answer) if correct_answer is not None else None
    )

    return NormalizedQuestionAttempt(
        question_id=normalized_question_id,
        is_correct=normalized_is_correct,
        answer=normalized_payload["answer"],
        correct_answer=normalized_payload["correct_answer"],
        attempts=attempts,
        duration_ms=duration_ms,
        hints_used=hints_used,
        knowledge_point_ids=merged_kps,
        difficulty=normalized_payload["difficulty"],
        payload=normalized_payload,
    )


def resolve_question_knowledge_points(
    *,
    question_id: str,
    qmatrix_rows: list[Any],
    payload_knowledge_point_ids: list[str] | None,
    event_knowledge_points: list[str] | None,
    payload_difficulty: str | None,
) -> list[ResolvedKnowledgePoint]:
    """Resolve question->knowledge-point mapping with fallback order.

    Priority:
    1) payload knowledge_point_ids
    2) q-matrix rows for question
    3) event-level knowledge_points
    4) question_id as fallback pseudo-knowledge-point
    """
    payload_kps = _normalize_knowledge_points(payload_knowledge_point_ids)
    event_kps = _normalize_knowledge_points(event_knowledge_points)

    if payload_kps:
        # If payload specifies KPs, keep them and borrow q-matrix weights when available.
        weight_map = {
            str(getattr(row, "knowledge_point_id", "")): float(getattr(row, "weight", 1.0) or 1.0)
            for row in qmatrix_rows
        }
        resolved = [
            ResolvedKnowledgePoint(
                knowledge_point_id=kp,
                weight=max(0.0, weight_map.get(kp, 1.0)),
                difficulty=payload_difficulty,
            )
            for kp in payload_kps
        ]
        return _normalize_weights(resolved)

    if qmatrix_rows:
        resolved = [
            ResolvedKnowledgePoint(
                knowledge_point_id=str(getattr(row, "knowledge_point_id", "")).strip(),
                weight=max(0.0, float(getattr(row, "weight", 1.0) or 1.0)),
                difficulty=_normalize_difficulty(getattr(row, "difficulty", None)) or payload_difficulty,
            )
            for row in qmatrix_rows
            if str(getattr(row, "knowledge_point_id", "")).strip()
        ]
        if resolved:
            return _normalize_weights(resolved)

    if event_kps:
        resolved = [
            ResolvedKnowledgePoint(
                knowledge_point_id=kp,
                weight=1.0,
                difficulty=payload_difficulty,
            )
            for kp in event_kps
        ]
        return _normalize_weights(resolved)

    fallback_id = question_id.strip() or "unknown-question"
    return [
        ResolvedKnowledgePoint(
            knowledge_point_id=fallback_id,
            weight=1.0,
            difficulty=payload_difficulty,
        )
    ]


def _normalize_weights(points: list[ResolvedKnowledgePoint]) -> list[ResolvedKnowledgePoint]:
    total = sum(max(0.0, p.weight) for p in points)
    if total <= 0.0:
        equal = 1.0 / max(len(points), 1)
        return [
            ResolvedKnowledgePoint(
                knowledge_point_id=p.knowledge_point_id,
                weight=equal,
                difficulty=p.difficulty,
            )
            for p in points
        ]
    return [
        ResolvedKnowledgePoint(
            knowledge_point_id=p.knowledge_point_id,
            weight=_clamp_weight(max(0.0, p.weight) / total),
            difficulty=p.difficulty,
        )
        for p in points
    ]
