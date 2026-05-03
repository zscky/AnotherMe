"""Business logic for unified job lifecycle and execution."""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import mkdtemp
from typing import Any, Dict, Iterable, Protocol
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .anotherme_executor import (
    MissingInputObjectError,
    build_requirement_from_photo,
    extract_core_example_text,
    run_problem_video_job,
    synthesize_problem_image_from_text,
)
from .chat_service import extract_learning_records, get_student_profile_snapshot
from .config import Settings
from .course_generation_provider import create_course_generation_provider
from .models import AILearningRecord, Job, JobArtifact, JobEvent
from .anotherme_client import AnotherMeClient, AnotherMeError
from agents.foundation.trace_event import TraceEvent, TraceEventEmitter
from .queueing import QueueMessage
from .schemas import CreateJobRequest, JobStatus, JobType, validate_job_payload
from .storage import ObjectStorage


RUNNING_STATUSES = {JobStatus.QUEUED.value, JobStatus.RUNNING.value}
RETRY_NOT_BEFORE_KEY = "retry_not_before"


class QueueClientLike(Protocol):
    def enqueue(self, queue_name: str, message: QueueMessage) -> None:
        ...

    def push_dead_letter(self, dlq_name: str, message: QueueMessage) -> None:
        ...


class JobServiceError(RuntimeError):
    pass


def _utcnow() -> datetime:
    return datetime.utcnow()


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        return parsed.astimezone(tz=None).replace(tzinfo=None)
    return parsed


def _get_retry_not_before(job: Job) -> datetime | None:
    state = job.engine_state or {}
    return _parse_iso_datetime(state.get(RETRY_NOT_BEFORE_KEY))


def _clear_retry_schedule(job: Job) -> None:
    state = dict(job.engine_state or {})
    if RETRY_NOT_BEFORE_KEY in state:
        state.pop(RETRY_NOT_BEFORE_KEY, None)
        job.engine_state = state


def is_job_ready_for_execution(job: Job, now: datetime | None = None) -> bool:
    target = _get_retry_not_before(job)
    if not target:
        return True
    return (now or _utcnow()) >= target


