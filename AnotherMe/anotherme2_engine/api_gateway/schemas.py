"""Pydantic schemas and contract validation for gateway APIs."""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field, ValidationError


class JobType(str, Enum):
    COURSE_GENERATE = "course_generate"
    PROBLEM_VIDEO_GENERATE = "problem_video_generate"
    STUDY_PACKAGE_GENERATE = "study_package_generate"
    LEARNING_RECORD_EXTRACT = "learning_record_extract"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class CourseOptions(BaseModel):
    enable_web_search: bool = False
    enable_image_generation: bool = False
    enable_video_generation: bool = False
    enable_tts: bool = False
    agent_mode: Literal["default", "generate"] = "default"


class PedagogyProfile(BaseModel):
    domain: Optional[Literal["middle-school-math"]] = None
    exam_orientation: Optional[Literal["zhongkao"]] = None
    grade_band: Optional[Literal["grade7", "grade8", "grade9", "auto"]] = None
    strictness: Optional[Literal["standard", "high"]] = None


class CourseGenerateInput(BaseModel):
    requirement: str = Field(..., min_length=1)
    language: str = "zh-CN"
    options: CourseOptions = Field(default_factory=CourseOptions)
    pedagogy_profile: Optional[PedagogyProfile] = None


class ProblemVideoGenerateInput(BaseModel):
    image_object_key: str = Field(..., min_length=1)
    problem_text: Optional[str] = None
    geometry_file: Optional[str] = None
    output_profile: str = "1080p"
    learner_user_id: Optional[str] = None
    learner_session_id: Optional[str] = None
    learner_lookback_days: int = Field(default=120, ge=14, le=365)
    learning_context: Optional[Dict[str, Any]] = None


class StudyPackageSource(BaseModel):
    type: Literal["topic", "photo"]
    topic: Optional[str] = None
    image_object_key: Optional[str] = None


class StudyPackageOutputs(BaseModel):
    course: bool = True
    problem_video: bool = True


class StudyPackageGenerateInput(BaseModel):
    source: StudyPackageSource
    outputs: StudyPackageOutputs = Field(default_factory=StudyPackageOutputs)


class LearningRecordExtractInput(BaseModel):
    session_id: str = Field(..., min_length=1)
    user_id: Optional[str] = None
    extract_version: str = "v1"
    latest_user_message_id: Optional[str] = None
    message_count: Optional[int] = Field(default=None, ge=0)


class CreateJobRequest(BaseModel):
    job_type: JobType
    payload: Dict[str, Any]
    user_id: str = "default_user"


class UploadResponse(BaseModel):
    object_key: str
    url: str
    size: int
    content_type: str


class JobSummary(BaseModel):
    job_id: str
    job_type: JobType
    status: JobStatus
    progress: int
    step: str
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str


class JobResultResponse(BaseModel):
    job_id: str
    status: JobStatus
    result: Dict[str, Any]


class APIError(BaseModel):
    error_code: str
    message: str
    details: Optional[Dict[str, Any]] = None


class MessageAttachmentInput(BaseModel):
    file_url: str = Field(..., min_length=1)
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    object_key: Optional[str] = None


class CreateConversationRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    type: str = "single"
    name: str = Field(..., min_length=1)
    creator_id: Optional[str] = None
    member_ids: list[str] = Field(default_factory=list)


class ConversationSummary(BaseModel):
    conversation_id: str
    type: str
    name: str
    creator_id: str
    last_message_id: Optional[str] = None
    last_message_time: Optional[str] = None
    unread_count: int = 0
    created_at: str
    updated_at: str


class ConversationMemberSummary(BaseModel):
    conversation_id: str
    user_id: str
    joined_at: str
    mute_flag: bool = False
    unread_count: int = 0
    last_read_message_id: Optional[str] = None
    last_read_seq: int = 0


class AddConversationMembersRequest(BaseModel):
    operator_user_id: str = Field(..., min_length=1)
    member_ids: list[str] = Field(..., min_length=1)


class RemoveConversationMemberRequest(BaseModel):
    operator_user_id: str = Field(..., min_length=1)


class RemoveConversationMemberResponse(BaseModel):
    conversation_id: str
    member_user_id: str
    removed: bool


class CreateMessageRequest(BaseModel):
    sender_id: str = Field(..., min_length=1)
    message_type: str = "text"
    content: str = Field(..., min_length=1)
    reply_to_message_id: Optional[str] = None
    status: str = "sent"
    source_type: str = "manual"
    source_ref_id: Optional[str] = None
    attachments: list[MessageAttachmentInput] = Field(default_factory=list)


class MessageAttachmentOutput(MessageAttachmentInput):
    attachment_id: str


