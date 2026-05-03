"""Bayesian Knowledge Tracing (BKT) core models and teaching policy engine.

This module is intentionally free of database dependencies so it can be
unit-tested and eventually swapped for neural KT (DKT/SAKT/AKT) without
touching the service layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class BKTParameters:
    """BKT parameters for a single knowledge point.

    Defaults are calibrated for middle-school math cold-start.
    They should be refined per-subject as data accumulates.
    """

    p_init: float = 0.3      # initial probability of mastery
    p_learn: float = 0.15    # probability of learning after an opportunity
    p_guess: float = 0.2     # probability of guessing correctly when not mastered
    p_slip: float = 0.1      # probability of slipping when mastered
    p_forget: float = 0.05   # probability of forgetting between opportunities

    def __post_init__(self):
        for name, val in [
            ("p_init", self.p_init),
            ("p_learn", self.p_learn),
            ("p_guess", self.p_guess),
            ("p_slip", self.p_slip),
            ("p_forget", self.p_forget),
        ]:
            if not (0.0 <= val <= 1.0):
                raise ValueError(f"{name} must be in [0, 1], got {val}")


@dataclass
class StudentKnowledgeTrace:
    """Current BKT trace for one (student, knowledge_point) pair."""

    user_id: str
    knowledge_point_id: str
    p_mastery: float = 0.3
    p_learn: float = 0.15
    p_guess: float = 0.2
    p_slip: float = 0.1
    p_forget: float = 0.05
    attempts: int = 0
    correct_attempts: int = 0

    def update(self, is_correct: bool) -> float:
        """Run one BKT observation update + learning/forgetting transition.

        Returns the posterior mastery probability after the transition.

        Standard BKT four-parameter update with forgetting:
          1. Observation update (Bayes)
          2. Temporal transition: P(L_{n+1}) = P(L|obs)*(1-forget) + (1-P(L|obs))*learn
        """
        p = self.p_mastery
        slip = self.p_slip
        guess = self.p_guess
        learn = self.p_learn
        forget = self.p_forget

        if is_correct:
            # P(L | correct) = P(L) * (1 - slip) / [P(L)*(1-slip) + (1-P(L))*guess]
            numerator = p * (1.0 - slip)
            denominator = numerator + (1.0 - p) * guess
        else:
            # P(L | wrong) = P(L) * slip / [P(L)*slip + (1-P(L))*(1-guess)]
            numerator = p * slip
            denominator = numerator + (1.0 - p) * (1.0 - guess)

        if denominator == 0.0:
            posterior = p
        else:
            posterior = numerator / denominator

        # Learning + forgetting transition (standard BKT):
        # P(L_{n+1}) = P(L|obs) * (1 - forget) + (1 - P(L|obs)) * learn
        self.p_mastery = posterior * (1.0 - forget) + (1.0 - posterior) * learn
        self.attempts += 1
        if is_correct:
            self.correct_attempts += 1
        return self.p_mastery


@dataclass
class QuestionKnowledgeMapping:
    """One row of the Q-matrix: a question maps to N knowledge points."""

    question_id: str
    knowledge_point_ids: list[str] = field(default_factory=list)
    weights: dict[str, float] = field(default_factory=dict)
    difficulty: Literal["easy", "medium", "hard"] | None = None

    def weight_for(self, kp_id: str) -> float:
        return self.weights.get(kp_id, 1.0)


@dataclass
class TeachingDecision:
    """Explicit teaching policy output derived from KT state."""

    target_knowledge_point_id: str
    mastery: float
    action: Literal[
        "reteach",
        "give_hint",
        "worked_example",
        "variant_practice",
        "advance",
        "review_later",
    ]
    reason: str


class TeachingPolicyEngine:
    """Rule-based teaching policy driven by mastery thresholds.

    These thresholds are conservative defaults for middle-school math.
    """

    THRESHOLDS = {
        "reteach": 0.35,
        "give_hint": 0.35,
        "worked_example": 0.35,
        "variant_practice": 0.65,
        "advance": 0.85,
    }

    REVIEW_DAYS = 14  # days after which we suggest review even if mastery is high

    def decide(
        self,
        trace: StudentKnowledgeTrace,
        days_since_last_review: float | None = None,
    ) -> TeachingDecision:
        """Generate a teaching decision from a single knowledge-point trace."""

        p = trace.p_mastery
        kp_id = trace.knowledge_point_id

        # Long-term review rule overrides everything
        if days_since_last_review is not None and days_since_last_review >= self.REVIEW_DAYS:
            if p >= self.THRESHOLDS["advance"]:
                return TeachingDecision(
                    target_knowledge_point_id=kp_id,
                    mastery=p,
                    action="review_later",
                    reason=f"掌握概率 {p:.2f} 已达标，但已 {days_since_last_review:.0f} 天未复习，建议间隔复习",
                )

        if p < self.THRESHOLDS["reteach"]:
            return TeachingDecision(
                target_knowledge_point_id=kp_id,
                mastery=p,
                action="reteach",
                reason=f"掌握概率 {p:.2f} < 0.35，基础薄弱，需要重新讲解并给出 worked example",
            )

        if p < self.THRESHOLDS["variant_practice"]:
            # Distinguish between hint vs worked_example based on attempt history
            if trace.attempts >= 2 and trace.correct_attempts == 0:
                return TeachingDecision(
                    target_knowledge_point_id=kp_id,
                    mastery=p,
                    action="worked_example",
                    reason=f"掌握概率 {p:.2f}，已尝试 {trace.attempts} 次仍未做对，需要分步示范",
                )
            return TeachingDecision(
                target_knowledge_point_id=kp_id,
                mastery=p,
                action="give_hint",
                reason=f"掌握概率 {p:.2f}，需要提示 + 分步练习",
            )

        if p < self.THRESHOLDS["advance"]:
            return TeachingDecision(
                target_knowledge_point_id=kp_id,
                mastery=p,
                action="variant_practice",
                reason=f"掌握概率 {p:.2f}，需变式练习巩固",
            )

        return TeachingDecision(
            target_knowledge_point_id=kp_id,
            mastery=p,
            action="advance",
            reason=f"掌握概率 {p:.2f} >= 0.85，可以进入下一知识点",
        )


class KnowledgeTracingStateEstimator:
    """High-level facade: Q-matrix lookup + BKT update + policy decision."""

    def __init__(self, policy: TeachingPolicyEngine | None = None):
        self.policy = policy or TeachingPolicyEngine()

    def estimate_observation(
        self,
        trace: StudentKnowledgeTrace,
        is_correct: bool,
    ) -> float:
        """Run a single observation through BKT and return posterior mastery."""
        return trace.update(is_correct)

    def decide(
        self,
        trace: StudentKnowledgeTrace,
        days_since_last_review: float | None = None,
    ) -> TeachingDecision:
        """Generate teaching decision from current trace."""
        return self.policy.decide(trace, days_since_last_review)

    def build_agent_context(
        self,
        trace: StudentKnowledgeTrace,
        decision: TeachingDecision,
        recent_events: list[dict] | None = None,
    ) -> str:
        """Build a prompt-friendly knowledge tracing context block.

        This is the bridge between the KT estimator and the LLM agent.
        """
        lines = [
            f"# Knowledge Tracing State",
            f"学生对“{trace.knowledge_point_id}”的掌握概率为 {trace.p_mastery:.2f}，",
            f"最近相关题目尝试 {trace.attempts} 次，做对 {trace.correct_attempts} 次。",
            "",
            f"# Teaching Decision",
            f"当前策略：{decision.action}。",
            f"原因：{decision.reason}",
        ]

        if recent_events:
            lines.append("")
            lines.append("# Recent Trace Events")
            for ev in recent_events[:5]:
                correct_label = "对" if ev.get("is_correct") else "错"
                lines.append(
                    f"- {ev.get('created_at', 'recent')}: {correct_label} "
                    f"(掌握概率 {ev.get('posterior_mastery', '?'):.2f})"
                )

        return "\n".join(lines)
