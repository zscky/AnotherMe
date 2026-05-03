"""
LearningEvent - Unified learning event stream.

Instead of only extracting learning profiles from chat text, this defines a
structured event system that captures all learning behaviors:
- quiz_answered, hint_used, video_generated, video_watched
- notebook_saved, asked_question, feedback_dislike
- problem_solved, confusion_detected

These events feed directly into LearnerModelingAgent for mastery updates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime
import uuid
import math
import time


VALID_EVENT_TYPES = {
    "quiz_answered",
    "hint_used",
    "video_generated",
    "video_watched",
    "notebook_saved",
    "asked_question",
    "feedback_dislike",
    "feedback_like",
    "problem_solved",
    "confusion_detected",
    "scene_completed",
    "scene_retried",
    "block_started",
    "time_spent",
    "knowledge_point_mastered",
    "knowledge_point_struggled",
}


@dataclass
class LearningEvent:
    """
    A structured learning event that captures student behavior.
    
    Events are the primary input to LearnerModelingAgent for mastery updates,
    replacing the previous approach of only extracting from chat text.
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    type: str = ""
    user_id: str = ""
    timestamp: Optional[datetime] = None
    classroom_id: Optional[str] = None
    scene_id: Optional[str] = None
    block_id: Optional[str] = None
    knowledge_points: List[str] = field(default_factory=list)
    subject: Optional[str] = None
    payload: Dict[str, Any] = field(default_factory=dict)
    weight: float = 1.0
    source: str = "user_action"

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "id": self.id,
            "type": self.type,
            "user_id": self.user_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "classroom_id": self.classroom_id,
            "scene_id": self.scene_id,
            "block_id": self.block_id,
            "knowledge_points": self.knowledge_points,
            "subject": self.subject,
            "payload": self.payload,
            "weight": self.weight,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LearningEvent":
        """Deserialize from dictionary."""
        timestamp = None
        if data.get("timestamp"):
            try:
                timestamp = datetime.fromisoformat(data["timestamp"])
            except (ValueError, TypeError):
                pass
        
        return cls(
            id=data.get("id", str(uuid.uuid4())[:12]),
            type=data.get("type", ""),
            user_id=data.get("user_id", ""),
            timestamp=timestamp,
            classroom_id=data.get("classroom_id"),
            scene_id=data.get("scene_id"),
            block_id=data.get("block_id"),
            knowledge_points=data.get("knowledge_points", []),
            subject=data.get("subject"),
            payload=data.get("payload", {}),
            weight=data.get("weight", 1.0),
            source=data.get("source", "user_action"),
        )


@dataclass
class QuizAnsweredPayload:
    """Payload for quiz_answered events."""
    question_id: str
    selected_answers: List[str]
    correct_answers: List[str]
    is_correct: bool
    time_spent_ms: int
    attempt_number: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "question_id": self.question_id,
            "selected_answers": self.selected_answers,
            "correct_answers": self.correct_answers,
            "is_correct": self.is_correct,
            "time_spent_ms": self.time_spent_ms,
            "attempt_number": self.attempt_number,
        }


@dataclass
class ConfusionDetectedPayload:
    """Payload for confusion_detected events."""
    detection_method: str
    context: str
    confidence_score: float
    suggested_remediation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "detection_method": self.detection_method,
            "context": self.context,
            "confidence_score": self.confidence_score,
            "suggested_remediation": self.suggested_remediation,
        }


@dataclass
class VideoWatchedPayload:
    """Payload for video_watched events."""
    video_job_id: str
    watch_duration_seconds: float
    total_duration_seconds: float
    completion_rate: float
    paused_at: List[float] = field(default_factory=list)
    replayed_at: List[float] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "video_job_id": self.video_job_id,
            "watch_duration_seconds": self.watch_duration_seconds,
            "total_duration_seconds": self.total_duration_seconds,
            "completion_rate": self.completion_rate,
            "paused_at": self.paused_at,
            "replayed_at": self.replayed_at,
        }


@dataclass
class ProblemSolvedPayload:
    """Payload for problem_solved events."""
    problem_id: str
    solution_method: Optional[str] = None
    time_spent_ms: int = 0
    attempts_count: int = 1
    hints_used_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "problem_id": self.problem_id,
            "solution_method": self.solution_method,
            "time_spent_ms": self.time_spent_ms,
            "attempts_count": self.attempts_count,
            "hints_used_count": self.hints_used_count,
        }


