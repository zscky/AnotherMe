"""
LearningContext - Unified learning context inspired by DeepTutor's UnifiedContext.

Provides a single source of truth for learning state across all features:
course generation, classroom Q&A, problem video, review planning, and chat.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from datetime import datetime


@dataclass
class NotebookRef:
    """Reference to a saved notebook entry."""
    id: str
    title: str
    source_scene_id: Optional[str] = None
    source_classroom_id: Optional[str] = None
    saved_at: Optional[datetime] = None
    content_type: str = "knowledge_card"


@dataclass
class AbilityScore:
    """Student ability score with metric."""
    metric: str
    value: float
    full_mark: float = 100.0


@dataclass
class LearningStatsSummary:
    """Summary of learning statistics."""
    records_total: int = 0
    records_14d: int = 0
    active_days_14: int = 0
    confusion_records: int = 0
    solved_records: int = 0
    top_subjects: List[str] = field(default_factory=list)
    top_knowledge_points: List[str] = field(default_factory=list)


@dataclass
class StudentProfileSnapshot:
    """Snapshot of student learning profile."""
    weak_subjects: List[str] = field(default_factory=list)
    weak_knowledge_points: List[str] = field(default_factory=list)
    ability_scores: List[AbilityScore] = field(default_factory=list)
    recent_focus: Optional[str] = None
    learning_stats: LearningStatsSummary = field(default_factory=LearningStatsSummary)
    snapshot_at: Optional[datetime] = None


@dataclass
class EnabledTool:
    """Tool configuration for a learning session."""
    id: str
    enabled: bool = True
    config: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LearningContextMetadata:
    """Metadata about how this context was created."""
    source: str = "chat"
    topic: Optional[str] = None
    language: str = "zh-CN"
    grade: Optional[int] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LearningContext:
    """
    Unified learning context that bridges all learning features.
    
    Instead of having separate context chains for:
    - classroom-generation (classroom-generation.ts)
    - chat with learning record extraction (chat_service.py route.ts)
    - problem video with learner memory (job_service.py)
    
    All features read from the same LearningContext.
    """
    user_id: str
    classroom_id: Optional[str] = None
    scene_id: Optional[str] = None
    ai_session_id: Optional[str] = None
    notebook_refs: List[NotebookRef] = field(default_factory=list)
    problem_video_job_id: Optional[str] = None
    student_profile: Optional[StudentProfileSnapshot] = None
    enabled_tools: List[EnabledTool] = field(default_factory=list)
    metadata: LearningContextMetadata = field(default_factory=LearningContextMetadata)
    updated_at: Optional[datetime] = None

    def __post_init__(self):
        if self.updated_at is None:
            self.updated_at = datetime.utcnow()
        if not isinstance(self.metadata, LearningContextMetadata):
            self.metadata = LearningContextMetadata(**self.metadata) if self.metadata else LearningContextMetadata()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary for storage/transmission."""
        return {
            "user_id": self.user_id,
            "classroom_id": self.classroom_id,
            "scene_id": self.scene_id,
            "ai_session_id": self.ai_session_id,
            "notebook_refs": [
                {
                    "id": ref.id,
                    "title": ref.title,
                    "source_scene_id": ref.source_scene_id,
                    "source_classroom_id": ref.source_classroom_id,
                    "saved_at": ref.saved_at.isoformat() if ref.saved_at else None,
                    "content_type": ref.content_type,
                }
                for ref in self.notebook_refs
            ],
            "problem_video_job_id": self.problem_video_job_id,
            "student_profile": self._profile_to_dict() if self.student_profile else None,
            "enabled_tools": [
                {"id": t.id, "enabled": t.enabled, "config": t.config}
                for t in self.enabled_tools
            ],
            "metadata": {
                "source": self.metadata.source,
                "topic": self.metadata.topic,
                "language": self.metadata.language,
                "grade": self.metadata.grade,
                "extra": self.metadata.extra,
            },
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def _profile_to_dict(self) -> Dict[str, Any]:
        p = self.student_profile
        return {
            "weak_subjects": p.weak_subjects,
            "weak_knowledge_points": p.weak_knowledge_points,
            "ability_scores": [
                {"metric": s.metric, "value": s.value, "full_mark": s.full_mark}
                for s in p.ability_scores
            ],
            "recent_focus": p.recent_focus,
            "learning_stats": {
                "records_total": p.learning_stats.records_total,
                "records_14d": p.learning_stats.records_14d,
                "active_days_14": p.learning_stats.active_days_14,
                "confusion_records": p.learning_stats.confusion_records,
                "solved_records": p.learning_stats.solved_records,
                "top_subjects": p.learning_stats.top_subjects,
                "top_knowledge_points": p.learning_stats.top_knowledge_points,
            },
            "snapshot_at": p.snapshot_at.isoformat() if p.snapshot_at else None,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LearningContext":
        """Deserialize from dictionary."""
        notebook_refs = []
        for ref_data in data.get("notebook_refs", []):
            saved_at = None
            if ref_data.get("saved_at"):
                try:
                    saved_at = datetime.fromisoformat(ref_data["saved_at"])
                except (ValueError, TypeError):
                    pass
            notebook_refs.append(NotebookRef(
                id=ref_data["id"],
                title=ref_data["title"],
                source_scene_id=ref_data.get("source_scene_id"),
                source_classroom_id=ref_data.get("source_classroom_id"),
                saved_at=saved_at,
                content_type=ref_data.get("content_type", "knowledge_card"),
            ))

        student_profile = None
        profile_data = data.get("student_profile")
        if profile_data:
            stats_data = profile_data.get("learning_stats", {})
            ability_scores = [
                AbilityScore(
                    metric=s["metric"],
                    value=s["value"],
                    full_mark=s.get("full_mark", 100.0),
                )
                for s in profile_data.get("ability_scores", [])
            ]
            snapshot_at = None
            if profile_data.get("snapshot_at"):
                try:
                    snapshot_at = datetime.fromisoformat(profile_data["snapshot_at"])
                except (ValueError, TypeError):
                    pass
            student_profile = StudentProfileSnapshot(
                weak_subjects=profile_data.get("weak_subjects", []),
                weak_knowledge_points=profile_data.get("weak_knowledge_points", []),
                ability_scores=ability_scores,
                recent_focus=profile_data.get("recent_focus"),
                learning_stats=LearningStatsSummary(
                    records_total=stats_data.get("records_total", 0),
                    records_14d=stats_data.get("records_14d", 0),
                    active_days_14=stats_data.get("active_days_14", 0),
                    confusion_records=stats_data.get("confusion_records", 0),
                    solved_records=stats_data.get("solved_records", 0),
                    top_subjects=stats_data.get("top_subjects", []),
                    top_knowledge_points=stats_data.get("top_knowledge_points", []),
                ),
                snapshot_at=snapshot_at,
            )

        metadata_data = data.get("metadata", {})
        metadata = LearningContextMetadata(
            source=metadata_data.get("source", "chat"),
            topic=metadata_data.get("topic"),
            language=metadata_data.get("language", "zh-CN"),
            grade=metadata_data.get("grade"),
            extra=metadata_data.get("extra", {}),
        )

        updated_at = None
        if data.get("updated_at"):
            try:
                updated_at = datetime.fromisoformat(data["updated_at"])
            except (ValueError, TypeError):
                pass

        return cls(
            user_id=data["user_id"],
            classroom_id=data.get("classroom_id"),
            scene_id=data.get("scene_id"),
            ai_session_id=data.get("ai_session_id"),
            notebook_refs=notebook_refs,
            problem_video_job_id=data.get("problem_video_job_id"),
            student_profile=student_profile,
            enabled_tools=[
                EnabledTool(id=t["id"], enabled=t.get("enabled", True), config=t.get("config", {}))
                for t in data.get("enabled_tools", [])
            ],
            metadata=metadata,
            updated_at=updated_at,
        )

    def with_student_profile(self, profile: StudentProfileSnapshot) -> "LearningContext":
        """Return a new context with updated student profile."""
        import copy
        new_ctx = copy.copy(self)
        new_ctx.student_profile = profile
        new_ctx.updated_at = datetime.utcnow()
        return new_ctx

    def add_notebook_ref(self, ref: NotebookRef) -> "LearningContext":
        """Return a new context with an added notebook reference."""
        import copy
        new_ctx = copy.copy(self)
        new_ctx.notebook_refs = [*self.notebook_refs, ref]
        new_ctx.updated_at = datetime.utcnow()
        return new_ctx

    def set_tool_enabled(self, tool_id: str, enabled: bool, config: Dict[str, Any] | None = None) -> "LearningContext":
        """Return a new context with tool enabled/disabled."""
        import copy
        new_ctx = copy.copy(self)
        existing = [t for t in self.enabled_tools if t.id != tool_id]
        new_tools = [*existing, EnabledTool(id=tool_id, enabled=enabled, config=config or {})]
        new_ctx.enabled_tools = new_tools
        new_ctx.updated_at = datetime.utcnow()
        return new_ctx

    def is_tool_enabled(self, tool_id: str) -> bool:
        """Check if a tool is enabled."""
        for tool in self.enabled_tools:
            if tool.id == tool_id:
                return tool.enabled
        return False
