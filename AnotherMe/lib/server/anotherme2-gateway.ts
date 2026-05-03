import { createLogger } from '@/lib/logger';
import type { LearningContext } from '@/lib/types/learning-context';

const log = createLogger('AnotherMe2Gateway');

const DEFAULT_USER_ID = 'anotherme-problem-video-ui';
export const DEFAULT_CHAT_USER_ID = 'anotherme-default-user';

export interface AnotherMe2UploadResponse {
  object_key: string;
  url: string;
  size: number;
  content_type: string;
}

export interface AnotherMe2JobSummary {
  job_id: string;
  job_type: string;
  status: string;
  progress: number;
  step: string;
  error_code?: string | null;
  error_message?: string | null;
  result?: Record<string, unknown> | null;
}

export interface AnotherMe2ProblemVideoResult {
  video_url?: string;
  duration_sec?: number;
  script_steps_count?: number;
  debug_bundle_url?: string | null;
  learner_memory_records?: number;
  learner_memory_events?: number;
}

export interface GatewayConversationSummary {
  conversation_id: string;
  type: string;
  name: string;
  creator_id: string;
  last_message_id?: string | null;
  last_message_time?: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export interface GatewayAttachment {
  attachment_id: string;
  file_url: string;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  object_key?: string | null;
}

export interface GatewayMessage {
  message_id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  message_type: string;
  content: string;
  reply_to_message_id?: string | null;
  status: string;
  source_type: string;
  source_ref_id?: string | null;
  recalled_flag: boolean;
  deleted_flag: boolean;
  created_at: string;
  attachments: GatewayAttachment[];
}

export interface GatewayConversationMember {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  mute_flag: boolean;
  unread_count: number;
  last_read_message_id?: string | null;
  last_read_seq: number;
}

export interface GatewayRemoveConversationMemberResult {
  conversation_id: string;
  member_user_id: string;
  removed: boolean;
}

export interface GatewayAIChatSession {
  session_id: string;
  user_id: string;
  title: string;
  source: string;
  subject?: string | null;
  linked_classroom_id?: string | null;
  linked_conversation_id?: string | null;
  archived_flag: boolean;
  created_at: string;
  updated_at: string;
}

export interface GatewayAIChatMessage {
  message_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_type: string;
  model_name?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  latency_ms?: number | null;
  request_id?: string | null;
  parent_message_id?: string | null;
  created_at: string;
}

export interface GatewayAIMessageFeedback {
  feedback_id: string;
  message_id: string;
  user_id: string;
  rating: 'like' | 'dislike';
  feedback_text?: string | null;
  created_at: string;
}

export interface LearningRecordExtractResult {
  session_id: string;
  user_id: string;
  records_created: number;
  subjects: string[];
  knowledge_points: string[];
  extract_version: string;
  latest_user_message_id?: string;
  message_count?: number;
}

export interface GatewayLearningRecord {
  record_id: string;
  user_id: string;
  session_id: string;
  message_id?: string | null;
  subject?: string | null;
  knowledge_point?: string | null;
  question_type?: string | null;
  difficulty?: string | null;
  solved_flag: boolean;
  confusion_flag: boolean;
  extract_version: string;
  created_at: string;
}

export interface GatewayAbilityScore {
  metric: string;
  value: number;
  full_mark: number;
}

export interface GatewayLearningStats {
  records_total: number;
  records_14d: number;
  active_days_14: number;
  confusion_records: number;
  solved_records: number;
  top_subjects: string[];
  top_knowledge_points: string[];
  total_weight: number;
}

export interface GatewayStudentProfile {
  user_id: string;
  weak_subjects: string[];
  weak_knowledge_points: string[];
  recent_focus?: string | null;
  ability_scores: GatewayAbilityScore[];
  learning_stats: GatewayLearningStats;
  updated_at?: string | null;
  computed_at: string;
  profile_source: string;
}

export interface GatewayLearningEvent {
  event_id: string;
  user_id: string;
  event_type: string;
  session_id?: string | null;
  classroom_id?: string | null;
  scene_id?: string | null;
  block_id?: string | null;
  knowledge_points?: string[] | null;
  payload?: Record<string, unknown> | null;
  weight: number;
  created_at: string;
}

interface AnotherMe2JobResultResponse {
  job_id: string;
  status: string;
  result: AnotherMe2ProblemVideoResult;
}

class AnotherMe2GatewayError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AnotherMe2GatewayError';
    this.status = status;
  }
}

