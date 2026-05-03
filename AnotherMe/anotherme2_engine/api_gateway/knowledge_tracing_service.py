"""Knowledge Tracing service layer.

Bridging LearningEvent -> BKT update -> StudentKnowledgeState persistence.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from .knowledge_graph import (
    normalize_question_attempt,
    resolve_question_knowledge_points,
)
from .kt_models import (
    BKTParameters,
    KnowledgeTracingStateEstimator,
    StudentKnowledgeTrace,
    TeachingDecision,
)
from .models import (
    KnowledgePoint,
    KnowledgeTraceEvent,
    QuestionKnowledgeMap,
    StudentKnowledgeState,
)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _default_bkt_params() -> BKTParameters:
    return BKTParameters(
        p_init=0.3,
        p_learn=0.15,
        p_guess=0.2,
        p_slip=0.1,
        p_forget=0.05,
    )


def _to_trace(state: StudentKnowledgeState) -> StudentKnowledgeTrace:
    return StudentKnowledgeTrace(
        user_id=state.user_id,
        knowledge_point_id=state.knowledge_point_id,
        p_mastery=state.p_mastery,
        p_learn=state.p_learn,
        p_guess=state.p_guess,
        p_slip=state.p_slip,
        p_forget=state.p_forget,
        attempts=state.attempts,
        correct_attempts=state.correct_attempts,
    )


def _apply_trace_to_state(state: StudentKnowledgeState, trace: StudentKnowledgeTrace) -> None:
    state.p_mastery = trace.p_mastery
    state.p_learn = trace.p_learn
    state.p_guess = trace.p_guess
    state.p_slip = trace.p_slip
    state.p_forget = trace.p_forget
    state.attempts = trace.attempts
    state.correct_attempts = trace.correct_attempts
    state.last_updated_at = _utcnow()


def get_or_create_knowledge_state(
    session: Session,
    user_id: str,
    knowledge_point_id: str,
) -> StudentKnowledgeState:
    """Fetch existing state or create a cold-start state with default BKT params."""
    state = (
        session.query(StudentKnowledgeState)
        .filter(
            StudentKnowledgeState.user_id == user_id,
            StudentKnowledgeState.knowledge_point_id == knowledge_point_id,
        )
        .first()
    )
    if state:
        return state

    params = _default_bkt_params()
    state = StudentKnowledgeState(
        user_id=user_id,
        knowledge_point_id=knowledge_point_id,
        p_mastery=params.p_init,
        p_learn=params.p_learn,
        p_guess=params.p_guess,
        p_slip=params.p_slip,
        p_forget=params.p_forget,
        attempts=0,
        correct_attempts=0,
    )
    session.add(state)
    session.flush()
    return state


def process_quiz_answer(
    session: Session,
    user_id: str,
    question_id: str,
    is_correct: bool,
    knowledge_point_ids: list[str] | None = None,
    event_knowledge_points: list[str] | None = None,
    block_id: str | None = None,
    scene_id: str | None = None,
    source_event_id: str | None = None,
    payload: dict | None = None,
) -> list[dict[str, Any]]:
    """Process a quiz answer through the Q-matrix and update BKT states.

    Returns a list of updated knowledge-point summaries.
    """
    normalized = normalize_question_attempt(
        question_id=question_id,
        is_correct=is_correct,
        payload=payload,
        event_knowledge_points=event_knowledge_points,
        block_id=block_id,
        scene_id=scene_id,
    )
    if not normalized.question_id:
        raise ValueError("question_id is required for strict knowledge tracing")

    # 1. Resolve question -> knowledge points via Q-matrix + strict payload fallback
    mappings = (
        session.query(QuestionKnowledgeMap)
        .filter(QuestionKnowledgeMap.question_id == normalized.question_id)
        .all()
    )
    resolved_kps = resolve_question_knowledge_points(
        question_id=normalized.question_id,
        qmatrix_rows=mappings,
        payload_knowledge_point_ids=knowledge_point_ids or normalized.knowledge_point_ids,
        event_knowledge_points=event_knowledge_points,
        payload_difficulty=normalized.difficulty,
    )

    estimator = KnowledgeTracingStateEstimator()
    results: list[dict[str, Any]] = []

    for kp in resolved_kps:
        kp_id = kp.knowledge_point_id
        state = get_or_create_knowledge_state(session, user_id, kp_id)
        prior = state.p_mastery
        trace = _to_trace(state)

        # BKT update with weighted evidence from Q-matrix.
        # For multi-knowledge-point questions, weight controls how strongly
        # a single observation moves each individual mastery state.
        base_posterior = estimator.estimate_observation(trace, normalized.is_correct)
        posterior = prior + (base_posterior - prior) * kp.weight
        trace.p_mastery = max(0.0, min(1.0, posterior))
        _apply_trace_to_state(state, trace)

        # Persist trace event
        trace_event = KnowledgeTraceEvent(
            id=str(uuid4()),
            user_id=user_id,
            knowledge_point_id=kp_id,
            source_event_id=source_event_id,
            event_type="quiz_answered",
            prior_mastery=prior,
            posterior_mastery=posterior,
            is_correct=normalized.is_correct,
            question_id=normalized.question_id,
            payload={
                **normalized.payload,
                "kt_weight": kp.weight,
                "resolved_knowledge_point_id": kp_id,
                "resolved_difficulty": kp.difficulty,
            },
        )
        session.add(trace_event)

        results.append({
            "knowledge_point_id": kp_id,
            "prior_mastery": prior,
            "posterior_mastery": posterior,
            "attempts": state.attempts,
            "correct_attempts": state.correct_attempts,
            "weight": kp.weight,
            "difficulty": kp.difficulty,
        })

    return results


def normalize_learning_event_for_kt(
    *,
    event_type: str,
    payload: dict | None,
    block_id: str | None,
    scene_id: str | None,
    knowledge_points: list[str] | None,
) -> tuple[dict[str, Any], list[str]]:
    """Normalize LearningEvent payload/knowledge_points before KT update."""
    raw_payload = payload or {}
    normalized_payload = dict(raw_payload)

    if event_type == "quiz_answered":
        normalized_attempt = normalize_question_attempt(
            question_id=(
                raw_payload.get("question_id")
                or raw_payload.get("questionId")
                or block_id
                or scene_id
            ),
            is_correct=bool(raw_payload.get("is_correct", raw_payload.get("isCorrect", False))),
            payload=raw_payload,
            event_knowledge_points=knowledge_points,
            block_id=block_id,
            scene_id=scene_id,
        )
        normalized_payload = normalized_attempt.payload
        normalized_points = normalized_attempt.knowledge_point_ids or (knowledge_points or [])
        return normalized_payload, normalized_points

    return normalized_payload, (knowledge_points or [])


def get_student_knowledge_states(
    session: Session,
    user_id: str,
    knowledge_point_ids: list[str] | None = None,
    min_mastery: float | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """List current BKT states for a student, optionally filtered."""
    query = session.query(StudentKnowledgeState).filter(
        StudentKnowledgeState.user_id == user_id
    )
    if knowledge_point_ids:
        query = query.filter(StudentKnowledgeState.knowledge_point_id.in_(knowledge_point_ids))
    if min_mastery is not None:
        query = query.filter(StudentKnowledgeState.p_mastery >= min_mastery)

    rows = query.order_by(StudentKnowledgeState.last_updated_at.desc()).limit(limit).all()
    return [serialize_knowledge_state(r) for r in rows]


def get_knowledge_state_for_point(
    session: Session,
    user_id: str,
    knowledge_point_id: str,
) -> dict[str, Any] | None:
    """Get a single knowledge-point state for a student."""
    state = (
        session.query(StudentKnowledgeState)
        .filter(
            StudentKnowledgeState.user_id == user_id,
            StudentKnowledgeState.knowledge_point_id == knowledge_point_id,
        )
        .first()
    )
    if not state:
        return None
    return serialize_knowledge_state(state)


def get_teaching_decisions(
    session: Session,
    user_id: str,
    knowledge_point_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Generate teaching decisions for a student's knowledge points."""
    states = get_student_knowledge_states(
        session, user_id, knowledge_point_ids=knowledge_point_ids, limit=500
    )

    estimator = KnowledgeTracingStateEstimator()
    decisions: list[dict[str, Any]] = []
    now = _utcnow()

    for st in states:
        trace = StudentKnowledgeTrace(
            user_id=st["user_id"],
            knowledge_point_id=st["knowledge_point_id"],
            p_mastery=st["p_mastery"],
            p_learn=st.get("p_learn", 0.15),
            p_guess=st.get("p_guess", 0.2),
            p_slip=st.get("p_slip", 0.1),
            p_forget=st.get("p_forget", 0.05),
            attempts=st.get("attempts", 0),
            correct_attempts=st.get("correct_attempts", 0),
        )

        days_since = None
        last_updated = st.get("last_updated_at")
        if last_updated:
            if isinstance(last_updated, str):
                last_updated = datetime.fromisoformat(last_updated)
            days_since = (now - last_updated).total_seconds() / 86400.0

        decision = estimator.decide(trace, days_since_last_review=days_since)
        decisions.append(serialize_teaching_decision(decision))

    # Sort by mastery ascending (weakest first)
    decisions.sort(key=lambda d: d["mastery"])
    return decisions


