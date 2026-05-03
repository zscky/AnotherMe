"""
LearningBlock - Upgrade from Scene-level to Block-level learning objects.

Inspired by DeepTutor's Book Engine block system. Extends the existing Scene model
with block-level source tracking, learning objectives, attempt tracking,
misconception tags, and retry/failure state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from datetime import datetime
import uuid


BlockType = str
BlockStatus = str
BlockDifficulty = str

VALID_BLOCK_TYPES = {"slide", "quiz", "interactive", "pbl", "video", "reading", "practice", "review"}
VALID_BLOCK_STATUSES = {"pending", "active", "completed", "failed", "skipped", "retrying"}
VALID_BLOCK_DIFFICULTIES = {"easy", "medium", "hard", "adaptive"}


@dataclass
class SourceAnchor:
    """Tracks where a block's content originated from."""
    type: str
    identifier: str
    description: Optional[str] = None


@dataclass
class AttemptRecord:
    """Records a student's attempt on a learning block."""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    timestamp: Optional[datetime] = None
    success: Optional[bool] = None
    score: Optional[float] = None
    time_spent_ms: Optional[int] = None
    hints_used: List[str] = field(default_factory=list)
    struggled_points: List[str] = field(default_factory=list)

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()


@dataclass
class LearningBlockMetadata:
    """Metadata for a learning block."""
    type: str = "slide"
    status: str = "pending"
    difficulty: str = "adaptive"
    learning_objectives: List[str] = field(default_factory=list)
    knowledge_points: List[str] = field(default_factory=list)
    misconception_tags: List[str] = field(default_factory=list)
    source_anchors: List[SourceAnchor] = field(default_factory=list)
    attempts: List[AttemptRecord] = field(default_factory=list)
    generated_by: str = "system"
    estimated_time_minutes: int = 8
    prerequisite_block_ids: List[str] = field(default_factory=list)
    related_block_ids: List[str] = field(default_factory=list)
    recommended_for_review: bool = False
    review_reason: Optional[str] = None