function getGatewayBaseUrl(): string {
  const value = process.env.ANOTHERME2_GATEWAY_BASE_URL?.trim();
  if (!value) {
    throw new AnotherMe2GatewayError(
      'AnotherMe2 gateway is not configured. Set ANOTHERME2_GATEWAY_BASE_URL.',
      500,
    );
  }
  return value.replace(/\/+$/, '');
}

function buildGatewayHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  const token = process.env.ANOTHERME2_GATEWAY_TOKEN?.trim();
  if (token) {
    merged.set('Authorization', `Bearer ${token}`);
  }
  return merged;
}

async function parseGatewayResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

async function gatewayFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getGatewayBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: buildGatewayHeaders(init?.headers),
      cache: 'no-store',
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Unknown network error';
    log.error(`Gateway request unreachable: ${path} ${message}`);
    const hint =
      /connection error|econnrefused|fetch failed|network|refused|timed out|timeout/i.test(message)
        ? ' 请确认已在运行 AnotherMe2 网关（如 pnpm dev:gateway），且 AnotherMe 的 ANOTHERME2_GATEWAY_BASE_URL 与网关监听地址一致；若使用 pnpm dev:all 复用已有 Next 进程，请核对 .env.local 中的网关 URL。'
        : '';
    throw new AnotherMe2GatewayError(
      `无法连接 AnotherMe2 网关（${getGatewayBaseUrl()}）：${message}。${hint}`,
      503,
    );
  }

  const payload = await parseGatewayResponse(response);
  if (!response.ok) {
    let message = `Gateway request failed with status ${response.status}`;
    if (payload && typeof payload === 'object') {
      const maybeMessage =
        'message' in payload
          ? payload.message
          : 'detail' in payload && payload.detail && typeof payload.detail === 'object'
            ? (payload.detail as { message?: string }).message
            : undefined;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
        message = maybeMessage;
      }
    } else if (typeof payload === 'string' && payload.trim()) {
      message = payload;
    }

    log.warn(`Gateway request failed: ${response.status} ${path} ${message}`);
    throw new AnotherMe2GatewayError(message, response.status);
  }

  return payload as T;
}

export async function uploadProblemImageToAnotherMe2(file: File): Promise<AnotherMe2UploadResponse> {
  const body = new FormData();
  body.append('file', file, file.name);
  return gatewayFetch<AnotherMe2UploadResponse>('/v1/uploads', {
    method: 'POST',
    body,
  });
}

export async function createAnotherMe2ProblemVideoJob(params: {
  imageObjectKey: string;
  problemText?: string;
  outputProfile?: '1080p';
  userId?: string;
  learnerSessionId?: string;
  learnerLookbackDays?: number;
  learningContext?: LearningContext;
}): Promise<AnotherMe2JobSummary> {
  const payload: Record<string, unknown> = {
    image_object_key: params.imageObjectKey,
    output_profile: params.outputProfile || '1080p',
  };
  if (params.problemText?.trim()) {
    payload.problem_text = params.problemText.trim();
  }
  if (params.userId?.trim()) {
    payload.learner_user_id = params.userId.trim();
  }
  if (params.learnerSessionId?.trim()) {
    payload.learner_session_id = params.learnerSessionId.trim();
  }
  if (typeof params.learnerLookbackDays === 'number') {
    payload.learner_lookback_days = params.learnerLookbackDays;
  }
  if (params.learningContext) {
    payload.learning_context = params.learningContext;
  }

  return gatewayFetch<AnotherMe2JobSummary>('/v1/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_type: 'problem_video_generate',
      user_id: params.userId?.trim() || DEFAULT_USER_ID,
      payload,
    }),
  });
}

export async function getAnotherMe2Job(jobId: string): Promise<AnotherMe2JobSummary> {
  return gatewayFetch<AnotherMe2JobSummary>(`/v1/jobs/${jobId}`);
}

export async function getAnotherMe2ProblemVideoResult(
  jobId: string,
): Promise<AnotherMe2ProblemVideoResult> {
  const payload = await gatewayFetch<AnotherMe2JobResultResponse>(`/v1/jobs/${jobId}/result`);
  return payload.result || {};
}

export async function listGatewayConversations(params: {
  userId: string;
  limit?: number;
}): Promise<GatewayConversationSummary[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  return gatewayFetch<GatewayConversationSummary[]>(`/v1/messages/conversations?${query.toString()}`);
}

