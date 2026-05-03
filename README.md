# AnotherMe Unified Project

This repository is now organized as one backend-first project with two engines:

- `AnotherMe`: unified main project root
  - `anotherme-core` (Node/Next.js)
  - `anotherme2-engine` (Python)
  - `api-gateway` (FastAPI in `anotherme2_engine/api_gateway`)

## Unified Architecture

- `api-gateway` (FastAPI, in `AnotherMe/anotherme2_engine/api_gateway`)
  - unified external APIs
  - job orchestration and status tracking
  - routes jobs to AnotherMe core and integrated `anotherme2_engine` worker flows
- `anotherme-core` (Node/Next.js, in `AnotherMe`)
  - topic-to-course generation
  - classroom content generation
- `anotherme2-engine` (Python, in `AnotherMe/anotherme2_engine`)
  - image-to-teaching-video flow
  - vision -> script -> voice -> animation -> merge
- infrastructure
  - Postgres: job metadata
  - Redis: queues (`q.course`, `q.problem_video`, `q.package`)
  - MinIO/S3: artifacts

## Repository Layout

```text
AnotherMe-V3/
  AnotherMe/
    app/                   # anotherme-core app
    lib/                   # anotherme-core libs
    .env.example           # Next.js / provider config template
    .env.local             # local Next.js / provider config, ignored by git
    anotherme2_engine/     # python engine + api-gateway
      api_gateway/
        .env.example       # gateway config template
        .env               # local gateway config, ignored by git
  scripts/                 # unified start/stop/status scripts
  docker-compose.unified.yml
```

## Unified APIs

Gateway endpoints:

- `POST /v1/uploads`
- `POST /v1/jobs`
- `GET /v1/jobs/{job_id}`
- `GET /v1/jobs/{job_id}/result`

Job types:

- `course_generate`
- `problem_video_generate`
- `study_package_generate`

## Quick Start (Local, non-docker)

Prerequisites:

- Node.js 20.9 or newer.
- pnpm 10.x.
- Python 3.10 or newer; Python 3.11 is recommended and is what the Docker setup uses.
- `uv` for the Python gateway and worker.

If pnpm is missing after installing Node.js, enable it with:

- `corepack enable`

If uv is missing, install it from <https://docs.astral.sh/uv/> or use your Python package manager.

Steps:

1. Enter the app directory:
   - `cd AnotherMe`
2. Run the configuration tour:
   - `pnpm setup:tour`
   - or `python scripts/config_tour.py`
3. Validate configuration at any time:
   - `pnpm config:check`
   - or `python scripts/config_tour.py --check`
4. Install dependencies:
   - `pnpm install`
   - install `uv` for the Python gateway/worker if it is not already available.
5. Start all local services from `AnotherMe/`:
   - `pnpm dev:all`

Expected local URLs:

- Web app: `http://localhost:3000`
- API gateway: `http://127.0.0.1:8080`

If you only want to verify the Web app and login flow first, you can start just the Next.js app:

- `pnpm dev`

Then open `http://localhost:3000`.

Legacy PowerShell helpers remain available from the repository root:

1. Start services:
   - `pwsh ./scripts/dev-up.ps1`
2. Check service status:
   - `pwsh ./scripts/dev-status.ps1`
3. Stop all:
   - `pwsh ./scripts/dev-down.ps1`

## Environment Files

- `AnotherMe/.env.local`: Next.js app, AI providers, TTS/ASR/PDF/image/video provider keys, web search, and `ANOTHERME2_GATEWAY_*` client settings.
- `AnotherMe/anotherme2_engine/api_gateway/.env`: Python gateway/worker settings, database, Redis, queues, object storage, job timeout, and `GATEWAY_API_TOKEN`.
- `AnotherMe/server-providers.yml`: optional but recommended server-owned provider credentials. Runtime priority is `server-providers.yml > .env.local > user request values`, so deployment-provided keys win over browser/user-entered keys.
- DeepTutor `.env*` files belong to the reference project and are not used by AnotherMe runtime.

Do not add a repository-root `.env` for AnotherMe. The runtime no longer reads root `.env` files, which avoids silent conflicts between the Web app and gateway settings.

## First Login

There is no default admin or demo account. Create the first account yourself:

1. Open `http://localhost:3000/register`.
2. Enter an email address, display name, and a password with at least 8 characters.
3. Submit the form. Registration also signs you in.
4. Later, use `http://localhost:3000/login` with the same email and password.

The auth database is created automatically at `AnotherMe/data/auth.sqlite` on first registration. Make sure the `AnotherMe/data` directory is writable by the process running Next.js.

If login fails after a restart, check:

- `AnotherMe/data/auth.sqlite` still exists and was not deleted with generated runtime data.
- You are opening the same app origin that created the cookie, normally `http://localhost:3000`.
- `AUTH_COOKIE_SECURE` is not forced to `true` for local plain-HTTP development.

## Quick Start (Docker Compose)

1. Prepare the same two local env files:
   - `AnotherMe/.env.local`
   - `AnotherMe/anotherme2_engine/api_gateway/.env`
2. Start services:
   - `docker compose -f docker-compose.unified.yml up -d --build`
3. Stop:
   - `docker compose -f docker-compose.unified.yml down`

## Notes

- This integration uses only one top-level service folder: `AnotherMe`.
- You can continue running each subproject independently if needed.
