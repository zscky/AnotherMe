"""Database helpers (SQLAlchemy)."""

from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import socket
import time
from datetime import datetime
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine.url import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import NullPool

from .config import get_settings


Base = declarative_base()


engine = None
SessionLocal = None


def _create_engine(database_url: str):
    if database_url.startswith("sqlite"):
        busy_timeout_ms = int(os.getenv("GATEWAY_SQLITE_BUSY_TIMEOUT_MS", "30000"))
        connect_args = {
            "check_same_thread": False,
            # Let SQLite wait for write locks instead of failing fast.
            "timeout": max(1.0, busy_timeout_ms / 1000.0),
        }
        sqlite_engine = create_engine(
            database_url,
            future=True,
            pool_pre_ping=True,
            connect_args=connect_args,
            poolclass=NullPool,
        )

        @event.listens_for(sqlite_engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute(f"PRAGMA busy_timeout={busy_timeout_ms}")
            cursor.close()

        return sqlite_engine

    if database_url.startswith("postgresql"):
        connect_timeout_sec = int(os.getenv("GATEWAY_DB_CONNECT_TIMEOUT_SEC", "5"))
        return create_engine(
            database_url,
            future=True,
            pool_pre_ping=True,
            connect_args={"connect_timeout": max(1, connect_timeout_sec)},
        )

    return create_engine(database_url, future=True, pool_pre_ping=True)


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _should_auto_fallback(database_url: str) -> bool:
    if database_url.startswith("sqlite"):
        return False
    raw = os.getenv("GATEWAY_DB_AUTO_FALLBACK")
    if raw is not None:
        return _env_flag("GATEWAY_DB_AUTO_FALLBACK", False)

    # In local/dev/test workflows, prefer resiliency so gateway/worker can boot
    # without requiring a running PostgreSQL instance.
    env_name = os.getenv("GATEWAY_ENV", "dev").strip().lower()
    if env_name in {"dev", "development", "local", "test", "testing"}:
        return True

    # Production-like envs stay disabled by default to avoid split-brain writes.
    return False


def _fallback_sqlite_url() -> str:
    fallback_path = Path(os.getenv("GATEWAY_SQLITE_FALLBACK_PATH", "gateway_data/gateway.local.db"))
    if not fallback_path.is_absolute():
        engine_root = Path(__file__).resolve().parent.parent
        fallback_path = engine_root / fallback_path
    absolute = fallback_path.expanduser().resolve()
    absolute.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{absolute.as_posix()}"


def _is_connectivity_error(exc: OperationalError) -> bool:
    message = str(exc).lower()
    needles = (
        "could not connect",
        "connection refused",
        "connection timeout",
        "timeout expired",
        "name or service not known",
        "temporary failure in name resolution",
        "no route to host",
        "network is unreachable",
    )
    return any(token in message for token in needles)


def _postgres_tcp_reachable(database_url: str) -> bool:
    if not database_url.startswith("postgresql"):
        return True

    url = make_url(database_url)
    if not url.host:
        return True

    timeout_sec = float(os.getenv("GATEWAY_DB_PRECHECK_TIMEOUT_SEC", "1.5"))
    attempts = max(1, int(os.getenv("GATEWAY_DB_PRECHECK_ATTEMPTS", "2")))
    retry_delay_sec = max(0.0, float(os.getenv("GATEWAY_DB_PRECHECK_RETRY_DELAY_MS", "150")) / 1000.0)
    port = url.port or 5432
    for attempt in range(1, attempts + 1):
        try:
            with socket.create_connection((url.host, port), timeout=max(0.2, timeout_sec)):
                return True
        except OSError:
            if attempt == attempts:
                return False
            if retry_delay_sec > 0:
                time.sleep(retry_delay_sec)
    return False


def reconfigure_db(database_url: str | None = None) -> None:
    global engine, SessionLocal
    db_url = database_url or get_settings().database_url
    if engine is not None:
        engine.dispose()
    engine = _create_engine(db_url)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


reconfigure_db()


def init_db() -> None:
    from . import models  # noqa: F401  # ensure model import side effects

    current_url = str(engine.url)

    def _create_all() -> None:
        active_engine = engine
        active_url = str(active_engine.url)

        def _sqlite_column_exists(conn, table: str, column: str) -> bool:
            rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
            return any(str(row[1]).lower() == column.lower() for row in rows)

        def _postgres_column_exists(conn, table: str, column: str) -> bool:
            row = conn.exec_driver_sql(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = :table_name
                  AND column_name = :column_name
                LIMIT 1
                """,
                {"table_name": table, "column_name": column},
            ).first()
            return row is not None

        def _ensure_schema_columns(conn, url: str) -> None:
            if url.startswith("postgresql"):
                conn.exec_driver_sql(
                    "ALTER TABLE job_events ADD COLUMN IF NOT EXISTS trace_event_id VARCHAR(36)"
                )
                conn.exec_driver_sql(
                    "ALTER TABLE job_events ADD COLUMN IF NOT EXISTS trace_event_type VARCHAR(64)"
                )
                conn.exec_driver_sql(
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()"
                )
                conn.exec_driver_sql(
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITHOUT TIME ZONE"
                )
                conn.exec_driver_sql(
                    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITHOUT TIME ZONE"
                )
                conn.exec_driver_sql(
                    "UPDATE jobs SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL"
                )
                conn.exec_driver_sql(
                    "ALTER TABLE jobs ALTER COLUMN updated_at SET NOT NULL"
                )
                return

            if url.startswith("sqlite"):
                if not _sqlite_column_exists(conn, "job_events", "trace_event_id"):
                    conn.exec_driver_sql("ALTER TABLE job_events ADD COLUMN trace_event_id TEXT")
                if not _sqlite_column_exists(conn, "job_events", "trace_event_type"):
                    conn.exec_driver_sql("ALTER TABLE job_events ADD COLUMN trace_event_type TEXT")
                if not _sqlite_column_exists(conn, "jobs", "updated_at"):
                    conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN updated_at TEXT")
                if not _sqlite_column_exists(conn, "jobs", "started_at"):
                    conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN started_at TEXT")
                if not _sqlite_column_exists(conn, "jobs", "completed_at"):
                    conn.exec_driver_sql("ALTER TABLE jobs ADD COLUMN completed_at TEXT")
                now_iso = datetime.utcnow().isoformat()
                conn.exec_driver_sql(
                    "UPDATE jobs SET updated_at = COALESCE(updated_at, created_at, :now_iso) WHERE updated_at IS NULL",
                    {"now_iso": now_iso},
                )
                return

        # Gateway and worker may boot together; serialize schema init on PostgreSQL.
        if active_url.startswith("postgresql"):
            lock_sql = "SELECT pg_advisory_lock(hashtext('anotherme2_schema_init'))"
            unlock_sql = "SELECT pg_advisory_unlock(hashtext('anotherme2_schema_init'))"
            with active_engine.begin() as conn:
                conn.exec_driver_sql(lock_sql)
                try:
                    Base.metadata.create_all(bind=conn)
                    _ensure_schema_columns(conn, active_url)
                finally:
                    conn.exec_driver_sql(unlock_sql)
            return

        with active_engine.begin() as conn:
            Base.metadata.create_all(bind=conn)
            _ensure_schema_columns(conn, active_url)

    if _should_auto_fallback(current_url) and not _postgres_tcp_reachable(current_url):
        fallback_url = _fallback_sqlite_url()
        if current_url != fallback_url:
            print(
                f"[gateway-db] Primary database unreachable ({current_url}), falling back to {fallback_url}",
                flush=True,
            )
            reconfigure_db(fallback_url)
            _create_all()
            return

    try:
        _create_all()
        return
    except OperationalError as exc:
        if not _should_auto_fallback(current_url) or not _is_connectivity_error(exc):
            raise

    fallback_url = _fallback_sqlite_url()
    if current_url == fallback_url:
        raise RuntimeError("Fallback target equals current database URL")

    print(
        f"[gateway-db] Primary database unreachable ({current_url}), falling back to {fallback_url}",
        flush=True,
    )
    reconfigure_db(fallback_url)
    _create_all()


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