def get_teaching_decision_for_point(
    session: Session,
    user_id: str,
    knowledge_point_id: str,
) -> dict[str, Any] | None:
    """Generate a teaching decision for a single knowledge point."""
    st = get_knowledge_state_for_point(session, user_id, knowledge_point_id)
    if not st:
        return None

    trace = StudentKnowledgeTrace(
        user_id=st["user_id"],
        knowledge_point_id=st["knowledge_point_id"],
        p_mastery=st["p_mastery"],
        p_learn=st.get("p_learn", 0.15),
        p_guess=st.get("p_guess", 0.2),
        p_slip=st.get("p_slip", 0.1),
        p_forget=st.get("p_forget", 0.05),
        attempts=st.get("attempts", 0),
        correct_attempts=st.get("correct_attempts", 0),
    )

    now = _utcnow()
    days_since = None
    last_updated = st.get("last_updated_at")
    if last_updated:
        if isinstance(last_updated, str):
            last_updated = datetime.fromisoformat(last_updated)
        days_since = (now - last_updated).total_seconds() / 86400.0

    estimator = KnowledgeTracingStateEstimator()
    decision = estimator.decide(trace, days_since_last_review=days_since)
    return serialize_teaching_decision(decision)


def get_agent_kt_context(
    session: Session,
    user_id: str,
    knowledge_point_id: str,
    recent_limit: int = 5,
) -> str:
    """Build a prompt-ready KT context block for an agent."""
    st = get_knowledge_state_for_point(session, user_id, knowledge_point_id)
    if not st:
        return f"# Knowledge Tracing State\n学生对“{knowledge_point_id}”尚无追踪记录。"

    trace = StudentKnowledgeTrace(
        user_id=st["user_id"],
        knowledge_point_id=st["knowledge_point_id"],
        p_mastery=st["p_mastery"],
        p_learn=st.get("p_learn", 0.15),
        p_guess=st.get("p_guess", 0.2),
        p_slip=st.get("p_slip", 0.1),
        p_forget=st.get("p_forget", 0.05),
        attempts=st.get("attempts", 0),
        correct_attempts=st.get("correct_attempts", 0),
    )

    now = _utcnow()
    days_since = None
    last_updated = st.get("last_updated_at")
    if last_updated:
        if isinstance(last_updated, str):
            last_updated = datetime.fromisoformat(last_updated)
        days_since = (now - last_updated).total_seconds() / 86400.0

    estimator = KnowledgeTracingStateEstimator()
    decision = estimator.decide(trace, days_since_last_review=days_since)

    recent_events = (
        session.query(KnowledgeTraceEvent)
        .filter(
            KnowledgeTraceEvent.user_id == user_id,
            KnowledgeTraceEvent.knowledge_point_id == knowledge_point_id,
        )
        .order_by(KnowledgeTraceEvent.created_at.desc())
        .limit(recent_limit)
        .all()
    )
    recent = [
        {
            "is_correct": ev.is_correct,
            "posterior_mastery": ev.posterior_mastery,
            "created_at": ev.created_at.isoformat() if ev.created_at else None,
        }
        for ev in recent_events
    ]

    return estimator.build_agent_context(trace, decision, recent)


