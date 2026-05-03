from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.engine import Connection
from unittest.mock import patch

import api_gateway.db as db_module
from api_gateway.app import create_app
from api_gateway.config import Settings
from api_gateway.db import init_db, reconfigure_db, session_scope
from api_gateway.job_service import (
    _run_problem_video_generate,
    create_or_get_job,
    fail_jobs_with_missing_input_objects,
    handle_worker_message,
    purge_prestart_nonterminal_jobs,
    reconcile_single_running_problem_video_job_with_artifacts,
)
from api_gateway.course_generation_provider import (
    LegacyCourseGenerationProvider,
    MiddleSchoolMathCourseGenerationProvider,
    create_course_generation_provider,
)
from api_gateway.models import (
    AIChatMessage,
    AIChatSession,
    AILearningRecord,
    Job,
    JobArtifact,
    LearningEvent,
    StudentProfile,
)
from api_gateway.queueing import QueueMessage
from api_gateway.schemas import CreateJobRequest, JobType, validate_job_payload
from api_gateway.storage import LocalObjectStorage
from api_gateway.anotherme_executor import MissingInputObjectError, ProblemVideoExecutionResult


class FakeQueueClient:
    def __init__(self):
        self.items = []
        self.dead_letters = []

    def enqueue(self, queue_name, message):
        self.items.append((queue_name, message))

    def push_dead_letter(self, dlq_name, message):
        self.dead_letters.append((dlq_name, message))

    def ping(self):
        return True


class StubCourseClient:
    def __init__(self):
        self.last_payload = None

    def submit_course_job(self, payload):
        self.last_payload = payload
        return {"jobId": "job-1"}

    def poll_course_job(self, job_id):
        return {"jobId": job_id, "status": "running"}


def test_settings_startup_purge_requires_safety_latch():
    settings_unarmed = Settings(
        purge_prestart_jobs_on_startup=True,
        startup_purge_armed=False,
    )
    assert settings_unarmed.startup_purge_enabled is False

    settings_armed = Settings(
        purge_prestart_jobs_on_startup=True,
        startup_purge_armed=True,
    )
    assert settings_armed.startup_purge_enabled is True


def test_course_generation_provider_switch_and_payload_injection():
    stub = StubCourseClient()

    legacy_settings = Settings(course_generation_provider="legacy")
    legacy_provider = create_course_generation_provider(legacy_settings, stub)  # type: ignore[arg-type]
    assert isinstance(legacy_provider, LegacyCourseGenerationProvider)
    legacy_provider.submit({"requirement": "讲解勾股定理"})
    assert "pedagogy_profile" not in (stub.last_payload or {})

    msm_settings = Settings(course_generation_provider="msm_v1")
    msm_provider = create_course_generation_provider(msm_settings, stub)  # type: ignore[arg-type]
    assert isinstance(msm_provider, MiddleSchoolMathCourseGenerationProvider)
    msm_provider.submit({"requirement": "讲解勾股定理"})
    assert stub.last_payload is not None
    assert stub.last_payload["pedagogy_profile"]["domain"] == "middle-school-math"


def test_validate_payload_defaults():
    payload = validate_job_payload(
        JobType.COURSE_GENERATE,
        {
            "requirement": "讲解二次函数",
        },
    )
    assert payload["language"] == "zh-CN"
    assert payload["options"]["enable_web_search"] is False

    payload2 = validate_job_payload(
        JobType.PROBLEM_VIDEO_GENERATE,
        {
            "image_object_key": "uploads/a.png",
        },
    )
    assert payload2["output_profile"] == "1080p"


def test_validate_problem_video_payload_accepts_learner_context():
    payload = validate_job_payload(
        JobType.PROBLEM_VIDEO_GENERATE,
        {
            "image_object_key": "uploads/a.png",
            "learner_user_id": "stu-01",
            "learner_session_id": "sess-01",
            "learner_lookback_days": 45,
        },
    )
    assert payload["learner_user_id"] == "stu-01"
    assert payload["learner_session_id"] == "sess-01"
    assert payload["learner_lookback_days"] == 45


