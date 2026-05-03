import { createLogger } from '@/lib/logger';
import { createHash } from 'crypto';
import { liveBookEngine } from './live-book-engine';
import { liveBookCompiler } from './live-book/live-book-compiler';
import { sourceExplorer } from './live-book/source-explorer';
import { spineSynthesizer } from './live-book/spine-synthesizer';
import { sectionArchitect } from './live-book/section-architect';
import { createDeepDiveSubpage } from './live-book/deep-dive-engine';
import { detectKBDrift, quickDriftCheck } from './live-book/kb-drift-detector';
import { sourceInputToAnchors } from './live-book/source-registry';

const log = createLogger('LiveBookStore');

type LiveBookStatus = 'draft' | 'spine_ready' | 'compiling' | 'ready' | 'failed';
type LiveBookPageStatus = 'pending' | 'ready' | 'partial' | 'error';

export type LiveBookBlockType =
  | 'section'
  | 'text'
  | 'quiz'
  | 'interactive'
  | 'animation'
  | 'deep_dive'
  | 'remedial'
  | 'callout'
  | 'figure'
  | 'flash_cards'
  | 'code'
  | 'timeline'
  | 'concept_graph'
  | 'user_note'
  | 'placeholder';

export interface LiveBookProposal {
  title: string;
  description: string;
  scope: string;
  targetLevel: string;
  estimatedChapters: number;
  rationale: string;
}

export interface LiveBookBlock {
  id: string;
  type: LiveBookBlockType;
  title: string;
  content: string;
  status: 'ready' | 'error';
  paramsJson: Record<string, unknown>;
  metadataJson: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
  // Backward compatibility fields
  payloadJson?: Record<string, unknown>;
  sourceRefsJson?: Array<Record<string, unknown>>;
}

export interface LiveBookPage {
  id: string;
  chapterId: string;
  title: string;
  order: number;
  status: LiveBookPageStatus;
  blocks: LiveBookBlock[];
}

export interface LiveBookChapter {
  id: string;
  title: string;
  goal: string;
  order: number;
  difficulty?: string;
  learningObjectives?: string[];
  contentType?: 'theory' | 'derivation' | 'practice' | 'concept' | 'overview' | 'mixed';
  sourceRefs?: Array<Record<string, unknown>>;
  prerequisites?: string[];
  summary?: string;
}

export interface LiveBookExplorationReport {
  queries: string[];
  chunks: Array<Record<string, unknown>>;
  summary: string;
  coverage: Record<string, unknown>;
  candidateConcepts: string[];
}

export interface LiveBookExplorationRecord {
  id: string;
  bookId: string;
  chapterId?: string;
  topic: string;
  report: LiveBookExplorationReport;
  createdAt: number;
  updatedAt: number;
}

export interface LiveBookQuizAttempt {
  pageId: string;
  blockId: string;
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  timestamp: number;
}

export interface LiveBookProgress {
  currentPageId: string | null;
  visitedPageIds: string[];
  bookmarkedPageIds: string[];
  quizAttempts: LiveBookQuizAttempt[];
  weakChapterIds: string[];
  score: number;
  updatedAt: number;
}

export interface LiveBookQuality {
  compileTotal: number;
  compileFailed: number;
  blockErrors: number;
  supplementHits: number;
}