export async function createGatewayConversation(params: {
  userId: string;
  type?: string;
  name: string;
  creatorId?: string;
  memberIds?: string[];
}): Promise<GatewayConversationSummary> {
  return gatewayFetch<GatewayConversationSummary>('/v1/messages/conversations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      type: params.type || 'single',
      name: params.name,
      creator_id: params.creatorId,
      member_ids: params.memberIds || [],
    }),
  });
}

export async function listGatewayConversationMembers(params: {
  conversationId: string;
  userId: string;
}): Promise<GatewayConversationMember[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  return gatewayFetch<GatewayConversationMember[]>(
    `/v1/messages/${params.conversationId}/members?${query.toString()}`,
  );
}

export async function addGatewayConversationMembers(params: {
  conversationId: string;
  operatorUserId: string;
  memberIds: string[];
}): Promise<GatewayConversationMember[]> {
  return gatewayFetch<GatewayConversationMember[]>(`/v1/messages/${params.conversationId}/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operator_user_id: params.operatorUserId,
      member_ids: params.memberIds,
    }),
  });
}

export async function removeGatewayConversationMember(params: {
  conversationId: string;
  memberUserId: string;
  operatorUserId: string;
}): Promise<GatewayRemoveConversationMemberResult> {
  const encodedMemberUserId = encodeURIComponent(params.memberUserId);
  return gatewayFetch<GatewayRemoveConversationMemberResult>(
    `/v1/messages/${params.conversationId}/members/${encodedMemberUserId}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operator_user_id: params.operatorUserId,
      }),
    },
  );
}

export async function deleteGatewayConversation(params: {
  conversationId: string;
  operatorUserId: string;
}): Promise<{ conversation_id: string; deleted: boolean }> {
  return gatewayFetch<{ conversation_id: string; deleted: boolean }>(
    `/v1/messages/conversations/${encodeURIComponent(params.conversationId)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operator_user_id: params.operatorUserId,
      }),
    },
  );
}

export async function listGatewayMessages(params: {
  conversationId: string;
  userId: string;
  limit?: number;
  beforeSeq?: number;
}): Promise<GatewayMessage[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  if (typeof params.beforeSeq === 'number') {
    query.set('before_seq', String(params.beforeSeq));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayMessage[]>(`/v1/messages/${params.conversationId}/messages${suffix}`);
}

export async function createGatewayMessage(params: {
  conversationId: string;
  senderId: string;
  content: string;
  messageType?: string;
  replyToMessageId?: string;
  status?: string;
  sourceType?: string;
  sourceRefId?: string;
  attachments?: Array<{
    file_url: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
    object_key?: string;
  }>;
}): Promise<GatewayMessage> {
  return gatewayFetch<GatewayMessage>(`/v1/messages/${params.conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender_id: params.senderId,
      message_type: params.messageType || 'text',
      content: params.content,
      reply_to_message_id: params.replyToMessageId,
      status: params.status || 'sent',
      source_type: params.sourceType || 'manual',
      source_ref_id: params.sourceRefId,
      attachments: params.attachments || [],
    }),
  });
}

export async function markGatewayConversationRead(params: {
  conversationId: string;
  userId: string;
  lastReadSeq?: number;
}): Promise<{ conversation_id: string; user_id: string; last_read_seq: number; unread_count: number }> {
  return gatewayFetch<{ conversation_id: string; user_id: string; last_read_seq: number; unread_count: number }>(
    `/v1/messages/${params.conversationId}/read`,
    {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      last_read_seq: params.lastReadSeq,
    }),
    },
  );
}

export async function listGatewayAISessions(params: {
  userId: string;
  limit?: number;
  linkedConversationId?: string;
}): Promise<GatewayAIChatSession[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  if (params.linkedConversationId) {
    query.set('linked_conversation_id', params.linkedConversationId);
  }
  return gatewayFetch<GatewayAIChatSession[]>(`/v1/ai/sessions?${query.toString()}`);
}

export async function createGatewayAISession(params: {
  userId: string;
  title: string;
  source?: string;
  subject?: string;
  linkedClassroomId?: string;
  linkedConversationId?: string;
}): Promise<GatewayAIChatSession> {
  return gatewayFetch<GatewayAIChatSession>('/v1/ai/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      title: params.title,
      source: params.source || '课后答疑',
      subject: params.subject,
      linked_classroom_id: params.linkedClassroomId,
      linked_conversation_id: params.linkedConversationId,
    }),
  });
}

