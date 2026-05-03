"""Runtime settings for the API gateway."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

try:
    from env_loader import load_project_env
except ModuleNotFoundError:
    from anotherme2_engine.env_loader import load_project_env


load_project_env()


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("GATEWAY_APP_NAME", "anotherme2-gateway")
    app_env: str = os.getenv("GATEWAY_ENV", "dev")
    app_host: str = os.getenv("GATEWAY_HOST", "0.0.0.0")
    app_port: int = int(os.getenv("GATEWAY_PORT", "8080"))

    database_url: str = os.getenv(
        "GATEWAY_DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@localhost:5432/anotherme2",
    )

    redis_url: str = os.getenv("GATEWAY_REDIS_URL", "redis://localhost:6379/0")
    queue_backend: Literal["auto", "redis", "polling"] = os.getenv("GATEWAY_QUEUE_BACKEND", "auto")  # type: ignore[assignment]
    queue_course: str = os.getenv("GATEWAY_QUEUE_COURSE", "q.course")
    queue_problem_video: str = os.getenv("GATEWAY_QUEUE_PROBLEM_VIDEO", "q.problem_video")
    queue_package: str = os.getenv("GATEWAY_QUEUE_PACKAGE", "q.package")
    queue_learning_record: str = os.getenv("GATEWAY_QUEUE_LEARNING_RECORD", "q.learning_record")
    queue_dead_letter_prefix: str = os.getenv("GATEWAY_DLQ_PREFIX", "q.dlq")
    max_retries: int = int(os.getenv("GATEWAY_MAX_RETRIES", "2"))
    retry_base_seconds: int = int(os.getenv("GATEWAY_RETRY_BASE_SECONDS", "5"))
    running_job_stale_seconds: int = int(os.getenv("GATEWAY_RUNNING_JOB_STALE_SECONDS", "1800"))
    running_job_recover_batch: int = int(os.getenv("GATEWAY_RUNNING_JOB_RECOVER_BATCH", "8"))
    running_job_result_reconcile_batch: int = int(os.getenv("GATEWAY_RUNNING_JOB_RESULT_RECONCILE_BATCH", "12"))
    missing_input_cleanup_batch: int = int(os.getenv("GATEWAY_MISSING_INPUT_CLEANUP_BATCH", "12"))
    purge_prestart_jobs_on_startup: bool = _bool_env("GATEWAY_PURGE_PRESTART_JOBS_ON_STARTUP", False)
    purge_prestart_jobs_batch: int = int(os.getenv("GATEWAY_PURGE_PRESTART_JOBS_BATCH", "5000"))
    purge_prestart_queue_messages_on_startup: bool = _bool_env(
        "GATEWAY_PURGE_PRESTART_QUEUE_MESSAGES_ON_STARTUP",
        False,
    )
    # Safety latch for destructive startup purge behavior.
    # Even if purge flags are enabled, startup purge is skipped unless this is truthy.
    startup_purge_armed: bool = _bool_env("GATEWAY_STARTUP_PURGE_ARMED", False)

    anotherme_base_url: str = os.getenv("ANOTHERME_BASE_URL", "http://localhost:3000")
    anotherme_poll_seconds: int = int(os.getenv("ANOTHERME_POLL_SECONDS", "5"))
    anotherme_timeout_seconds: int = int(os.getenv("ANOTHERME_TIMEOUT_SECONDS", "1200"))
    course_generation_provider: Literal["legacy", "msm_v1"] = os.getenv(
        "GATEWAY_COURSE_GENERATION_PROVIDER",
        "legacy",
    )  # type: ignore[assignment]

    object_storage_driver: str = os.getenv("OBJECT_STORAGE_DRIVER", "local")
    object_storage_bucket: str = os.getenv("OBJECT_STORAGE_BUCKET", "anotherme2-artifacts")
    object_storage_endpoint: str = os.getenv("OBJECT_STORAGE_ENDPOINT_URL", "")
    object_storage_access_key: str = os.getenv("OBJECT_STORAGE_ACCESS_KEY", "")
    object_storage_secret_key: str = os.getenv("OBJECT_STORAGE_SECRET_KEY", "")
    object_storage_region: str = os.getenv("OBJECT_STORAGE_REGION", "us-east-1")
    object_storage_public_base_url: str = os.getenv("OBJECT_STORAGE_PUBLIC_BASE_URL", "")
    local_storage_root: str = os.getenv("LOCAL_STORAGE_ROOT", "./gateway_data/objects")

    worker_temp_root: str = os.getenv("GATEWAY_WORKER_TEMP_ROOT", "./gateway_data/tmp")
    worker_output_root: str = os.getenv("GATEWAY_WORKER_OUTPUT_ROOT", "./gateway_data/runs")
    keep_run_output: bool = _bool_env("GATEWAY_KEEP_RUN_OUTPUT", True)

    # Optional static token for phase-1 single-tenant auth.
    api_token: str = os.getenv("GATEWAY_API_TOKEN", "")

    @property
    def queue_mapping(self) -> dict[str, str]:
        return {
            "course_generate": self.queue_course,
            "problem_video_generate": self.queue_problem_video,
            "study_package_generate": self.queue_package,
            "learning_record_extract": self.queue_learning_record,
        }

    @property
    def dlq_mapping(self) -> dict[str, str]:
        return {
            queue: f"{self.queue_dead_letter_prefix}.{queue}"
            for queue in [
                self.queue_course,
                self.queue_problem_video,
                self.queue_package,
                self.queue_learning_record,
            ]
        }

    @property
    def startup_purge_enabled(self) -> bool:
        return bool(self.purge_prestart_jobs_on_startup and self.startup_purge_armed)


_SETTINGS: Settings | None = None


def get_settings() -> Settings:
    global _SETTINGS
    if _SETTINGS is None:
        _SETTINGS = Settings()
    return _SETTINGS
