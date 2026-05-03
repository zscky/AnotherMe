import type {
  LiveBookChapter,
  LiveBookExplorationReport,
  LiveBookQuizAttempt,
  LiveBookRecord,
  LiveBookSourceInput,
  LiveBookSourceSnapshot,
} from '@/lib/server/live-book-store';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';

const log = createLogger('SourceExplorer');

interface ExploreInput {
  book: LiveBookRecord;
  topic: string;
}

function takeTop<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

function deriveCandidateConcepts(topic: string): string[] {
  const normalized = topic
    .replace(/[，。、""''（）()【】\[\]:：;；,.!?！？]/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  const unique = Array.from(new Set(normalized));
  const seeded = unique.length > 0 ? unique : [topic];
  const defaults = ['核心定义', '关键步骤', '易错点', '迁移应用'];
  return Array.from(new Set([...takeTop(seeded, 8), ...defaults])).slice(0, 12);
}

function collectWeakSignals(
  chapters: LiveBookChapter[],
  attempts: LiveBookQuizAttempt[],
  pageToChapter: Map<string, string>,
) {
  const chapterIdSet = new Set(chapters.map((item) => item.id));
  const wrongByChapter = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.isCorrect) continue;
    const chapterId = pageToChapter.get(attempt.pageId) || '';
    if (!chapterIdSet.has(chapterId)) continue;
    if (!chapterId) continue;
    wrongByChapter.set(chapterId, (wrongByChapter.get(chapterId) || 0) + 1);
  }
  return Array.from(wrongByChapter.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([chapterId, wrongCount]) => ({ chapterId, wrongCount }));
}

function buildQueries(topic: string, chapters: LiveBookChapter[]): string[] {
  const chapterTitles = chapters.map((chapter) => chapter.title).filter(Boolean);
  const seeded = [
    `${topic} 核心概念`,
    `${topic} 典型例题`,
    `${topic} 常见误区`,
    `${topic} 迁移应用`,
  ];
  return Array.from(new Set([...seeded, ...chapterTitles.slice(0, 4)]));
}

function extractInputSources(book: LiveBookRecord): LiveBookSourceInput[] {
  const raw = book.conceptGraphJson?.inputSources;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const source = item as Record<string, unknown>;
      const kind = source.kind;
      const text = source.text;
      const hasSnapshots = Array.isArray(source.snapshots) && source.snapshots.length > 0;
      const hasRefs =
        (Array.isArray(source.kbIds) && source.kbIds.length > 0) ||
        (Array.isArray(source.notebookRefs) && source.notebookRefs.length > 0) ||
        (Array.isArray(source.chatSelections) && source.chatSelections.length > 0) ||
        (Array.isArray(source.questionRefs) && source.questionRefs.length > 0);
      if (
        (kind !== 'kb' &&
          kind !== 'notes' &&
          kind !== 'chat' &&
          kind !== 'question' &&
          kind !== 'manual') ||
        typeof text !== 'string' ||
        (!text.trim() && !hasSnapshots && !hasRefs)
      ) {
        return null;
      }
      const base: LiveBookSourceInput = {
        kind,
        text: text.trim(),
        weight:
          typeof source.weight === 'number' && Number.isFinite(source.weight) ? source.weight : 1,
      };
      if (Array.isArray(source.snapshots))
        base.snapshots = source.snapshots as LiveBookSourceSnapshot[];
      if (Array.isArray(source.kbIds)) base.kbIds = source.kbIds as string[];
      if (Array.isArray(source.notebookRefs)) base.notebookRefs = source.notebookRefs as string[];
      if (Array.isArray(source.chatSelections))
        base.chatSelections = source.chatSelections as LiveBookSourceInput['chatSelections'];
      if (Array.isArray(source.questionRefs)) base.questionRefs = source.questionRefs as string[];
      return base;
    })
    .filter((item): item is LiveBookSourceInput => Boolean(item));
}

