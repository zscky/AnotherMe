"""
Trace Events - Process event trace visualization.

Instead of only showing progress/step, this exposes internal workflow steps
as frontend-readable trace events. For problem video workflow, this shows:
- What knowledge points were identified
- What weaknesses were discovered
- What Manim errors were fixed

For course generation, this shows:
- Research phase results
- Outline generation details
- Scene generation progress per scene
- Quality gate results
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from datetime import datetime
import uuid


VALID_TRACE_EVENT_TYPES = {
    "workflow_started",
    "workflow_step_started",
    "workflow_step_completed",
    "workflow_step_failed",
    "workflow_completed",
    "knowledge_identified",
    "weakness_discovered",
    "manim_error_fixed",
    "tts_generated",
    "video_rendered",
    "quality_gate_passed",
    "quality_gate_failed",
    "retry_attempted",
    "artifact_uploaded",
    "learner_profile_loaded",
    "adaptive_plan_generated",
}


@dataclass
class TraceEvent:
    """
    A trace event that exposes internal workflow steps for frontend visualization.
    
    Instead of just showing progress/step, trace events provide rich information
    about what happened during each step: knowledge points identified, weaknesses
    discovered, errors fixed, etc.
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    type: str = ""
    timestamp: Optional[datetime] = None
    job_id: str = ""
    step: str = ""
    duration_ms: Optional[int] = None
    status: str = "running"
    payload: Dict[str, Any] = field(default_factory=dict)
    message: str = ""
    severity: str = "info"

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "id": self.id,
            "type": self.type,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "job_id": self.job_id,
            "step": self.step,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "payload": self.payload,
            "message": self.message,
            "severity": self.severity,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TraceEvent":
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
            timestamp=timestamp,
            job_id=data.get("job_id", ""),
            step=data.get("step", ""),
            duration_ms=data.get("duration_ms"),
            status=data.get("status", "running"),
            payload=data.get("payload", {}),
            message=data.get("message", ""),
            severity=data.get("severity", "info"),
        )