def test_validate_course_payload_accepts_optional_pedagogy_profile():
    payload = validate_job_payload(
        JobType.COURSE_GENERATE,
        {
            "requirement": "讲解一次函数",
            "pedagogy_profile": {
                "domain": "middle-school-math",
                "exam_orientation": "zhongkao",
                "grade_band": "grade8",
                "strictness": "high",
            },
        },
    )
    assert payload["pedagogy_profile"]["domain"] == "middle-school-math"
    assert payload["pedagogy_profile"]["strictness"] == "high"


def test_validate_learning_extract_payload_accepts_snapshot_fields():
    payload = validate_job_payload(
        JobType.LEARNING_RECORD_EXTRACT,
        {
            "session_id": "sess-1",
            "extract_version": "v2",
            "latest_user_message_id": "msg-9",
            "message_count": 12,
        },
    )
    assert payload["session_id"] == "sess-1"
    assert payload["extract_version"] == "v2"
    assert payload["latest_user_message_id"] == "msg-9"
    assert payload["message_count"] == 12


def test_idempotent_job_creation(tmp_path: Path):
    db_path = tmp_path / "jobs.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(tmp_path / "obj"),
    )

    req = CreateJobRequest(
        job_type=JobType.COURSE_GENERATE,
        payload={"requirement": "牛顿定律课程"},
        user_id="u1",
    )

    with session_scope() as session:
        job1, created1 = create_or_get_job(session, req, settings)
        session.flush()
        job2, created2 = create_or_get_job(session, req, settings)
        session.flush()

        assert created1 is True
        assert created2 is False
        assert job1.id == job2.id


def test_init_db_auto_falls_back_to_sqlite_when_postgres_unreachable(tmp_path: Path, monkeypatch):
    fallback_db = tmp_path / "gateway-fallback.db"

    monkeypatch.setenv("GATEWAY_ENV", "dev")
    monkeypatch.setenv("GATEWAY_DB_AUTO_FALLBACK", "1")
    monkeypatch.setenv("GATEWAY_SQLITE_FALLBACK_PATH", str(fallback_db))
    monkeypatch.setenv("GATEWAY_DB_CONNECT_TIMEOUT_SEC", "1")

    reconfigure_db("postgresql+psycopg://postgres:postgres@127.0.0.1:5432/anotherme2")

    def _fake_create_all(*args, **kwargs):
        bind = kwargs.get("bind")
        engine_url = ""
        if isinstance(bind, Connection):
            engine_url = str(bind.engine.url)
        elif bind is not None and hasattr(bind, "url"):
            engine_url = str(bind.url)

        if engine_url.startswith("postgresql"):
            raise OperationalError(
                "create_all",
                {},
                Exception("could not connect to server: Connection refused"),
            )
        return None

    with patch.object(db_module, "_postgres_tcp_reachable", return_value=True), patch.object(
        db_module.Base.metadata,
        "create_all",
        side_effect=_fake_create_all,
    ):
        init_db()

    engine_url = str(db_module.engine.url)
    assert engine_url.startswith("sqlite:///")
    assert fallback_db.as_posix() in engine_url


def test_init_db_precheck_fallback_initializes_sqlite_without_postgres_lock(tmp_path: Path, monkeypatch):
    fallback_db = tmp_path / "gateway-precheck-fallback.db"

    monkeypatch.setenv("GATEWAY_ENV", "dev")
    monkeypatch.setenv("GATEWAY_DB_AUTO_FALLBACK", "1")
    monkeypatch.setenv("GATEWAY_SQLITE_FALLBACK_PATH", str(fallback_db))

    reconfigure_db("postgresql+psycopg://postgres:postgres@127.0.0.1:5432/anotherme2")

    with patch.object(db_module, "_postgres_tcp_reachable", return_value=False):
        init_db()

    assert str(db_module.engine.url).startswith("sqlite:///")
    assert fallback_db.exists()


def test_api_contract_uploads_and_jobs(tmp_path: Path):
    db_path = tmp_path / "gateway.db"
    storage_root = tmp_path / "objects"

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
        worker_temp_root=str(tmp_path / "tmp"),
    )

    queue = FakeQueueClient()
    storage = LocalObjectStorage(storage_root)

    app = create_app(settings_override=settings, queue_client_override=queue, storage_override=storage)
    client = TestClient(app)

    up = client.post(
        "/v1/uploads",
        files={"file": ("problem.png", b"fakepng", "image/png")},
    )
    assert up.status_code == 200
    up_json = up.json()
    assert up_json["object_key"].startswith("uploads/")

    create = client.post(
        "/v1/jobs",
        json={
            "job_type": "problem_video_generate",
            "user_id": "u2",
            "payload": {"image_object_key": up_json["object_key"]},
        },
    )
    assert create.status_code == 200
    create_json = create.json()
    assert create_json["status"] == "queued"
    job_id = create_json["job_id"]

    query = client.get(f"/v1/jobs/{job_id}")
    assert query.status_code == 200
    assert query.json()["job_type"] == "problem_video_generate"

    result = client.get(f"/v1/jobs/{job_id}/result")
    assert result.status_code == 409