# ---------------------------------------------------------------------------
# Q-matrix CRUD
# ---------------------------------------------------------------------------

def set_question_knowledge_mapping(
    session: Session,
    question_id: str,
    knowledge_point_id: str,
    weight: float = 1.0,
    difficulty: str | None = None,
) -> QuestionKnowledgeMap:
    """Upsert a Q-matrix entry."""
    mapping = (
        session.query(QuestionKnowledgeMap)
        .filter(
            QuestionKnowledgeMap.question_id == question_id,
            QuestionKnowledgeMap.knowledge_point_id == knowledge_point_id,
        )
        .first()
    )
    if mapping:
        mapping.weight = weight
        if difficulty:
            mapping.difficulty = difficulty
        return mapping

    mapping = QuestionKnowledgeMap(
        question_id=question_id,
        knowledge_point_id=knowledge_point_id,
        weight=weight,
        difficulty=difficulty,
    )
    session.add(mapping)
    session.flush()
    return mapping


def get_question_knowledge_mappings(
    session: Session,
    question_id: str,
) -> list[dict[str, Any]]:
    """Get all knowledge-point mappings for a question."""
    rows = (
        session.query(QuestionKnowledgeMap)
        .filter(QuestionKnowledgeMap.question_id == question_id)
        .all()
    )
    return [
        {
            "question_id": r.question_id,
            "knowledge_point_id": r.knowledge_point_id,
            "weight": r.weight,
            "difficulty": r.difficulty,
        }
        for r in rows
    ]


