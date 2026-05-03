"""
DeepTutor Integration Module.

This module integrates all 5 DeepTutor-inspired innovations:
1. LearningContext - Unified learning context
2. LearningBlock - Block-based learning objects
3. LearningEvent - Unified learning event stream
4. Capability Registry - Capability/Tool separation
5. Trace Events - Process event trace visualization

Usage: Import this module to access all integrated components.
"""

from .learning_context import (
    LearningContext,
    NotebookRef,
    StudentProfileSnapshot,
    AbilityScore,
    LearningStatsSummary,
    EnabledTool,
    LearningContextMetadata,
)

from .learning_block import (
    LearningBlock,
    LearningBlockMetadata,
    SourceAnchor,
    AttemptRecord,
    ReviewItem,
    add_knowledge_point_to_block,
    add_learning_objective,
    add_source_anchor,
    get_review_recommended_blocks,
)

from .learning_event import (
    LearningEvent,
    LearningEventEmitter,
    QuizAnsweredPayload,
    ConfusionDetectedPayload,
    VideoWatchedPayload,
    ProblemSolvedPayload,
)

from .capability_registry import (
    Capability,
    Tool,
    CapabilityRegistry,
    create_default_registry,
    DEFAULT_CAPABILITIES,
    DEFAULT_TOOLS,
)

from .trace_event import (
    TraceEvent,
    TraceEventEmitter,
)

__all__ = [
    "LearningContext",
    "NotebookRef",
    "StudentProfileSnapshot",
    "AbilityScore",
    "LearningStatsSummary",
    "EnabledTool",
    "LearningContextMetadata",
    "LearningBlock",
    "LearningBlockMetadata",
    "SourceAnchor",
    "AttemptRecord",
    "ReviewItem",
    "add_knowledge_point_to_block",
    "add_learning_objective",
    "add_source_anchor",
    "get_review_recommended_blocks",
    "LearningEvent",
    "LearningEventEmitter",
    "QuizAnsweredPayload",
    "ConfusionDetectedPayload",
    "VideoWatchedPayload",
    "ProblemSolvedPayload",
    "Capability",
    "Tool",
    "CapabilityRegistry",
    "create_default_registry",
    "DEFAULT_CAPABILITIES",
    "DEFAULT_TOOLS",
    "TraceEvent",
    "TraceEventEmitter",
]