def test_study_package_requires_output():
    try:
        validate_job_payload(
            JobType.STUDY_PACKAGE_GENERATE,
            {"source": {"type": "topic", "topic": "相似三角形"}, "outputs": {"course": False, "problem_video": False}},
        )
    except Exception as exc:
        assert "cannot both be false" in str(exc)
    else:
        raise AssertionError("Expected validation failure")


def test_problem_video_result_contract(tmp_path: Path):
    db_path = tmp_path / "pv.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()
    storage = LocalObjectStorage(obj_root)

    fake_video = tmp_path / "fake.mp4"
    fake_video.write_bytes(b"video")

    with session_scope() as session:
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-problem-video-contract",
            status="running",
            progress=0,
            step="running",
            max_retries=0,
            input_payload={"image_object_key": "uploads/a.png"},
            normalized_payload={"image_object_key": "uploads/a.png", "output_profile": "1080p"},
            engine_state={},
        )
        session.add(job)
        session.flush()

        with patch(
            "api_gateway.job_service.run_problem_video_job",
            return_value=ProblemVideoExecutionResult(
                video_path=str(fake_video),
                duration_sec=12.5,
                script_steps_count=4,
                debug_bundle_path=None,
                requirement_hint="hint",
            ),
        ):
            result = _run_problem_video_generate(
                session=session,
                job=job,
                payload={"image_object_key": "uploads/a.png", "output_profile": "1080p"},
                settings=Settings(local_storage_root=str(obj_root)),
                storage=storage,
            )

        assert set(result.keys()) >= {
            "video_url",
            "duration_sec",
            "script_steps_count",
            "debug_bundle_url",
            "learner_memory_records",
            "learner_memory_events",
        }


def test_problem_video_pipeline_attaches_learner_memory_bundle(tmp_path: Path):
    db_path = tmp_path / "pv-memory.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()
    storage = LocalObjectStorage(obj_root)

    fake_video = tmp_path / "memory_fake.mp4"
    fake_video.write_bytes(b"video")
    now = datetime.utcnow()

    with session_scope() as session:
        ai_session = AIChatSession(
            id="sess-memory-1",
            user_id="stu-memory-1",
            title="memory",
            source="课后答疑",
            subject="数学",
            archived_flag=False,
            created_at=now - timedelta(days=2),
            updated_at=now - timedelta(days=1),
        )
        record = AILearningRecord(
            id=str(uuid4()),
            user_id="stu-memory-1",
            session_id="sess-memory-1",
            message_id=None,
            subject="数学",
            knowledge_point="勾股定理",
            question_type="qa",
            difficulty="hard",
            solved_flag=False,
            confusion_flag=True,
            extract_version="v1",
            created_at=now - timedelta(hours=8),
        )
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="stu-memory-1",
            idempotency_key="idem-problem-video-memory-contract",
            status="running",
            progress=0,
            step="running",
            max_retries=0,
            input_payload={"image_object_key": "uploads/a.png"},
            normalized_payload={
                "image_object_key": "uploads/a.png",
                "output_profile": "1080p",
                "learner_user_id": "stu-memory-1",
                "learner_session_id": "sess-memory-1",
                "learner_lookback_days": 30,
            },
            engine_state={},
        )
        session.add_all([ai_session, record, job])
        session.flush()

        captured_payload: dict[str, Any] = {}

        def _fake_run_problem_video_job(payload, **kwargs):
            captured_payload.update(payload)
            return ProblemVideoExecutionResult(
                video_path=str(fake_video),
                duration_sec=9.8,
                script_steps_count=2,
                debug_bundle_path=None,
                requirement_hint="hint",
            )

        with patch(
            "api_gateway.job_service.get_student_profile_snapshot",
            return_value={
                "user_id": "stu-memory-1",
                "weak_subjects": ["数学"],
                "weak_knowledge_points": ["勾股定理"],
                "recent_focus": "数学",
                "ability_scores": [],
                "learning_stats": {
                    "records_total": 1,
                    "records_14d": 1,
                    "active_days_14": 1,
                    "confusion_records": 1,
                    "solved_records": 0,
                    "top_subjects": ["数学"],
                    "top_knowledge_points": ["勾股定理"],
                    "total_weight": 1.0,
                },
                "updated_at": now.isoformat(),
                "computed_at": now.isoformat(),
                "profile_source": "computed_with_decay",
            },
        ), patch("api_gateway.job_service.run_problem_video_job", side_effect=_fake_run_problem_video_job):
            result = _run_problem_video_generate(
                session=session,
                job=job,
                payload=job.normalized_payload,
                settings=Settings(local_storage_root=str(obj_root)),
                storage=storage,
            )

        assert "learner_memory" in captured_payload
        learner_memory = captured_payload["learner_memory"]
        assert learner_memory["user_id"] == "stu-memory-1"
        assert learner_memory["session_id"] == "sess-memory-1"
        assert len(learner_memory["recent_learning_records"]) == 1
        assert len(learner_memory["derived_learning_events"]) == 1
        assert result["learner_memory_records"] == 1
        assert result["learner_memory_events"] == 1