class LearningEventEmitter:
    """
    Emits and stores learning events for mastery calculation.
    
    This replaces the previous approach where learning profiles were only
    extracted from chat text. Now all structured behaviors (quiz answers,
    video watching, hint usage, etc.) feed into the learner model.
    """

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.events: List[LearningEvent] = []
        self._listeners: Dict[str, List[Callable]] = {}

    def emit(self, event: LearningEvent) -> LearningEvent:
        """Emit a learning event and notify listeners."""
        if event.user_id != self.user_id:
            event.user_id = self.user_id
        if event.timestamp is None:
            event.timestamp = datetime.utcnow()
        
        self.events.append(event)
        
        for listener in self._listeners.get(event.type, []):
            try:
                listener(event)
            except Exception:
                pass
        
        return event

    def on(self, event_type: str, callback: Callable[[LearningEvent], None]) -> None:
        """Register a listener for a specific event type."""
        if event_type not in self._listeners:
            self._listeners[event_type] = []
        self._listeners[event_type].append(callback)

    def emit_quiz_answered(
        self,
        question_id: str,
        selected_answers: List[str],
        correct_answers: List[str],
        knowledge_points: List[str],
        time_spent_ms: int,
        attempt_number: int,
        classroom_id: Optional[str] = None,
        scene_id: Optional[str] = None,
        block_id: Optional[str] = None,
    ) -> LearningEvent:
        """Emit a quiz answered event."""
        is_correct = sorted(selected_answers) == sorted(correct_answers)
        
        return self.emit(LearningEvent(
            type="quiz_answered",
            knowledge_points=knowledge_points,
            payload=QuizAnsweredPayload(
                question_id=question_id,
                selected_answers=selected_answers,
                correct_answers=correct_answers,
                is_correct=is_correct,
                time_spent_ms=time_spent_ms,
                attempt_number=attempt_number,
            ).to_dict(),
            weight=1.2 if attempt_number == 1 else 0.8,
            classroom_id=classroom_id,
            scene_id=scene_id,
            block_id=block_id,
        ))

    def emit_confusion_detected(
        self,
        context: str,
        knowledge_points: List[str],
        detection_method: str = "explicit",
        confidence_score: float = 0.8,
        classroom_id: Optional[str] = None,
        scene_id: Optional[str] = None,
    ) -> LearningEvent:
        """Emit a confusion detected event."""
        return self.emit(LearningEvent(
            type="confusion_detected",
            knowledge_points=knowledge_points,
            payload=ConfusionDetectedPayload(
                detection_method=detection_method,
                context=context,
                confidence_score=confidence_score,
            ).to_dict(),
            weight=1.5 if detection_method == "explicit" else 1.0,
            source="ai_inferred" if detection_method == "ai_inferred" else "user_action",
            classroom_id=classroom_id,
            scene_id=scene_id,
        ))

    def emit_video_watched(
        self,
        video_job_id: str,
        watch_duration_seconds: float,
        total_duration_seconds: float,
        knowledge_points: List[str],
        paused_at: Optional[List[float]] = None,
        replayed_at: Optional[List[float]] = None,
    ) -> LearningEvent:
        """Emit a video watched event."""
        completion_rate = watch_duration_seconds / total_duration_seconds if total_duration_seconds > 0 else 0
        
        weight = 1.2 if completion_rate >= 0.9 else (0.8 if completion_rate >= 0.5 else 0.5)
        
        return self.emit(LearningEvent(
            type="video_watched",
            knowledge_points=knowledge_points,
            payload=VideoWatchedPayload(
                video_job_id=video_job_id,
                watch_duration_seconds=watch_duration_seconds,
                total_duration_seconds=total_duration_seconds,
                completion_rate=completion_rate,
                paused_at=paused_at or [],
                replayed_at=replayed_at or [],
            ).to_dict(),
            weight=weight,
        ))

    def emit_problem_solved(
        self,
        problem_id: str,
        knowledge_points: List[str],
        time_spent_ms: int = 0,
        attempts_count: int = 1,
        hints_used_count: int = 0,
        solution_method: Optional[str] = None,
    ) -> LearningEvent:
        """Emit a problem solved event."""
        return self.emit(LearningEvent(
            type="problem_solved",
            knowledge_points=knowledge_points,
            payload=ProblemSolvedPayload(
                problem_id=problem_id,
                solution_method=solution_method,
                time_spent_ms=time_spent_ms,
                attempts_count=attempts_count,
                hints_used_count=hints_used_count,
            ).to_dict(),
            weight=1.2 if attempts_count <= 1 else 0.8,
        ))

    def emit_hint_used(
        self,
        knowledge_points: List[str],
        hint_id: str,
        hint_content: str,
        question_id: Optional[str] = None,
    ) -> LearningEvent:
        """Emit a hint used event."""
        return self.emit(LearningEvent(
            type="hint_used",
            knowledge_points=knowledge_points,
            payload={
                "hint_id": hint_id,
                "hint_content": hint_content,
                "question_id": question_id,
            },
            weight=0.8,
        ))

    def get_events_by_type(self, event_type: str) -> List[LearningEvent]:
        """Get all events of a specific type."""
        return [e for e in self.events if e.type == event_type]

    def get_events_by_knowledge_point(self, knowledge_point: str) -> List[LearningEvent]:
        """Get all events related to a specific knowledge point."""
        return [e for e in self.events if knowledge_point in e.knowledge_points]

    def get_events_in_range(self, start_time: datetime, end_time: datetime) -> List[LearningEvent]:
        """Get events within a time range."""
        return [
            e for e in self.events
            if e.timestamp and start_time <= e.timestamp <= end_time
        ]

    def calculate_knowledge_point_mastery(
        self,
        knowledge_point: str,
        now: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """
        Calculate mastery score for a knowledge point from events.
        
        Uses time-decayed event weights similar to LearnerModelingAgent's
        _apply_learning_events method.
        """
        if now is None:
            now = datetime.utcnow()
        
        relevant_events = [
            e for e in self.events
            if knowledge_point in e.knowledge_points
        ]
        
        if not relevant_events:
            return {"mastery": 0.5, "event_count": 0, "last_event_timestamp": None}
        
        score = 0.5
        
        event_deltas = {
            "correct": 0.18,
            "quick_correct": 0.24,
            "wrong": -0.22,
            "not_understood": -0.28,
            "voice_confused": -0.2,
            "hint_used": -0.08,
        }
        
        for event in relevant_events:
            age_days = max(0.0, (now - event.timestamp).total_seconds() / 86400.0)
            time_weight = math.exp(-age_days / 35.0)
            event_weight = event.weight * time_weight
            
            event_type = event.type
            payload = event.payload
            
            if event_type == "quiz_answered":
                is_correct = payload.get("is_correct", False)
                delta = event_deltas.get("correct" if is_correct else "wrong", 0)
                if delta >= 0:
                    score = score + (1 - score) * delta * event_weight
                else:
                    score = score * (1 + delta * event_weight)
            
            elif event_type == "confusion_detected":
                confidence = payload.get("confidence_score", 0.8)
                score *= (1 - 0.28 * confidence * event_weight)
            
            elif event_type == "problem_solved":
                attempts = payload.get("attempts_count", 1)
                delta = 0.24 if attempts <= 1 else 0.15
                score = score + (1 - score) * delta * event_weight
            
            elif event_type == "hint_used":
                score *= (1 - 0.08 * event_weight)
            
            elif event_type == "video_watched":
                completion_rate = payload.get("completion_rate", 0)
                if completion_rate >= 0.9:
                    score = score + (1 - score) * 0.1 * event_weight
            
            score = max(0.0, min(1.0, score))
        
        return {
            "mastery": round(score, 4),
            "event_count": len(relevant_events),
            "last_event_timestamp": relevant_events[-1].timestamp.isoformat() if relevant_events[-1].timestamp else None,
        }

    def to_event_list_for_agent(self) -> List[Dict[str, Any]]:
        """
        Convert events to the format expected by LearnerModelingAgent.
        
        This bridges the event stream with the existing learner modeling pipeline.
        """
        result = []
        for event in self.events:
            if event.type in ("quiz_answered",):
                payload = event.payload
                is_correct = payload.get("is_correct", False)
                event_type = "correct" if is_correct else "wrong"
                
                if is_correct and payload.get("time_spent_ms", 0) < 30000:
                    event_type = "quick_correct"
                
                result.append({
                    "type": event_type,
                    "knowledge_points": event.knowledge_points,
                    "weight": event.weight,
                })
            
            elif event.type == "confusion_detected":
                result.append({
                    "type": "not_understood",
                    "knowledge_points": event.knowledge_points,
                    "weight": event.weight * event.payload.get("confidence_score", 0.8),
                })
            
            elif event.type == "hint_used":
                result.append({
                    "type": "hint_used",
                    "knowledge_points": event.knowledge_points,
                    "weight": event.weight,
                })
        
        return result