class MessageOutput(BaseModel):
    message_id: str
    conversation_id: str
    seq: int
    sender_id: str
    message_type: str
    content: str
    reply_to_message_id: Optional[str] = None
    status: str
    source_type: str
    source_ref_id: Optional[str] = None
    recalled_flag: bool = False
    deleted_flag: bool = False
    created_at: str
    attachments: list[MessageAttachmentOutput] = Field(default_factory=list)


class MarkConversationReadRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    last_read_seq: Optional[int] = None


class ConversationReadResponse(BaseModel):
    conversation_id: str
    user_id: str
    last_read_seq: int
    unread_count: int


class CreateAIChatSessionRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    source: str = "课后答疑"
    subject: Optional[str] = None
    linked_classroom_id: Optional[str] = None
    linked_conversation_id: Optional[str] = None


class AIChatSessionSummary(BaseModel):
    session_id: str
    user_id: str
    title: str
    source: str
    subject: Optional[str] = None
    linked_classroom_id: Optional[str] = None
    linked_conversation_id: Optional[str] = None
    archived_flag: bool
    created_at: str
    updated_at: str


class CreateAIChatMessageRequest(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1)
    user_id: Optional[str] = None
    content_type: str = "text"
    model_name: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    request_id: Optional[str] = None
    parent_message_id: Optional[str] = None


class AIChatMessageOutput(BaseModel):
    message_id: str
    session_id: str
    role: str
    content: str
    content_type: str
    model_name: Optional[str] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    request_id: Optional[str] = None
    parent_message_id: Optional[str] = None
    created_at: str


class AIMessageFeedbackRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    rating: Literal["like", "dislike"]
    feedback_text: Optional[str] = None


class AIMessageFeedbackOutput(BaseModel):
    feedback_id: str
    message_id: str
    user_id: str
    rating: str
    feedback_text: Optional[str] = None
    created_at: str


class LearningRecordOutput(BaseModel):
    record_id: str
    user_id: str
    session_id: str
    message_id: Optional[str] = None
    subject: Optional[str] = None
    knowledge_point: Optional[str] = None
    question_type: Optional[str] = None
    difficulty: Optional[str] = None
    solved_flag: bool
    confusion_flag: bool
    extract_version: str
    created_at: str


class AbilityScoreOutput(BaseModel):
    metric: str
    value: int
    full_mark: int = 100


class LearningStatsOutput(BaseModel):
    records_total: int
    records_14d: int
    active_days_14: int
    confusion_records: int
    solved_records: int
    top_subjects: list[str] = Field(default_factory=list)
    top_knowledge_points: list[str] = Field(default_factory=list)
    total_weight: float = 0.0


class KnowledgeTracingSummaryOutput(BaseModel):
    knowledge_point_id: str
    p_mastery: float
    attempts: int
    correct_attempts: int
    action: Optional[str] = None
    action_reason: Optional[str] = None


class StudentProfileOutput(BaseModel):
    user_id: str
    weak_subjects: list[str] = Field(default_factory=list)
    weak_knowledge_points: list[str] = Field(default_factory=list)
    recent_focus: Optional[str] = None
    ability_scores: list[AbilityScoreOutput] = Field(default_factory=list)
    learning_stats: LearningStatsOutput
    updated_at: Optional[str] = None
    computed_at: str
    profile_source: str
    knowledge_tracing: list[KnowledgeTracingSummaryOutput] = Field(default_factory=list)


class CreateLearningEventRequest(BaseModel):
    user_id: Optional[str] = None
    event_type: str = Field(..., min_length=1, max_length=64)
    session_id: Optional[str] = None
    classroom_id: Optional[str] = None
    scene_id: Optional[str] = None
    block_id: Optional[str] = None
    knowledge_points: Optional[list[str]] = None
    payload: Optional[Dict[str, Any]] = None
    weight: Optional[float] = Field(default=1.0, ge=0.1, le=5.0)


class LearningEventOutput(BaseModel):
    event_id: str
    user_id: str
    event_type: str
    session_id: Optional[str] = None
    classroom_id: Optional[str] = None
    scene_id: Optional[str] = None
    block_id: Optional[str] = None
    knowledge_points: Optional[list[str]] = None
    payload: Optional[Dict[str, Any]] = None
    weight: float
    created_at: str


class LearningEventSummary(BaseModel):
    event_type: str
    count: int
    latest_at: str


class LearningEventStatsOutput(BaseModel):
    total_events: int
    by_type: list[LearningEventSummary] = Field(default_factory=list)
    knowledge_points_involved: list[str] = Field(default_factory=list)


def _model_dump(value: BaseModel) -> Dict[str, Any]:
    return value.model_dump() if hasattr(value, "model_dump") else value.dict()