def test_problem_video_missing_input_is_failed_without_retry(tmp_path: Path):
    db_path = tmp_path / "missing-input.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    queue = FakeQueueClient()
    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(obj_root),
        max_retries=2,
    )
    storage = LocalObjectStorage(obj_root)

    with session_scope() as session:
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-problem-video-missing-input",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/missing.png"},
            normalized_payload={"image_object_key": "uploads/missing.png", "output_profile": "1080p"},
            engine_state={},
        )
        session.add(job)
        session.flush()
        message = QueueMessage(job_id=job.id, job_type=job.job_type, queue_name=job.queue_name)

        with patch("api_gateway.job_service.execute_job", side_effect=MissingInputObjectError("object not found")):
            handle_worker_message(
                session=session,
                queue_client=queue,
                message=message,
                settings=settings,
                storage=storage,
            )

        refreshed = session.get(Job, job.id)
        assert refreshed is not None
        assert refreshed.status == "failed"
        assert refreshed.error_code == "JOB_INPUT_MISSING"
        assert refreshed.attempt_count == 0
        assert queue.items == []
        assert queue.dead_letters == []


def test_fail_jobs_with_missing_input_objects_marks_queued_only(tmp_path: Path):
    db_path = tmp_path / "missing-input-cleanup.db"
    obj_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    storage = LocalObjectStorage(obj_root)

    with session_scope() as session:
        queued_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-missing-input-queued",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/missing-queued.png"},
            normalized_payload={"image_object_key": "uploads/missing-queued.png", "output_profile": "1080p"},
            engine_state={},
        )
        running_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u2",
            idempotency_key="idem-missing-input-running",
            status="running",
            progress=35,
            step="running_anotherme2",
            max_retries=2,
            input_payload={"image_object_key": "uploads/missing-running.png"},
            normalized_payload={"image_object_key": "uploads/missing-running.png", "output_profile": "1080p"},
            engine_state={},
        )
        healthy_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u3",
            idempotency_key="idem-present-input",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/present.png"},
            normalized_payload={"image_object_key": "uploads/present.png", "output_profile": "1080p"},
            engine_state={},
        )
        geometry_missing_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u4",
            idempotency_key="idem-missing-geometry",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/present-geometry.png", "geometry_file": "uploads/missing-geo.json"},
            normalized_payload={
                "image_object_key": "uploads/present-geometry.png",
                "geometry_file": "uploads/missing-geo.json",
                "output_profile": "1080p",
            },
            engine_state={},
        )
        session.add_all([queued_job, running_job, healthy_job, geometry_missing_job])
        session.flush()

        (obj_root / "uploads").mkdir(parents=True, exist_ok=True)
        (obj_root / "uploads" / "present.png").write_bytes(b"ok")
        (obj_root / "uploads" / "present-geometry.png").write_bytes(b"ok")

        cleaned = fail_jobs_with_missing_input_objects(
            session,
            storage,
            ["q.problem_video"],
            max_failures=5,
        )

        assert cleaned == 2
        assert queued_job.status == "failed"
        assert geometry_missing_job.status == "failed"
        assert running_job.status == "running"
        assert queued_job.error_code == "JOB_INPUT_MISSING"
        assert geometry_missing_job.error_code == "JOB_INPUT_MISSING"
        assert running_job.error_code is None
        assert healthy_job.status == "queued"