def list_knowledge_points(
    session: Session,
    subject: str | None = None,
    parent_id: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """List knowledge points in the graph."""
    query = session.query(KnowledgePoint)
    if subject:
        query = query.filter(KnowledgePoint.subject == subject)
    if parent_id:
        query = query.filter(KnowledgePoint.parent_id == parent_id)
    rows = query.order_by(KnowledgePoint.name).limit(limit).all()
    return [
        {
            "id": r.id,
            "subject": r.subject,
            "name": r.name,
            "description": r.description,
            "parent_id": r.parent_id,
            "prerequisites": r.prerequisites or [],
            "difficulty": r.difficulty,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def upsert_knowledge_point(
    session: Session,
    kp_id: str,
    name: str,
    subject: str | None = None,
    description: str | None = None,
    parent_id: str | None = None,
    prerequisites: list[str] | None = None,
    difficulty: str | None = None,
) -> KnowledgePoint:
    """Upsert a knowledge point definition."""
    kp = session.get(KnowledgePoint, kp_id)
    if kp:
        kp.name = name
        if subject is not None:
            kp.subject = subject
        if description is not None:
            kp.description = description
        if parent_id is not None:
            kp.parent_id = parent_id
        if prerequisites is not None:
            kp.prerequisites = prerequisites
        if difficulty is not None:
            kp.difficulty = difficulty
        return kp

    kp = KnowledgePoint(
        id=kp_id,
        name=name,
        subject=subject,
        description=description,
        parent_id=parent_id,
        prerequisites=prerequisites or [],
        difficulty=difficulty,
    )
    session.add(kp)
    session.flush()
    return kp


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def serialize_knowledge_state(state: StudentKnowledgeState) -> dict[str, Any]:
    return {
        "user_id": state.user_id,
        "knowledge_point_id": state.knowledge_point_id,
        "p_mastery": state.p_mastery,
        "p_learn": state.p_learn,
        "p_guess": state.p_guess,
        "p_slip": state.p_slip,
        "p_forget": state.p_forget,
        "attempts": state.attempts,
        "correct_attempts": state.correct_attempts,
        "last_updated_at": state.last_updated_at.isoformat() if state.last_updated_at else None,
    }


def serialize_teaching_decision(decision: TeachingDecision) -> dict[str, Any]:
    return {
        "target_knowledge_point_id": decision.target_knowledge_point_id,
        "mastery": decision.mastery,
        "action": decision.action,
        "reason": decision.reason,
    }


def serialize_knowledge_trace_event(event: KnowledgeTraceEvent) -> dict[str, Any]:
    return {
        "trace_event_id": event.id,
        "user_id": event.user_id,
        "knowledge_point_id": event.knowledge_point_id,
        "source_event_id": event.source_event_id,
        "event_type": event.event_type,
        "prior_mastery": event.prior_mastery,
        "posterior_mastery": event.posterior_mastery,
        "is_correct": event.is_correct,
        "question_id": event.question_id,
        "payload": event.payload or {},
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


# ---------------------------------------------------------------------------
# Diagnostic Probe Generator
# ---------------------------------------------------------------------------

_PROBE_TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "default": [
        {
            "question": "请判断以下关于{knowledge_point}的说法是否正确，并简要说明理由。",
            "options": None,
            "correct_answer": "（由教师根据实际教学内容判定）",
            "explanation": "本题用于诊断学生对{knowledge_point}核心概念的理解程度。",
            "probe_type": "step_by_step",
        },
        {
            "question": "关于{knowledge_point}，下列说法正确的是？",
            "options": ["A. （示例选项1）", "B. （示例选项2）", "C. （示例选项3）", "D. （示例选项4）"],
            "correct_answer": "A",
            "explanation": "本题考查{knowledge_point}的基本定义与性质。",
            "probe_type": "choice",
        },
    ],
}


def _pick_template(knowledge_point_id: str, action: str) -> dict[str, Any]:
    """Pick a probe template based on knowledge point and teaching action."""
    templates = _PROBE_TEMPLATES.get(knowledge_point_id) or _PROBE_TEMPLATES["default"]
    # For reteach / worked_example, prefer step_by_step; for variant_practice, prefer choice
    if action in ("reteach", "worked_example", "give_hint"):
        candidates = [t for t in templates if t.get("probe_type") == "step_by_step"]
    elif action == "variant_practice":
        candidates = [t for t in templates if t.get("probe_type") == "choice"]
    else:
        candidates = templates
    if not candidates:
        candidates = templates
    return candidates[hash(knowledge_point_id + action) % len(candidates)]


def generate_diagnostic_probe(
    session: Session,
    user_id: str,
    knowledge_point_id: str | None = None,
    difficulty: str | None = None,
    probe_type: str | None = None,
) -> dict[str, Any]:
    """Generate a diagnostic probe based on the student's weakest knowledge point.

    If knowledge_point_id is not provided, picks the weakest one automatically.
    """
    from uuid import uuid4

    # Resolve target knowledge point
    if not knowledge_point_id:
        states = get_student_knowledge_states(session, user_id, limit=1)
        if not states:
            raise ValueError("No knowledge tracing state found for this student")
        knowledge_point_id = states[0]["knowledge_point_id"]

    # Get teaching decision for this knowledge point
    decision = get_teaching_decision_for_point(session, user_id, knowledge_point_id)
    if not decision:
        raise ValueError(f"No teaching decision found for knowledge point {knowledge_point_id}")

    # Get knowledge point name
    kp = session.query(KnowledgePoint).filter(KnowledgePoint.id == knowledge_point_id).first()
    kp_name = kp.name if kp else knowledge_point_id

    # Pick template
    template = _pick_template(knowledge_point_id, decision["action"])

    # Determine effective difficulty
    effective_difficulty = difficulty or (kp.difficulty if kp else "medium")
    effective_probe_type = probe_type or template.get("probe_type", "choice")

    # Build hints based on action
    hints: list[str] = []
    if decision["action"] == "reteach":
        hints.append(f"回顾{kp_name}的核心定义。")
        hints.append("尝试从最简单的例子入手。")
    elif decision["action"] == "give_hint":
        hints.append(f"思考{kp_name}与已学知识之间的联系。")
        hints.append("注意题目中的关键条件。")
    elif decision["action"] == "worked_example":
        hints.append("先观察给出的示例步骤，再独立尝试。")
        hints.append("每一步操作的原因是什么？")
    elif decision["action"] == "variant_practice":
        hints.append("这道题是之前练习的变式，注意条件和问法的变化。")

    question_text = template["question"].format(knowledge_point=kp_name)
    explanation_text = template["explanation"].format(knowledge_point=kp_name)

    return {
        "probe_id": f"probe-{uuid4().hex[:12]}",
        "knowledge_point_id": knowledge_point_id,
        "question": question_text,
        "options": template.get("options"),
        "correct_answer": template["correct_answer"].format(knowledge_point=kp_name),
        "explanation": explanation_text,
        "difficulty": effective_difficulty,
        "probe_type": effective_probe_type,
        "hints": hints,
        "teaching_action": decision["action"],
        "reason": decision["reason"],
    }