function buildStructuredQueries(topic: string, sources: LiveBookSourceInput[]): string[] {
  const queries: string[] = [];
  for (const source of sources) {
    if (source.text.trim()) {
      queries.push(`${topic} ${source.text.slice(0, 80)}`);
    }
    for (const snapshot of source.snapshots || []) {
      if (snapshot.title) queries.push(`${topic} ${snapshot.title}`);
      queries.push(`${topic} ${snapshot.content.slice(0, 80)}`);
    }
    if (source.kbIds && source.kbIds.length > 0) {
      queries.push(...source.kbIds.map((id) => `kb:${id}`));
    }
    if (source.notebookRefs && source.notebookRefs.length > 0) {
      queries.push(...source.notebookRefs.map((id) => `notebook:${id}`));
    }
    if (source.chatSelections && source.chatSelections.length > 0) {
      for (const sel of source.chatSelections) {
        queries.push(`chat:${sel.chatId}`);
      }
    }
    if (source.questionRefs && source.questionRefs.length > 0) {
      queries.push(...source.questionRefs.map((id) => `question:${id}`));
    }
  }
  return queries;
}

function chunkKey(chunk: Record<string, unknown>): string {
  const kind = String(chunk.kind || chunk.source || 'unknown').toLowerCase();
  const ref = String(chunk.ref || chunk.id || chunk.chunk_id || '').toLowerCase();
  const snippet = String(chunk.snippet || chunk.text || chunk.content || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 180)
    .toLowerCase();
  return `${kind}:${ref}:${snippet}`;
}

function confidenceOf(chunk: Record<string, unknown>): number {
  if (typeof chunk.confidence === 'number') return chunk.confidence;
  if (typeof chunk.score === 'number') return chunk.score;
  return 0.5;
}

function dedupeEvidenceChunks(
  chunks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const chunk of chunks) {
    const key = chunkKey(chunk);
    const existing = byKey.get(key);
    if (!existing || confidenceOf(chunk) > confidenceOf(existing)) {
      byKey.set(key, chunk);
    }
  }
  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Real multi-source content resolution
// ---------------------------------------------------------------------------

function snapshotKindToChunkKind(kind: LiveBookSourceSnapshot['kind']): string {
  if (kind === 'note') return 'notebook';
  if (kind === 'question') return 'question_bank';
  return kind;
}

function buildSnapshotChunks(source: LiveBookSourceInput): Array<Record<string, unknown>> {
  if (!source.snapshots || source.snapshots.length === 0) return [];
  return source.snapshots.map((snapshot) => ({
    kind: snapshotKindToChunkKind(snapshot.kind),
    ref: `${snapshot.kind}:${snapshot.id}`,
    snippet: `${snapshot.title ? `${snapshot.title}：` : ''}${snapshot.content.slice(0, 600)}`,
    confidence: 0.9,
    snapshotId: snapshot.id,
    sourceKind: source.kind,
    title: snapshot.title,
    metadata: snapshot.metadata || {},
  }));
}

