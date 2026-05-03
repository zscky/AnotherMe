# API Gateway (Phase 1)

统一后端网关：对接 AnotherMe 课程生成、AnotherMe2 拍题视频生成、消息中心与 AI 会话存储。

## 启动

根目录统一启动：

```bash
pnpm dev:all
```

或分别启动：

```bash
python run_gateway.py
python run_gateway_worker.py
```

## 主要接口

- `POST /v1/uploads` 上传拍题图片，返回 `object_key`
- `POST /v1/jobs` 创建任务（`course_generate` / `problem_video_generate` / `study_package_generate` / `learning_record_extract`）
- `GET /v1/jobs/{job_id}` 查询任务状态
- `GET /v1/jobs/{job_id}/result` 查询任务结果
- `GET /v1/messages/conversations` 查询消息会话
- `POST /v1/messages/conversations` 创建消息会话
- `GET /v1/messages/{conversation_id}/messages` 查询会话消息
- `POST /v1/messages/{conversation_id}/messages` 发送消息
- `POST /v1/messages/{conversation_id}/read` 标记会话已读
- `GET /v1/ai/sessions` 查询 AI 会话
- `POST /v1/ai/sessions` 创建 AI 会话
- `GET /v1/ai/sessions/{session_id}/messages` 查询 AI 消息
- `POST /v1/ai/sessions/{session_id}/messages` 写入 AI 消息
- `GET /v1/ai/sessions/{session_id}/learning-records` 查询会话学习抽取记录
- `POST /v1/ai/messages/{message_id}/feedback` 提交 AI 消息反馈
- `GET /v1/students/{user_id}/profile` 查询学生画像快照（时间衰减评分）

## 统一任务状态机

- `queued -> running -> succeeded|failed`
- 统一返回字段：`progress`、`step`、`error_code`、`error_message`、`result`

## 任务输入契约

- `course_generate`
  - `requirement` 必填
  - `language` 默认 `zh-CN`
  - `options`: `enable_web_search`、`enable_image_generation`、`enable_video_generation`、`enable_tts`、`agent_mode`
  - `pedagogy_profile` 可选：`domain/exam_orientation/grade_band/strictness`
- `problem_video_generate`
  - `image_object_key` 必填
  - `problem_text` 可选
  - `geometry_file` 可选
  - `output_profile` 默认 `1080p`
- `study_package_generate`
  - `source.type`: `topic | photo`
  - `source.topic` 或 `source.image_object_key`
  - `outputs`: `course:boolean`、`problem_video:boolean`
- `learning_record_extract`
  - `session_id` 必填（AI 会话 ID）
  - `user_id` 可选（默认使用会话归属用户）
  - `extract_version` 默认 `v1`
  - `latest_user_message_id` 可选（用于增量抽取去重）
  - `message_count` 可选（配合最新消息快照做幂等）

## 任务输出契约

- `course_generate` -> `{classroom_id, classroom_url, scenes_count}`
- `problem_video_generate` -> `{video_url, duration_sec, script_steps_count, debug_bundle_url}`
- `study_package_generate` -> `{package_id, course_result?, problem_video_result?}`
- `learning_record_extract` -> `{session_id, user_id, records_created, subjects, knowledge_points, extract_version}`

## 关键环境变量

- `GATEWAY_DATABASE_URL`（例如 `postgresql+psycopg://user:pass@localhost:5432/anotherme2`）
- `GATEWAY_REDIS_URL`（例如 `redis://localhost:6379/0`）
- `ANOTHERME_BASE_URL`（例如 `http://localhost:3000`）
- `GATEWAY_COURSE_GENERATION_PROVIDER`（`legacy` 或 `msm_v1`，默认 `legacy`）
- `OBJECT_STORAGE_DRIVER`（`local` / `s3` / `minio`）
- `OBJECT_STORAGE_BUCKET`、`OBJECT_STORAGE_ENDPOINT_URL`、`OBJECT_STORAGE_ACCESS_KEY`、`OBJECT_STORAGE_SECRET_KEY`

默认支持 `local` 存储用于本地调试；生产建议使用 MinIO/S3。