class KnowledgePointInput(BaseModel):
    kp_id: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=256)
    subject: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = Field(default=None, max_length=1024)
    parent_id: Optional[str] = Field(default=None, max_length=128)
    prerequisites: list[str] = Field(default_factory=list)
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None


class KnowledgePointOutput(BaseModel):
    id: str
    subject: Optional[str] = None
    name: str
    description: Optional[str] = None
    parent_id: Optional[str] = None
    prerequisites: list[str] = Field(default_factory=list)
    difficulty: Optional[str] = None
    created_at: str


class QuestionKnowledgeMapInput(BaseModel):
    question_id: str = Field(..., min_length=1, max_length=128)
    knowledge_point_id: str = Field(..., min_length=1, max_length=128)
    weight: float = Field(default=1.0, ge=0.0, le=5.0)
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None


class QuestionKnowledgeMapOutput(BaseModel):
    question_id: str
    knowledge_point_id: str
    weight: float
    difficulty: Optional[str] = None


class StudentKnowledgeStateOutput(BaseModel):
    user_id: str
    knowledge_point_id: str
    p_mastery: float
    p_learn: float
    p_guess: float
    p_slip: float
    p_forget: float = 0.05
    attempts: int
    correct_attempts: int
    last_updated_at: Optional[str] = None


class ProcessQuizAnswerInput(BaseModel):
    question_id: str = Field(..., min_length=1, max_length=128)
    is_correct: bool
    knowledge_point_ids: Optional[list[str]] = None
    payload: Optional[Dict[str, Any]] = None


class QuizAnswerResultOutput(BaseModel):
    knowledge_point_id: str
    prior_mastery: float
    posterior_mastery: float
    attempts: int
    correct_attempts: int
    weight: float = 1.0
    difficulty: Optional[str] = None


class TeachingDecisionOutput(BaseModel):
    target_knowledge_point_id: str
    mastery: float
    action: Literal["reteach", "give_hint", "worked_example", "variant_practice", "advance", "review_later"]
    reason: str


class KnowledgeTraceEventOutput(BaseModel):
    trace_event_id: str
    user_id: str
    knowledge_point_id: str
    source_event_id: Optional[str] = None
    event_type: str
    prior_mastery: float
    posterior_mastery: float
    is_correct: Optional[bool] = None
    question_id: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    created_at: str


class StudentKnowledgeContextOutput(BaseModel):
    context_text: str


class DiagnosticProbeInput(BaseModel):
    knowledge_point_id: Optional[str] = None
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None
    probe_type: Optional[Literal["choice", "fill_blank", "step_by_step"]] = None


class DiagnosticProbeOutput(BaseModel):
    probe_id: str
    knowledge_point_id: str
    question: str
    options: Optional[list[str]] = None
    correct_answer: str
    explanation: str
    difficulty: str
    probe_type: str
    hints: list[str] = Field(default_factory=list)
    teaching_action: Literal["reteach", "give_hint", "worked_example", "variant_practice", "advance", "review_later"]
    reason: str


class KnowledgeTracingSummaryOutput(BaseModel):
    """Unified knowledge tracing snapshot for a student."""

    user_id: str
    knowledge_states: list[StudentKnowledgeStateOutput]
    teaching_decisions: list[TeachingDecisionOutput]
    weakest_knowledge_point: Optional[StudentKnowledgeStateOutput] = None
    summary: Dict[str, Any] = Field(default_factory=dict)


def validate_job_payload(job_type: JobType, payload: Dict[str, Any]) -> Dict[str, Any]:
    model_map = {
        JobType.COURSE_GENERATE: CourseGenerateInput,
        JobType.PROBLEM_VIDEO_GENERATE: ProblemVideoGenerateInput,
        JobType.STUDY_PACKAGE_GENERATE: StudyPackageGenerateInput,
        JobType.LEARNING_RECORD_EXTRACT: LearningRecordExtractInput,
    }
    model = model_map[job_type]

    try:
        validated = model.model_validate(payload) if hasattr(model, "model_validate") else model.parse_obj(payload)
    except ValidationError:
        raise

    normalized = _model_dump(validated)

    if job_type == JobType.STUDY_PACKAGE_GENERATE:
        source = normalized["source"]
        outputs = normalized["outputs"]
        if source["type"] == "topic" and not (source.get("topic") or "").strip():
            raise ValueError("source.topic is required when source.type=topic")
        if source["type"] == "photo" and not (source.get("image_object_key") or "").strip():
            raise ValueError("source.image_object_key is required when source.type=photo")
        if not outputs.get("course") and not outputs.get("problem_video"):
            raise ValueError("outputs.course and outputs.problem_video cannot both be false")

    return normalized