async function resolveNotebookContents(
  notebookRefs: string[],
): Promise<Array<Record<string, unknown>>> {
  try {
    const classroomChunks: Array<Record<string, unknown>> = [];
    const unresolvedRefs = new Set(notebookRefs);
    const classroomRefPairs = notebookRefs
      .map((ref) => {
        const [bookId, blockId] = ref.split(':');
        return bookId && blockId ? { ref, bookId, blockId } : null;
      })
      .filter((item): item is { ref: string; bookId: string; blockId: string } => Boolean(item));

    if (classroomRefPairs.length > 0) {
      const { listClassroomBooks } = await import('@/lib/server/classroom-book-service');
      const books = (
        await Promise.all(
          ['local-user', 'anonymous', 'anotherme-default-user'].map(async (userId) => {
            try {
              return await listClassroomBooks(userId);
            } catch {
              return [];
            }
          }),
        )
      ).flat();

      for (const pair of classroomRefPairs) {
        const book = books.find((item) => item.id === pair.bookId);
        const block = book?.blocks.find((item) => item.id === pair.blockId);
        if (!book || !block) continue;
        unresolvedRefs.delete(pair.ref);
        classroomChunks.push({
          kind: 'notebook',
          ref: `notebook:${pair.ref}`,
          snippet: `生成笔记「${book.title} / ${block.title}」：${block.content.slice(0, 300)}`,
          confidence: 0.8,
          notebookRef: pair.ref,
          noteTitle: block.title,
          noteSubject: book.meta?.originalTopic,
          noteTags: [book.meta?.sourceCapability, block.type, ...block.knowledgePointIds].filter(
            Boolean,
          ),
          metadata: {
            bookId: book.id,
            blockId: block.id,
            sourceCapability: book.meta?.sourceCapability,
          },
        });
      }
    }

    const { readNotebookNotes } = await import('@/lib/notebook/storage');
    const allNotes = readNotebookNotes();
    const chunks: Array<Record<string, unknown>> = [];
    for (const ref of unresolvedRefs) {
      const note = allNotes.find((n) => n.id === ref);
      if (note) {
        chunks.push({
          kind: 'notebook',
          ref: `notebook:${ref}`,
          snippet: `笔记「${note.title}」：${note.content.slice(0, 300)}`,
          confidence: 0.8,
          notebookRef: ref,
          noteTitle: note.title,
          noteSubject: note.subject,
          noteTags: note.tags,
        });
      } else {
        chunks.push({
          kind: 'notebook',
          ref: `notebook:${ref}`,
          snippet: `笔记引用：${ref}（未提供内容快照，服务端无法读取浏览器本地笔记）`,
          confidence: 0.25,
          notebookRef: ref,
          warning: 'missing_notebook_snapshot',
        });
      }
    }
    return [...classroomChunks, ...chunks];
  } catch (error) {
    log.warn('Failed to resolve notebook contents:', error);
    return notebookRefs.map((ref) => ({
      kind: 'notebook',
      ref: `notebook:${ref}`,
      snippet: `笔记引用：${ref}（读取失败，建议随来源提交内容快照）`,
      confidence: 0.25,
      notebookRef: ref,
      warning: 'notebook_resolution_failed',
    }));
  }
}

async function resolveChatContents(
  chatSelections: LiveBookSourceInput['chatSelections'],
): Promise<Array<Record<string, unknown>>> {
  if (!chatSelections || chatSelections.length === 0) return [];
  try {
    const { listGatewayAIMessages } = await import('@/lib/server/anotherme2-gateway');
    const chunks: Array<Record<string, unknown>> = [];
    for (const sel of chatSelections) {
      const messages = await listGatewayAIMessages({ sessionId: sel.chatId, limit: 50 });
      const selectedMessages =
        sel.messageIds.length > 0
          ? messages.filter((m) => sel.messageIds.includes(m.message_id))
          : messages;
      const contentPreview = selectedMessages
        .map((m) => `[${m.role}] ${m.content.slice(0, 200)}`)
        .join('\n');
      chunks.push({
        kind: 'chat',
        ref: `chat:${sel.chatId}`,
        snippet: `对话「${sel.chatId}」：${contentPreview.slice(0, 400)}`,
        confidence: 0.75,
        chatId: sel.chatId,
        messageIds: sel.messageIds,
        messageCount: selectedMessages.length,
      });
    }
    return chunks;
  } catch (error) {
    log.warn('Failed to resolve chat contents:', error);
    return chatSelections.map((sel) => ({
      kind: 'chat',
      ref: `chat:${sel.chatId}`,
      snippet: `对话引用：${sel.chatId}（读取失败）`,
      confidence: 0.3,
      chatId: sel.chatId,
      messageIds: sel.messageIds,
    }));
  }
}