def test_reconcile_running_job_with_uploaded_artifact_marks_succeeded(tmp_path: Path):
    db_path = tmp_path / "reconcile-running.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    with session_scope() as session:
        job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-reconcile-running",
            status="running",
            progress=80,
            step="uploading_artifacts",
            max_retries=2,
            input_payload={"image_object_key": "uploads/present.png"},
            normalized_payload={"image_object_key": "uploads/present.png", "output_profile": "1080p"},
            engine_state={"duration_sec": 21.5, "script_steps_count": 5},
        )
        session.add(job)
        session.flush()

        session.add(
            JobArtifact(
                job_id=job.id,
                artifact_type="problem_video",
                object_key=f"jobs/{job.id}/problem_video/final.mp4",
                url=f"http://127.0.0.1:9000/jobs/{job.id}/problem_video/final.mp4",
                artifact_metadata=None,
            )
        )
        session.flush()

        changed = reconcile_single_running_problem_video_job_with_artifacts(session, job)
        assert changed is True
        assert job.status == "succeeded"
        assert job.step == "completed"
        assert job.result_payload is not None
        assert job.result_payload.get("video_url", "").endswith("/final.mp4")
        assert job.result_payload.get("duration_sec") == 21.5
        assert job.result_payload.get("script_steps_count") == 5


def test_purge_prestart_nonterminal_jobs_marks_queued_and_running_failed(tmp_path: Path):
    db_path = tmp_path / "purge-prestart.db"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    with session_scope() as session:
        queued_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u1",
            idempotency_key="idem-prestart-queued",
            status="queued",
            progress=0,
            step="queued",
            max_retries=2,
            input_payload={"image_object_key": "uploads/a.png"},
            normalized_payload={"image_object_key": "uploads/a.png", "output_profile": "1080p"},
            engine_state={},
        )
        running_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u2",
            idempotency_key="idem-prestart-running",
            status="running",
            progress=65,
            step="uploading_artifacts",
            max_retries=2,
            input_payload={"image_object_key": "uploads/b.png"},
            normalized_payload={"image_object_key": "uploads/b.png", "output_profile": "1080p"},
            engine_state={},
        )
        succeeded_job = Job(
            job_type="problem_video_generate",
            queue_name="q.problem_video",
            user_id="u3",
            idempotency_key="idem-prestart-succeeded",
            status="succeeded",
            progress=100,
            step="completed",
            max_retries=2,
            input_payload={"image_object_key": "uploads/c.png"},
            normalized_payload={"image_object_key": "uploads/c.png", "output_profile": "1080p"},
            engine_state={},
        )
        session.add_all([queued_job, running_job, succeeded_job])
        session.flush()

        purged = purge_prestart_nonterminal_jobs(session, max_purge=10)
        assert purged == 2
        assert queued_job.status == "failed"
        assert running_job.status == "failed"
        assert queued_job.error_code == "JOB_PURGED_ON_RESTART"
        assert running_job.error_code == "JOB_PURGED_ON_RESTART"
        assert succeeded_job.status == "succeeded"