export interface LiveBookRecord {
  id: string;
  title: string;
  topic: string;
  userId?: string;
  language: 'zh-CN' | 'en-US';
  targetLevel: string;
  status: LiveBookStatus;
  proposal: LiveBookProposal;
  chapters: LiveBookChapter[];
  pages: LiveBookPage[];
  progress: LiveBookProgress;
  quality: LiveBookQuality;
  conceptGraphJson: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type LiveBookJobStage =
  | 'queued'
  | 'ideation'
  | 'exploration'
  | 'synthesis'
  | 'compilation'
  | 'completed'
  | 'failed';

export type LiveBookJobEventType =
  | 'stage_begin'
  | 'progress'
  | 'stage_end'
  | 'page_ready'
  | 'block_ready'
  | 'block_error'
  | 'error'
  | 'done';

export interface LiveBookJobEvent {
  id: string;
  type: LiveBookJobEventType;
  stage: LiveBookJobStage;
  message: string;
  progress: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface LiveBookJobRecord {
  id: string;
  bookId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: LiveBookJobStage;
  progress: number;
  events: LiveBookJobEvent[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateLiveBookInput {
  topic: string;
  language: 'zh-CN' | 'en-US';
  targetLevel?: string;
  userId?: string;
  sources?: LiveBookSourceInput[];
}

export interface LiveBookSourceInput {
  kind: 'kb' | 'notes' | 'chat' | 'question' | 'manual';
  text: string;
  weight?: number;
  snapshots?: LiveBookSourceSnapshot[];
  // Structured references (P0 enhancement)
  kbIds?: string[];
  notebookRefs?: string[];
  chatSelections?: Array<{ chatId: string; messageIds: string[] }>;
  questionRefs?: string[];
}

export interface LiveBookSourceSnapshot {
  kind: 'note' | 'chat' | 'question' | 'kb' | 'manual';
  id: string;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface LiveBookSummary {
  id: string;
  title: string;
  topic: string;
  status: LiveBookStatus;
  chapterCount: number;
  pageCount: number;
  updatedAt: number;
}

export interface LiveBookInsights {
  weakProfile: {
    weakChapters: Array<{ chapterId: string; title: string; wrongCount: number }>;
    weakPoints: string[];
  };
  reviewPath: Array<{ step: number; title: string; action: string }>;
  quality: {
    compileFailureRate: number;
    blockErrorRate: number;
    supplementHitRate: number;
    compileTotal: number;
    compileFailed: number;
    blockErrors: number;
    supplementHits: number;
  };
  progress: {
    score: number;
    quizTotal: number;
    quizCorrect: number;
    visitedPages: number;
    totalPages: number;
  };
}

export interface LiveBookHealth {
  stalePageIds: string[];
  driftPageIds: string[];
  driftReasonByPageId: Record<string, string[]>;
  errorPageIds: string[];
  partialPageIds: string[];
  pendingPageIds: string[];
  blockErrorCount: number;
  staleCount: number;
  driftCount: number;
  ok: boolean;
}

interface LiveBookFingerprintSnapshot {
  bookFingerprint: string;
  chapterFingerprint: string;
  pageFingerprints: Record<string, string>;
  updatedAt: number;
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function withFallbackTitle(topic: string): string {
  const trimmed = topic.trim();
  if (!trimmed) return '未命名活书';
  if (trimmed.length <= 26) return trimmed;
  return `${trimmed.slice(0, 26)}...`;
}

const MAX_SOURCE_ITEMS = 12;
const MAX_SOURCE_TEXT_LENGTH = 2000;
const MAX_SOURCE_SNAPSHOTS = 24;
const MAX_SOURCE_SNAPSHOT_CONTENT_LENGTH = 4000;
const MAX_TOTAL_SOURCE_SNAPSHOT_LENGTH = 48000;

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return items.length > 0 ? Array.from(new Set(items)).slice(0, 50) : undefined;
}

function normalizeSnapshots(
  value: unknown,
  remainingBudget: { value: number },
): LiveBookSourceSnapshot[] | undefined {
  if (!Array.isArray(value) || remainingBudget.value <= 0) return undefined;
  const snapshots: LiveBookSourceSnapshot[] = [];

  for (const raw of value) {
    if (snapshots.length >= MAX_SOURCE_SNAPSHOTS || remainingBudget.value <= 0) break;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const kind = item.kind;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (
      (kind !== 'note' &&
        kind !== 'chat' &&
        kind !== 'question' &&
        kind !== 'kb' &&
        kind !== 'manual') ||
      !id ||
      !content
    ) {
      continue;
    }

    const clippedContent = content.slice(
      0,
      Math.min(MAX_SOURCE_SNAPSHOT_CONTENT_LENGTH, remainingBudget.value),
    );
    remainingBudget.value -= clippedContent.length;
    const metadata = asRecord(item.metadata);
    snapshots.push({
      kind,
      id,
      ...(typeof item.title === 'string' && item.title.trim()
        ? { title: item.title.trim().slice(0, 160) }
        : {}),
      content: clippedContent,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }

  return snapshots.length > 0 ? snapshots : undefined;
}

function normalizeChatSelections(
  value: unknown,
): Array<{ chatId: string; messageIds: string[] }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const selections = value
    .filter(
      (sel): sel is Record<string, unknown> =>
        Boolean(sel) && typeof sel === 'object' && !Array.isArray(sel),
    )
    .map((sel) => ({
      chatId: typeof sel.chatId === 'string' ? sel.chatId.trim() : '',
      messageIds: normalizeStringArray(sel.messageIds) || [],
    }))
    .filter((sel) => sel.chatId);
  return selections.length > 0 ? selections.slice(0, 24) : undefined;
}

function sourceHasContent(item: LiveBookSourceInput): boolean {
  return Boolean(
    item.text.trim() ||
    item.snapshots?.length ||
    item.kbIds?.length ||
    item.notebookRefs?.length ||
    item.chatSelections?.length ||
    item.questionRefs?.length,
  );
}

function normalizeSources(input?: LiveBookSourceInput[]): LiveBookSourceInput[] {
  if (!Array.isArray(input)) return [];
  const snapshotBudget = { value: MAX_TOTAL_SOURCE_SNAPSHOT_LENGTH };
  return input
    .map((item) => {
      const normalized: LiveBookSourceInput = {
        kind: item.kind,
        text:
          typeof item.text === 'string' ? item.text.trim().slice(0, MAX_SOURCE_TEXT_LENGTH) : '',
        weight: typeof item.weight === 'number' && Number.isFinite(item.weight) ? item.weight : 1,
      };
      const snapshots = normalizeSnapshots(item.snapshots, snapshotBudget);
      const kbIds = normalizeStringArray(item.kbIds);
      const notebookRefs = normalizeStringArray(item.notebookRefs);
      const chatSelections = normalizeChatSelections(item.chatSelections);
      const questionRefs = normalizeStringArray(item.questionRefs);
      if (snapshots) normalized.snapshots = snapshots;
      if (kbIds) normalized.kbIds = kbIds;
      if (notebookRefs) normalized.notebookRefs = notebookRefs;
      if (chatSelections) normalized.chatSelections = chatSelections;
      if (questionRefs) normalized.questionRefs = questionRefs;
      return normalized;
    })
    .filter(
      (item) =>
        (item.kind === 'kb' ||
          item.kind === 'notes' ||
          item.kind === 'chat' ||
          item.kind === 'question' ||
          item.kind === 'manual') &&
        sourceHasContent(item),
    )
    .slice(0, MAX_SOURCE_ITEMS);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableClone((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableClone(value)))
    .digest('hex');
}

function readFingerprintSnapshot(book: LiveBookRecord): LiveBookFingerprintSnapshot {
  const conceptGraph = asRecord(book.conceptGraphJson);
  const snapshot = asRecord(conceptGraph.fingerprintSnapshot);
  const pageFingerprints = asRecord(snapshot.pageFingerprints);

  return {
    bookFingerprint: typeof snapshot.bookFingerprint === 'string' ? snapshot.bookFingerprint : '',
    chapterFingerprint:
      typeof snapshot.chapterFingerprint === 'string' ? snapshot.chapterFingerprint : '',
    pageFingerprints: Object.fromEntries(
      Object.entries(pageFingerprints).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>,
    updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : 0,
  };
}

function getInputSources(book: LiveBookRecord): LiveBookSourceInput[] {
  const conceptGraph = asRecord(book.conceptGraphJson);
  const inputSources = Array.isArray(conceptGraph.inputSources)
    ? (conceptGraph.inputSources as LiveBookSourceInput[])
    : [];
  return normalizeSources(inputSources);
}

function buildFingerprintBasis(book: LiveBookRecord) {
  const inputSources = getInputSources(book);
  const conceptGraph = asRecord(book.conceptGraphJson);
  const sourceSummary =
    typeof conceptGraph.sourceSummary === 'string'
      ? conceptGraph.sourceSummary
      : summarizeSources(inputSources);

  return {
    topic: book.topic,
    language: book.language,
    targetLevel: book.targetLevel,
    sourceSummary,
    inputSources,
    chapters: book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      goal: chapter.goal,
      order: chapter.order,
      difficulty: chapter.difficulty || 'medium',
      learningObjectives: chapter.learningObjectives || [],
      contentType: chapter.contentType || 'mixed',
      sourceRefs: chapter.sourceRefs || [],
      prerequisites: chapter.prerequisites || [],
      summary: chapter.summary || '',
    })),
    pages: book.pages.map((page) => ({
      id: page.id,
      chapterId: page.chapterId,
      title: page.title,
      order: page.order,
      status: page.status,
    })),
  };
}

function computeBookFingerprint(book: LiveBookRecord): string {
  return fingerprint(buildFingerprintBasis(book));
}

function computeChapterFingerprint(book: LiveBookRecord): string {
  return fingerprint({
    topic: book.topic,
    language: book.language,
    targetLevel: book.targetLevel,
    inputSources: getInputSources(book),
    chapters: book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      goal: chapter.goal,
      order: chapter.order,
      difficulty: chapter.difficulty || 'medium',
      learningObjectives: chapter.learningObjectives || [],
      contentType: chapter.contentType || 'mixed',
      sourceRefs: chapter.sourceRefs || [],
      prerequisites: chapter.prerequisites || [],
      summary: chapter.summary || '',
    })),
  });
}

function computePageFingerprint(
  book: LiveBookRecord,
  page: LiveBookPage,
  chapter?: LiveBookChapter,
): string {
  return fingerprint({
    topic: book.topic,
    language: book.language,
    targetLevel: book.targetLevel,
    inputSources: getInputSources(book),
    chapter: chapter
      ? {
          id: chapter.id,
          title: chapter.title,
          goal: chapter.goal,
          order: chapter.order,
          difficulty: chapter.difficulty || 'medium',
          learningObjectives: chapter.learningObjectives || [],
          contentType: chapter.contentType || 'mixed',
          sourceRefs: chapter.sourceRefs || [],
          prerequisites: chapter.prerequisites || [],
          summary: chapter.summary || '',
        }
      : null,
    page: {
      id: page.id,
      chapterId: page.chapterId,
      title: page.title,
      order: page.order,
      status: page.status,
    },
  });
}

function updateFingerprintSnapshot(book: LiveBookRecord, pageIds?: string[]): LiveBookRecord {
  const conceptGraph = asRecord(book.conceptGraphJson);
  const snapshot = readFingerprintSnapshot(book);
  const nextPageFingerprints = { ...snapshot.pageFingerprints };
  const targetPageIds = pageIds && pageIds.length > 0 ? pageIds : book.pages.map((page) => page.id);

  for (const pageId of targetPageIds) {
    const page = book.pages.find((item) => item.id === pageId);
    if (!page) continue;
    const chapter = book.chapters.find((item) => item.id === page.chapterId);
    nextPageFingerprints[pageId] = computePageFingerprint(book, page, chapter);
  }

  return {
    ...book,
    conceptGraphJson: {
      ...conceptGraph,
      fingerprintSnapshot: {
        bookFingerprint: computeBookFingerprint(book),
        chapterFingerprint: computeChapterFingerprint(book),
        pageFingerprints: nextPageFingerprints,
        updatedAt: Date.now(),
      },
    },
  };
}

function describeFingerprintDrift(
  book: LiveBookRecord,
  page: LiveBookPage,
  chapter?: LiveBookChapter,
): string[] {
  const conceptGraph = asRecord(book.conceptGraphJson);
  const snapshot = readFingerprintSnapshot(book);
  const current = computePageFingerprint(book, page, chapter);
  const saved = snapshot.pageFingerprints[page.id];

  if (!saved) {
    return page.status === 'pending' ? [] : ['missing_snapshot'];
  }

  if (saved === current) {
    return [];
  }

  const reasons: string[] = [];
  if (typeof conceptGraph.sourceSummary === 'string' && conceptGraph.sourceSummary.length > 0) {
    reasons.push('source_or_spine_changed');
  }
  if (page.title.length > 0) {
    reasons.push('page_structure_changed');
  }
  if (chapter) {
    reasons.push('chapter_context_changed');
  }
  return Array.from(new Set(reasons.length > 0 ? reasons : ['fingerprint_mismatch']));
}

function summarizeSources(sources: LiveBookSourceInput[]): string {
  if (sources.length === 0) return '基于默认知识库与主题推导。';

  const grouped = new Map<LiveBookSourceInput['kind'], number>();
  for (const source of sources) {
    grouped.set(source.kind, (grouped.get(source.kind) || 0) + 1);
  }

  const order: LiveBookSourceInput['kind'][] = ['question', 'notes', 'chat', 'kb', 'manual'];
  const labels: Record<LiveBookSourceInput['kind'], string> = {
    question: '题目',
    notes: '笔记',
    chat: '对话',
    kb: '知识库',
    manual: '手动输入',
  };

  return order
    .filter((key) => grouped.has(key))
    .map((key) => `${labels[key]} ${grouped.get(key)} 条`)
    .join('，');
}

function buildProposal(input: CreateLiveBookInput): LiveBookProposal {
  const sources = normalizeSources(input.sources);
  const sourceSummary = summarizeSources(sources);
  return {
    title: withFallbackTitle(input.topic),
    description: `围绕「${input.topic.trim()}」构建可交互学习书，支持章节精读、页内追问与测验反馈。`,
    scope: '概念理解 + 例题推演 + 自测复盘',
    targetLevel: input.targetLevel?.trim() || '通用',
    estimatedChapters: 4,
    rationale: `优先覆盖核心概念、易错点与迁移练习，保证可学、可练、可复盘。输入来源：${sourceSummary}`,
  };
}

function buildInitialChapters(topic: string): LiveBookChapter[] {
  return liveBookEngine.planSpine(topic);
}

function buildPageShells(chapters: LiveBookChapter[]): LiveBookPage[] {
  const ts = Date.now();
  return chapters.map((chapter) => ({
    id: makeId('pg'),
    chapterId: chapter.id,
    title: chapter.title,
    order: chapter.order,
    status: 'pending',
    blocks:
      chapter.contentType === 'overview'
        ? [
            {
              id: makeId('blk'),
              type: 'section',
              title: '本书导览',
              content: '该页面将展示概念依赖图与章节入口。',
              status: 'ready',
              paramsJson: { text: '该页面将展示概念依赖图与章节入口。' },
              metadataJson: { blockVersion: 1, source: 'page_shell_overview' },
              createdAt: ts,
              updatedAt: ts,
            },
            {
              id: makeId('blk'),
              type: 'concept_graph',
              title: '概念依赖图',
              content: '等待编译后生成概念图。',
              status: 'ready',
              paramsJson: { graph: {} },
              metadataJson: { blockVersion: 1, source: 'page_shell_overview' },
              createdAt: ts,
              updatedAt: ts,
            },
          ]
        : [
            {
              id: makeId('blk'),
              type: 'section',
              title: '正在准备本页内容',
              content: '该页面等待编译完成后将显示详细内容块。',
              status: 'ready',
              paramsJson: { text: '该页面等待编译完成后将显示详细内容块。' },
              metadataJson: { blockVersion: 1, source: 'page_shell' },
              createdAt: ts,
              updatedAt: ts,
            },
          ],
  }));
}

function buildProgress(): LiveBookProgress {
  return {
    currentPageId: null,
    visitedPageIds: [],
    bookmarkedPageIds: [],
    quizAttempts: [],
    weakChapterIds: [],
    score: 0,
    updatedAt: Date.now(),
  };
}

function buildQuality(): LiveBookQuality {
  return {
    compileTotal: 0,
    compileFailed: 0,
    blockErrors: 0,
    supplementHits: 0,
  };
}

function pickQuestionId(blockId: string): string {
  return `${blockId}_q1`;
}

function buildCompiledPage(book: LiveBookRecord, page: LiveBookPage, chapter: LiveBookChapter) {
  return liveBookCompiler.compilePage(book, page, chapter);
}

async function buildCompiledPageAsync(
  book: LiveBookRecord,
  page: LiveBookPage,
  chapter: LiveBookChapter,
  sectionPlan?: import('./live-book/section-architect').SectionPlan,
  onBlockEvent?: import('./live-book/live-book-compiler').BlockEventListener,
): Promise<import('./live-book/live-book-compiler').CompilePageResult> {
  return liveBookCompiler.compilePageAsync(book, page, chapter, sectionPlan, {
    onBlockEvent,
    concurrency: 1,
  });
}

function updateScoreFromAttempts(attempts: LiveBookQuizAttempt[]): number {
  if (attempts.length === 0) return 0;
  const correct = attempts.filter((item) => item.isCorrect).length;
  return Math.round((correct / attempts.length) * 100);
}

function resolveWeakChapterIds(book: LiveBookRecord): string[] {
  const wrongByChapter = new Map<string, number>();

  for (const attempt of book.progress.quizAttempts) {
    if (attempt.isCorrect) continue;
    const page = book.pages.find((item) => item.id === attempt.pageId);
    if (!page) continue;
    wrongByChapter.set(page.chapterId, (wrongByChapter.get(page.chapterId) || 0) + 1);
  }

  return Array.from(wrongByChapter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([chapterId]) => chapterId);
}

function generateRemedialBlock(
  book: LiveBookRecord,
  page: LiveBookPage,
  chapter: LiveBookChapter | undefined,
  questionId: string,
  userAnswer: string,
): LiveBookBlock {
  const chapterGoal = chapter?.goal || '掌握本章核心概念';
  const learningObjectives = chapter?.learningObjectives || [];
  const sourceRefs = chapter?.sourceRefs || [];

  const errorPatterns = [
    { pattern: /条件|前提|假设/, suggestion: '重新审视题目给出的条件，确认哪些是可用的已知信息。' },
    { pattern: /结论|结果|答案/, suggestion: '明确题目要求证明或求解的目标是什么。' },
    { pattern: /步骤|过程|方法/, suggestion: '回顾标准解题步骤，检查是否有遗漏或顺序错误。' },
  ];

  const matchedPattern = errorPatterns.find((p) => p.pattern.test(userAnswer)) || errorPatterns[0];

  const remedialContent = `【错因分析】
你在题目「${questionId}」的回答中可能出现了理解偏差。

【针对性建议】
${matchedPattern.suggestion}

【本章目标回顾】
${chapterGoal}

${learningObjectives.length > 0 ? `【需要掌握的关键点】\n${learningObjectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n')}` : ''}

【练习建议】
1. 重新阅读题目，圈出关键条件
2. 尝试用一句话概括解题思路
3. 对照本章目标检查理解程度`;

  return {
    id: makeId('blk'),
    type: 'remedial',
    title: '错因补偿练习',
    content: remedialContent,
    status: 'ready',
    paramsJson: {
      text: remedialContent,
      questionId,
      userAnswer,
      chapterGoal,
      learningObjectives,
      errorPattern: matchedPattern.pattern.source,
    },
    metadataJson: {
      blockVersion: 2,
      source: 'quiz_remedial',
      sourceAnchors: sourceRefs.slice(0, 3),
      generatedAt: new Date().toISOString(),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function generateDeepDiveBlock(
  book: LiveBookRecord,
  page: LiveBookPage,
  chapter: LiveBookChapter | undefined,
  question: string,
): LiveBookBlock {
  const chapterGoal = chapter?.goal || '';
  const learningObjectives = chapter?.learningObjectives || [];
  const sourceRefs = chapter?.sourceRefs || [];

  const questionLower = question.toLowerCase();
  const isWhyQuestion = /为什么|why|为何|怎么会/.test(questionLower);
  const isHowQuestion = /怎么|how|如何|怎样/.test(questionLower);
  const isWhatQuestion = /什么|what|什么意思/.test(questionLower);

  let explanationType = 'general';
  let explanationContent = '';

  if (isWhyQuestion) {
    explanationType = 'causal';
    explanationContent = `【为什么类问题解析】

你问到："${question}"

【本质原因】
在「${book.topic}」中，这种现象的出现有其内在逻辑：
1. 条件约束：特定前提决定了结果的形式
2. 结构特征：问题的内在结构导致了这种表现
3. 因果链条：从已知到结论存在必然的推导关系

【深层理解】
${chapterGoal ? `结合本章目标「${chapterGoal}」，` : ''}我们需要理解：
- 这个现象不是偶然的，而是由定义和性质决定的
- 改变某些条件会导致结果如何变化
- 这种规律在其他类似问题中是否适用`;
  } else if (isHowQuestion) {
    explanationType = 'procedural';
    explanationContent = `【怎么做类问题解析】

你问到："${question}"

【操作步骤】
解决这类问题的标准流程：
1. 审题定位：明确已知条件和求解目标
2. 选择工具：确定适用的定理、公式或方法
3. 执行计算：按逻辑顺序推进每一步
4. 验证结果：检查答案的合理性和完整性

【关键技巧】
${learningObjectives.length > 0 ? `本章要求掌握：\n${learningObjectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n')}\n\n` : ''}在实际操作中，要特别注意：
- 边界条件的处理
- 特殊情况的对策
- 常见错误的规避`;
  } else if (isWhatQuestion) {
    explanationType = 'conceptual';
    explanationContent = `【是什么类问题解析】

你问到："${question}"

【概念定义】
「${book.topic}」中的这个概念的精确定义：
- 核心内涵：本质特征是什么
- 外延范围：包含哪些情况，不包含哪些
- 等价表述：还可以怎样描述这个概念

【关联概念】
${chapterGoal ? `本章围绕「${chapterGoal}」展开，` : ''}相关概念包括：
${learningObjectives.length > 0 ? learningObjectives.map((obj) => `- ${obj}`).join('\n') : '- 基础定义\n- 性质定理\n- 应用场景'}

【理解检验】
试着用自己的话解释这个概念，看是否能准确传达其核心含义。`;
  } else {
    explanationContent = `【深入解析】

你问到："${question}"

【问题分析】
针对你的问题，我们可以从以下几个角度展开：

1. 概念层面
${chapterGoal ? `本章核心目标是「${chapterGoal}」。` : ''}理解相关概念是解决问题的基础。

2. 方法层面
${learningObjectives.length > 0 ? `本章需要掌握的技能：\n${learningObjectives.map((obj, i) => `   ${i + 1}. ${obj}`).join('\n')}` : '掌握标准解题方法和技巧'}

3. 应用层面
尝试将理解应用到具体情境中，通过练习加深认识。

【延伸阅读】
如果还有疑问，可以：
- 回顾本章的基础概念
- 查看典型例题的完整解析
- 尝试用不同方法解决同一问题`;
  }

  return {
    id: makeId('blk'),
    type: 'deep_dive',
    title: isWhyQuestion
      ? '深度解析：为什么'
      : isHowQuestion
        ? '深度解析：怎么做'
        : isWhatQuestion
          ? '深度解析：是什么'
          : '页内深挖解释',
    content: explanationContent,
    status: 'ready',
    paramsJson: {
      question,
      explanationType,
      chapterGoal,
      learningObjectives,
    },
    metadataJson: {
      blockVersion: 2,
      source: 'page_chat_deep_dive',
      sourceAnchors: sourceRefs.slice(0, 3),
      generatedAt: new Date().toISOString(),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Per-book compile queue for page-priority compilation (P2)
import { compileQueueManager, type CompileTask } from './live-book/compile-queue';

const bookCompileQueues = new Map<string, Promise<void>>();

async function runPageCompilation(
  jobId: string,
  bookId: string,
  pageIds: string[],
  sectionPlans: Map<string, import('./live-book/section-architect').SectionPlan>,
  stageBegin: number,
  stageEnd: number,
): Promise<void> {
  const latestBook = await liveBookEngine.getBook(bookId);
  if (!latestBook) throw new Error('book vanished during compilation');

  const totalPages = Math.max(1, pageIds.length);
  let updatedBook = latestBook;

  for (let i = 0; i < pageIds.length; i += 1) {
    const pageId = pageIds[i];
    const page = updatedBook.pages.find((item) => item.id === pageId);
    if (!page) continue;

    const chapter = updatedBook.chapters.find((item) => item.id === page.chapterId);
    if (!chapter) continue;

    const sectionPlan = sectionPlans.get(chapter.id);
    const pageProgress = stageBegin + Math.round(((i + 1) / totalPages) * (stageEnd - stageBegin));
    const incrementalBlocks: LiveBookBlock[] = [];

    const saveIncrementalBlock = async (block: LiveBookBlock) => {
      const nextBlocks = [...incrementalBlocks, block];
      incrementalBlocks.length = 0;
      incrementalBlocks.push(...nextBlocks);
      const hasReady = nextBlocks.some((item) => item.status === 'ready');
      const hasError = nextBlocks.some((item) => item.status === 'error');
      updatedBook = {
        ...updatedBook,
        pages: updatedBook.pages.map((item) =>
          item.id === page.id
            ? {
                ...item,
                status: hasReady || hasError ? 'partial' : item.status,
                blocks: nextBlocks,
              }
            : item,
        ),
        updatedAt: Date.now(),
      };
      await liveBookEngine.saveBook(updatedBook);
    };

    const onBlockEvent: import('./live-book/live-book-compiler').BlockEventListener = async (
      event,
    ) => {
      if (event.type === 'block_start') {
        await liveBookEngine.appendJobEvent(jobId, {
          type: 'block_ready',
          stage: 'compilation',
          progress: Math.max(stageBegin, pageProgress - 1),
          message: `开始生成 ${event.blockType} 内容块 (${event.blockIndex + 1}/${event.totalBlocks})`,
          metadata: {
            pageId: page.id,
            blockType: event.blockType,
            blockIndex: event.blockIndex,
            totalBlocks: event.totalBlocks,
            subEvent: 'block_start',
          },
        });
      } else if (event.type === 'block_progress') {
        await liveBookEngine.appendJobEvent(jobId, {
          type: 'progress',
          stage: 'compilation',
          progress: Math.max(stageBegin, pageProgress - 1),
          message: `生成 ${event.blockType} 中...`,
          metadata: {
            pageId: page.id,
            blockType: event.blockType,
            blockIndex: event.blockIndex,
            contentPreview: event.content?.slice(0, 100),
            subEvent: 'block_progress',
          },
        });
      } else if (event.type === 'block_complete') {
        await liveBookEngine.appendJobEvent(jobId, {
          type: 'block_ready',
          stage: 'compilation',
          progress: Math.max(stageBegin, pageProgress - 1),
          message: `内容块已生成：${event.blockType}`,
          metadata: {
            pageId: page.id,
            blockType: event.blockType,
            blockIndex: event.blockIndex,
            totalBlocks: event.totalBlocks,
            subEvent: 'block_complete',
          },
        });
        if (event.block) {
          await saveIncrementalBlock(event.block);
        }
      } else if (event.type === 'block_error') {
        await liveBookEngine.appendJobEvent(jobId, {
          type: 'block_error',
          stage: 'compilation',
          progress: Math.max(stageBegin, pageProgress - 1),
          message: `内容块生成失败：${event.blockType}`,
          metadata: {
            pageId: page.id,
            blockType: event.blockType,
            blockIndex: event.blockIndex,
            error: event.error,
            subEvent: 'block_error',
          },
        });
        if (event.block) {
          await saveIncrementalBlock(event.block);
        }
      } else if (event.type === 'bridge_text') {
        await liveBookEngine.appendJobEvent(jobId, {
          type: 'progress',
          stage: 'compilation',
          progress: Math.max(stageBegin, pageProgress - 1),
          message: `生成过渡语：${event.bridgeText?.slice(0, 50)}...`,
          metadata: {
            pageId: page.id,
            blockType: event.blockType,
            bridgeText: event.bridgeText,
            subEvent: 'bridge_text',
          },
        });
      }
    };

    const compiled = await buildCompiledPageAsync(
      updatedBook,
      page,
      chapter,
      sectionPlan,
      onBlockEvent,
    );

    updatedBook = {
      ...updatedBook,
      quality: {
        ...updatedBook.quality,
        compileTotal: updatedBook.quality.compileTotal + 1,
        blockErrors: updatedBook.quality.blockErrors + compiled.errorCount,
        compileFailed:
          updatedBook.quality.compileFailed + (compiled.pageStatus === 'error' ? 1 : 0),
      },
      pages: updatedBook.pages.map((item) =>
        item.id === page.id
          ? {
              ...item,
              status: compiled.pageStatus,
              blocks: compiled.blocks,
            }
          : item,
      ),
    };
    updatedBook = updateFingerprintSnapshot(updatedBook, [page.id]);
    await liveBookEngine.saveBook(updatedBook);

    for (const result of compiled.blockResults) {
      if (result.ok) {
        await liveBookEngine.appendJobEvent(jobId, {
          type: 'block_ready',
          stage: 'compilation',
          progress: Math.max(stageBegin, pageProgress - 1),
          message: `内容块已生成：${result.block.title}`,
          metadata: { pageId: page.id, blockId: result.block.id, blockType: result.block.type },
        });
      } else {
        await liveBookEngine.appendJobEvent(jobId, {
          type: 'block_error',
          stage: 'compilation',
          progress: Math.max(stageBegin, pageProgress - 1),
          message: `内容块生成失败：${result.block.title}`,
          metadata: {
            pageId: page.id,
            blockId: result.block.id,
            blockType: result.block.type,
            error: result.error,
          },
        });
      }
    }

    await liveBookEngine.appendJobEvent(jobId, {
      type: 'page_ready',
      stage: 'compilation',
      progress: pageProgress,
      message: `页面编译完成：${page.title}`,
      metadata: {
        pageId: page.id,
        pageOrder: page.order,
        pageStatus: compiled.pageStatus,
        blockSuccess: compiled.successCount,
        blockErrors: compiled.errorCount,
        bridgeTexts: compiled.bridgeTexts,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

async function runCompileWorkflow(
  jobId: string,
  bookId: string,
  priorityPageId?: string,
): Promise<void> {
  const stagePlan: Array<{ stage: LiveBookJobStage; begin: number; end: number; message: string }> =
    [
      { stage: 'ideation', begin: 5, end: 18, message: '正在分析主题与目标受众' },
      { stage: 'exploration', begin: 18, end: 35, message: '正在抽取核心知识点与场景' },
      { stage: 'synthesis', begin: 35, end: 55, message: '正在合成章节结构与学习路径' },
      { stage: 'compilation', begin: 55, end: 95, message: '正在编译页面与内容块' },
    ];

  try {
    await liveBookEngine.updateJob(jobId, (job) => ({
      ...job,
      status: 'running',
      stage: 'ideation',
      progress: 5,
    }));

    let book = await liveBookEngine.getBook(bookId);
    if (!book) {
      throw new Error('book not found for compile');
    }

    book = { ...book, status: 'compiling', updatedAt: Date.now() };
    await liveBookEngine.saveBook(book);

    let sectionPlans = new Map<string, import('./live-book/section-architect').SectionPlan>();

    for (const stage of stagePlan) {
      await liveBookEngine.appendJobEvent(jobId, {
        type: 'stage_begin',
        stage: stage.stage,
        progress: stage.begin,
        message: stage.message,
      });

      await new Promise((resolve) => setTimeout(resolve, 220));

      await liveBookEngine.appendJobEvent(jobId, {
        type: 'progress',
        stage: stage.stage,
        progress: Math.round((stage.begin + stage.end) / 2),
        message: stage.message,
      });

      if (stage.stage === 'exploration') {
        const latestBook = await liveBookEngine.getBook(bookId);
        if (!latestBook) throw new Error('book vanished during exploration');

        const report = await sourceExplorer.explore({
          book: latestBook,
          topic: latestBook.topic,
        });
        await saveLiveBookExploration({
          bookId,
          topic: latestBook.topic,
          report,
        });

        await liveBookEngine.appendJobEvent(jobId, {
          type: 'progress',
          stage: 'exploration',
          progress: Math.min(stage.end - 1, Math.round((stage.begin + stage.end) / 2) + 4),
          message: `资料探索完成：${report.chunks.length} 条证据，${report.candidateConcepts.length} 个候选概念`,
          metadata: {
            chunks: report.chunks.length,
            concepts: report.candidateConcepts.length,
          },
        });
      }

      if (stage.stage === 'synthesis') {
        const latestBook = await liveBookEngine.getBook(bookId);
        if (!latestBook) throw new Error('book vanished during synthesis');

        const explorationRecords = await listLiveBookExplorations(bookId);
        const exploration = explorationRecords[0]?.report;

        if (exploration) {
          const synthesized = await spineSynthesizer.synthesize(latestBook, exploration);
          const chapters = synthesized.chapters
            .sort((a, b) => a.order - b.order)
            .map((chapter, index) => ({ ...chapter, order: index + 1 }));

          const normalizedPages = chapters.map((chapter, index) => {
            const existing = latestBook.pages.find((page) => page.chapterId === chapter.id);
            if (existing) {
              return {
                ...existing,
                title: chapter.title,
                order: index + 1,
              };
            }
            return buildPageShells([chapter])[0];
          });

          const synthesizedBook: LiveBookRecord = {
            ...latestBook,
            chapters,
            pages: normalizedPages,
            proposal: {
              ...latestBook.proposal,
              estimatedChapters: chapters.length,
            },
            conceptGraphJson: synthesized.conceptGraphJson,
            updatedAt: Date.now(),
          };

          await liveBookEngine.saveBook(synthesizedBook);

          // Build section plans using SectionArchitect
          sectionPlans = await sectionArchitect.planSections(synthesizedBook, exploration);

          await liveBookEngine.appendJobEvent(jobId, {
            type: 'progress',
            stage: 'synthesis',
            progress: Math.min(stage.end - 1, Math.round((stage.begin + stage.end) / 2) + 4),
            message: `书脊合成完成：${chapters.length} 章`,
            metadata: {
              chapterCount: chapters.length,
              conceptNodes: Array.isArray(synthesized.conceptGraphJson.nodes)
                ? synthesized.conceptGraphJson.nodes.length
                : 0,
            },
          });
        }
      }

      if (stage.stage === 'compilation') {
        const latestBook = await liveBookEngine.getBook(bookId);
        if (!latestBook) throw new Error('book vanished during compilation');

        const pages = [...latestBook.pages].sort((a, b) => a.order - b.order);
        const allPageIds = pages.map((p) => p.id);

        // Page-priority queue: priorityPageId first, then remaining pages
        const priorityIds =
          priorityPageId && allPageIds.includes(priorityPageId)
            ? [priorityPageId, ...allPageIds.filter((id) => id !== priorityPageId)]
            : allPageIds;

        // Compile priority pages first
        const priorityCount = priorityPageId ? 1 : 0;
        const prioritySlice = priorityIds.slice(0, priorityCount || allPageIds.length);
        const backgroundSlice = priorityCount > 0 ? priorityIds.slice(priorityCount) : [];

        await runPageCompilation(
          jobId,
          bookId,
          prioritySlice,
          sectionPlans,
          stage.begin,
          stage.end,
        );

        if (backgroundSlice.length > 0) {
          await liveBookEngine.appendJobEvent(jobId, {
            type: 'progress',
            stage: 'compilation',
            progress: Math.round((stage.begin + stage.end) / 2),
            message: `优先页面已编译，后台队列继续补齐 ${backgroundSlice.length} 页`,
            metadata: { backgroundPages: backgroundSlice.length },
          });
          await runBackgroundCompilation(
            jobId,
            bookId,
            backgroundSlice,
            sectionPlans,
            priorityPageId,
          );
        }
      }

      await liveBookEngine.appendJobEvent(jobId, {
        type: 'stage_end',
        stage: stage.stage,
        progress: stage.end,
        message: `${stage.stage} 阶段完成`,
      });
    }

    const finalBook = await liveBookEngine.getBook(bookId);
    if (finalBook) {
      const pageStatuses = finalBook.pages.map((item) => item.status);
      const hasUsablePage = pageStatuses.some(
        (status) => status === 'ready' || status === 'partial',
      );
      const readyBook: LiveBookRecord = {
        ...finalBook,
        status: hasUsablePage ? 'ready' : 'failed',
        progress: {
          ...finalBook.progress,
          currentPageId: finalBook.pages.sort((a, b) => a.order - b.order)[0]?.id || null,
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };
      await liveBookEngine.saveBook(readyBook);
    }

    await liveBookEngine.updateJob(jobId, (job) => ({
      ...job,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      updatedAt: Date.now(),
    }));

    await liveBookEngine.appendJobEvent(jobId, {
      type: 'done',
      stage: 'completed',
      progress: 100,
      message: '活书编译完成',
      metadata: { bookId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown compile error';
    log.error(`LiveBook compile failed [book=${bookId}, job=${jobId}]:`, error);

    const failedBook = await liveBookEngine.getBook(bookId);
    if (failedBook) {
      await liveBookEngine.saveBook({
        ...failedBook,
        status: 'failed',
        quality: {
          ...failedBook.quality,
          compileFailed: failedBook.quality.compileFailed + 1,
        },
        updatedAt: Date.now(),
      });
    }

    await liveBookEngine.updateJob(jobId, (job) => ({
      ...job,
      status: 'failed',
      stage: 'failed',
      progress: Math.min(job.progress, 99),
      error: message,
      updatedAt: Date.now(),
    }));

    await liveBookEngine.appendJobEvent(jobId, {
      type: 'error',
      stage: 'failed',
      progress: 99,
      message,
      metadata: { bookId },
    });
  }
}

async function enqueueBookCompile(
  jobId: string,
  bookId: string,
  priorityPageId?: string,
): Promise<void> {
  const existing = bookCompileQueues.get(bookId);
  const next = existing
    ? existing.then(() => runCompileWorkflow(jobId, bookId, priorityPageId))
    : runCompileWorkflow(jobId, bookId, priorityPageId);
  bookCompileQueues.set(bookId, next);
  await next;
}

// New background compilation using CompileQueueManager
async function runBackgroundCompilation(
  jobId: string,
  bookId: string,
  pageIds: string[],
  sectionPlans: Map<string, import('./live-book/section-architect').SectionPlan>,
  priorityPageId?: string,
): Promise<void> {
  const handler = async (task: CompileTask) => {
    const book = await liveBookEngine.getBook(task.bookId);
    if (!book) throw new Error('book vanished during background compilation');

    const page = book.pages.find((p) => p.id === task.pageId);
    if (!page) throw new Error('page not found');

    const chapter = book.chapters.find((c) => c.id === page.chapterId);
    if (!chapter) throw new Error('chapter not found');

    const sectionPlan = sectionPlans.get(chapter.id);

    const compiled = liveBookCompiler.compilePage(book, page, chapter, sectionPlan);

    const updatedBook: LiveBookRecord = {
      ...book,
      quality: {
        ...book.quality,
        compileTotal: book.quality.compileTotal + 1,
        blockErrors: book.quality.blockErrors + compiled.errorCount,
        compileFailed: book.quality.compileFailed + (compiled.pageStatus === 'error' ? 1 : 0),
      },
      pages: book.pages.map((p) =>
        p.id === page.id ? { ...p, status: compiled.pageStatus, blocks: compiled.blocks } : p,
      ),
    };

    await liveBookEngine.saveBook(updateFingerprintSnapshot(updatedBook, [page.id]));

    await liveBookEngine.appendJobEvent(jobId, {
      type: 'page_ready',
      stage: 'compilation',
      progress: 0,
      message: `后台编译完成：${page.title}`,
      metadata: {
        pageId: page.id,
        pageStatus: compiled.pageStatus,
        blockSuccess: compiled.successCount,
        blockErrors: compiled.errorCount,
      },
    });
  };

  const queue = compileQueueManager.getOrCreateQueue(bookId, handler, {
    maxConcurrent: 2,
    retryLimit: 2,
    retryDelayMs: 3000,
    taskTimeoutMs: 180000,
  });

  // Sort pages: priority first, then by order
  const sortedPageIds = [...pageIds];
  if (priorityPageId && sortedPageIds.includes(priorityPageId)) {
    const idx = sortedPageIds.indexOf(priorityPageId);
    sortedPageIds.splice(idx, 1);
    sortedPageIds.unshift(priorityPageId);
  }

  for (let i = 0; i < sortedPageIds.length; i++) {
    const pageId = sortedPageIds[i];
    const priority = pageId === priorityPageId ? 100 : sortedPageIds.length - i;
    queue.enqueue({
      jobId,
      bookId,
      pageId,
      priority,
    });
  }

  // Wait for queue to complete
  await new Promise<void>((resolve) => {
    const checkInterval = setInterval(() => {
      const status = queue.getStatus();
      if (status.queued === 0 && status.active === 0) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 500);

    // Timeout after 10 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 600000);
  });
}

// ---------------------------------------------------------------------------
// Public API (kept compatible with existing routes)
// ---------------------------------------------------------------------------

export async function createLiveBook(input: CreateLiveBookInput): Promise<LiveBookRecord> {
  const topic = input.topic.trim();
  const sources = normalizeSources(input.sources);
  const chapters = buildInitialChapters(topic);
  return liveBookEngine.createBook({
    title: withFallbackTitle(topic),
    topic,
    userId: input.userId,
    language: input.language,
    targetLevel: input.targetLevel,
    proposal: buildProposal(input),
    chapters,
    pages: buildPageShells(chapters),
    progress: buildProgress(),
    quality: buildQuality(),
    conceptGraphJson: {
      inputSources: sources,
      sourceAnchors: sources.flatMap(sourceInputToAnchors),
      sourceSummary: summarizeSources(sources),
    },
  });
}

export async function listLiveBooks(): Promise<LiveBookSummary[]> {
  return liveBookEngine.listBooks();
}

export async function getLiveBook(bookId: string): Promise<LiveBookRecord | null> {
  return liveBookEngine.getBook(bookId);
}

export async function confirmLiveBookProposal(bookId: string): Promise<LiveBookRecord | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  // Step 1: Source exploration with LLM query design + synthesis
  const exploration = await sourceExplorer.explore({
    book,
    topic: book.topic,
  });

  // Store exploration chunks in conceptGraphJson for later use by compiler
  const explorationForStorage = {
    ...exploration,
    chunks: exploration.chunks.slice(0, 20), // Limit stored chunks
  };

  await saveLiveBookExploration({
    bookId: book.id,
    topic: book.topic,
    report: explorationForStorage,
  });

  // Step 2: Spine synthesis with Draft -> Critique -> Revise
  const synthesized = await spineSynthesizer.synthesize(book, exploration);
  const chapters = synthesized.chapters
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index + 1 }));

  // Step 3: Build enriched conceptGraphJson with exploration data
  const enrichedConceptGraph = {
    ...synthesized.conceptGraphJson,
    inputSources: book.conceptGraphJson?.inputSources || [],
    sourceSummary: summarizeSources(
      Array.isArray(book.conceptGraphJson?.inputSources)
        ? (book.conceptGraphJson?.inputSources as LiveBookSourceInput[])
        : [],
    ),
    explorationChunks: exploration.chunks.slice(0, 10),
    critiqueIssues: synthesized.critiqueIssues,
  };

  const next: LiveBookRecord = {
    ...book,
    proposal: {
      ...book.proposal,
      estimatedChapters: chapters.length,
    },
    chapters,
    pages: buildPageShells(chapters),
    status: 'spine_ready',
    conceptGraphJson: enrichedConceptGraph,
    updatedAt: Date.now(),
  };

  await liveBookEngine.saveBook(next);
  return next;
}

export async function confirmLiveBookSpine(bookId: string): Promise<LiveBookRecord | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const normalizedChapters = [...book.chapters]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index + 1 }));

  const normalizedPages = normalizedChapters.map((chapter, index) => {
    const existing = book.pages.find((page) => page.chapterId === chapter.id);
    if (!existing) {
      const shell = buildPageShells([chapter])[0];
      return {
        ...shell,
        order: index + 1,
      };
    }

    return {
      ...existing,
      title: chapter.title,
      order: index + 1,
    };
  });

  const next: LiveBookRecord = {
    ...book,
    chapters: normalizedChapters,
    pages: normalizedPages,
    status: 'spine_ready',
    updatedAt: Date.now(),
  };

  await liveBookEngine.saveBook(next);
  return next;
}

export async function getLiveBookPage(
  bookId: string,
  pageId: string,
): Promise<{ book: LiveBookRecord; page: LiveBookPage } | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;
  const page = book.pages.find((item) => item.id === pageId);
  if (!page) return null;
  return { book, page };
}

export async function reorderLiveBookChapters(
  bookId: string,
  orderedChapterIds: string[],
): Promise<LiveBookRecord | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const chapterMap = new Map(book.chapters.map((item) => [item.id, item]));
  const normalizedIds = orderedChapterIds.filter((id) => chapterMap.has(id));
  for (const chapter of book.chapters) {
    if (!normalizedIds.includes(chapter.id)) normalizedIds.push(chapter.id);
  }

  const chapters = normalizedIds.map((id, index) => {
    const chapter = chapterMap.get(id);
    if (!chapter) {
      throw new Error(`chapter not found: ${id}`);
    }
    return {
      ...chapter,
      order: index + 1,
    };
  });

  const pages = chapters.map((chapter, index) => {
    const existing = book.pages.find((page) => page.chapterId === chapter.id);
    if (!existing) {
      const shell = buildPageShells([chapter])[0];
      return {
        ...shell,
        order: index + 1,
      };
    }

    return {
      ...existing,
      title: chapter.title,
      order: index + 1,
    };
  });

  const next: LiveBookRecord = {
    ...book,
    chapters,
    pages,
    updatedAt: Date.now(),
  };
  await liveBookEngine.saveBook(next);
  return next;
}

export async function startLiveBookCompile(
  bookId: string,
  priorityPageId?: string,
): Promise<LiveBookJobRecord | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const runningJobs = await listLiveBookJobs(bookId);
  const active = runningJobs.find((item) => item.status === 'queued' || item.status === 'running');
  if (active) return active;

  const job = await liveBookEngine.createJob(bookId);
  void enqueueBookCompile(job.id, bookId, priorityPageId);
  return job;
}

export async function compileLiveBookPage(
  bookId: string,
  pageId: string,
  force = false,
): Promise<LiveBookRecord | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const page = book.pages.find((item) => item.id === pageId);
  if (!page) return null;
  if (!force && page.status === 'ready' && page.blocks.length > 0) {
    return book;
  }

  const chapter = book.chapters.find((item) => item.id === page.chapterId);
  if (!chapter) return null;

  // Build section plan for single-page compilation (consistent with full-book compile)
  const explorationRecords = await listLiveBookExplorations(bookId);
  const exploration = explorationRecords[0]?.report;
  let sectionPlan: import('./live-book/section-architect').SectionPlan | undefined;
  if (exploration) {
    const sectionPlans = await sectionArchitect.planSections(book, exploration);
    sectionPlan = sectionPlans.get(chapter.id);
  }

  const compiled = liveBookCompiler.compilePage(book, page, chapter, sectionPlan);
  const next: LiveBookRecord = {
    ...book,
    status: compiled.pageStatus === 'error' ? 'failed' : 'ready',
    quality: {
      ...book.quality,
      compileTotal: book.quality.compileTotal + 1,
      blockErrors: book.quality.blockErrors + compiled.errorCount,
      compileFailed: book.quality.compileFailed + (compiled.pageStatus === 'error' ? 1 : 0),
    },
    pages: book.pages.map((item) =>
      item.id === pageId
        ? {
            ...item,
            status: compiled.pageStatus,
            blocks: compiled.blocks,
          }
        : item,
    ),
    progress: {
      ...book.progress,
      currentPageId: pageId,
      visitedPageIds: Array.from(new Set([...book.progress.visitedPageIds, pageId])),
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };

  const saved = updateFingerprintSnapshot(next, [pageId]);
  await liveBookEngine.saveBook(saved);
  return saved;
}

export async function listLiveBookJobs(bookId?: string): Promise<LiveBookJobRecord[]> {
  return liveBookEngine.listJobs(bookId);
}

export async function getLiveBookJob(jobId: string): Promise<LiveBookJobRecord | null> {
  return liveBookEngine.getJob(jobId);
}

export async function listLiveBookExplorations(
  bookId: string,
  chapterId?: string,
): Promise<LiveBookExplorationRecord[]> {
  return liveBookEngine.listExplorations(bookId, chapterId);
}

export async function saveLiveBookExploration(params: {
  bookId: string;
  topic: string;
  report: LiveBookExplorationReport;
  chapterId?: string;
  id?: string;
}): Promise<LiveBookExplorationRecord> {
  return liveBookEngine.saveExploration(params);
}

export function subscribeLiveBookJob(
  jobId: string,
  listener: (event: LiveBookJobEvent) => void,
): () => void {
  return liveBookEngine.subscribeJob(jobId, listener);
}

export async function operateLiveBookBlock(
  bookId: string,
  payload: {
    action: 'regenerate' | 'insert' | 'move' | 'delete';
    pageId: string;
    blockId?: string;
    direction?: 'up' | 'down';
    blockType?: LiveBookBlockType;
    title?: string;
    content?: string;
  },
): Promise<LiveBookRecord | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const page = book.pages.find((item) => item.id === payload.pageId);
  if (!page) return null;

  let blocks = [...page.blocks];

  if (payload.action === 'regenerate') {
    if (!payload.blockId) return null;
    const chapter = book.chapters.find((item) => item.id === page.chapterId);
    if (!chapter) return null;
    const regeneratedBlocks = await Promise.all(
      blocks.map(async (block) =>
        block.id === payload.blockId
          ? await liveBookCompiler.regenerateBlock(book, page, chapter, block)
          : block,
      ),
    );
    blocks = regeneratedBlocks;
  }

  if (payload.action === 'insert') {
    const block: LiveBookBlock = {
      id: makeId('blk'),
      type: payload.blockType || 'text',
      title: payload.title?.trim() || '新增内容块',
      content: payload.content?.trim() || '这是新插入的活书内容块。',
      status: 'ready',
      paramsJson: { text: payload.content?.trim() || '这是新插入的活书内容块。' },
      metadataJson: { blockVersion: 1, source: 'manual_insert' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (!payload.blockId) {
      blocks.push(block);
    } else {
      const idx = blocks.findIndex((item) => item.id === payload.blockId);
      if (idx === -1) blocks.push(block);
      else blocks.splice(idx + 1, 0, block);
    }
  }

  if (payload.action === 'move') {
    if (!payload.blockId || !payload.direction) return null;
    const idx = blocks.findIndex((item) => item.id === payload.blockId);
    if (idx === -1) return null;
    const target = payload.direction === 'up' ? idx - 1 : idx + 1;
    if (target >= 0 && target < blocks.length) {
      const moved = blocks[idx];
      blocks.splice(idx, 1);
      blocks.splice(target, 0, moved);
    }
  }

  if (payload.action === 'delete') {
    if (!payload.blockId) return null;
    blocks = blocks.filter((item) => item.id !== payload.blockId);
  }

  const next: LiveBookRecord = {
    ...book,
    pages: book.pages.map((item) =>
      item.id === page.id
        ? {
            ...item,
            blocks,
          }
        : item,
    ),
    updatedAt: Date.now(),
  };

  await liveBookEngine.saveBook(next);
  return next;
}

export async function regenerateLiveBookBlock(
  bookId: string,
  pageId: string,
  blockId: string,
): Promise<LiveBookRecord | null> {
  return operateLiveBookBlock(bookId, {
    action: 'regenerate',
    pageId,
    blockId,
  });
}

export async function submitLiveBookQuizAttempt(
  bookId: string,
  payload: {
    pageId: string;
    blockId: string;
    questionId?: string;
    userAnswer?: string;
    isCorrect: boolean;
  },
): Promise<LiveBookRecord | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const page = book.pages.find((item) => item.id === payload.pageId);
  if (!page) return null;

  const chapter = book.chapters.find((item) => item.id === page.chapterId);

  const attempt: LiveBookQuizAttempt = {
    pageId: payload.pageId,
    blockId: payload.blockId,
    questionId: payload.questionId || pickQuestionId(payload.blockId),
    userAnswer: payload.userAnswer || '',
    isCorrect: payload.isCorrect,
    timestamp: Date.now(),
  };

  await liveBookEngine.addQuizAttempt(bookId, attempt);

  let pages = [...book.pages];
  let quality = { ...book.quality };

  if (!payload.isCorrect) {
    const remedial = generateRemedialBlock(
      book,
      page,
      chapter,
      attempt.questionId,
      attempt.userAnswer,
    );

    pages = pages.map((item) =>
      item.id === payload.pageId
        ? {
            ...item,
            blocks: [...item.blocks, remedial],
          }
        : item,
    );

    quality = {
      ...quality,
      supplementHits: quality.supplementHits + 1,
    };
  }

  const nextQuizAttempts = [...book.progress.quizAttempts, attempt];
  const visitedSet = new Set([...book.progress.visitedPageIds, payload.pageId]);

  let nextBook: LiveBookRecord = {
    ...book,
    pages,
    quality,
    progress: {
      ...book.progress,
      currentPageId: payload.pageId,
      visitedPageIds: Array.from(visitedSet),
      quizAttempts: nextQuizAttempts,
      score: updateScoreFromAttempts(nextQuizAttempts),
      updatedAt: Date.now(),
      weakChapterIds: [],
    },
    updatedAt: Date.now(),
  };

  nextBook = {
    ...nextBook,
    progress: {
      ...nextBook.progress,
      weakChapterIds: resolveWeakChapterIds(nextBook),
    },
  };

  await liveBookEngine.saveBook(nextBook);
  return nextBook;
}

export async function chatWithLiveBookPage(
  bookId: string,
  payload: { pageId: string; message: string },
): Promise<{ book: LiveBookRecord; reply: string } | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const page = book.pages.find((item) => item.id === payload.pageId);
  if (!page) return null;

  const chapter = book.chapters.find((item) => item.id === page.chapterId);

  const lower = payload.message.toLowerCase();
  const needsDeepDive =
    lower.includes('为什么') ||
    lower.includes('怎么') ||
    lower.includes('why') ||
    lower.includes('how') ||
    lower.includes('什么') ||
    lower.includes('what') ||
    lower.includes('如何') ||
    lower.includes('为何');

  let pages = [...book.pages];
  const chapters = [...book.chapters];
  let quality = { ...book.quality };
  let reply = `基于当前页面，我建议先抓住「${book.topic}」的核心判定条件，再验证每一步推理是否闭环。`;

  if (needsDeepDive) {
    // Try creating a deep dive subpage first
    const deepDiveResult = await createDeepDiveSubpage({
      book,
      parentPage: page,
      parentChapter: chapter || {
        id: page.chapterId,
        title: page.title,
        goal: '',
        order: page.order,
      },
      triggerQuestion: payload.message,
    });

    if (deepDiveResult) {
      // Insert new chapter and page
      chapters.push(deepDiveResult.chapter);
      pages.push(deepDiveResult.page);

      // Add a deep_dive block to current page linking to subpage
      const linkBlock = generateDeepDiveBlock(book, page, chapter, payload.message);
      pages = pages.map((item) =>
        item.id === page.id ? { ...item, blocks: [...item.blocks, linkBlock] } : item,
      );

      quality = { ...quality, supplementHits: quality.supplementHits + 1 };
      reply = deepDiveResult.reply;
    } else {
      // Fallback: just add a deep_dive block to current page
      const block = generateDeepDiveBlock(book, page, chapter, payload.message);
      pages = pages.map((item) =>
        item.id === page.id ? { ...item, blocks: [...item.blocks, block] } : item,
      );
      quality = { ...quality, supplementHits: quality.supplementHits + 1 };
      reply = `已为你追加「${block.title}」内容块，针对你的问题「${payload.message}」进行了深入分析。可继续追问具体步骤。`;
    }
  }

  const visitedSet = new Set([...book.progress.visitedPageIds, payload.pageId]);

  const next: LiveBookRecord = {
    ...book,
    pages,
    chapters,
    quality,
    progress: {
      ...book.progress,
      currentPageId: payload.pageId,
      visitedPageIds: Array.from(visitedSet),
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };

  await liveBookEngine.saveBook(next);
  return { book: next, reply };
}

function splitReplyIntoChunks(reply: string): string[] {
  const chunks = reply
    .split(/(?<=[。！？!?.])/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (chunks.length <= 1) {
    return reply.length > 0 ? [reply] : [];
  }
  return chunks;
}

export async function chatWithLiveBookPageStream(
  bookId: string,
  payload: { pageId: string; message: string },
): Promise<{ chunks: string[]; finalReply: string; book: LiveBookRecord } | null> {
  const result = await chatWithLiveBookPage(bookId, payload);
  if (!result) return null;
  return {
    chunks: splitReplyIntoChunks(result.reply),
    finalReply: result.reply,
    book: result.book,
  };
}

export async function checkLiveBookHealth(bookId: string): Promise<LiveBookHealth | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  // Use new KB drift detector for comprehensive health check
  const driftCheck = await quickDriftCheck(book);

  const pendingPageIds = book.pages
    .filter((item) => item.status === 'pending')
    .map((item) => item.id);
  const partialPageIds = book.pages
    .filter((item) => item.status === 'partial')
    .map((item) => item.id);
  const errorPageIds = driftCheck.errorPageIds;
  const driftReasonByPageId: Record<string, string[]> = {};
  const driftPageIds = driftCheck.driftedPageIds;

  let blockErrorCount = 0;
  for (const page of book.pages) {
    blockErrorCount += page.blocks.filter(
      (block) => block.status === 'error' || Boolean(block.error),
    ).length;

    // Add drift reasons for drifted pages
    if (driftPageIds.includes(page.id)) {
      driftReasonByPageId[page.id] = ['Content may be outdated or source has changed'];
    }
  }

  const stalePageIds = Array.from(
    new Set([
      ...pendingPageIds,
      ...partialPageIds,
      ...errorPageIds,
      ...driftPageIds,
      ...driftCheck.stalePageIds,
    ]),
  );
  const staleCount = stalePageIds.length;

  return {
    stalePageIds,
    driftPageIds,
    driftReasonByPageId,
    errorPageIds,
    partialPageIds,
    pendingPageIds,
    blockErrorCount,
    staleCount,
    driftCount: driftPageIds.length,
    ok: driftCheck.ok && blockErrorCount === 0,
  };
}

// New: Full KB drift report with LLM analysis
export async function getLiveBookDriftReport(
  bookId: string,
): Promise<import('./live-book/kb-drift-detector').KBDriftReport | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  return detectKBDrift(book, {
    checkFingerprints: true,
    checkSources: true,
    checkKB: true,
    useLLM: true,
  });
}

export async function refreshLiveBookFingerprints(bookId: string): Promise<{
  book: LiveBookRecord;
  health: LiveBookHealth;
  recompiledPageIds: string[];
} | null> {
  const initial = await checkLiveBookHealth(bookId);
  if (!initial) return null;

  let latest = await liveBookEngine.getBook(bookId);
  if (!latest) return null;

  const recompiledPageIds: string[] = [];
  for (const pageId of initial.stalePageIds) {
    const compiled = await compileLiveBookPage(bookId, pageId, true);
    if (compiled) {
      latest = compiled;
      recompiledPageIds.push(pageId);
    }
  }

  if (!latest) return null;
  const health = await checkLiveBookHealth(bookId);
  if (!health) return null;

  return {
    book: latest,
    health,
    recompiledPageIds,
  };
}

export async function buildLiveBookInsights(bookId: string): Promise<LiveBookInsights | null> {
  const book = await liveBookEngine.getBook(bookId);
  if (!book) return null;

  const attempts = book.progress.quizAttempts;
  const quizTotal = attempts.length;
  const quizCorrect = attempts.filter((item) => item.isCorrect).length;

  const wrongByChapter = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.isCorrect) continue;
    const page = book.pages.find((item) => item.id === attempt.pageId);
    if (!page) continue;
    wrongByChapter.set(page.chapterId, (wrongByChapter.get(page.chapterId) || 0) + 1);
  }

  const weakChapters = Array.from(wrongByChapter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([chapterId, wrongCount]) => {
      const chapter = book.chapters.find((item) => item.id === chapterId);
      return {
        chapterId,
        title: chapter?.title || chapterId,
        wrongCount,
      };
    });

  const weakPoints = weakChapters.map((item) => `${item.title}（错题 ${item.wrongCount}）`);
  if (weakPoints.length === 0) weakPoints.push('当前暂无明显薄弱章节');

  const reviewPath = [
    {
      step: 1,
      title: weakChapters[0]?.title || '核心章节回顾',
      action: '回看本章 section/text 块并复述关键判定条件。',
    },
    {
      step: 2,
      title: '错题补偿训练',
      action: '优先完成 remedial/quiz 块，记录每题失误原因。',
    },
    {
      step: 3,
      title: '迁移验证',
      action: '在互动提问块中追问"如何迁移到新题型"。',
    },
  ];

  const compileFailureRate =
    book.quality.compileTotal === 0
      ? 0
      : Number((book.quality.compileFailed / book.quality.compileTotal).toFixed(4));

  const totalBlocks = Math.max(
    1,
    book.pages.reduce((sum, page) => sum + page.blocks.length, 0),
  );
  const blockErrorRate = Number((book.quality.blockErrors / totalBlocks).toFixed(4));

  const supplementBase = Math.max(1, quizTotal + book.progress.visitedPageIds.length);
  const supplementHitRate = Number((book.quality.supplementHits / supplementBase).toFixed(4));

  return {
    weakProfile: {
      weakChapters,
      weakPoints,
    },
    reviewPath,
    quality: {
      compileFailureRate,
      blockErrorRate,
      supplementHitRate,
      compileTotal: book.quality.compileTotal,
      compileFailed: book.quality.compileFailed,
      blockErrors: book.quality.blockErrors,
      supplementHits: book.quality.supplementHits,
    },
    progress: {
      score: book.progress.score,
      quizTotal,
      quizCorrect,
      visitedPages: book.progress.visitedPageIds.length,
      totalPages: book.pages.length,
    },
  };
}