async function resolveQuestionContents(
  questionRefs: string[],
): Promise<Array<Record<string, unknown>>> {
  if (!questionRefs || questionRefs.length === 0) return [];

  try {
    const chunks: Array<Record<string, unknown>> = [];

    for (const ref of questionRefs) {
      const questionId = ref.startsWith('q:') ? ref : `q:${ref}`;

      chunks.push({
        kind: 'question_bank',
        ref: questionId,
        snippet: `题目引用：${ref}（未提供题目内容快照，无法作为真实题目证据）`,
        confidence: 0.25,
        questionRef: ref,
        warning: 'missing_question_snapshot',
      });
    }

    log.info(`Resolved ${chunks.length} question references`);
    return chunks;
  } catch (error) {
    log.warn('Failed to resolve question contents:', error);
    return questionRefs.map((ref) => ({
      kind: 'question_bank',
      ref: `question:${ref}`,
      snippet: `题库引用：${ref}（解析失败）`,
      confidence: 0.25,
      questionRef: ref,
      warning: 'question_resolution_failed',
    }));
  }
}

async function buildChunksForSource(
  source: LiveBookSourceInput,
): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<Record<string, unknown>> = [];
  const snapshotChunks = buildSnapshotChunks(source);
  chunks.push(...snapshotChunks);

  if (source.kbIds && source.kbIds.length > 0) {
    const snapshotKbIds = new Set(
      snapshotChunks
        .filter((chunk) => chunk.kind === 'kb')
        .map((chunk) => String(chunk.snapshotId || '').trim())
        .filter(Boolean),
    );
    for (const kbId of source.kbIds) {
      if (snapshotKbIds.has(kbId)) continue;
      chunks.push({
        kind: 'kb_ref',
        ref: `kb:${kbId}`,
        snippet: `知识库引用：${kbId}（等待 RAG 检索命中真实片段）`,
        confidence: 0.35,
        kbId,
        warning: 'kb_ref_without_snapshot',
      });
    }
  }
  if (source.notebookRefs && source.notebookRefs.length > 0) {
    const snapshotNoteIds = new Set(
      snapshotChunks
        .filter((chunk) => chunk.kind === 'notebook')
        .map((chunk) => String(chunk.snapshotId || '').trim())
        .filter(Boolean),
    );
    const missingRefs = source.notebookRefs.filter((ref) => !snapshotNoteIds.has(ref));
    const notebookChunks = await resolveNotebookContents(missingRefs);
    chunks.push(...notebookChunks);
  }
  if (source.chatSelections && source.chatSelections.length > 0) {
    const chatChunks = await resolveChatContents(source.chatSelections);
    chunks.push(...chatChunks);
  }
  if (source.questionRefs && source.questionRefs.length > 0) {
    const snapshotQuestionIds = new Set(
      snapshotChunks
        .filter((chunk) => chunk.kind === 'question_bank')
        .map((chunk) => String(chunk.snapshotId || '').trim())
        .filter(Boolean),
    );
    const missingRefs = source.questionRefs.filter((ref) => !snapshotQuestionIds.has(ref));
    const questionChunks = await resolveQuestionContents(missingRefs);
    chunks.push(...questionChunks);
  }
  return chunks;
}

async function buildSourceChunks(
  sources: LiveBookSourceInput[],
): Promise<Array<Record<string, unknown>>> {
  const chunkGroups = await Promise.all(sources.map((source) => buildChunksForSource(source)));
  return dedupeEvidenceChunks(chunkGroups.flat());
}

// ---------------------------------------------------------------------------
// LLM Query Design (like DeepTutor SourceExplorer)
// ---------------------------------------------------------------------------

interface LLMQueryDesign {
  queries: string[];
}

