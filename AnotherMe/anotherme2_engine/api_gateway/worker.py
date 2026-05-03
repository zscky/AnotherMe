"""Queue worker for gateway jobs."""

from __future__ import annotations

import os
import time

from .config import get_settings
from .db import init_db, reconfigure_db, session_scope
from .job_service import (
    dequeue_next_queued_job,
    fail_jobs_with_missing_input_objects,
    handle_worker_message,
    purge_prestart_nonterminal_jobs,
    reconcile_running_problem_video_jobs_with_artifacts,
    recover_stale_running_jobs,
)
from .queueing import build_queue_client
from .storage import build_storage


def run_worker() -> None:
    settings = get_settings()
    reconfigure_db(settings.database_url)
    init_db()

    queue_client = build_queue_client(settings)
    storage = build_storage(settings)
    queue_order = [
        settings.queue_package,
        settings.queue_problem_video,
        settings.queue_course,
        settings.queue_learning_record,
    ]
    queue_backend = getattr(queue_client, "backend", "redis")

    print(f"[gateway-worker] started, queues={queue_order}, backend={queue_backend}")

    if settings.startup_purge_enabled:
        with session_scope() as startup_session:
            purged = purge_prestart_nonterminal_jobs(
                startup_session,
                max_purge=max(0, settings.purge_prestart_jobs_batch),
            )
            if purged:
                print(f"[gateway-worker] purged {purged} pre-restart queued/running job(s) on startup")

        if settings.purge_prestart_queue_messages_on_startup:
            purge_method = getattr(queue_client, "purge_queues", None)
            if callable(purge_method):
                queue_targets = [
                    settings.queue_course,
                    settings.queue_problem_video,
                    settings.queue_package,
                    settings.queue_learning_record,
                ]
                purged_messages = int(purge_method(queue_targets) or 0)
                if purged_messages:
                    print(f"[gateway-worker] purged {purged_messages} queued message(s) on startup")
    elif settings.purge_prestart_jobs_on_startup and not settings.startup_purge_armed:
        print(
            "[gateway-worker] startup purge is requested but skipped because "
            "GATEWAY_STARTUP_PURGE_ARMED is not enabled"
        )

    generation_timeout_sec = max(60, int(os.getenv("ANOTHERME2_GENERATION_TIMEOUT_SEC", "1800")))
    effective_stale_seconds = max(settings.running_job_stale_seconds, generation_timeout_sec + 120)
    stale_recovery_queues = [settings.queue_problem_video]
    missing_input_cleanup_queues = [settings.queue_problem_video]
    reconcile_result_queues = [settings.queue_problem_video]
    last_db_fallback_scan = 0.0
    db_fallback_scan_interval_sec = 1.0

    while True:
        idle_sleep_seconds = 0.0
        with session_scope() as session:
            reconciled = reconcile_running_problem_video_jobs_with_artifacts(
                session,
                reconcile_result_queues,
                max_reconciliations=max(0, settings.running_job_result_reconcile_batch),
            )
            if reconciled:
                print(f"[gateway-worker] reconciled {reconciled} running job(s) to succeeded from uploaded artifacts")

            cleaned = fail_jobs_with_missing_input_objects(
                session,
                storage,
                missing_input_cleanup_queues,
                max_failures=max(0, settings.missing_input_cleanup_batch),
            )
            if cleaned:
                print(f"[gateway-worker] marked {cleaned} job(s) failed due to missing input object")

            recovered = recover_stale_running_jobs(
                session,
                queue_client,
                stale_recovery_queues,
                stale_seconds=effective_stale_seconds,
                max_recoveries=settings.running_job_recover_batch,
            )
            if recovered:
                print(f"[gateway-worker] recovered {recovered} stale running job(s)")

            if queue_backend == "polling":
                message = dequeue_next_queued_job(session, queue_order)
                if not message:
                    idle_sleep_seconds = 0.3
                    message = None
            else:
                now_monotonic = time.monotonic()
                message = None
                if (now_monotonic - last_db_fallback_scan) >= db_fallback_scan_interval_sec:
                    # Fallback DB polling keeps queued jobs recoverable even if Redis messages are lost.
                    message = dequeue_next_queued_job(session, queue_order)
                    last_db_fallback_scan = now_monotonic

                if not message:
                    item = queue_client.dequeue(queue_order, timeout=3)
                    if not item:
                        idle_sleep_seconds = 0.1
                        message = None
                    else:
                        _queue_name, message = item
                else:
                    # Avoid starving Redis queues when DB fallback keeps finding work.
                    idle_sleep_seconds = 0.0

            if not message:
                continue

            handle_worker_message(
                session=session,
                queue_client=queue_client,
                message=message,
                settings=settings,
                storage=storage,
            )

        if idle_sleep_seconds > 0:
            time.sleep(idle_sleep_seconds)


if __name__ == "__main__":
    run_worker()
