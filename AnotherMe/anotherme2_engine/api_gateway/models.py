"""SQLAlchemy ORM models for unified job orchestration."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .db import Base


JsonType = JSONB().with_variant(JSON, "sqlite")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    job_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    queue_name: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    parent_job_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("jobs.id"), nullable=True)

    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    step: Mapped[str] = mapped_column(String(64), nullable=False, default="queued")

    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=2)

    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    input_payload: Mapped[dict] = mapped_column(JsonType, nullable=False)
    normalized_payload: Mapped[dict] = mapped_column(JsonType, nullable=False)
    engine_state: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    result_payload: Mapped[dict | None] = mapped_column(JsonType, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    events: Mapped[list["JobEvent"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    artifacts: Mapped[list["JobArtifact"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class KnowledgePoint(Base):
    __tablename__ = "knowledge_points"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    subject: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(128), ForeignKey("knowledge_points.id"), nullable=True, index=True)
    prerequisites: Mapped[list | None] = mapped_column(JsonType, nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class QuestionKnowledgeMap(Base):
    __tablename__ = "question_knowledge_map"
    __table_args__ = (UniqueConstraint("question_id", "knowledge_point_id", name="uq_question_kp"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    knowledge_point_id: Mapped[str] = mapped_column(String(128), ForeignKey("knowledge_points.id"), nullable=False, index=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    difficulty: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class StudentKnowledgeState(Base):
    __tablename__ = "student_knowledge_states"
    __table_args__ = (UniqueConstraint("user_id", "knowledge_point_id", name="uq_user_kp_state"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    knowledge_point_id: Mapped[str] = mapped_column(String(128), ForeignKey("knowledge_points.id"), nullable=False, index=True)
    p_mastery: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    p_learn: Mapped[float] = mapped_column(Float, nullable=False, default=0.15)
    p_guess: Mapped[float] = mapped_column(Float, nullable=False, default=0.2)
    p_slip: Mapped[float] = mapped_column(Float, nullable=False, default=0.1)
    p_forget: Mapped[float] = mapped_column(Float, nullable=False, default=0.05)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class KnowledgeTraceEvent(Base):
    __tablename__ = "knowledge_trace_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    knowledge_point_id: Mapped[str] = mapped_column(String(128), ForeignKey("knowledge_points.id"), nullable=False, index=True)
    source_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    prior_mastery: Mapped[float] = mapped_column(Float, nullable=False)
    posterior_mastery: Mapped[float] = mapped_column(Float, nullable=False)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    question_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    payload: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

class JobEvent(Base):
    __tablename__ = "job_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(36), ForeignKey("jobs.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    trace_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    trace_event_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    job: Mapped[Job] = relationship(back_populates="events")


class JobArtifact(Base):
    __tablename__ = "job_artifacts"
    __table_args__ = (UniqueConstraint("job_id", "artifact_type", "object_key", name="uq_job_artifact"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(36), ForeignKey("jobs.id"), nullable=False, index=True)
    artifact_type: Mapped[str] = mapped_column(String(64), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    artifact_metadata: Mapped[dict | None] = mapped_column("metadata", JsonType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    job: Mapped[Job] = relationship(back_populates="artifacts")


class AppUser(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    avatar: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    grade: Mapped[str | None] = mapped_column(String(32), nullable=True)
    class_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    conversation_type: Mapped[str] = mapped_column("type", String(32), nullable=False, default="single", index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    creator_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    last_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_message_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    __table_args__ = (UniqueConstraint("conversation_id", "user_id", name="uq_conversation_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    mute_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_read_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_read_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("conversation_id", "seq", name="uq_conversation_seq"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id"), nullable=False, index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    sender_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    message_type: Mapped[str] = mapped_column(String(32), nullable=False, default="text")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    reply_to_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="sent")
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    source_ref_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    recalled_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class MessageAttachment(Base):
    __tablename__ = "message_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("messages.id"), nullable=False, index=True)
    file_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class AIChatSession(Base):
    __tablename__ = "ai_chat_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="课后答疑")
    subject: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    linked_classroom_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    linked_conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    archived_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class AIChatMessage(Base):
    __tablename__ = "ai_chat_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("ai_chat_sessions.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(32), nullable=False, default="text")
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True, index=True)
    parent_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class AIMessageFeedback(Base):
    __tablename__ = "ai_message_feedback"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_ai_feedback_message_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    message_id: Mapped[str] = mapped_column(String(36), ForeignKey("ai_chat_messages.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    rating: Mapped[str] = mapped_column(String(16), nullable=False)
    feedback_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class AILearningRecord(Base):
    __tablename__ = "ai_learning_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("ai_chat_sessions.id"), nullable=False, index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("ai_chat_messages.id"), nullable=True, index=True)
    subject: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    knowledge_point: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    question_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(32), nullable=True)
    solved_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confusion_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    extract_version: Mapped[str] = mapped_column(String(32), nullable=False, default="v1")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class EventLog(Base):
    __tablename__ = "event_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    extra_json: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    weak_subjects: Mapped[list | None] = mapped_column(JsonType, nullable=True)
    weak_knowledge_points: Mapped[list | None] = mapped_column(JsonType, nullable=True)
    preferred_learning_style: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recent_focus: Mapped[str | None] = mapped_column(String(128), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class StudentMemory(Base):
    __tablename__ = "student_memory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    memory_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    importance: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class LearningEvent(Base):
    __tablename__ = "learning_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    classroom_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    scene_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    block_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    knowledge_points: Mapped[list | None] = mapped_column(JsonType, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# LiveBook models
# ---------------------------------------------------------------------------


class LiveBook(Base):
    __tablename__ = "live_books"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    topic: Mapped[str] = mapped_column(String(256), nullable=False)
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="zh-CN")
    target_level: Mapped[str] = mapped_column(String(64), nullable=False, default="通用")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft", index=True)
    proposal: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    progress: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    quality: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    chapters: Mapped[list["LiveBookChapter"]] = relationship(back_populates="book", cascade="all, delete-orphan")
    spines: Mapped[list["LiveBookSpine"]] = relationship(back_populates="book", cascade="all, delete-orphan")
    pages: Mapped[list["LiveBookPage"]] = relationship(back_populates="book", cascade="all, delete-orphan")
    jobs: Mapped[list["LiveBookJob"]] = relationship(back_populates="book", cascade="all, delete-orphan")


class LiveBookChapter(Base):
    __tablename__ = "live_book_chapters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_books.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    book: Mapped[LiveBook] = relationship(back_populates="chapters")


class LiveBookSpine(Base):
    __tablename__ = "live_book_spines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_books.id"), nullable=False, index=True)
    chapter_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(32), nullable=False, default="medium")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    book: Mapped[LiveBook] = relationship(back_populates="spines")


class LiveBookPage(Base):
    __tablename__ = "live_book_pages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    page_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_books.id"), nullable=False, index=True)
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_book_chapters.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    book: Mapped[LiveBook] = relationship(back_populates="pages")
    blocks: Mapped[list["LiveBookBlock"]] = relationship(back_populates="page", cascade="all, delete-orphan")


class LiveBookBlock(Base):
    __tablename__ = "live_book_blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    block_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_books.id"), nullable=False, index=True)
    page_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_book_pages.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ready")
    payload_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    source_refs_json: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    page: Mapped[LiveBookPage] = relationship(back_populates="blocks")


class LiveBookProgress(Base):
    __tablename__ = "live_book_progress"

    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_books.id"), primary_key=True)
    current_page_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    visited_pages: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    bookmarks: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    weak_points: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    weak_chapter_ids: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class LiveBookJob(Base):
    __tablename__ = "live_book_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_books.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    stage: Mapped[str] = mapped_column(String(64), nullable=False, default="queued")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    book: Mapped[LiveBook] = relationship(back_populates="jobs")
    events: Mapped[list["LiveBookJobEvent"]] = relationship(back_populates="job", cascade="all, delete-orphan")


class LiveBookJobEvent(Base):
    __tablename__ = "live_book_job_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    job_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_book_jobs.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    stage: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JsonType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    job: Mapped[LiveBookJob] = relationship(back_populates="events")


class LiveBookQuizAttempt(Base):
    __tablename__ = "live_book_quiz_attempts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    book_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_books.id"), nullable=False, index=True)
    page_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    block_id: Mapped[str] = mapped_column(String(36), nullable=False)
    question_id: Mapped[str] = mapped_column(String(36), nullable=False)
    user_answer: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