function buildQueryDesignPrompt(
  topic: string,
  proposal: LiveBookRecord['proposal'],
  sources: LiveBookSourceInput[],
): string {
  const sourceSummary = sources.map((s) => `[${s.kind}] ${s.text.slice(0, 60)}`).join('\n');

  return `你是一位资料探索专家，负责为活书设计高效的搜索查询。

## 主题
${topic}

## 提案信息
- 标题: ${proposal.title}
- 描述: ${proposal.description}
- 范围: ${proposal.scope}
- 目标水平: ${proposal.targetLevel}

## 输入来源
${sourceSummary || '（无结构化来源）'}

## 任务
请输出 JSON：{"queries": ["查询1", "查询2", ...]}

设计要求：
1. 查询应覆盖：定义/概念、核心机制/理论、典型例题、常见误区、应用场景
2. 查询应简短（不超过15字），适合向量检索
3. 数量控制在 4-8 个
4. 如果有知识库/笔记/题库来源，应设计针对性的查询

请只输出纯 JSON。`;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function callLLMQueryDesign(
  topic: string,
  proposal: LiveBookRecord['proposal'],
  sources: LiveBookSourceInput[],
): Promise<string[] | null> {
  try {
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: '你是一位专业的资料探索专家，擅长设计高效的搜索查询。',
        prompt: buildQueryDesignPrompt(topic, proposal, sources),
        maxOutputTokens: 1024,
        temperature: 0.4,
      },
      'source-explorer:query-design',
      { retries: 1, validate: (text) => text.trim().length > 30 && text.includes('queries') },
    );
    const parsed = safeJsonParse<LLMQueryDesign>(result.text);
    if (parsed && Array.isArray(parsed.queries) && parsed.queries.length > 0) {
      return parsed.queries.filter((q) => typeof q === 'string' && q.trim().length > 0);
    }
    return null;
  } catch (error) {
    log.warn('LLM query design failed, using default queries', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM Synthesis (summary + candidate concepts from exploration)
// ---------------------------------------------------------------------------

interface LLMExplorationSynthesis {
  summary: string;
  candidateConcepts: string[];
  notes: string[];
}

function buildSynthesisPrompt(topic: string, chunks: Array<Record<string, unknown>>): string {
  const chunksText = chunks
    .slice(0, 15)
    .map((c, i) => {
      const kind = (c.kind as string) || 'unknown';
      const snippet = (c.snippet as string) || '';
      const confidence = (c.confidence as number) || 0.5;
      return `${i + 1}. [${kind}] (confidence: ${confidence}) ${snippet}`;
    })
    .join('\n');

  return `你是一位学习资料分析专家。请根据收集到的证据片段，为主题生成结构化摘要和候选概念。

## 主题
${topic}

## 证据片段
${chunksText}

## 任务
请输出 JSON：
{
  "summary": "简短摘要（100字以内），概括资料覆盖范围和核心发现",
  "candidateConcepts": ["概念1", "概念2", ...],
  "notes": ["观察1", "观察2", ...]
}

要求：
1. candidateConcepts 应包含 4-10 个核心概念
2. summary 应说明资料来源的丰富程度
3. notes 可包含对资料质量的观察

请只输出纯 JSON。`;
}

async function callLLMSynthesis(
  topic: string,
  chunks: Array<Record<string, unknown>>,
): Promise<LLMExplorationSynthesis | null> {
  try {
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: '你是一位专业的学习资料分析专家，擅长从证据片段中提取核心概念和结构化摘要。',
        prompt: buildSynthesisPrompt(topic, chunks),
        maxOutputTokens: 2048,
        temperature: 0.35,
      },
      'source-explorer:synthesis',
      { retries: 1, validate: (text) => text.trim().length > 50 && text.includes('summary') },
    );
    const parsed = safeJsonParse<LLMExplorationSynthesis>(result.text);
    if (parsed && typeof parsed.summary === 'string') {
      return {
        summary: parsed.summary,
        candidateConcepts: Array.isArray(parsed.candidateConcepts) ? parsed.candidateConcepts : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      };
    }
    return null;
  } catch (error) {
    log.warn('LLM synthesis failed, using default summary', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// RAG retrieval using project's RAGVectorStore
// ---------------------------------------------------------------------------

interface RAGChunk {
  text: string;
  source: string;
  score: number;
  kbName?: string;
  metadata?: Record<string, unknown>;
  warning?: string;
}

interface RAGSearchResultChunk {
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface RAGStoreLike {
  search(
    query: string,
    options: { topK: number; useHybrid: boolean },
  ): Promise<{
    chunks: RAGSearchResultChunk[];
  }>;
}

function metadataMatchesKb(
  metadata: Record<string, unknown> | undefined,
  source: string,
  kbIds: string[],
): boolean {
  const haystack = [
    source,
    metadata?.source,
    metadata?.kbId,
    metadata?.kb_id,
    metadata?.kbName,
    metadata?.kb_name,
    metadata?.title,
  ]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.toLowerCase());

  return kbIds.some((id) => {
    const needle = id.toLowerCase();
    return haystack.some((item) => item === needle || item.includes(needle));
  });
}

async function performRAGRetrieval(queries: string[], kbIds?: string[]): Promise<RAGChunk[]> {
  if (!queries || queries.length === 0) {
    log.info('No queries provided for RAG retrieval');
    return [];
  }

  try {
    const { initRAGStore } = await import('@/lib/rag/vectorStore');
    const store = (await initRAGStore()) as RAGStoreLike;

    const queryResults = await Promise.all(
      queries.slice(0, 8).map(async (query) => {
        try {
          const result = await store.search(query, { topK: 5, useHybrid: true });
          return result.chunks.map((chunk) => {
            const metadata = chunk.metadata || {};
            const source = typeof metadata.source === 'string' ? metadata.source : 'rag';
            const title = typeof metadata.title === 'string' ? metadata.title : source;
            return {
              text: chunk.text.slice(0, 800),
              source,
              score: chunk.score || 0,
              kbName: title,
              metadata: { ...metadata, query },
            } satisfies RAGChunk;
          });
        } catch (error) {
          log.warn(`RAG query failed [${query}]:`, error);
          return [];
        }
      }),
    );

    const allChunks = queryResults.flat();
    const dedupedChunks = dedupeEvidenceChunks(
      allChunks.map((chunk) => ({
        kind: 'rag',
        ref: chunk.source,
        text: chunk.text,
        score: chunk.score,
        kbName: chunk.kbName,
        metadata: chunk.metadata,
      })),
    ).map((chunk) => ({
      text: String(chunk.text || ''),
      source: String(chunk.ref || 'rag'),
      score: typeof chunk.score === 'number' ? chunk.score : 0,
      kbName: typeof chunk.kbName === 'string' ? chunk.kbName : String(chunk.ref || 'rag'),
      metadata: chunk.metadata as Record<string, unknown> | undefined,
    }));

    const filtered =
      kbIds && kbIds.length > 0
        ? dedupedChunks.filter((chunk) => metadataMatchesKb(chunk.metadata, chunk.source, kbIds))
        : dedupedChunks;

    log.info(
      `RAG retrieval returned ${filtered.length} chunks from ${queries.length} queries (kbIds: ${kbIds?.length || 0})`,
    );
    if (kbIds && kbIds.length > 0 && filtered.length === 0) {
      return kbIds.map((kbId) => ({
        text: `知识库「${kbId}」未检索到匹配片段。`,
        source: `kb:${kbId}`,
        score: 0.2,
        kbName: kbId,
        metadata: { kbId },
        warning: 'rag_no_match',
      }));
    }
    return filtered.sort((a, b) => b.score - a.score).slice(0, 20);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn(
      `RAG retrieval failed: ${errorMessage}. This may indicate the vector store is not initialized or llamaindex is unavailable.`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// SourceExplorer
// ---------------------------------------------------------------------------

export class SourceExplorer {
  async explore(input: ExploreInput): Promise<LiveBookExplorationReport> {
    const topic = input.topic.trim() || input.book.topic.trim() || '未命名主题';
    const chapters = [...input.book.chapters].sort((a, b) => a.order - b.order);
    const attempts = input.book.progress.quizAttempts || [];
    const pageToChapter = new Map(
      input.book.pages.map((page) => [page.id, page.chapterId] as const),
    );
    const inputSources = extractInputSources(input.book);

    // Step 1: LLM Query Design
    const designedQueries = await callLLMQueryDesign(topic, input.book.proposal, inputSources);

    // Step 2: Build all queries (designed + structured + default)
    const sourceQueries = buildStructuredQueries(topic, inputSources).slice(0, 12);
    const defaultQueries = buildQueries(topic, chapters);
    const allQueries = Array.from(
      new Set([...(designedQueries || []), ...sourceQueries, ...defaultQueries]),
    ).slice(0, 16);

    // Step 3: RAG Retrieval (parallel across KBs)
    const allKbIds = inputSources.flatMap((s) => s.kbIds || []);
    const ragChunks = await performRAGRetrieval(
      allQueries,
      allKbIds.length > 0 ? allKbIds : undefined,
    );

    // Step 4: Build source chunks from structured inputs (with real content resolution)
    const sourceChunks = await buildSourceChunks(inputSources);

    // Step 5: Aggregate all chunks
    const weakSignals = collectWeakSignals(chapters, attempts, pageToChapter);
    const candidateConcepts = deriveCandidateConcepts(topic);

    const baseChunks: Array<Record<string, unknown>> = [
      {
        kind: 'topic',
        ref: `topic:${topic}`,
        snippet: `学习主题：${topic}`,
        confidence: 0.9,
      },
      ...chapters.slice(0, 8).map((chapter) => ({
        kind: 'classroom_scene',
        ref: `chapter:${chapter.id}`,
        snippet: `${chapter.title}｜${chapter.goal}`,
        confidence: 0.7,
      })),
      ...chapters.slice(0, 8).map((chapter) => ({
        kind: 'notebook_record',
        ref: `chapter_summary:${chapter.id}`,
        snippet: chapter.summary || `章节目标：${chapter.goal}`,
        confidence: 0.6,
      })),
      ...weakSignals.slice(0, 5).map((item) => ({
        kind: 'quiz_attempt',
        ref: `weak:${item.chapterId}`,
        snippet: `该章节近期错题次数：${item.wrongCount}`,
        confidence: 0.8,
      })),
      ...sourceChunks,
      ...ragChunks.map((chunk) => ({
        kind: 'rag',
        ref: chunk.source,
        snippet: chunk.text.slice(0, 300),
        confidence: chunk.score,
        kbName: chunk.kbName,
        metadata: chunk.metadata || {},
        warning: chunk.warning,
      })),
    ];

    const finalChunks = dedupeEvidenceChunks(baseChunks);

    // Step 6: LLM Synthesis
    const synthesis = await callLLMSynthesis(topic, finalChunks);

    const finalSummary =
      synthesis?.summary ||
      `围绕「${topic}」共聚合 ${finalChunks.length} 条证据片段，候选概念 ${candidateConcepts.length} 个。结构化来源：知识库 ${inputSources.filter((s) => s.kbIds?.length).length} 组，笔记 ${inputSources.filter((s) => s.notebookRefs?.length).length} 组，对话 ${inputSources.filter((s) => s.chatSelections?.length).length} 组，题库 ${inputSources.filter((s) => s.questionRefs?.length).length} 组。`;

    const finalConcepts =
      synthesis?.candidateConcepts && synthesis.candidateConcepts.length > 0
        ? synthesis.candidateConcepts
        : candidateConcepts;

    return {
      queries: allQueries,
      chunks: finalChunks,
      summary: finalSummary,
      coverage: {
        topic,
        chapterCount: chapters.length,
        classroomSceneCount: chapters.length,
        notebookRecordCount: chapters.length,
        quizAttemptCount: attempts.length,
        weakSignalCount: weakSignals.length,
        sourceInputCount: inputSources.length,
        structuredKbCount: inputSources.filter((s) => s.kbIds?.length).length,
        structuredNotebookCount: inputSources.filter((s) => s.notebookRefs?.length).length,
        structuredChatCount: inputSources.filter((s) => s.chatSelections?.length).length,
        structuredQuestionCount: inputSources.filter((s) => s.questionRefs?.length).length,
        ragChunkCount: ragChunks.length,
        sourceChunkCount: sourceChunks.length,
        evidenceChunkCount: finalChunks.length,
        evidenceWarningCount: finalChunks.filter((chunk) => typeof chunk.warning === 'string')
          .length,
        designedQueryCount: designedQueries?.length || 0,
      },
      candidateConcepts: finalConcepts,
    };
  }
}

export const sourceExplorer = new SourceExplorer();