export async function listGatewayAIMessages(params: {
  sessionId: string;
  limit?: number;
}): Promise<GatewayAIChatMessage[]> {
  const query = new URLSearchParams();
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayAIChatMessage[]>(`/v1/ai/sessions/${params.sessionId}/messages${suffix}`);
}

export async function createGatewayAIMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  userId?: string;
  contentType?: string;
  modelName?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  requestId?: string;
  parentMessageId?: string;
}): Promise<GatewayAIChatMessage> {
  return gatewayFetch<GatewayAIChatMessage>(`/v1/ai/sessions/${params.sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: params.role,
      content: params.content,
      user_id: params.userId,
      content_type: params.contentType || 'text',
      model_name: params.modelName,
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: params.totalTokens,
      latency_ms: params.latencyMs,
      request_id: params.requestId,
      parent_message_id: params.parentMessageId,
    }),
  });
}

export async function createGatewayAIMessageFeedback(params: {
  messageId: string;
  userId: string;
  rating: 'like' | 'dislike';
  feedbackText?: string;
}): Promise<GatewayAIMessageFeedback> {
  return gatewayFetch<GatewayAIMessageFeedback>(`/v1/ai/messages/${params.messageId}/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      rating: params.rating,
      feedback_text: params.feedbackText,
    }),
  });
}

export async function createLearningRecordExtractJob(params: {
  sessionId: string;
  userId?: string;
  extractVersion?: string;
  latestUserMessageId?: string;
  messageCount?: number;
}): Promise<AnotherMe2JobSummary> {
  return gatewayFetch<AnotherMe2JobSummary>('/v1/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_type: 'learning_record_extract',
      user_id: params.userId || DEFAULT_CHAT_USER_ID,
      payload: {
        session_id: params.sessionId,
        user_id: params.userId,
        extract_version: params.extractVersion || 'v1',
        latest_user_message_id: params.latestUserMessageId,
        message_count: params.messageCount,
      },
    }),
  });
}

export async function getLearningRecordExtractResult(jobId: string): Promise<LearningRecordExtractResult> {
  const payload = await gatewayFetch<{ job_id: string; status: string; result: LearningRecordExtractResult }>(
    `/v1/jobs/${jobId}/result`,
  );
  return payload.result;
}

export async function listGatewayAILearningRecords(params: {
  sessionId: string;
  userId?: string;
  limit?: number;
}): Promise<GatewayLearningRecord[]> {
  const query = new URLSearchParams();
  if (params.userId) {
    query.set('user_id', params.userId);
  }
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayLearningRecord[]>(
    `/v1/ai/sessions/${params.sessionId}/learning-records${suffix}`,
  );
}

