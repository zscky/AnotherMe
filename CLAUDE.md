# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AnotherMe (镜我) is an AGPL-3.0 licensed AI education platform with three engines:

- **anotherme-core** (`AnotherMe/`): Next.js 16 / React 19 web app with 70+ API routes
- **anotherme2-engine** (`AnotherMe/anotherme2_engine/`): Python image-to-teaching-video pipeline using LangChain/LangGraph
- **api-gateway** (`AnotherMe/anotherme2_engine/api_gateway/`): FastAPI unified REST API with job orchestration

Infrastructure: PostgreSQL (job metadata), Redis (queues: `q.course`, `q.problem_video`, `q.package`), MinIO/S3 (artifacts).

Local URLs: Web app at `localhost:3000`, API gateway at `127.0.0.1:8080`.

No default admin account — register at `http://localhost:3000/register`. Auth DB auto-created at `AnotherMe/data/auth.sqlite`.

## Prerequisites

- Node.js 20.9+ (22 recommended)
- pnpm 10.x (enable via `corepack enable` if missing)
- Python 3.10+ (3.11 recommended)
- `uv` for Python gateway/worker (install from https://docs.astral.sh/uv/)

## Commands

All commands run from `AnotherMe/` directory unless noted.

### Development
```bash
pnpm dev                  # Next.js dev server only (localhost:3000)
pnpm dev:all              # Start all: web + gateway + worker
pnpm dev:gateway          # API gateway only (localhost:8080)
pnpm dev:worker           # Queue worker only
```

### Build & Lint
```bash
pnpm build                # Production build (next build)
pnpm lint                 # ESLint
pnpm check                # Prettier check
pnpm format               # Prettier auto-fix
npx tsc --noEmit          # TypeScript type check
```

### Testing
```bash
pnpm test                          # All unit tests (vitest run, single pass)
pnpm test -- path/to.test.ts       # Single unit test file
pnpm test:e2e                      # E2E tests (Playwright, Chromium)
pnpm test:e2e:ui                   # E2E with interactive UI

# Python tests
cd AnotherMe/anotherme2_engine && pytest
cd AnotherMe/anotherme2_engine && pytest tests/test_vision_agent.py  # Single test
```

### Configuration
```bash
pnpm setup:tour           # Interactive env configuration guide
pnpm config:check         # Validate current configuration
```

### Docker
```bash
docker compose -f docker-compose.unified.yml up -d --build    # Full stack (6 services)
docker compose -f docker-compose.unified.yml down              # Stop
```

## Architecture

### Web App (Next.js 16, App Router)

The app uses feature-based organization. Key directories:

- `app/(dashboard)/` — Main pages: ai-tutor, live-book, classes, photo-to-video, diagnostic, settings
- `app/api/` — 70+ REST route handlers (auth, chat, classroom, generation, live-book, problem-video, students, etc.)
- `features/` — Feature modules (components, pages, server logic) for: ai-tutor, auth, classroom, live-book, problem-video, diagnostic, profile, settings
- `lib/` — Shared libraries: ai (LLM providers), auth (SQLite sessions), store (Zustand), i18n, hooks, and domain modules
- `components/` — Shared UI (shadcn/ui + layout components)
- `packages/` — pnpm workspace packages: `mathml2omml` (MathML→OMML), `pptxgenjs` (PowerPoint fork)

Path alias: `@/*` maps to project root.

### Python Engine (Image → Video Pipeline)

Agent pipeline in `AnotherMe/anotherme2_engine/agents/`:

```
VisionAgent → ScriptAgent → VoiceAgent → AnimationAgent → RepairAgent → MergeAgent
```

Organized by domain:
- `foundation/` — BaseAgent, AgentState/VideoProject/ScriptStep types, learning events, capability registry
- `perception/` — VisionAgent (image OCR, scene graph, geometry), CoordinateSceneCompiler
- `planning/` — ScriptAgent, AnimationPlanner, SceneGraphUpdater, CanvasScene, TeachingIRPlanner, LearnerModelingAgent
- `execution/` — AnimationAgent (4-layer: SceneGraphUpdater→AnimationPlanner→CanvasScene→TemplateCodegen), VoiceAgent (edge-tts), RepairAgent (rule-based Manim fixes), MergeAgent (Manim render→MP4)
- `orchestration/` — LangGraph workflow definition

CLI entry: `python main.py --image problem.png [--problem "text"] [--output_dir ./out]`

### API Gateway (FastAPI)

Located in `AnotherMe/anotherme2_engine/api_gateway/`. Key files:
- `app.py` — FastAPI application with all endpoints
- `job_service.py` — Job orchestration (create, status, result)
- `chat_service.py` — AI chat service
- `config.py` — Settings (env-based via `GATEWAY_*` vars)
- `db.py` — SQLAlchemy database layer
- `models.py` / `schemas.py` — Data models and Pydantic schemas
- `storage.py` — Object storage (local/S3/MinIO)
- `queueing.py` — Redis queue management
- `knowledge_graph.py` / `knowledge_tracing_service.py` — Student knowledge modeling

REST endpoints: `/v1/uploads`, `/v1/jobs`, `/v1/jobs/{id}`, `/v1/jobs/{id}/result`

Job types: `course_generate`, `problem_video_generate`, `study_package_generate`, `learning_record_extract`

### Auth System

SQLite-based (via sql.js) at `AnotherMe/data/auth.sqlite`. Email/password with 14-day session TTL. Session fixation prevention on login. Cookie-based sessions.

### State Management

Zustand stores in `lib/store/`: settings, canvas, stage, media-generation, snapshots, keyboard, whiteboard-history, user-profile. IndexedDB (dexie) for client persistence.

### Internationalization

4 locales: zh-CN (primary), en-US, ja-JP, ru-RU. Uses i18next. Translation files in `lib/i18n/locales/`.

## Environment Files

- `AnotherMe/.env.local` — Main config: LLM/TTS/ASR/PDF/Image/Video provider keys, gateway URL/token
- `AnotherMe/anotherme2_engine/api_gateway/.env` — Gateway config: Postgres, Redis, queues, object storage
- `AnotherMe/server-providers.yml` — Optional server-owned provider credentials (priority: server-providers.yml > .env.local > user values)
- `AnotherMe/.env.example` — Template with all supported providers

Never add a root-level `.env` — the runtime doesn't read it.

## CI/CD

GitHub Actions (`AnotherMe/.github/workflows/ci.yml`) on push/PR to `main`:
1. **check**: Prettier → ESLint → TypeScript → Vitest
2. **e2e**: Playwright (Chromium)

## DeepTutor Subproject

`DeepTutor/` is a separate agent-native learning companion (its own git repo, Apache-2.0 license). It has its own AGENTS.md, pyproject.toml, and Docker setup. It is not used at runtime by AnotherMe.

## Key Conventions

- TypeScript strict mode; path alias `@/*`
- Prettier: 100 char width, 2-space indent, single quotes, trailing commas, LF
- ESLint: next/core-web-vitals + next/typescript; unused vars with `_` prefix are warnings
- Python: LangChain/LangGraph for agent orchestration; Manim for math animations
- Chinese is the primary UI and documentation language