def canonical_json(data: Dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_idempotency_key(job_type: str, normalized_payload: Dict[str, Any], user_id: str) -> str:
    raw = f"{job_type}|{canonical_json(normalized_payload)}|{user_id}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def add_event(session: Session, job_id: str, event_type: str, message: str, payload: Dict[str, Any] | None = None) -> None:
    session.add(
        JobEvent(
            job_id=job_id,
            event_type=event_type,
            message=message,
            payload=payload,
        )
    )


def add_trace_event(
    session: Session,
    job_id: str,
    event_type: str,
    message: str,
    trace_event_id: str,
    trace_event_type: str,
    payload: Dict[str, Any] | None = None,
) -> None:
    session.add(
        JobEvent(
            job_id=job_id,
            event_type=event_type,
            message=message,
            payload=payload,
            trace_event_id=trace_event_id,
            trace_event_type=trace_event_type,
        )
    )


def _persist_trace_events(session: Session, job_id: str, trace: TraceEventEmitter) -> None:
    existing_ids = {
        row[0]
        for row in session.query(JobEvent.trace_event_id)
        .filter(JobEvent.job_id == job_id, JobEvent.trace_event_id.isnot(None))
        .all()
    }
    for event in trace.events:
        if not event.id or event.id in existing_ids:
            continue
        add_trace_event(
            session,
            job_id,
            event.type or "trace",
            event.message or event.type or "Trace event",
            trace_event_id=event.id,
            trace_event_type=event.type,
            payload=event.to_dict(),
        )
        existing_ids.add(event.id)


def add_artifact(
    session: Session,
    job_id: str,
    artifact_type: str,
    object_key: str,
    url: str,
    metadata: Dict[str, Any] | None = None,
) -> None:
    session.add(
        JobArtifact(
            job_id=job_id,
            artifact_type=artifact_type,
            object_key=object_key,
            url=url,
            artifact_metadata=metadata,
        )
    )


def serialize_job(job: Job) -> Dict[str, Any]:
    return {
        "job_id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "progress": job.progress,
        "step": job.step,
        "error_code": job.error_code,
        "error_message": job.error_message,
        "result": job.result_payload,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
    }


def create_or_get_job(
    session: Session,
    request: CreateJobRequest,
    settings: Settings,
) -> tuple[Job, bool]:
    normalized_payload = validate_job_payload(request.job_type, request.payload)
    idem_key = compute_idempotency_key(request.job_type.value, normalized_payload, request.user_id)

    existing = (
        session.query(Job)
        .filter(Job.idempotency_key == idem_key)
        .order_by(Job.created_at.desc())
        .first()
    )
    if existing and existing.status in RUNNING_STATUSES.union({JobStatus.SUCCEEDED.value}):
        return existing, False

    queue_name = settings.queue_mapping[request.job_type.value]
    job = Job(
        job_type=request.job_type.value,
        queue_name=queue_name,
        user_id=request.user_id,
        idempotency_key=idem_key,
        status=JobStatus.QUEUED.value,
        progress=0,
        step="queued",
        max_retries=settings.max_retries,
        input_payload=request.payload,
        normalized_payload=normalized_payload,
        engine_state={},
    )
    session.add(job)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        existing = (
            session.query(Job)
            .filter(Job.idempotency_key == idem_key)
            .order_by(Job.created_at.desc())
            .first()
        )
        if existing:
            return existing, False
        raise

    add_event(session, job.id, "queued", "Job accepted and queued", {"queue": queue_name})
    return job, True


def dequeue_next_queued_job(
    session: Session,
    queue_names: list[str],
    *,
    scan_limit_per_queue: int = 100,
) -> QueueMessage | None:
    now = _utcnow()
    for queue_name in queue_names:
        jobs = (
            session.query(Job)
            .filter(Job.queue_name == queue_name, Job.status == JobStatus.QUEUED.value)
            .order_by(Job.created_at.asc())
            .limit(max(1, scan_limit_per_queue))
            .all()
        )
        if not jobs:
            continue
        for job in jobs:
            if is_job_ready_for_execution(job, now):
                return QueueMessage(job_id=job.id, job_type=job.job_type, queue_name=job.queue_name)
    return None


def recover_stale_running_jobs(
    session: Session,
    queue_client: QueueClientLike,
    queue_names: Iterable[str],
    *,
    stale_seconds: int,
    max_recoveries: int,
) -> int:
    if stale_seconds <= 0 or max_recoveries <= 0:
        return 0

    queue_name_list = [name for name in queue_names if str(name or "").strip()]
    if not queue_name_list:
        return 0

    cutoff = _utcnow() - timedelta(seconds=stale_seconds)
    stale_jobs = (
        session.query(Job)
        .filter(
            Job.status == JobStatus.RUNNING.value,
            Job.queue_name.in_(queue_name_list),
            Job.updated_at < cutoff,
        )
        .order_by(Job.updated_at.asc())
        .limit(max_recoveries)
        .all()
    )

    recovered = 0
    for job in stale_jobs:
        job.attempt_count += 1
        stale_message = (
            "Detected stale running job and reclaimed it for retry "
            f"(step={job.step}, stale_seconds={stale_seconds}, "
            f"attempt={job.attempt_count}/{job.max_retries})."
        )

        if job.attempt_count > job.max_retries:
            _mark_failed(session, job, "JOB_STALE_TIMEOUT", stale_message)
            continue

        job.status = JobStatus.QUEUED.value
        job.step = "queued"
        job.error_code = "RECOVERED_STALE_RUNNING"
        job.error_message = stale_message
        job.updated_at = _utcnow()
        add_event(
            session,
            job.id,
            "recovered",
            stale_message,
            {
                "reason": "stale_running",
                "stale_seconds": stale_seconds,
                "attempt": job.attempt_count,
            },
        )
        queue_client.enqueue(
            job.queue_name,
            QueueMessage(job_id=job.id, job_type=job.job_type, queue_name=job.queue_name),
        )
        recovered += 1

    return recovered


def fail_jobs_with_missing_input_objects(
    session: Session,
    storage: ObjectStorage,
    queue_names: Iterable[str],
    *,
    max_failures: int,
) -> int:
    if max_failures <= 0:
        return 0

    queue_name_list = [name for name in queue_names if str(name or "").strip()]
    if not queue_name_list:
        return 0

    scan_limit = max(max_failures * 4, max_failures)
    candidates = (
        session.query(Job)
        .filter(
            Job.job_type == JobType.PROBLEM_VIDEO_GENERATE.value,
            Job.queue_name.in_(queue_name_list),
            Job.status == JobStatus.QUEUED.value,
        )
        .order_by(Job.updated_at.asc())
        .limit(scan_limit)
        .all()
    )

    failed = 0
    for job in candidates:
        if failed >= max_failures:
            break

        normalized_payload = job.normalized_payload or {}
        input_payload = job.input_payload or {}
        image_object_key = (
            str(normalized_payload.get("image_object_key") or input_payload.get("image_object_key") or "")
            .strip()
        )
        if not image_object_key:
            _mark_failed(session, job, "JOB_INPUT_MISSING", "Missing required field: image_object_key")
            failed += 1
            continue

        try:
            exists = storage.exists(image_object_key)
        except Exception as exc:
            add_event(
                session,
                job.id,
                "input_check_skipped",
                "Skipped input object existence check due to storage error",
                {"image_object_key": image_object_key, "error": str(exc)},
            )
            continue

        if exists:
            geometry_object_key = str(normalized_payload.get("geometry_file") or input_payload.get("geometry_file") or "").strip()
            if not geometry_object_key:
                continue
            try:
                geometry_exists = storage.exists(geometry_object_key)
            except Exception as exc:
                add_event(
                    session,
                    job.id,
                    "input_check_skipped",
                    "Skipped geometry object existence check due to storage error",
                    {"geometry_file": geometry_object_key, "error": str(exc)},
                )
                continue

            if geometry_exists:
                continue

            _mark_failed(session, job, "JOB_INPUT_MISSING", f"Input geometry object missing in storage: {geometry_object_key}")
            failed += 1
            continue

        _mark_failed(session, job, "JOB_INPUT_MISSING", f"Input object missing in storage: {image_object_key}")
        failed += 1

    return failed


def _reconcile_running_problem_video_job(session: Session, job: Job) -> bool:
    if job.job_type != JobType.PROBLEM_VIDEO_GENERATE.value or job.status != JobStatus.RUNNING.value:
        return False

    video_artifact = (
        session.query(JobArtifact)
        .filter(JobArtifact.job_id == job.id, JobArtifact.artifact_type == "problem_video")
        .order_by(JobArtifact.id.desc())
        .first()
    )
    if not video_artifact:
        return False

    debug_artifact = (
        session.query(JobArtifact)
        .filter(JobArtifact.job_id == job.id, JobArtifact.artifact_type == "debug_bundle")
        .order_by(JobArtifact.id.desc())
        .first()
    )

    engine_state = job.engine_state or {}
    result_payload = {
        "video_url": video_artifact.url,
        "duration_sec": engine_state.get("duration_sec"),
        "script_steps_count": engine_state.get("script_steps_count"),
        "debug_bundle_url": (
            debug_artifact.url if debug_artifact else engine_state.get("debug_bundle_url")
        ),
    }
    add_event(
        session,
        job.id,
        "reconciled",
        "Recovered succeeded status from uploaded artifacts after interrupted worker execution",
        {
            "artifact_type": "problem_video",
            "video_url": video_artifact.url,
        },
    )
    _mark_succeeded(session, job, result_payload)
    return True


def reconcile_running_problem_video_jobs_with_artifacts(
    session: Session,
    queue_names: Iterable[str],
    *,
    max_reconciliations: int,
) -> int:
    if max_reconciliations <= 0:
        return 0

    queue_name_list = [name for name in queue_names if str(name or "").strip()]
    if not queue_name_list:
        return 0

    candidates = (
        session.query(Job)
        .filter(
            Job.job_type == JobType.PROBLEM_VIDEO_GENERATE.value,
            Job.status == JobStatus.RUNNING.value,
            Job.queue_name.in_(queue_name_list),
        )
        .order_by(Job.updated_at.asc())
        .limit(max_reconciliations)
        .all()
    )

    reconciled = 0
    for job in candidates:
        if _reconcile_running_problem_video_job(session, job):
            reconciled += 1

    return reconciled


def reconcile_single_running_problem_video_job_with_artifacts(session: Session, job: Job) -> bool:
    return _reconcile_running_problem_video_job(session, job)


def purge_prestart_nonterminal_jobs(
    session: Session,
    *,
    max_purge: int,
) -> int:
    if max_purge <= 0:
        return 0

    cutoff = _utcnow()
    candidates = (
        session.query(Job)
        .filter(
            Job.status.in_([JobStatus.QUEUED.value, JobStatus.RUNNING.value]),
            Job.created_at <= cutoff,
        )
        .order_by(Job.created_at.asc())
        .limit(max_purge)
        .all()
    )

    purged = 0
    for job in candidates:
        _mark_failed(
            session,
            job,
            "JOB_PURGED_ON_RESTART",
            "Job was purged on service startup to clear pre-restart pending queue.",
        )
        purged += 1

    return purged


def _mark_running(session: Session, job: Job, step: str, message: str, progress: int) -> None:
    now = _utcnow()
    if not job.started_at:
        job.started_at = now
    _clear_retry_schedule(job)
    job.updated_at = now
    job.status = JobStatus.RUNNING.value
    job.step = step
    job.progress = max(0, min(100, progress))
    add_event(session, job.id, "progress", message, {"step": step, "progress": job.progress})


def _mark_failed(session: Session, job: Job, error_code: str, message: str) -> None:
    _clear_retry_schedule(job)
    job.status = JobStatus.FAILED.value
    job.error_code = error_code
    job.error_message = message
    job.step = "failed"
    job.completed_at = _utcnow()
    job.updated_at = _utcnow()
    add_event(session, job.id, "failed", message, {"error_code": error_code})


def _mark_succeeded(session: Session, job: Job, result_payload: Dict[str, Any]) -> None:
    _clear_retry_schedule(job)
    job.status = JobStatus.SUCCEEDED.value
    job.progress = 100
    job.step = "completed"
    job.error_code = None
    job.error_message = None
    job.result_payload = result_payload
    job.completed_at = _utcnow()
    job.updated_at = _utcnow()
    add_event(session, job.id, "succeeded", "Job completed", {"result": result_payload})


def _is_non_retriable_execution_error(job: Job, exc: Exception) -> bool:
    if job.job_type != JobType.PROBLEM_VIDEO_GENERATE.value:
        return False
    return isinstance(exc, MissingInputObjectError)


def _try_claim_queued_job(session: Session, job_id: str) -> bool:
    now = _utcnow()
    claimed = session.execute(
        update(Job)
        .where(Job.id == job_id, Job.status == JobStatus.QUEUED.value)
        .values(
            status=JobStatus.RUNNING.value,
            step="worker_claimed",
            updated_at=now,
            started_at=now,
            error_code=None,
            error_message=None,
        )
    )
    session.flush()
    return (claimed.rowcount or 0) == 1


def _run_course_generate(
    session: Session,
    job: Job,
    payload: Dict[str, Any],
    settings: Settings,
) -> Dict[str, Any]:
    client = AnotherMeClient(settings.anotherme_base_url)
    trace = TraceEventEmitter(job_id=job.id)
    trace.emit_workflow_started(total_steps=4, message="Course generation started")
    try:
        provider = create_course_generation_provider(settings, client)
        _mark_running(session, job, "submitting_anotherme", "Submitting course generation to AnotherMe", 5)
        session.commit()

        trace.start_step("submit", "Submitting to AnotherMe engine")
        submitted = provider.submit(payload)
        anotherme_job_id = submitted.get("jobId") or submitted.get("job_id")
        if not anotherme_job_id:
            raise AnotherMeError(f"AnotherMe submit response missing jobId: {submitted}")

        job.engine_state = {**(job.engine_state or {}), "anotherme_job_id": anotherme_job_id}

        trace.complete_step("submit", payload={"anotherme_job_id": anotherme_job_id})

        add_event(session, job.id, "engine_state", "AnotherMe job submitted", {"anotherme_job_id": anotherme_job_id})
        session.commit()

        trace.start_step("polling", "Polling AnotherMe for progress")

        start = time.time()
        last_step = ""
        while True:
            poll = provider.poll(anotherme_job_id)
            status = str(poll.get("status") or "").lower()
            progress = int(poll.get("progress") or 0)
            step = str(poll.get("step") or "polling")
            message = str(poll.get("message") or "Polling AnotherMe job")

            _mark_running(session, job, step, message, progress)
            session.commit()

            if step != last_step:
                trace.complete_step(last_step if last_step else "polling", payload={"step": step, "progress": progress})
                trace.start_step(step, message)
                last_step = step

            done = bool(poll.get("done")) or status in {"succeeded", "failed"}
            if done:
                if status == "succeeded":
                    result = poll.get("result") or {}
                    classroom_id = result.get("classroomId") or result.get("classroom_id")
                    classroom_url = result.get("url") or result.get("classroom_url")
                    scenes_count = int(result.get("scenesCount") or result.get("scenes_count") or 0)
                    meta_payload = result.get("meta") if isinstance(result.get("meta"), dict) else {}
                    meta = {}
                    quality_score = meta_payload.get("quality_score")
                    engine_version = meta_payload.get("engine_version")
                    if quality_score is not None:
                        meta["quality_score"] = quality_score
                    if engine_version is not None:
                        meta["engine_version"] = engine_version

                    trace.complete_step(last_step or "polling", payload={"classroom_id": classroom_id, "scenes_count": scenes_count})
                    trace.emit_workflow_completed(message="Course generation completed successfully")
                    _persist_trace_events(session, job.id, trace)
                    session.commit()

                    return {
                        "classroom_id": classroom_id,
                        "classroom_url": classroom_url,
                        "scenes_count": scenes_count,
                        **({"meta": meta} if meta else {}),
                        "trace_events": trace.to_event_list(),
                    }
                raise AnotherMeError(poll.get("error") or "AnotherMe job failed")

            if (time.time() - start) > settings.anotherme_timeout_seconds:
                raise AnotherMeError(f"AnotherMe polling timeout ({settings.anotherme_timeout_seconds}s)")

            time.sleep(max(settings.anotherme_poll_seconds, 1))
    finally:
        client.close()


def _clamp_int(value: Any, default: int, lower: int, upper: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(lower, min(upper, parsed))


def _resolve_learner_context(
    job: Job,
    payload: Dict[str, Any],
) -> tuple[str | None, str | None, int]:
    learner_user_id = str(payload.get("learner_user_id") or job.user_id or "").strip()
    learner_session_id_raw = str(payload.get("learner_session_id") or "").strip()
    learner_session_id = learner_session_id_raw or None
    lookback_days = _clamp_int(payload.get("learner_lookback_days"), default=120, lower=14, upper=365)
    return (learner_user_id or None, learner_session_id, lookback_days)


def _serialize_memory_learning_record(row: AILearningRecord) -> Dict[str, Any]:
    return {
        "record_id": row.id,
        "session_id": row.session_id,
        "message_id": row.message_id,
        "subject": row.subject,
        "knowledge_point": row.knowledge_point,
        "question_type": row.question_type,
        "difficulty": row.difficulty,
        "solved_flag": bool(row.solved_flag),
        "confusion_flag": bool(row.confusion_flag),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _build_memory_event(record: Dict[str, Any]) -> Dict[str, Any] | None:
    knowledge_point = str(record.get("knowledge_point") or "").strip()
    if not knowledge_point:
        return None

    confusion = bool(record.get("confusion_flag"))
    solved = bool(record.get("solved_flag"))
    difficulty = str(record.get("difficulty") or "").strip().lower()

    if confusion and not solved:
        event_type = "not_understood"
    elif solved:
        event_type = "correct"
    else:
        event_type = "wrong"

    weight = 1.3 if difficulty == "hard" and event_type in {"not_understood", "wrong"} else 1.0
    return {
        "type": event_type,
        "knowledge_points": [knowledge_point],
        "weight": weight,
    }


def _build_learner_memory_bundle(
    session: Session,
    job: Job,
    payload: Dict[str, Any],
) -> Dict[str, Any] | None:
    learner_user_id, learner_session_id, lookback_days = _resolve_learner_context(job, payload)
    if not learner_user_id:
        return None

    profile_snapshot = get_student_profile_snapshot(
        session,
        learner_user_id,
        lookback_days=lookback_days,
    )

    cutoff = _utcnow() - timedelta(days=lookback_days)
    records_query = session.query(AILearningRecord).filter(
        AILearningRecord.user_id == learner_user_id,
        AILearningRecord.created_at >= cutoff,
    )
    if learner_session_id:
        records_query = records_query.filter(AILearningRecord.session_id == learner_session_id)

    rows = records_query.order_by(AILearningRecord.created_at.desc()).limit(120).all()
    rows.reverse()
    serialized_records = [_serialize_memory_learning_record(row) for row in rows]

    events: list[Dict[str, Any]] = []
    for record in serialized_records:
        event = _build_memory_event(record)
        if event is not None:
            events.append(event)

    return {
        "user_id": learner_user_id,
        "session_id": learner_session_id,
        "lookback_days": lookback_days,
        "profile_snapshot": profile_snapshot,
        "recent_learning_records": serialized_records,
        "derived_learning_events": events,
    }


def _run_problem_video_generate(
    session: Session,
    job: Job,
    payload: Dict[str, Any],
    settings: Settings,
    storage: ObjectStorage,
) -> Dict[str, Any]:
    def _resolve_run_output_dir(artifact_path: str) -> Path | None:
        candidate = Path(artifact_path)
        if candidate.parent.name == "run_output":
            return candidate.parent
        if candidate.parent.parent.name == "run_output":
            return candidate.parent.parent
        return None

    trace = TraceEventEmitter(job_id=job.id)
    trace.emit_workflow_started(total_steps=5, message="Problem video generation started")

    _mark_running(session, job, "running_anotherme2", "Running AnotherMe2 video pipeline", 10)
    session.commit()

    learner_memory = _build_learner_memory_bundle(session, job, payload)
    if learner_memory:
        trace_event = trace.emit_learner_profile_loaded(
            step="learner_profile_loaded",
            user_id=learner_memory.get("user_id", ""),
            weak_subjects=learner_memory.get("weak_subjects", []),
            weak_knowledge_points=learner_memory.get("weak_knowledge_points", []),
            ability_scores=learner_memory.get("ability_scores", []),
        )
        add_trace_event(
            session,
            job.id,
            "learner_memory_loaded",
            "Attached learner memory bundle for personalized video generation",
            trace_event_id=trace_event.id,
            trace_event_type=trace_event.type,
            payload={
                "learner_user_id": learner_memory.get("user_id"),
                "learner_session_id": learner_memory.get("session_id"),
                "records": len(learner_memory.get("recent_learning_records") or []),
                "events": len(learner_memory.get("derived_learning_events") or []),
            },
        )
        session.commit()

    executor_payload = dict(payload)
    if learner_memory:
        executor_payload["learner_memory"] = learner_memory

    trace.start_step("video_generation", "Generating problem video with AnotherMe2")

    exec_result = run_problem_video_job(
        executor_payload,
        storage=storage,
        temp_root=settings.worker_temp_root,
        output_root=settings.worker_output_root,
        keep_run_output=settings.keep_run_output,
    )
    run_output_dir = _resolve_run_output_dir(exec_result.video_path)

    trace.complete_step("video_generation", payload={"duration_sec": exec_result.duration_sec})

    _mark_running(session, job, "uploading_artifacts", "Uploading generated artifacts", 80)
    session.commit()
    try:
        video_ext = Path(exec_result.video_path).suffix or ".mp4"
        video_key = f"jobs/{job.id}/problem_video/final{video_ext}"
        video_url = storage.upload_file(exec_result.video_path, video_key)
        add_artifact(session, job.id, "problem_video", video_key, video_url)

        trace_event = trace.emit(TraceEvent(
            type="video_rendered",
            step="uploading_artifacts",
            status="completed",
            message=f"Video rendered and uploaded: {video_key}",
            severity="success",
            payload={"video_key": video_key, "video_url": video_url},
        ))
        add_trace_event(
            session,
            job.id,
            "artifact_uploaded",
            "Problem video artifact uploaded",
            trace_event_id=trace_event.id,
            trace_event_type=trace_event.type,
            payload={"video_key": video_key, "video_url": video_url},
        )

        debug_url = None
        if exec_result.debug_bundle_path and Path(exec_result.debug_bundle_path).exists():
            debug_key = f"jobs/{job.id}/problem_video/debug_bundle.zip"
            debug_url = storage.upload_file(exec_result.debug_bundle_path, debug_key, content_type="application/zip")
            add_artifact(session, job.id, "debug_bundle", debug_key, debug_url)

        trace.emit_workflow_completed(message="Problem video generation completed successfully")
        job.engine_state = {
            **(job.engine_state or {}),
            "requirement_hint": exec_result.requirement_hint,
            "duration_sec": exec_result.duration_sec,
            "script_steps_count": exec_result.script_steps_count,
            "debug_bundle_url": debug_url,
            "run_output_dir": str(run_output_dir) if run_output_dir else None,
            "learner_memory_records": len((learner_memory or {}).get("recent_learning_records") or []),
            "learner_memory_events": len((learner_memory or {}).get("derived_learning_events") or []),
            "trace_events": trace.to_event_list(),
        }
        _persist_trace_events(session, job.id, trace)
        session.commit()

        return {
            "video_url": video_url,
            "duration_sec": exec_result.duration_sec,
            "script_steps_count": exec_result.script_steps_count,
            "debug_bundle_url": debug_url,
            "learner_memory_records": len((learner_memory or {}).get("recent_learning_records") or []),
            "learner_memory_events": len((learner_memory or {}).get("derived_learning_events") or []),
            "trace_events": trace.to_event_list(),
        }
    finally:
        # Optional cleanup: preserve run_output when keep_run_output is enabled.
        if (not settings.keep_run_output) and run_output_dir and run_output_dir.exists():
            run_root = run_output_dir.parent
            shutil.rmtree(run_output_dir, ignore_errors=True)
            try:
                if run_root.exists() and not any(run_root.iterdir()):
                    run_root.rmdir()
            except OSError:
                pass


def _create_inline_child_job(
    session: Session,
    parent: Job,
    child_type: str,
    payload: Dict[str, Any],
    settings: Settings,
) -> Job:
    child = Job(
        job_type=child_type,
        queue_name="inline",
        user_id=parent.user_id,
        parent_job_id=parent.id,
        idempotency_key=f"inline-{parent.id}-{child_type}-{uuid4().hex}",
        status=JobStatus.RUNNING.value,
        progress=0,
        step="inline_started",
        max_retries=0,
        input_payload=payload,
        normalized_payload=payload,
        engine_state={},
    )
    session.add(child)
    session.flush()
    add_event(session, child.id, "queued", "Inline child task created", {"parent": parent.id})
    return child


def _run_study_package(
    session: Session,
    job: Job,
    payload: Dict[str, Any],
    settings: Settings,
    storage: ObjectStorage,
) -> Dict[str, Any]:
    source = payload["source"]
    outputs = payload["outputs"]
    package_id = f"pkg_{job.id}"

    _mark_running(session, job, "package_started", "Running study package orchestration", 5)
    session.commit()

    course_result: Dict[str, Any] | None = None
    problem_result: Dict[str, Any] | None = None
    enabled_tasks = []
    if outputs.get("course", False):
        enabled_tasks.append("course")
    if outputs.get("problem_video", False):
        enabled_tasks.append("problem_video")
    if not enabled_tasks:
        raise JobServiceError("study_package_generate requires at least one output")

    if len(enabled_tasks) == 2:
        task_weights = {"course": 50.0, "problem_video": 50.0}
    else:
        only = enabled_tasks[0]
        task_weights = {only: 100.0}

    completed_weight = 0.0

    def _mark_parent_task_done(task: str, step: str, message: str) -> None:
        nonlocal completed_weight
        completed_weight += task_weights.get(task, 0.0)
        _mark_running(session, job, step, message, min(99, int(round(completed_weight))))
        session.commit()

    if source["type"] == "topic":
        topic = source["topic"]

        if outputs.get("course", False):
            child = _create_inline_child_job(
                session,
                job,
                JobType.COURSE_GENERATE.value,
                {
                    "requirement": topic,
                    "language": "zh-CN",
                    "options": {
                        "enable_web_search": True,
                        "enable_image_generation": False,
                        "enable_video_generation": False,
                        "enable_tts": True,
                        "agent_mode": "default",
                    },
                },
                settings,
            )
            course_result = _run_course_generate(session, child, child.input_payload, settings)
            _mark_succeeded(session, child, course_result)
            session.commit()
            _mark_parent_task_done("course", "topic_course_done", "Topic course generated")

        if outputs.get("problem_video", False):
            core_text = topic
            if course_result and course_result.get("classroom_id"):
                classroom_payload = AnotherMeClient(settings.anotherme_base_url).get_classroom(course_result["classroom_id"])
                core_text = extract_core_example_text(classroom_payload)

            synthetic_key = f"jobs/{job.id}/synthetic/topic_problem.png"
            synthesize_problem_image_from_text(core_text, storage, synthetic_key, settings.worker_temp_root)
            child = _create_inline_child_job(
                session,
                job,
                JobType.PROBLEM_VIDEO_GENERATE.value,
                {
                    "image_object_key": synthetic_key,
                    "problem_text": core_text,
                    "geometry_file": None,
                    "output_profile": "1080p",
                },
                settings,
            )
            problem_result = _run_problem_video_generate(session, child, child.input_payload, settings, storage)
            _mark_succeeded(session, child, problem_result)
            session.commit()
            _mark_parent_task_done("problem_video", "topic_problem_video_done", "Topic problem video generated")
    else:
        image_object_key = source["image_object_key"]
        requirement_hint: str | None = None

        if outputs.get("problem_video", False):
            child = _create_inline_child_job(
                session,
                job,
                JobType.PROBLEM_VIDEO_GENERATE.value,
                {
                    "image_object_key": image_object_key,
                    "problem_text": None,
                    "geometry_file": None,
                    "output_profile": "1080p",
                },
                settings,
            )
            problem_result = _run_problem_video_generate(session, child, child.input_payload, settings, storage)
            _mark_succeeded(session, child, problem_result)
            session.commit()
            requirement_hint = (child.engine_state or {}).get("requirement_hint")
            _mark_parent_task_done("problem_video", "photo_problem_video_done", "Photo problem video generated")

        if outputs.get("course", False):
            if not requirement_hint:
                try:
                    tmp_dir = Path(mkdtemp(prefix="photo-requirement-", dir=settings.worker_temp_root))
                    local_image = tmp_dir / "source_photo.png"
                    storage.download_file(image_object_key, str(local_image))
                    requirement_hint = build_requirement_from_photo(str(local_image))
                except Exception:
                    requirement_hint = "请围绕学生上传的拍题内容，生成系统化课程讲解，包含概念梳理、解题步骤和易错点。"

            child = _create_inline_child_job(
                session,
                job,
                JobType.COURSE_GENERATE.value,
                {
                    "requirement": requirement_hint,
                    "language": "zh-CN",
                    "options": {
                        "enable_web_search": True,
                        "enable_image_generation": False,
                        "enable_video_generation": False,
                        "enable_tts": True,
                        "agent_mode": "default",
                    },
                },
                settings,
            )
            course_result = _run_course_generate(session, child, child.input_payload, settings)
            _mark_succeeded(session, child, course_result)
            session.commit()
            _mark_parent_task_done("course", "photo_course_done", "Photo-derived course generated")

    result = {"package_id": package_id}
    if course_result is not None:
        result["course_result"] = course_result
    if problem_result is not None:
        result["problem_video_result"] = problem_result
    return result


def _run_learning_record_extract(
    session: Session,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    return extract_learning_records(
        session=session,
        ai_session_id=str(payload["session_id"]),
        user_id=payload.get("user_id"),
        extract_version=str(payload.get("extract_version") or "v1"),
        latest_user_message_id=(
            str(payload.get("latest_user_message_id")) if payload.get("latest_user_message_id") else None
        ),
        message_count=int(payload["message_count"]) if payload.get("message_count") is not None else None,
    )


def execute_job(session: Session, job: Job, settings: Settings, storage: ObjectStorage) -> Dict[str, Any]:
    payload = job.normalized_payload

    if job.job_type == JobType.COURSE_GENERATE.value:
        return _run_course_generate(session, job, payload, settings)
    if job.job_type == JobType.PROBLEM_VIDEO_GENERATE.value:
        return _run_problem_video_generate(session, job, payload, settings, storage)
    if job.job_type == JobType.STUDY_PACKAGE_GENERATE.value:
        return _run_study_package(session, job, payload, settings, storage)
    if job.job_type == JobType.LEARNING_RECORD_EXTRACT.value:
        _mark_running(session, job, "extracting_learning_records", "Extracting learning records", 30)
        session.commit()
        return _run_learning_record_extract(session, payload)

    raise JobServiceError(f"Unsupported job type: {job.job_type}")


def handle_worker_message(
    session: Session,
    queue_client: QueueClientLike,
    message: QueueMessage,
    settings: Settings,
    storage: ObjectStorage,
) -> None:
    now = _utcnow()
    job = session.get(Job, message.job_id)
    if not job:
        return
    if job.status != JobStatus.QUEUED.value:
        return
    if not is_job_ready_for_execution(job, now):
        return
    if not _try_claim_queued_job(session, message.job_id):
        return
    session.commit()

    job = session.get(Job, message.job_id)
    if not job:
        return

    try:
        result = execute_job(session, job, settings, storage)
        _mark_succeeded(session, job, result)
    except Exception as exc:
        if _is_non_retriable_execution_error(job, exc):
            _mark_failed(session, job, "JOB_INPUT_MISSING", str(exc))
            return

        job.attempt_count += 1
        error_message = str(exc)
        if job.attempt_count <= job.max_retries:
            job.status = JobStatus.QUEUED.value
            job.step = "retry_waiting"
            job.error_code = "RETRY_SCHEDULED"
            job.error_message = error_message
            delay = settings.retry_base_seconds * (2 ** (job.attempt_count - 1))
            retry_not_before = _utcnow() + timedelta(seconds=delay)
            state = dict(job.engine_state or {})
            state[RETRY_NOT_BEFORE_KEY] = retry_not_before.isoformat()
            job.engine_state = state
            job.updated_at = _utcnow()
            add_event(
                session,
                job.id,
                "retry",
                f"Job failed; retrying in {delay}s",
                {
                    "attempt": job.attempt_count,
                    "error": error_message,
                    "retry_not_before": retry_not_before.isoformat(),
                },
            )
            session.commit()
        else:
            _mark_failed(session, job, "JOB_EXECUTION_FAILED", error_message)
            dlq_name = settings.dlq_mapping.get(job.queue_name, f"{settings.queue_dead_letter_prefix}.{job.queue_name}")
            queue_client.push_dead_letter(dlq_name, message)