@dataclass
class LearningBlock:
    """
    A block-level learning object that extends the Scene model.
    
    Each Scene can contain one or more LearningBlocks, providing finer-grained
    tracking of learning objectives, attempts, misconceptions, and review needs.
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    scene_id: str = ""
    stage_id: str = ""
    order: int = 0
    title: str = ""
    metadata: LearningBlockMetadata = field(default_factory=LearningBlockMetadata)
    content: Dict[str, Any] = field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.utcnow()
        if self.updated_at is None:
            self.updated_at = datetime.utcnow()

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "id": self.id,
            "scene_id": self.scene_id,
            "stage_id": self.stage_id,
            "order": self.order,
            "title": self.title,
            "metadata": {
                "type": self.metadata.type,
                "status": self.metadata.status,
                "difficulty": self.metadata.difficulty,
                "learning_objectives": self.metadata.learning_objectives,
                "knowledge_points": self.metadata.knowledge_points,
                "misconception_tags": self.metadata.misconception_tags,
                "source_anchors": [
                    {"type": a.type, "identifier": a.identifier, "description": a.description}
                    for a in self.metadata.source_anchors
                ],
                "attempts": [
                    {
                        "id": a.id,
                        "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                        "success": a.success,
                        "score": a.score,
                        "time_spent_ms": a.time_spent_ms,
                        "hints_used": a.hints_used,
                        "struggled_points": a.struggled_points,
                    }
                    for a in self.metadata.attempts
                ],
                "generated_by": self.metadata.generated_by,
                "estimated_time_minutes": self.metadata.estimated_time_minutes,
                "prerequisite_block_ids": self.metadata.prerequisite_block_ids,
                "related_block_ids": self.metadata.related_block_ids,
                "recommended_for_review": self.metadata.recommended_for_review,
                "review_reason": self.metadata.review_reason,
            },
            "content": self.content,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LearningBlock":
        """Deserialize from dictionary."""
        metadata_data = data.get("metadata", {})
        
        source_anchors = [
            SourceAnchor(
                type=a["type"],
                identifier=a["identifier"],
                description=a.get("description"),
            )
            for a in metadata_data.get("source_anchors", [])
        ]
        
        attempts = []
        for a_data in metadata_data.get("attempts", []):
            timestamp = None
            if a_data.get("timestamp"):
                try:
                    timestamp = datetime.fromisoformat(a_data["timestamp"])
                except (ValueError, TypeError):
                    pass
            attempts.append(AttemptRecord(
                id=a_data.get("id", str(uuid.uuid4())[:12]),
                timestamp=timestamp,
                success=a_data.get("success"),
                score=a_data.get("score"),
                time_spent_ms=a_data.get("time_spent_ms"),
                hints_used=a_data.get("hints_used", []),
                struggled_points=a_data.get("struggled_points", []),
            ))
        
        metadata = LearningBlockMetadata(
            type=metadata_data.get("type", "slide"),
            status=metadata_data.get("status", "pending"),
            difficulty=metadata_data.get("difficulty", "adaptive"),
            learning_objectives=metadata_data.get("learning_objectives", []),
            knowledge_points=metadata_data.get("knowledge_points", []),
            misconception_tags=metadata_data.get("misconception_tags", []),
            source_anchors=source_anchors,
            attempts=attempts,
            generated_by=metadata_data.get("generated_by", "system"),
            estimated_time_minutes=metadata_data.get("estimated_time_minutes", 8),
            prerequisite_block_ids=metadata_data.get("prerequisite_block_ids", []),
            related_block_ids=metadata_data.get("related_block_ids", []),
            recommended_for_review=metadata_data.get("recommended_for_review", False),
            review_reason=metadata_data.get("review_reason"),
        )
        
        created_at = None
        if data.get("created_at"):
            try:
                created_at = datetime.fromisoformat(data["created_at"])
            except (ValueError, TypeError):
                pass
        
        updated_at = None
        if data.get("updated_at"):
            try:
                updated_at = datetime.fromisoformat(data["updated_at"])
            except (ValueError, TypeError):
                pass
        
        return cls(
            id=data.get("id", str(uuid.uuid4())[:12]),
            scene_id=data.get("scene_id", ""),
            stage_id=data.get("stage_id", ""),
            order=data.get("order", 0),
            title=data.get("title", ""),
            metadata=metadata,
            content=data.get("content", {}),
            created_at=created_at,
            updated_at=updated_at,
        )

    def record_attempt(
        self,
        success: Optional[bool] = None,
        score: Optional[float] = None,
        time_spent_ms: Optional[int] = None,
        hints_used: Optional[List[str]] = None,
        struggled_points: Optional[List[str]] = None,
    ) -> "LearningBlock":
        """Record a new attempt on this block."""
        attempt = AttemptRecord(
            success=success,
            score=score,
            time_spent_ms=time_spent_ms,
            hints_used=hints_used or [],
            struggled_points=struggled_points or [],
        )
        self.metadata.attempts.append(attempt)
        
        if success is True:
            self.metadata.status = "completed"
        elif success is False:
            self.metadata.status = "failed"
        
        self.updated_at = datetime.utcnow()
        return self

    def add_misconception_tag(self, tag: str) -> "LearningBlock":
        """Add a misconception tag if not already present."""
        if tag not in self.metadata.misconception_tags:
            self.metadata.misconception_tags.append(tag)
            self.updated_at = datetime.utcnow()
        return self

    def mark_for_review(self, reason: str) -> "LearningBlock":
        """Mark this block as recommended for review."""
        self.metadata.recommended_for_review = True
        self.metadata.review_reason = reason
        self.updated_at = datetime.utcnow()
        return self

    def calculate_mastery(self) -> float:
        """Calculate mastery score from attempts."""
        attempts = self.metadata.attempts
        if not attempts:
            return 0.0
        
        successful = sum(1 for a in attempts if a.success is True)
        total = len(attempts)
        success_rate = successful / total
        
        recency_bonus = 0.1 if total > 1 else 0.0
        return min(1.0, success_rate * 0.8 + recency_bonus)

    @classmethod
    def from_scene(cls, scene_data: Dict[str, Any]) -> "LearningBlock":
        """Create a LearningBlock from a Scene dictionary."""
        scene_type = scene_data.get("type", "slide")
        block_type = scene_type if scene_type in VALID_BLOCK_TYPES else "slide"
        
        time_estimates = {
            "slide": 8, "quiz": 6, "interactive": 10, "pbl": 12,
            "video": 5, "reading": 5, "practice": 8, "review": 10,
        }
        
        return cls(
            id=f"block-{scene_data.get('id', str(uuid.uuid4())[:12])}",
            scene_id=scene_data.get("id", ""),
            stage_id=scene_data.get("stageId", ""),
            order=scene_data.get("order", 0),
            title=scene_data.get("title", ""),
            metadata=LearningBlockMetadata(
                type=block_type,
                estimated_time_minutes=time_estimates.get(block_type, 8),
            ),
            content=scene_data.get("content", {}),
        )


@dataclass
class ReviewItem:
    """An item recommended for review."""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    type: str = "knowledge_point"
    content: str = ""
    mastery_score: float = 0.0
    last_reviewed_at: Optional[datetime] = None


def get_review_recommended_blocks(blocks: List[LearningBlock]) -> List[LearningBlock]:
    """Get blocks that are recommended for review."""
    return [b for b in blocks if b.metadata.recommended_for_review]


def add_knowledge_point_to_block(block: LearningBlock, knowledge_point: str) -> LearningBlock:
    """Add a knowledge point to a block's metadata."""
    if knowledge_point not in block.metadata.knowledge_points:
        block.metadata.knowledge_points.append(knowledge_point)
        block.updated_at = datetime.utcnow()
    return block


def add_learning_objective(block: LearningBlock, objective: str) -> LearningBlock:
    """Add a learning objective to a block's metadata."""
    if objective not in block.metadata.learning_objectives:
        block.metadata.learning_objectives.append(objective)
        block.updated_at = datetime.utcnow()
    return block


def add_source_anchor(block: LearningBlock, anchor_type: str, identifier: str, description: Optional[str] = None) -> LearningBlock:
    """Add a source anchor to a block's metadata."""
    block.metadata.source_anchors.append(SourceAnchor(
        type=anchor_type,
        identifier=identifier,
        description=description,
    ))
    block.updated_at = datetime.utcnow()
    return block