export async function getGatewayStudentProfile(params: {
  userId: string;
  lookbackDays?: number;
}): Promise<GatewayStudentProfile> {
  const query = new URLSearchParams();
  if (typeof params.lookbackDays === 'number') {
    query.set('lookback_days', String(params.lookbackDays));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayStudentProfile>(`/v1/students/${params.userId}/profile${suffix}`);
}

export async function createGatewayLearningEvent(params: {
  userId: string;
  eventType: string;
  sessionId?: string;
  classroomId?: string;
  sceneId?: string;
  blockId?: string;
  knowledgePoints?: string[];
  payload?: Record<string, unknown>;
  weight?: number;
}): Promise<GatewayLearningEvent> {
  return gatewayFetch<GatewayLearningEvent>(
    `/v1/users/${encodeURIComponent(params.userId)}/learning-events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: params.eventType,
        session_id: params.sessionId,
        classroom_id: params.classroomId,
        scene_id: params.sceneId,
        block_id: params.blockId,
        knowledge_points: params.knowledgePoints,
        payload: params.payload,
        weight: params.weight,
      }),
    },
  );
}

export interface GatewayKnowledgePoint {
  id: string;
  subject?: string | null;
  name: string;
  description?: string | null;
  parent_id?: string | null;
  prerequisites: string[];
  difficulty?: string | null;
  created_at: string;
}

export interface GatewayStudentKnowledgeState {
  user_id: string;
  knowledge_point_id: string;
  p_mastery: number;
  p_learn: number;
  p_guess: number;
  p_slip: number;
  attempts: number;
  correct_attempts: number;
  last_updated_at?: string | null;
}

export interface GatewayTeachingDecision {
  target_knowledge_point_id: string;
  mastery: number;
  action: string;
  reason: string;
}

export interface GatewayQuizAnswerResult {
  knowledge_point_id: string;
  prior_mastery: number;
  posterior_mastery: number;
  attempts: number;
  correct_attempts: number;
}

export interface GatewayStudentKnowledgeContext {
  context_text: string;
}

export async function listGatewayKnowledgePoints(params?: {
  subject?: string;
  parentId?: string;
  limit?: number;
}): Promise<GatewayKnowledgePoint[]> {
  const query = new URLSearchParams();
  if (params?.subject) {
    query.set('subject', params.subject);
  }
  if (params?.parentId) {
    query.set('parent_id', params.parentId);
  }
  if (typeof params?.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayKnowledgePoint[]>(`/v1/knowledge-points${suffix}`);
}

export async function getGatewayStudentKnowledgeStates(params: {
  userId: string;
  knowledgePointIds?: string[];
  minMastery?: number;
  limit?: number;
}): Promise<GatewayStudentKnowledgeState[]> {
  const query = new URLSearchParams();
  if (params.knowledgePointIds?.length) {
    params.knowledgePointIds.forEach((id) => query.append('knowledge_point_ids', id));
  }
  if (typeof params.minMastery === 'number') {
    query.set('min_mastery', String(params.minMastery));
  }
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayStudentKnowledgeState[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/knowledge-states${suffix}`,
  );
}

export async function getGatewayStudentKnowledgeState(params: {
  userId: string;
  knowledgePointId: string;
}): Promise<GatewayStudentKnowledgeState> {
  return gatewayFetch<GatewayStudentKnowledgeState>(
    `/v1/users/${encodeURIComponent(params.userId)}/knowledge-states/${encodeURIComponent(params.knowledgePointId)}`,
  );
}

export async function getGatewayTeachingDecisions(params: {
  userId: string;
  knowledgePointIds?: string[];
}): Promise<GatewayTeachingDecision[]> {
  const query = new URLSearchParams();
  if (params.knowledgePointIds?.length) {
    params.knowledgePointIds.forEach((id) => query.append('knowledge_point_ids', id));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayTeachingDecision[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/teaching-decisions${suffix}`,
  );
}

export async function getGatewayTeachingDecision(params: {
  userId: string;
  knowledgePointId: string;
}): Promise<GatewayTeachingDecision> {
  return gatewayFetch<GatewayTeachingDecision>(
    `/v1/users/${encodeURIComponent(params.userId)}/teaching-decisions/${encodeURIComponent(params.knowledgePointId)}`,
  );
}

export async function getGatewayStudentKnowledgeContext(params: {
  userId: string;
  knowledgePointId: string;
}): Promise<GatewayStudentKnowledgeContext> {
  return gatewayFetch<GatewayStudentKnowledgeContext>(
    `/v1/users/${encodeURIComponent(params.userId)}/knowledge-context/${encodeURIComponent(params.knowledgePointId)}`,
  );
}

export async function createGatewayQuizAnswer(params: {
  userId: string;
  questionId: string;
  isCorrect: boolean;
  payload?: Record<string, unknown>;
}): Promise<GatewayQuizAnswerResult[]> {
  return gatewayFetch<GatewayQuizAnswerResult[]>(
    `/v1/users/${encodeURIComponent(params.userId)}/quiz-answers`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question_id: params.questionId,
        is_correct: params.isCorrect,
        payload: params.payload,
      }),
    },
  );
}

export interface GatewayDiagnosticProbe {
  probe_id: string;
  knowledge_point_id: string;
  question: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  probe_type: string;
  hints: string[];
  teaching_action: string;
  reason: string;
}

export async function createGatewayDiagnosticProbe(params: {
  userId: string;
  knowledgePointId?: string;
  difficulty?: string;
  probeType?: string;
}): Promise<GatewayDiagnosticProbe> {
  return gatewayFetch<GatewayDiagnosticProbe>(
    `/v1/users/${encodeURIComponent(params.userId)}/diagnostic-probes`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        knowledge_point_id: params.knowledgePointId,
        difficulty: params.difficulty,
        probe_type: params.probeType,
      }),
    },
  );
}

export function isAnotherMe2GatewayError(error: unknown): error is AnotherMe2GatewayError {
  return error instanceof AnotherMe2GatewayError;
}