class TraceEventEmitter:
    """
    Emits trace events for workflow visualization.
    
    This bridges the gap between backend workflow execution and frontend
    progress visualization, providing rich step-level details.
    """

    def __init__(self, job_id: str):
        self.job_id = job_id
        self.events: List[TraceEvent] = []
        self._step_start_times: Dict[str, datetime] = {}

    def emit(self, event: TraceEvent) -> TraceEvent:
        """Emit a trace event."""
        if not event.job_id:
            event.job_id = self.job_id
        if event.timestamp is None:
            event.timestamp = datetime.utcnow()
        
        self.events.append(event)
        return event

    def emit_workflow_started(self, total_steps: int = 0, message: str = "") -> TraceEvent:
        """Emit a workflow started trace event."""
        return self.emit(TraceEvent(
            type="workflow_started",
            step="workflow",
            status="running",
            message=message or "Workflow started",
            severity="info",
            payload={
                "type": "workflow_started",
                "total_steps": total_steps,
            },
        ))

    def emit_workflow_completed(self, message: str = "", payload: Optional[Dict[str, Any]] = None) -> TraceEvent:
        """Emit a workflow completed trace event."""
        return self.emit(TraceEvent(
            type="workflow_completed",
            step="workflow",
            status="completed",
            message=message or "Workflow completed",
            severity="success",
            payload=payload or {},
        ))

    def start_step(self, step: str, message: str = "") -> TraceEvent:
        """Mark the start of a workflow step."""
        self._step_start_times[step] = datetime.utcnow()
        
        return self.emit(TraceEvent(
            type="workflow_step_started",
            step=step,
            status="running",
            message=message or f"Step '{step}' started",
            severity="info",
        ))

    def complete_step(
        self,
        step: str,
        message: str = "",
        payload: Optional[Dict[str, Any]] = None,
    ) -> TraceEvent:
        """Mark a workflow step as completed."""
        duration_ms = None
        if step in self._step_start_times:
            delta = datetime.utcnow() - self._step_start_times[step]
            duration_ms = int(delta.total_seconds() * 1000)
            del self._step_start_times[step]
        
        return self.emit(TraceEvent(
            type="workflow_step_completed",
            step=step,
            status="completed",
            duration_ms=duration_ms,
            message=message or f"Step '{step}' completed",
            severity="success",
            payload=payload or {},
        ))

    def fail_step(
        self,
        step: str,
        error_message: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> TraceEvent:
        """Mark a workflow step as failed."""
        duration_ms = None
        if step in self._step_start_times:
            delta = datetime.utcnow() - self._step_start_times[step]
            duration_ms = int(delta.total_seconds() * 1000)
            del self._step_start_times[step]
        
        return self.emit(TraceEvent(
            type="workflow_step_failed",
            step=step,
            status="failed",
            duration_ms=duration_ms,
            message=error_message,
            severity="error",
            payload=payload or {},
        ))

    def emit_knowledge_identified(
        self,
        step: str,
        knowledge_points: List[str],
        confidence: float,
        source: str = "vision",
    ) -> TraceEvent:
        """Emit a knowledge identified trace event."""
        return self.emit(TraceEvent(
            type="knowledge_identified",
            step=step,
            status="completed",
            message=f"Identified {len(knowledge_points)} knowledge point(s): {', '.join(knowledge_points)}",
            severity="success",
            payload={
                "type": "knowledge_identified",
                "knowledge_points": knowledge_points,
                "confidence": confidence,
                "source": source,
            },
        ))

    def emit_weakness_discovered(
        self,
        step: str,
        knowledge_point: str,
        mastery_score: float,
        common_mistakes: List[str],
        suggested_remediation: str,
    ) -> TraceEvent:
        """Emit a weakness discovered trace event."""
        return self.emit(TraceEvent(
            type="weakness_discovered",
            step=step,
            status="completed",
            message=f'Discovered weakness in "{knowledge_point}" (mastery: {round(mastery_score * 100)}%)',
            severity="warning",
            payload={
                "type": "weakness_discovered",
                "knowledge_point": knowledge_point,
                "mastery_score": mastery_score,
                "common_mistakes": common_mistakes,
                "suggested_remediation": suggested_remediation,
            },
        ))

    def emit_manim_error_fixed(
        self,
        step: str,
        error_type: str,
        error_message: str,
        fix_applied: str,
        retry_count: int,
    ) -> TraceEvent:
        """Emit a Manim error fixed trace event."""
        return self.emit(TraceEvent(
            type="manim_error_fixed",
            step=step,
            status="completed",
            message=f"Fixed Manim error: {error_type} ({retry_count} retries)",
            severity="warning",
            payload={
                "type": "manim_error_fixed",
                "error_type": error_type,
                "error_message": error_message,
                "fix_applied": fix_applied,
                "retry_count": retry_count,
            },
        ))

    def emit_learner_profile_loaded(
        self,
        step: str,
        user_id: str,
        weak_subjects: List[str],
        weak_knowledge_points: List[str],
        ability_scores: List[Dict[str, Any]],
    ) -> TraceEvent:
        """Emit a learner profile loaded trace event."""
        return self.emit(TraceEvent(
            type="learner_profile_loaded",
            step=step,
            status="completed",
            message=f"Loaded learner profile for user {user_id}",
            severity="info",
            payload={
                "type": "learner_profile_loaded",
                "user_id": user_id,
                "weak_subjects": weak_subjects,
                "weak_knowledge_points": weak_knowledge_points,
                "ability_scores": ability_scores,
            },
        ))

    def emit_adaptive_plan(
        self,
        step: str,
        mode: str,
        weak_knowledge_points: List[str],
        tts_profile: Dict[str, str],
        visual_profile: Dict[str, Any],
    ) -> TraceEvent:
        """Emit an adaptive plan trace event."""
        return self.emit(TraceEvent(
            type="adaptive_plan_generated",
            step=step,
            status="completed",
            message=f"Generated adaptive plan: mode={mode}",
            severity="info",
            payload={
                "type": "adaptive_plan",
                "mode": mode,
                "weak_knowledge_points": weak_knowledge_points,
                "tts_profile": tts_profile,
                "visual_profile": visual_profile,
            },
        ))

    def emit_retry_attempted(
        self,
        step: str,
        attempt_number: int,
        max_attempts: int,
        reason: str,
    ) -> TraceEvent:
        """Emit a retry attempted trace event."""
        return self.emit(TraceEvent(
            type="retry_attempted",
            step=step,
            status="running",
            message=f"Retry attempt {attempt_number}/{max_attempts}: {reason}",
            severity="warning",
            payload={
                "type": "retry_attempted",
                "step_name": step,
                "attempt_number": attempt_number,
                "max_attempts": max_attempts,
                "reason": reason,
            },
        ))

    def get_events_by_step(self, step: str) -> List[TraceEvent]:
        """Get all events for a specific step."""
        return [e for e in self.events if e.step == step]

    def get_events_by_type(self, event_type: str) -> List[TraceEvent]:
        """Get all events of a specific type."""
        return [e for e in self.events if e.type == event_type]

    def get_knowledge_summary(self) -> Dict[str, Any]:
        """Get a summary of knowledge points and weaknesses from traces."""
        identified = set()
        weaknesses = []
        errors_fixed = 0
        
        for event in self.events:
            if event.type == "knowledge_identified":
                for kp in event.payload.get("knowledge_points", []):
                    identified.add(kp)
            elif event.type == "weakness_discovered":
                weaknesses.append({
                    "point": event.payload.get("knowledge_point", ""),
                    "mastery": event.payload.get("mastery_score", 0),
                })
            elif event.type == "manim_error_fixed":
                errors_fixed += 1
        
        return {
            "identified": sorted(identified),
            "weaknesses": weaknesses,
            "errors_fixed": errors_fixed,
        }

    def get_workflow_status(self) -> Dict[str, Any]:
        """Get the current workflow status from traces."""
        if not self.events:
            return {
                "status": "not_started",
                "current_step": None,
                "progress": 0,
                "total_steps": 0,
                "completed_steps": 0,
            }
        
        started_event = next(
            (e for e in self.events if e.type == "workflow_started"),
            None,
        )
        total_steps = started_event.payload.get("total_steps", 0) if started_event else 0
        
        completed_steps = sum(
            1 for e in self.events
            if e.status == "completed" and e.type == "workflow_step_completed"
        )
        
        has_completed = any(e.type == "workflow_completed" for e in self.events)
        has_failed = any(
            e.type == "workflow_step_failed" and e.severity == "error"
            for e in self.events
        )
        
        last_running = next(
            (e for e in reversed(self.events) if e.status == "running"),
            None,
        )
        
        progress = round((completed_steps / total_steps * 100)) if total_steps > 0 else 0
        
        return {
            "status": "completed" if has_completed else ("failed" if has_failed else "running"),
            "current_step": last_running.step if last_running else None,
            "progress": progress,
            "total_steps": total_steps,
            "completed_steps": completed_steps,
        }

    def to_event_list(self) -> List[Dict[str, Any]]:
        """Convert all events to dictionary list."""
        return [e.to_dict() for e in self.events]
