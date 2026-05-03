"""Chat/message domain services for gateway APIs."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
import math
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .knowledge_tracing_service import (
    get_teaching_decisions,
    normalize_learning_event_for_kt,
    process_quiz_answer,
)
from .models import (
    AIChatMessage,
    AIChatSession,
    AILearningRecord,
    AIMessageFeedback,
    AppUser,
    Conversation,
    ConversationMember,
    EventLog,
    LearningEvent,
    Message,
    MessageAttachment,
    StudentKnowledgeState,
    StudentProfile,
)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _supports_for_update(session: Session) -> bool:
    bind = session.get_bind()
    if bind is None:
        return False
    return bind.dialect.name not in {"sqlite"}


def _ensure_user(session: Session, user_id: str, name: str | None = None) -> AppUser:
    user = session.get(AppUser, user_id)
    if user:
        if name and not user.name:
            user.name = name
        return user

    user = AppUser(id=user_id, name=name)
    try:
        # Use a SAVEPOINT so concurrent requests can race safely on users.id.
        with session.begin_nested():
            session.add(user)
            session.flush([user])
        return user
    except IntegrityError as exc:
        message = str(exc).lower()
        if "users" not in message:
            raise
        existing = session.get(AppUser, user_id)
        if existing is None:
            raise
        if name and not existing.name:
            existing.name = name
        return existing


def serialize_conversation(conversation: Conversation, unread_count: int = 0) -> dict[str, Any]:
    return {
        "conversation_id": conversation.id,
        "type": conversation.conversation_type,
        "name": conversation.name,
        "creator_id": conversation.creator_id,
        "last_message_id": conversation.last_message_id,
        "last_message_time": conversation.last_message_time.isoformat() if conversation.last_message_time else None,
        "unread_count": unread_count,
        "created_at": conversation.created_at.isoformat(),
        "updated_at": conversation.updated_at.isoformat(),
    }


def create_conversation(
    session: Session,
    user_id: str,
    conversation_type: str,
    name: str,
    creator_id: str | None = None,
    member_ids: list[str] | None = None,
) -> Conversation:
    creator = creator_id or user_id
    _ensure_user(session, creator)

    conversation = Conversation(
        conversation_type=conversation_type,
        name=name,
        creator_id=creator,
    )
    session.add(conversation)
    session.flush()

    members = set(member_ids or [])
    members.add(user_id)
    members.add(creator)

    for member_id in members:
        _ensure_user(session, member_id)
        session.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=member_id,
                unread_count=0,
                last_read_seq=0,
            )
        )

    session.add(
        EventLog(
            user_id=user_id,
            event_type="conversation_created",
            target_id=conversation.id,
            extra_json={"type": conversation_type, "member_count": len(members)},
        )
    )

    return conversation


def delete_conversation(
    session: Session,
    conversation_id: str,
    operator_user_id: str,
) -> dict[str, Any]:
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise ValueError("Conversation not found")

    if not is_conversation_member(session, conversation_id, operator_user_id):
        raise ValueError("Operator is not a conversation member")

    # Only creator can delete the conversation
    if conversation.creator_id != operator_user_id:
        raise ValueError("Only conversation creator can delete the conversation")

    # Delete related records in correct order to avoid FK violations
    # 1. Delete conversation members
    session.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id
    ).delete(synchronize_session=False)

    # 2. Delete message attachments (via messages)
    message_ids = [
        row[0] for row in
        session.query(Message.id).filter(Message.conversation_id == conversation_id).all()
    ]
    if message_ids:
        session.query(MessageAttachment).filter(
            MessageAttachment.message_id.in_(message_ids)
        ).delete(synchronize_session=False)

    # 3. Delete messages
    session.query(Message).filter(
        Message.conversation_id == conversation_id
    ).delete(synchronize_session=False)

    # 4. Delete the conversation
    session.delete(conversation)

    session.add(
        EventLog(
            user_id=operator_user_id,
            event_type="conversation_deleted",
            target_id=conversation_id,
            extra_json={"conversation_name": conversation.name},
        )
    )
    session.flush()

    return {
        "conversation_id": conversation_id,
        "deleted": True,
    }


def list_conversations(session: Session, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        session.query(Conversation, ConversationMember)
        .join(ConversationMember, Conversation.id == ConversationMember.conversation_id)
        .filter(ConversationMember.user_id == user_id)
        .order_by(Conversation.updated_at.desc())
        .limit(max(1, min(limit, 200)))
        .all()
    )

    return [serialize_conversation(conv, member.unread_count) for conv, member in rows]


def serialize_conversation_member(member: ConversationMember) -> dict[str, Any]:
    return {
        "conversation_id": member.conversation_id,
        "user_id": member.user_id,
        "joined_at": member.joined_at.isoformat(),
        "mute_flag": member.mute_flag,
        "unread_count": member.unread_count,
        "last_read_message_id": member.last_read_message_id,
        "last_read_seq": member.last_read_seq,
    }


def is_conversation_member(session: Session, conversation_id: str, user_id: str) -> bool:
    member = (
        session.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
        .first()
    )
    return member is not None


def list_conversation_members(
    session: Session,
    conversation_id: str,
    requester_user_id: str | None = None,
) -> list[dict[str, Any]]:
    if requester_user_id and not is_conversation_member(session, conversation_id, requester_user_id):
        raise ValueError("Conversation member not found")

    members = (
        session.query(ConversationMember)
        .filter(ConversationMember.conversation_id == conversation_id)
        .order_by(ConversationMember.joined_at.asc())
        .all()
    )
    return [serialize_conversation_member(member) for member in members]


def add_conversation_members(
    session: Session,
    conversation_id: str,
    operator_user_id: str,
    member_ids: list[str],
) -> list[dict[str, Any]]:
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise ValueError("Conversation not found")

    if not is_conversation_member(session, conversation_id, operator_user_id):
        raise ValueError("Operator is not a conversation member")

    existing_members = {
        item.user_id
        for item in session.query(ConversationMember)
        .filter(ConversationMember.conversation_id == conversation_id)
        .all()
    }

    added_members: list[str] = []
    for member_id in member_ids:
        normalized = (member_id or "").strip()
        if not normalized or normalized in existing_members:
            continue

        _ensure_user(session, normalized)
        member = ConversationMember(
            conversation_id=conversation_id,
            user_id=normalized,
            unread_count=0,
            last_read_seq=0,
        )
        session.add(member)
        existing_members.add(normalized)
        added_members.append(normalized)

    if added_members:
        session.add(
            EventLog(
                user_id=operator_user_id,
                event_type="conversation_members_added",
                target_id=conversation_id,
                extra_json={"member_ids": added_members},
            )
        )

    session.flush()
    return list_conversation_members(session, conversation_id)


def remove_conversation_member(
    session: Session,
    conversation_id: str,
    operator_user_id: str,
    member_user_id: str,
) -> dict[str, Any]:
    conversation = session.get(Conversation, conversation_id)
    if not conversation:
        raise ValueError("Conversation not found")

    if not is_conversation_member(session, conversation_id, operator_user_id):
        raise ValueError("Operator is not a conversation member")

    if member_user_id == conversation.creator_id:
        raise ValueError("Cannot remove conversation creator")

    member = (
        session.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == member_user_id,
        )
        .first()
    )
    if not member:
        raise ValueError("Conversation member not found")

    session.delete(member)
    session.add(
        EventLog(
            user_id=operator_user_id,
            event_type="conversation_member_removed",
            target_id=conversation_id,
            extra_json={"member_user_id": member_user_id},
        )
    )
    session.flush()

    return {
        "conversation_id": conversation_id,
        "member_user_id": member_user_id,
        "removed": True,
    }


def _serialize_attachment(attachment: MessageAttachment) -> dict[str, Any]:
    return {
        "attachment_id": attachment.id,
        "file_url": attachment.file_url,
        "file_name": attachment.file_name,
        "file_size": attachment.file_size,
        "mime_type": attachment.mime_type,
        "object_key": attachment.object_key,
    }


def serialize_message(message: Message, attachments: list[MessageAttachment] | None = None) -> dict[str, Any]:
    return {
        "message_id": message.id,
        "conversation_id": message.conversation_id,
        "seq": message.seq,
        "sender_id": message.sender_id,
        "message_type": message.message_type,
        "content": message.content,
        "reply_to_message_id": message.reply_to_message_id,
        "status": message.status,
        "source_type": message.source_type,
        "source_ref_id": message.source_ref_id,
        "recalled_flag": message.recalled_flag,
        "deleted_flag": message.deleted_flag,
        "created_at": message.created_at.isoformat(),
        "attachments": [_serialize_attachment(item) for item in (attachments or [])],
    }


def list_messages(
    session: Session,
    conversation_id: str,
    requester_user_id: str | None = None,
    limit: int = 100,
    before_seq: int | None = None,
) -> list[dict[str, Any]]:
    if requester_user_id and not is_conversation_member(session, conversation_id, requester_user_id):
        raise ValueError("Conversation member not found")

    query = session.query(Message).filter(Message.conversation_id == conversation_id)
    if before_seq is not None:
        query = query.filter(Message.seq < before_seq)

    rows = query.order_by(Message.seq.desc()).limit(max(1, min(limit, 500))).all()
    rows = list(reversed(rows))

    if not rows:
        return []

    message_ids = [row.id for row in rows]
    attachments_by_message: dict[str, list[MessageAttachment]] = {mid: [] for mid in message_ids}
    attachments = (
        session.query(MessageAttachment)
        .filter(MessageAttachment.message_id.in_(message_ids))
        .order_by(MessageAttachment.created_at.asc())
        .all()
    )
    for attachment in attachments:
        attachments_by_message.setdefault(attachment.message_id, []).append(attachment)

    return [serialize_message(row, attachments_by_message.get(row.id) or []) for row in rows]


def create_message(
    session: Session,
    conversation_id: str,
    sender_id: str,
    message_type: str,
    content: str,
    reply_to_message_id: str | None = None,
    status: str = "sent",
    source_type: str = "manual",
    source_ref_id: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> tuple[Message, list[MessageAttachment]]:
    _ensure_user(session, sender_id)
    for attempt in range(3):
        try:
            with session.begin_nested():
                conversation_query = session.query(Conversation).filter(Conversation.id == conversation_id)
                if _supports_for_update(session):
                    conversation_query = conversation_query.with_for_update()
                conversation = conversation_query.first()
                if not conversation:
                    raise ValueError("Conversation not found")

                members_query = session.query(ConversationMember).filter(
                    ConversationMember.conversation_id == conversation_id
                )
                if _supports_for_update(session):
                    members_query = members_query.with_for_update()
                members = members_query.all()

                sender_member = next((item for item in members if item.user_id == sender_id), None)
                if sender_member is None:
                    raise ValueError("Sender is not a conversation member")

                max_seq = (
                    session.query(func.max(Message.seq))
                    .filter(Message.conversation_id == conversation_id)
                    .scalar()
                    or 0
                )
                next_seq = int(max_seq) + 1

                message = Message(
                    conversation_id=conversation_id,
                    seq=next_seq,
                    sender_id=sender_id,
                    message_type=message_type,
                    content=content,
                    reply_to_message_id=reply_to_message_id,
                    status=status,
                    source_type=source_type,
                    source_ref_id=source_ref_id,
                )
                session.add(message)
                session.flush()

                saved_attachments: list[MessageAttachment] = []
                for item in attachments or []:
                    attachment = MessageAttachment(
                        message_id=message.id,
                        file_url=str(item.get("file_url") or ""),
                        file_name=item.get("file_name"),
                        file_size=item.get("file_size"),
                        mime_type=item.get("mime_type"),
                        object_key=item.get("object_key"),
                    )
                    session.add(attachment)
                    saved_attachments.append(attachment)

                conversation.last_message_id = message.id
                conversation.last_message_time = message.created_at
                conversation.updated_at = _utcnow()

                for member in members:
                    if member.user_id == sender_id:
                        member.unread_count = 0
                        member.last_read_seq = max(member.last_read_seq, next_seq)
                        member.last_read_message_id = message.id
                    else:
                        member.unread_count += 1

                session.add(
                    EventLog(
                        user_id=sender_id,
                        event_type="message_sent",
                        target_id=conversation_id,
                        extra_json={
                            "message_id": message.id,
                            "message_type": message_type,
                            "source_type": source_type,
                        },
                    )
                )
            return message, saved_attachments
        except IntegrityError:
            if attempt >= 2:
                raise
            continue
    raise RuntimeError("failed to create message")


def mark_conversation_read(
    session: Session,
    conversation_id: str,
    user_id: str,
    last_read_seq: int | None,
) -> dict[str, Any]:
    member_query = (
        session.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
    )
    if _supports_for_update(session):
        member_query = member_query.with_for_update()
    member = member_query.first()
    if member is None:
        raise ValueError("Conversation member not found")

    effective_seq = last_read_seq
    if effective_seq is None:
        effective_seq = session.query(func.max(Message.seq)).filter(Message.conversation_id == conversation_id).scalar() or 0

    effective_seq = max(member.last_read_seq, int(effective_seq or 0))

    last_message = (
        session.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.seq == effective_seq)
        .first()
    )

    member.last_read_seq = effective_seq
    member.last_read_message_id = last_message.id if last_message else member.last_read_message_id

    unread_count = (
        session.query(func.count(Message.id))
        .filter(
            Message.conversation_id == conversation_id,
            Message.seq > effective_seq,
            Message.sender_id != user_id,
        )
        .scalar()
        or 0
    )
    member.unread_count = int(unread_count)

    session.add(
        EventLog(
            user_id=user_id,
            event_type="conversation_read",
            target_id=conversation_id,
            extra_json={"last_read_seq": effective_seq},
        )
    )

    return {
        "conversation_id": conversation_id,
        "user_id": user_id,
        "last_read_seq": effective_seq,
        "unread_count": member.unread_count,
    }


def serialize_ai_session(record: AIChatSession) -> dict[str, Any]:
    return {
        "session_id": record.id,
        "user_id": record.user_id,
        "title": record.title,
        "source": record.source,
        "subject": record.subject,
        "linked_classroom_id": record.linked_classroom_id,
        "linked_conversation_id": record.linked_conversation_id,
        "archived_flag": record.archived_flag,
        "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(),
    }


def create_ai_session(
    session: Session,
    user_id: str,
    title: str,
    source: str,
    subject: str | None = None,
    linked_classroom_id: str | None = None,
    linked_conversation_id: str | None = None,
) -> AIChatSession:
    _ensure_user(session, user_id)

    record = AIChatSession(
        user_id=user_id,
        title=title,
        source=source,
        subject=subject,
        linked_classroom_id=linked_classroom_id,
        linked_conversation_id=linked_conversation_id,
        archived_flag=False,
    )
    session.add(record)

    session.add(
        EventLog(
            user_id=user_id,
            event_type="ai_session_created",
            target_id=record.id,
            extra_json={"source": source, "subject": subject},
        )
    )

    session.flush()
    return record


def list_ai_sessions(
    session: Session,
    user_id: str,
    limit: int = 50,
    linked_conversation_id: str | None = None,
) -> list[dict[str, Any]]:
    query = session.query(AIChatSession).filter(
        AIChatSession.user_id == user_id,
        AIChatSession.archived_flag == False,  # noqa: E712
    )
    if linked_conversation_id:
        query = query.filter(AIChatSession.linked_conversation_id == linked_conversation_id)

    rows = query.order_by(AIChatSession.updated_at.desc()).limit(max(1, min(limit, 200))).all()
    return [serialize_ai_session(row) for row in rows]


def serialize_ai_message(message: AIChatMessage) -> dict[str, Any]:
    return {
        "message_id": message.id,
        "session_id": message.session_id,
        "role": message.role,
        "content": message.content,
        "content_type": message.content_type,
        "model_name": message.model_name,
        "prompt_tokens": message.prompt_tokens,
        "completion_tokens": message.completion_tokens,
        "total_tokens": message.total_tokens,
        "latency_ms": message.latency_ms,
        "request_id": message.request_id,
        "parent_message_id": message.parent_message_id,
        "created_at": message.created_at.isoformat(),
    }


def list_ai_messages(session: Session, session_id: str, limit: int = 200) -> list[dict[str, Any]]:
    rows = (
        session.query(AIChatMessage)
        .filter(AIChatMessage.session_id == session_id)
        .order_by(AIChatMessage.created_at.asc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    return [serialize_ai_message(row) for row in rows]


def create_ai_message(
    session: Session,
    session_id: str,
    role: str,
    content: str,
    user_id: str | None = None,
    content_type: str = "text",
    model_name: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    latency_ms: int | None = None,
    request_id: str | None = None,
    parent_message_id: str | None = None,
) -> AIChatMessage:
    ai_session = session.get(AIChatSession, session_id)
    if not ai_session:
        raise ValueError("AI session not found")

    if user_id and ai_session.user_id != user_id:
        raise ValueError("AI session does not belong to user")

    if request_id:
        existing = session.query(AIChatMessage).filter(AIChatMessage.request_id == request_id).first()
        if existing:
            return existing

    try:
        with session.begin_nested():
            message = AIChatMessage(
                session_id=session_id,
                role=role,
                content=content,
                content_type=content_type,
                model_name=model_name,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                latency_ms=latency_ms,
                request_id=request_id,
                parent_message_id=parent_message_id,
            )
            session.add(message)
            session.flush()
    except IntegrityError:
        if request_id:
            existing = session.query(AIChatMessage).filter(AIChatMessage.request_id == request_id).first()
            if existing:
                return existing
        raise

    ai_session.updated_at = _utcnow()

    session.add(
        EventLog(
            user_id=ai_session.user_id,
            event_type="ai_message_created",
            target_id=message.id,
            extra_json={"session_id": session_id, "role": role},
        )
    )

    return message


def upsert_ai_feedback(
    session: Session,
    message_id: str,
    user_id: str,
    rating: str,
    feedback_text: str | None = None,
) -> AIMessageFeedback:
    _ensure_user(session, user_id)

    feedback = (
        session.query(AIMessageFeedback)
        .filter(
            AIMessageFeedback.message_id == message_id,
            AIMessageFeedback.user_id == user_id,
        )
        .first()
    )

    if feedback is not None:
        feedback.rating = rating
        feedback.feedback_text = feedback_text
        session.flush()
        return feedback

    try:
        with session.begin_nested():
            feedback = AIMessageFeedback(
                message_id=message_id,
                user_id=user_id,
                rating=rating,
                feedback_text=feedback_text,
            )
            session.add(feedback)
            session.flush()
    except IntegrityError:
        feedback = (
            session.query(AIMessageFeedback)
            .filter(
                AIMessageFeedback.message_id == message_id,
                AIMessageFeedback.user_id == user_id,
            )
            .first()
        )
        if feedback is None:
            raise
        feedback.rating = rating
        feedback.feedback_text = feedback_text
        session.flush()
    return feedback


def serialize_ai_feedback(feedback: AIMessageFeedback) -> dict[str, Any]:
    return {
        "feedback_id": feedback.id,
        "message_id": feedback.message_id,
        "user_id": feedback.user_id,
        "rating": feedback.rating,
        "feedback_text": feedback.feedback_text,
        "created_at": feedback.created_at.isoformat(),
    }


_SUBJECT_RULES: list[tuple[str, str]] = [
    (r"函数|导数|极限|方程|几何|三角|概率|数学", "数学"),
    (r"物理|力学|电路|速度|加速度", "物理"),
    (r"化学|分子|离子|反应", "化学"),
    (r"英语|语法|单词|阅读", "英语"),
]


_KNOWLEDGE_KEYWORDS = [
    "二次函数",
    "一次函数",
    "几何",
    "三角函数",
    "导数",
    "极限",
    "概率",
    "方程",
    "不等式",
    "牛顿定律",
    "电路",
    "化学反应",
    "概率统计",
    "函数图像",
    "一元二次方程",
    "圆与扇形",
    "古诗文",
]


_CONFUSION_PATTERN = re.compile(r"不会|不懂|为什么|看不懂|疑惑|卡住|\?|？")
_SOLVED_PATTERN = re.compile(r"会了|懂了|明白了|已经会|搞懂|解决了|算出来|想通了|谢谢")
_HARD_PATTERN = re.compile(r"竞赛|压轴|复杂|很难|太难|挑战")
_EASY_PATTERN = re.compile(r"基础|入门|简单|不难|容易")
_CALCULATION_PATTERN = re.compile(r"计算|求|解|化简|代入")
_PROOF_PATTERN = re.compile(r"证明|推导|说明|论证")
_CHOICE_PATTERN = re.compile(r"选择|选项|A\.|B\.|C\.|D\.")
_STEP_PATTERN = re.compile(r"步骤|第[一二三四五六七八九十\d]+步|思路")


def _detect_subject(text: str) -> str:
    for pattern, subject in _SUBJECT_RULES:
        if re.search(pattern, text):
            return subject
    return "综合"


def _extract_knowledge_points(text: str) -> list[str]:
    hits: list[str] = []
    for keyword in _KNOWLEDGE_KEYWORDS:
        if keyword in text:
            hits.append(keyword)
    if hits:
        return list(dict.fromkeys(hits))

    # A light-weight regex fallback for compact domain terms.
    regex_hits = re.findall(r"([一-龥A-Za-z0-9]{2,16}(?:函数|方程|定理|法则|模型|公式))", text)
    if regex_hits:
        return list(dict.fromkeys(regex_hits[:3]))

    snippet = text.strip().replace("\n", " ")
    if not snippet:
        return []
    return [snippet[: min(20, len(snippet))]]


def _detect_question_type(text: str) -> str:
    if _PROOF_PATTERN.search(text):
        return "proof"
    if _CALCULATION_PATTERN.search(text):
        return "calculation"
    if _CHOICE_PATTERN.search(text):
        return "multiple_choice"
    if _STEP_PATTERN.search(text):
        return "step_by_step"
    return "qa"


def _detect_difficulty(text: str) -> str:
    if _HARD_PATTERN.search(text):
        return "hard"
    if _EASY_PATTERN.search(text):
        return "easy"
    return "medium"


def _detect_solved(text: str, confusion_flag: bool) -> bool:
    if confusion_flag and _CONFUSION_PATTERN.search(text):
        # "还是不懂" should not be treated as solved.
        if re.search(r"还是不懂|仍然不会|依旧不会|还不会", text):
            return False
    return bool(_SOLVED_PATTERN.search(text))


def extract_learning_records(
    session: Session,
    ai_session_id: str,
    user_id: str | None = None,
    extract_version: str = "v1",
    latest_user_message_id: str | None = None,
    message_count: int | None = None,
) -> dict[str, Any]:
    ai_session = session.get(AIChatSession, ai_session_id)
    if not ai_session:
        raise ValueError("AI session not found")

    if user_id and user_id != ai_session.user_id:
        raise ValueError("AI session does not belong to user")

    owner_id = ai_session.user_id

    last_extract_event = (
        session.query(EventLog)
        .filter(
            EventLog.user_id == owner_id,
            EventLog.event_type == "learning_records_extracted",
            EventLog.target_id == ai_session_id,
        )
        .order_by(EventLog.created_at.desc())
        .first()
    )
    if latest_user_message_id and last_extract_event and isinstance(last_extract_event.extra_json, dict):
        last_snapshot_message_id = str(last_extract_event.extra_json.get("latest_user_message_id") or "")
        last_snapshot_message_count = last_extract_event.extra_json.get("message_count")
        same_message_count = True
        if message_count is not None and last_snapshot_message_count is not None:
            try:
                same_message_count = int(last_snapshot_message_count) == int(message_count)
            except (TypeError, ValueError):
                same_message_count = False
        if (
            last_snapshot_message_id
            and last_snapshot_message_id == latest_user_message_id
            and same_message_count
        ):
            return {
                "session_id": ai_session_id,
                "user_id": owner_id,
                "records_created": 0,
                "subjects": [],
                "knowledge_points": [],
                "extract_version": extract_version,
                "latest_user_message_id": latest_user_message_id,
                "message_count": message_count,
            }

    messages = (
        session.query(AIChatMessage)
        .filter(AIChatMessage.session_id == ai_session_id)
        .order_by(AIChatMessage.created_at.asc())
        .all()
    )

    if not messages:
        return {
            "session_id": ai_session_id,
            "user_id": owner_id,
            "records_created": 0,
            "subjects": [],
            "knowledge_points": [],
            "extract_version": extract_version,
            "latest_user_message_id": latest_user_message_id,
            "message_count": message_count,
        }

    created = 0
    subjects: set[str] = set()
    knowledge_points: set[str] = set()

    weak_subjects: set[str] = set()
    weak_points: set[str] = set()
    last_user_message_id: str | None = None
    user_message_count = 0

    existing_pairs = {
        (item[0], item[1])
        for item in session.query(AILearningRecord.message_id, AILearningRecord.knowledge_point)
        .filter(
            AILearningRecord.session_id == ai_session_id,
            AILearningRecord.extract_version == extract_version,
        )
        .all()
        if item[0] and item[1]
    }

    for message in messages:
        if message.role != "user":
            continue

        text = (message.content or "").strip()
        if not text:
            continue

        user_message_count += 1
        last_user_message_id = message.id

        subject = _detect_subject(text)
        kps = _extract_knowledge_points(text)
        confusion = bool(_CONFUSION_PATTERN.search(text))
        solved = _detect_solved(text, confusion)
        question_type = _detect_question_type(text)
        difficulty = _detect_difficulty(text)

        subjects.add(subject)
        for kp in kps:
            knowledge_points.add(kp)
            pair = (message.id, kp)
            if pair in existing_pairs:
                continue
            record_id = str(
                uuid5(
                    NAMESPACE_URL,
                    f"learning-record:{ai_session_id}:{message.id}:{kp}:{extract_version}",
                )
            )
            try:
                with session.begin_nested():
                    session.add(
                        AILearningRecord(
                            id=record_id,
                            user_id=owner_id,
                            session_id=ai_session_id,
                            message_id=message.id,
                            subject=subject,
                            knowledge_point=kp,
                            question_type=question_type,
                            difficulty=difficulty,
                            solved_flag=solved,
                            confusion_flag=confusion,
                            extract_version=extract_version,
                        )
                    )
                    session.flush()
            except IntegrityError:
                continue

            existing_pairs.add(pair)
            created += 1

            if confusion and not solved:
                weak_subjects.add(subject)
                weak_points.add(kp)

    profile = session.get(StudentProfile, owner_id)
    if profile is None:
        profile = StudentProfile(
            user_id=owner_id,
            weak_subjects=[],
            weak_knowledge_points=[],
            recent_focus=next(iter(subjects), None),
        )
        session.add(profile)

    merged_subjects = set(profile.weak_subjects or [])
    merged_points = set(profile.weak_knowledge_points or [])
    merged_subjects.update(weak_subjects)
    merged_points.update(weak_points)

    profile.weak_subjects = sorted(merged_subjects)
    profile.weak_knowledge_points = sorted(merged_points)
    if subjects:
        profile.recent_focus = next(iter(subjects))

    snapshot_message_id = latest_user_message_id or last_user_message_id
    snapshot_message_count = message_count if message_count is not None else user_message_count
    session.add(
        EventLog(
            user_id=owner_id,
            event_type="learning_records_extracted",
            target_id=ai_session_id,
            extra_json={
                "records_created": created,
                "extract_version": extract_version,
                "latest_user_message_id": snapshot_message_id,
                "message_count": snapshot_message_count,
            },
        )
    )

    return {
        "session_id": ai_session_id,
        "user_id": owner_id,
        "records_created": created,
        "subjects": sorted(subjects),
        "knowledge_points": sorted(knowledge_points),
        "extract_version": extract_version,
        "latest_user_message_id": snapshot_message_id,
        "message_count": snapshot_message_count,
    }


def serialize_learning_record(record: AILearningRecord) -> dict[str, Any]:
    return {
        "record_id": record.id,
        "user_id": record.user_id,
        "session_id": record.session_id,
        "message_id": record.message_id,
        "subject": record.subject,
        "knowledge_point": record.knowledge_point,
        "question_type": record.question_type,
        "difficulty": record.difficulty,
        "solved_flag": bool(record.solved_flag),
        "confusion_flag": bool(record.confusion_flag),
        "extract_version": record.extract_version,
        "created_at": record.created_at.isoformat(),
    }


def list_learning_records(
    session: Session,
    session_id: str,
    *,
    user_id: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    ai_session = session.get(AIChatSession, session_id)
    if not ai_session:
        raise ValueError("AI session not found")
    if user_id and user_id != ai_session.user_id:
        raise ValueError("AI session does not belong to user")

    rows = (
        session.query(AILearningRecord)
        .filter(AILearningRecord.session_id == session_id)
        .order_by(AILearningRecord.created_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    rows.reverse()
    return [serialize_learning_record(row) for row in rows]


def _safe_div(value: float, denom: float) -> float:
    if denom <= 0:
        return 0.0
    return value / denom


def _clamp_score(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return max(minimum, min(maximum, int(round(value))))


def _time_decay_weight(created_at: datetime, now: datetime) -> float:
    age_days = max(0.0, (now - created_at).total_seconds() / 86400.0)
    # Half-life ~ 35 days. Recent behavior contributes more.
    return math.exp(-age_days / 35.0)


def get_student_profile_snapshot(
    session: Session,
    user_id: str,
    *,
    lookback_days: int = 120,
) -> dict[str, Any]:
    profile = session.get(StudentProfile, user_id)
    now = _utcnow()
    safe_lookback = max(14, min(lookback_days, 365))
    cutoff = now - timedelta(days=safe_lookback)
    cutoff_14d = now - timedelta(days=14)

    records = (
        session.query(AILearningRecord)
        .filter(
            AILearningRecord.user_id == user_id,
            AILearningRecord.created_at >= cutoff,
        )
        .order_by(AILearningRecord.created_at.desc())
        .limit(5000)
        .all()
    )
    records.reverse()
    learning_events = (
        session.query(LearningEvent)
        .filter(
            LearningEvent.user_id == user_id,
            LearningEvent.created_at >= cutoff,
        )
        .order_by(LearningEvent.created_at.asc())
        .limit(5000)
        .all()
    )

    if not records and not learning_events:
        return {
            "user_id": user_id,
            "weak_subjects": sorted(profile.weak_subjects or []) if profile else [],
            "weak_knowledge_points": sorted(profile.weak_knowledge_points or []) if profile else [],
            "recent_focus": profile.recent_focus if profile else None,
            "ability_scores": [
                {"metric": "概念理解", "value": 50, "full_mark": 100},
                {"metric": "练习表现", "value": 50, "full_mark": 100},
                {"metric": "实践应用", "value": 50, "full_mark": 100},
                {"metric": "反思复盘", "value": 50, "full_mark": 100},
                {"metric": "学习主动性", "value": 50, "full_mark": 100},
            ],
            "learning_stats": {
                "records_total": 0,
                "records_14d": 0,
                "active_days_14": 0,
                "confusion_records": 0,
                "solved_records": 0,
                "top_subjects": [],
                "top_knowledge_points": [],
                "total_weight": 0.0,
            },
            "updated_at": profile.updated_at.isoformat() if profile else None,
            "computed_at": now.isoformat(),
            "profile_source": "profile_only",
        }

    subject_weight = defaultdict(float)
    subject_confusion_weight = defaultdict(float)
    subject_solved_weight = defaultdict(float)
    knowledge_risk_weight = defaultdict(float)
    question_type_weight = defaultdict(float)
    active_days_14_set: set[str] = set()

    total_weight = 0.0
    solved_weight = 0.0
    confusion_weight = 0.0
    hard_weight = 0.0
    recent_focus_counter = Counter()
    records_14d = 0
    confusion_records = 0
    solved_records = 0

    for row in records:
        if not row.created_at:
            continue
        weight = _time_decay_weight(row.created_at, now)
        total_weight += weight
        subject = row.subject or "综合"
        subject_weight[subject] += weight
        question_type_weight[row.question_type or "qa"] += weight
        recent_focus_counter[subject] += 1

        if row.created_at >= cutoff_14d:
            records_14d += 1
            active_days_14_set.add(row.created_at.date().isoformat())

        if row.confusion_flag:
            confusion_records += 1
            confusion_weight += weight
            subject_confusion_weight[subject] += weight
            if row.knowledge_point:
                knowledge_risk_weight[row.knowledge_point] += weight * 1.3
        if row.solved_flag:
            solved_records += 1
            solved_weight += weight
            subject_solved_weight[subject] += weight
            if row.knowledge_point:
                knowledge_risk_weight[row.knowledge_point] = max(
                    0.0,
                    knowledge_risk_weight[row.knowledge_point] - weight * 0.45,
                )
        if (row.difficulty or "") == "hard":
            hard_weight += weight

    for event in learning_events:
        if not event.created_at:
            continue
        payload = event.payload or {}
        event_type = event.event_type
        weight = _time_decay_weight(event.created_at, now) * max(0.1, min(float(event.weight or 1.0), 5.0))
        total_weight += weight

        subject = str(payload.get("subject") or payload.get("topic") or "综合")
        subject_weight[subject] += weight
        recent_focus_counter[subject] += 1

        if event.created_at >= cutoff_14d:
            records_14d += 1
            active_days_14_set.add(event.created_at.date().isoformat())

        knowledge_points = event.knowledge_points or []
        if not knowledge_points and payload.get("knowledge_point"):
            knowledge_points = [str(payload.get("knowledge_point"))]

        is_confusion = event_type in {
            "confusion_detected",
            "hint_used",
            "knowledge_point_struggled",
            "feedback_dislike",
        }
        is_solved = event_type in {
            "problem_solved",
            "knowledge_point_mastered",
            "scene_completed",
            "feedback_like",
        }
        if event_type == "quiz_answered":
            is_correct = bool(payload.get("is_correct"))
            is_solved = is_correct
            is_confusion = not is_correct
            question_type_weight["quiz"] += weight
        elif event_type == "video_watched":
            watched_ratio = float(payload.get("watched_ratio") or payload.get("completion_rate") or 0.0)
            is_solved = watched_ratio >= 0.8
            question_type_weight["video"] += weight
        elif event_type == "notebook_saved":
            question_type_weight["reflection"] += weight
        elif event_type == "asked_question":
            question_type_weight["qa"] += weight

        if is_confusion:
            confusion_records += 1
            confusion_weight += weight
            subject_confusion_weight[subject] += weight
            for point in knowledge_points:
                if point:
                    knowledge_risk_weight[point] += weight * 1.1
        if is_solved:
            solved_records += 1
            solved_weight += weight
            subject_solved_weight[subject] += weight
            for point in knowledge_points:
                if point:
                    knowledge_risk_weight[point] = max(0.0, knowledge_risk_weight[point] - weight * 0.35)

    confusion_ratio = _safe_div(confusion_weight, total_weight)
    solved_ratio = _safe_div(solved_weight, total_weight)
    active_days_14 = len(active_days_14_set)
    diversity_ratio = min(len(subject_weight), 4) / 4.0
    application_signal = _safe_div(
        question_type_weight.get("proof", 0.0) + question_type_weight.get("calculation", 0.0),
        total_weight,
    )
    initiative_signal = min(1.0, _safe_div(active_days_14, 14.0))

    ability_scores = [
        {
            "metric": "概念理解",
            "value": _clamp_score(84 - confusion_ratio * 46 + solved_ratio * 18),
            "full_mark": 100,
        },
        {
            "metric": "练习表现",
            "value": _clamp_score(34 + solved_ratio * 52 + (1 - confusion_ratio) * 14),
            "full_mark": 100,
        },
        {
            "metric": "实践应用",
            "value": _clamp_score(30 + application_signal * 36 + solved_ratio * 22 + diversity_ratio * 10),
            "full_mark": 100,
        },
        {
            "metric": "反思复盘",
            "value": _clamp_score(
                28 + min(1.0, _safe_div(solved_weight + hard_weight * 0.4, confusion_weight + 1e-6)) * 32
                + initiative_signal * 10
            ),
            "full_mark": 100,
        },
        {
            "metric": "学习主动性",
            "value": _clamp_score(30 + initiative_signal * 42 + diversity_ratio * 18 + min(1.0, _safe_div(total_weight, 25)) * 10),
            "full_mark": 100,
        },
    ]

    subject_risk = {}
    for subject, weight in subject_weight.items():
        confusion_w = subject_confusion_weight.get(subject, 0.0)
        solved_w = subject_solved_weight.get(subject, 0.0)
        risk = confusion_w * 1.15 + max(weight - solved_w, 0.0) * 0.35
        if risk > 0:
            subject_risk[subject] = risk

    computed_weak_subjects = [
        item[0]
        for item in sorted(subject_risk.items(), key=lambda kv: kv[1], reverse=True)
        if item[1] > 0.25
    ][:6]
    merged_weak_subjects = set(profile.weak_subjects or []) if profile else set()
    merged_weak_subjects.update(computed_weak_subjects)

    computed_weak_points = [
        item[0]
        for item in sorted(knowledge_risk_weight.items(), key=lambda kv: kv[1], reverse=True)
        if item[1] > 0.2
    ][:12]
    merged_weak_points = set(profile.weak_knowledge_points or []) if profile else set()
    merged_weak_points.update(computed_weak_points)

    recent_focus = None
    if recent_focus_counter:
        recent_focus = recent_focus_counter.most_common(1)[0][0]
    if profile and profile.recent_focus:
        recent_focus = recent_focus or profile.recent_focus

    top_subjects = [item[0] for item in sorted(subject_weight.items(), key=lambda kv: kv[1], reverse=True)[:3]]
    top_knowledge_points = [
        item[0] for item in sorted(knowledge_risk_weight.items(), key=lambda kv: kv[1], reverse=True)[:5]
    ]

    updated_at_candidates = [now]
    if profile and profile.updated_at:
        updated_at_candidates.append(profile.updated_at)
    latest_record_at = records[-1].created_at if records and records[-1].created_at else None
    if latest_record_at:
        updated_at_candidates.append(latest_record_at)
    latest_event_at = learning_events[-1].created_at if learning_events and learning_events[-1].created_at else None
    if latest_event_at:
        updated_at_candidates.append(latest_event_at)

    # Knowledge Tracing augmentation: include BKT states for weakest KPs
    kt_summaries: list[dict[str, Any]] = []
    try:
        kt_states = (
            session.query(StudentKnowledgeState)
            .filter(StudentKnowledgeState.user_id == user_id)
            .order_by(StudentKnowledgeState.p_mastery.asc())
            .limit(20)
            .all()
        )
        if kt_states:
            kp_ids = [s.knowledge_point_id for s in kt_states]
            decisions = {d["target_knowledge_point_id"]: d for d in get_teaching_decisions(session, user_id, knowledge_point_ids=kp_ids)}
            for s in kt_states:
                dec = decisions.get(s.knowledge_point_id, {})
                kt_summaries.append({
                    "knowledge_point_id": s.knowledge_point_id,
                    "p_mastery": round(s.p_mastery, 4),
                    "attempts": s.attempts,
                    "correct_attempts": s.correct_attempts,
                    "action": dec.get("action"),
                    "action_reason": dec.get("reason"),
                })
    except Exception:
        # KT is additive; never break profile computation if KT query fails
        pass

    return {
        "user_id": user_id,
        "weak_subjects": sorted(merged_weak_subjects),
        "weak_knowledge_points": sorted(merged_weak_points),
        "recent_focus": recent_focus,
        "ability_scores": ability_scores,
        "learning_stats": {
            "records_total": len(records) + len(learning_events),
            "records_14d": records_14d,
            "active_days_14": active_days_14,
            "confusion_records": confusion_records,
            "solved_records": solved_records,
            "top_subjects": top_subjects,
            "top_knowledge_points": top_knowledge_points,
            "total_weight": round(total_weight, 4),
        },
        "updated_at": max(updated_at_candidates).isoformat() if updated_at_candidates else None,
        "computed_at": now.isoformat(),
        "profile_source": "computed_with_decay",
        "knowledge_tracing": kt_summaries,
    }


def create_learning_event(
    session: Session,
    user_id: str,
    event_type: str,
    session_id: str | None = None,
    classroom_id: str | None = None,
    scene_id: str | None = None,
    block_id: str | None = None,
    knowledge_points: list[str] | None = None,
    payload: dict | None = None,
    weight: float = 1.0,
) -> LearningEvent:
    normalized_payload, normalized_knowledge_points = normalize_learning_event_for_kt(
        event_type=event_type,
        payload=payload,
        block_id=block_id,
        scene_id=scene_id,
        knowledge_points=knowledge_points,
    )

    event = LearningEvent(
        user_id=user_id,
        event_type=event_type,
        session_id=session_id,
        classroom_id=classroom_id,
        scene_id=scene_id,
        block_id=block_id,
        knowledge_points=normalized_knowledge_points,
        payload=normalized_payload,
        weight=weight,
    )
    session.add(event)
    session.flush()

    # Knowledge Tracing integration: update BKT states for quiz answers
    if event_type == "quiz_answered" and normalized_payload:
        question_id = (
            normalized_payload.get("question_id")
            or normalized_payload.get("questionId")
            or block_id
            or scene_id
        )
        is_correct = bool(normalized_payload.get("is_correct", normalized_payload.get("isCorrect", False)))
        if question_id:
            process_quiz_answer(
                session=session,
                user_id=user_id,
                question_id=str(question_id),
                is_correct=is_correct,
                knowledge_point_ids=normalized_payload.get("knowledge_point_ids")
                if isinstance(normalized_payload.get("knowledge_point_ids"), list)
                else None,
                event_knowledge_points=normalized_knowledge_points,
                block_id=block_id,
                scene_id=scene_id,
                source_event_id=event.id,
                payload=normalized_payload,
            )

    return event


def serialize_learning_event(event: LearningEvent) -> dict[str, Any]:
    return {
        "event_id": event.id,
        "user_id": event.user_id,
        "event_type": event.event_type,
        "session_id": event.session_id,
        "classroom_id": event.classroom_id,
        "scene_id": event.scene_id,
        "block_id": event.block_id,
        "knowledge_points": event.knowledge_points or [],
        "payload": event.payload or {},
        "weight": event.weight,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def list_learning_events(
    session: Session,
    user_id: str,
    *,
    event_type: str | None = None,
    classroom_id: str | None = None,
    scene_id: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    query = session.query(LearningEvent).filter(LearningEvent.user_id == user_id)
    if event_type:
        query = query.filter(LearningEvent.event_type == event_type)
    if classroom_id:
        query = query.filter(LearningEvent.classroom_id == classroom_id)
    if scene_id:
        query = query.filter(LearningEvent.scene_id == scene_id)
    rows = query.order_by(LearningEvent.created_at.desc()).limit(limit).all()
    return [serialize_learning_event(row) for row in rows]


def get_learning_event_stats(
    session: Session,
    user_id: str,
    *,
    classroom_id: str | None = None,
    lookback_days: int = 30,
) -> dict[str, Any]:
    now = _utcnow()
    cutoff = now - timedelta(days=lookback_days)

    query = session.query(LearningEvent).filter(
        LearningEvent.user_id == user_id,
        LearningEvent.created_at >= cutoff,
    )
    if classroom_id:
        query = query.filter(LearningEvent.classroom_id == classroom_id)

    rows = query.all()

    type_counter: Counter = Counter()
    type_latest: dict[str, datetime] = {}
    knowledge_points_set: set[str] = set()

    for row in rows:
        type_counter[row.event_type] += 1
        if row.created_at:
            current_latest = type_latest.get(row.event_type)
            if current_latest is None or row.created_at > current_latest:
                type_latest[row.event_type] = row.created_at
        if row.knowledge_points:
            for kp in row.knowledge_points:
                if kp:
                    knowledge_points_set.add(kp)

    by_type = []
    for event_type, count in type_counter.most_common():
        by_type.append({
            "event_type": event_type,
            "count": count,
            "latest_at": type_latest.get(event_type, now).isoformat(),
        })

    return {
        "total_events": len(rows),
        "by_type": by_type,
        "knowledge_points_involved": sorted(knowledge_points_set),
    }