def test_api_learning_records_and_student_profile_contract(tmp_path: Path):
    db_path = tmp_path / "learning-profile.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    user_id = "stu-1"
    session_id = str(uuid4())
    user_msg_id = str(uuid4())
    now = datetime.utcnow()

    with session_scope() as session:
        ai_session = AIChatSession(
            id=session_id,
            user_id=user_id,
            title="测试会话",
            source="课后答疑",
            subject="数学",
            archived_flag=False,
            created_at=now - timedelta(hours=4),
            updated_at=now - timedelta(hours=1),
        )
        ai_message = AIChatMessage(
            id=user_msg_id,
            session_id=session_id,
            role="user",
            content="我不懂二次函数图像",
            content_type="text",
            created_at=now - timedelta(hours=3),
        )
        learning_record = AILearningRecord(
            id=str(uuid4()),
            user_id=user_id,
            session_id=session_id,
            message_id=user_msg_id,
            subject="数学",
            knowledge_point="二次函数",
            question_type="qa",
            difficulty="medium",
            solved_flag=False,
            confusion_flag=True,
            extract_version="v1",
            created_at=now - timedelta(hours=2),
        )
        profile = StudentProfile(
            user_id=user_id,
            weak_subjects=["数学"],
            weak_knowledge_points=["二次函数"],
            recent_focus="数学",
            updated_at=now - timedelta(hours=1),
        )
        session.add_all([ai_session, ai_message, learning_record, profile])
        session.flush()

    learning_resp = client.get(
        f"/v1/ai/sessions/{session_id}/learning-records",
        params={"user_id": user_id, "limit": 20},
    )
    assert learning_resp.status_code == 200
    learning_payload = learning_resp.json()
    assert isinstance(learning_payload, list)
    assert len(learning_payload) == 1
    assert learning_payload[0]["knowledge_point"] == "二次函数"
    assert learning_payload[0]["confusion_flag"] is True

    profile_resp = client.get(f"/v1/students/{user_id}/profile")
    assert profile_resp.status_code == 200
    profile_payload = profile_resp.json()
    assert profile_payload["user_id"] == user_id
    assert profile_payload["profile_source"] in {"computed_with_decay", "profile_only"}
    assert isinstance(profile_payload["ability_scores"], list)
    assert len(profile_payload["ability_scores"]) == 5
    assert "数学" in profile_payload["weak_subjects"]
    assert profile_payload["learning_stats"]["records_total"] >= 1


def test_learning_events_api_and_profile_signal(tmp_path: Path):
    db_path = tmp_path / "learning-events.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    missing_user_resp = client.post(
        "/v1/learning-events",
        json={
            "event_type": "quiz_answered",
            "knowledge_points": ["二次函数"],
            "payload": {"is_correct": False, "subject": "数学"},
        },
    )
    assert missing_user_resp.status_code == 400

    event_resp = client.post(
        "/v1/users/stu-events-1/learning-events",
        json={
            "event_type": "quiz_answered",
            "classroom_id": "class-1",
            "scene_id": "scene-1",
            "block_id": "block-scene-1",
            "knowledge_points": ["二次函数"],
            "payload": {"is_correct": False, "subject": "数学"},
            "weight": 1.2,
        },
    )
    assert event_resp.status_code == 200
    event_payload = event_resp.json()
    assert event_payload["user_id"] == "stu-events-1"
    assert event_payload["event_type"] == "quiz_answered"

    with session_scope() as session:
        assert session.query(LearningEvent).filter(LearningEvent.user_id == "stu-events-1").count() == 1

    events_resp = client.get("/v1/users/stu-events-1/learning-events")
    assert events_resp.status_code == 200
    assert len(events_resp.json()) == 1

    profile_resp = client.get("/v1/students/stu-events-1/profile")
    assert profile_resp.status_code == 200
    profile_payload = profile_resp.json()
    assert "二次函数" in profile_payload["weak_knowledge_points"]
    assert profile_payload["learning_stats"]["records_total"] == 1


def test_api_learning_records_rejects_unowned_session_access(tmp_path: Path):
    db_path = tmp_path / "learning-profile-unauth.db"
    storage_root = tmp_path / "objects"
    reconfigure_db(f"sqlite:///{db_path}")
    init_db()

    settings = Settings(
        database_url=f"sqlite:///{db_path}",
        redis_url="redis://unused",
        local_storage_root=str(storage_root),
    )
    app = create_app(
        settings_override=settings,
        queue_client_override=FakeQueueClient(),
        storage_override=LocalObjectStorage(storage_root),
    )
    client = TestClient(app)

    with session_scope() as session:
        session.add(
            AIChatSession(
                id=str(uuid4()),
                user_id="owner-1",
                title="only owner",
                source="课后答疑",
                subject="数学",
                archived_flag=False,
            )
        )
        session.flush()
        target_session_id = session.query(AIChatSession.id).first()[0]

    denied_resp = client.get(
        f"/v1/ai/sessions/{target_session_id}/learning-records",
        params={"user_id": "attacker"},
    )
    assert denied_resp.status_code == 400
    denied_payload = denied_resp.json()
    assert denied_payload["error_code"] == "INVALID_REQUEST"
