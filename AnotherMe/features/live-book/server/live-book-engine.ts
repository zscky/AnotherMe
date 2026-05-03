import type {
  LiveBookRecord,
  LiveBookPage,
  LiveBookBlock,
  LiveBookChapter,
  LiveBookJobRecord,
  LiveBookJobEvent,
  LiveBookJobStage,
  LiveBookJobEventType,
  LiveBookQuizAttempt,
  LiveBookExplorationRecord,
  LiveBookExplorationReport,
  LiveBookProgress,
  LiveBookQuality,
} from './live-book-store';
import {
  withLiveBookDatabase,
  queryRows,
  queryOne,
  runSql,
} from './live-book-db';
import { normalizeLiveBookBlockStorage } from './live-book-schema';
import { liveBookCompiler } from './live-book/live-book-compiler';

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function now(): number {
  return Date.now();
}

function toJson<T>(value: T): string {
  return JSON.stringify(value);
}

function fromJson<T>(value: string | null | Uint8Array): T {
  if (!value) return {} as T;
  if (value instanceof Uint8Array) {
    return JSON.parse(Buffer.from(value).toString('utf-8')) as T;
  }
  return JSON.parse(value) as T;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface BookRow {
  id: string;
  title: string;
  topic: string;
  user_id: string;
  language: string;
  target_level: string;
  status: string;
  proposal_title: string;
  proposal_description: string;
  proposal_scope: string;
  proposal_target_level: string;
  proposal_estimated_chapters: number;
  proposal_rationale: string;
  progress_current_page_id: string | null;
  progress_visited_page_ids: string;
  progress_bookmarked_page_ids: string;
  progress_quiz_attempts: string;
  progress_weak_chapter_ids: string;
  progress_score: number;
  progress_updated_at: number;
  quality_compile_total: number;
  quality_compile_failed: number;
  quality_block_errors: number;
  quality_supplement_hits: number;
  concept_graph_json: string;
  created_at: number;
  updated_at: number;
}

interface ProgressRow {
  book_id: string;
  current_page_id: string | null;
  visited_pages: string;
  bookmarks: string;
  weak_points: string;
  weak_chapter_ids: string;
  score: number;
  updated_at: number;
}

interface ChapterRow {
  id: string;
  book_id: string;
  title: string;
  goal: string;
  learning_objectives_json: string;
  content_type: string;
  source_refs_json: string;
  prerequisites_json: string;
  summary: string;
  sort_order: number;
  difficulty?: string;
  created_at: number;
  updated_at: number;
}

interface PageRow {
  id: string;
  book_id: string;
  chapter_id: string;
  title: string;
  sort_order: number;
  status: string;
  created_at: number;
  updated_at: number;
}

interface BlockRow {
  id: string;
  block_id: string | null;
  book_id: string;
  page_id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  payload_json: string;
  source_refs_json: string;
  params_json: string;
  metadata_json: string;
  block_error: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface ExplorationRow {
  id: string;
  book_id: string;
  chapter_id: string | null;
  topic: string;
  report_json: string;
  created_at: number;
  updated_at: number;
}

interface JobRow {
  id: string;
  book_id: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface EventRow {
  id: string;
  job_id: string;
  type: string;
  stage: string;
  message: string;
  progress: number;
  metadata: string | null;
  created_at: number;
}

interface QuizAttemptRow {
  id: string;
  book_id: string;
  page_id: string;
  block_id: string;
  question_id: string;
  user_answer: string;
  is_correct: number;
  created_at: number;
}

function mapBookRow(row: BookRow): LiveBookRecord {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    userId: row.user_id,
    language: row.language as 'zh-CN' | 'en-US',
    targetLevel: row.target_level,
    status: row.status as LiveBookRecord['status'],
    proposal: {
      title: row.proposal_title,
      description: row.proposal_description,
      scope: row.proposal_scope,
      targetLevel: row.proposal_target_level,
      estimatedChapters: row.proposal_estimated_chapters,
      rationale: row.proposal_rationale,
    },
    chapters: [],
    pages: [],
    progress: {
      currentPageId: row.progress_current_page_id,
      visitedPageIds: fromJson<string[]>(row.progress_visited_page_ids),
      bookmarkedPageIds: fromJson<string[]>(row.progress_bookmarked_page_ids),
      quizAttempts: fromJson<LiveBookQuizAttempt[]>(row.progress_quiz_attempts),
      weakChapterIds: fromJson<string[]>(row.progress_weak_chapter_ids),
      score: row.progress_score,
      updatedAt: row.progress_updated_at,
    },
    quality: {
      compileTotal: row.quality_compile_total,
      compileFailed: row.quality_compile_failed,
      blockErrors: row.quality_block_errors,
      supplementHits: row.quality_supplement_hits,
    },
    conceptGraphJson: fromJson<Record<string, unknown>>(row.concept_graph_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChapterRow(row: ChapterRow): LiveBookChapter {
  return {
    id: row.id,
    title: row.title,
    goal: row.goal,
    order: row.sort_order,
    difficulty: row.difficulty || 'medium',
    learningObjectives: fromJson<string[]>(row.learning_objectives_json || '[]'),
    contentType: (row.content_type || 'mixed') as LiveBookChapter['contentType'],
    sourceRefs: fromJson<Array<Record<string, unknown>>>(row.source_refs_json || '[]'),
    prerequisites: fromJson<string[]>(row.prerequisites_json || '[]'),
    summary: row.summary || '',
  };
}

function mapPageRow(row: PageRow): LiveBookPage {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    title: row.title,
    order: row.sort_order,
    status: row.status as LiveBookPage['status'],
    blocks: [],
  };
}

function mapBlockRow(row: BlockRow): LiveBookBlock {
  const legacyPayload = fromJson<Record<string, unknown>>(row.payload_json || '{}');
  const legacySourceRefs = fromJson<Array<Record<string, unknown>>>(row.source_refs_json || '[]');
  const paramsJson = fromJson<Record<string, unknown>>(row.params_json || '{}');
  const metadataJson = fromJson<Record<string, unknown>>(row.metadata_json || '{}');
  return {
    id: row.id,
    type: row.type as LiveBookBlock['type'],
    title: row.title,
    content: row.content,
    status: row.status as LiveBookBlock['status'],
    paramsJson: Object.keys(paramsJson).length > 0 ? paramsJson : legacyPayload,
    metadataJson: metadataJson,
    error: row.block_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payloadJson: legacyPayload,
    sourceRefsJson: legacySourceRefs,
  };
}

function mapExplorationRow(row: ExplorationRow): LiveBookExplorationRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id || undefined,
    topic: row.topic,
    report: fromJson<LiveBookExplorationReport>(row.report_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mergeProgressRow(book: LiveBookRecord, row: ProgressRow | null): LiveBookRecord {
  if (!row) return book;
  return {
    ...book,
    progress: {
      ...book.progress,
      currentPageId: row.current_page_id,
      visitedPageIds: fromJson<string[]>(row.visited_pages),
      bookmarkedPageIds: fromJson<string[]>(row.bookmarks),
      weakChapterIds: fromJson<string[]>(row.weak_chapter_ids || row.weak_points),
      score: row.score,
      updatedAt: row.updated_at,
    },
  };
}

function mapJobRow(row: JobRow): LiveBookJobRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    status: row.status as LiveBookJobRecord['status'],
    stage: row.stage as LiveBookJobRecord['stage'],
    progress: row.progress,
    events: [],
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRow(row: EventRow): LiveBookJobEvent {
  return {
    id: row.id,
    type: row.type as LiveBookJobEventType,
    stage: row.stage as LiveBookJobStage,
    message: row.message,
    progress: row.progress,
    timestamp: row.created_at,
    metadata: row.metadata ? fromJson<Record<string, unknown>>(row.metadata) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class LiveBookEngine {
  private jobSubscribers = new Map<string, Set<(event: LiveBookJobEvent) => void>>();

  planSpine(topic: string): LiveBookChapter[] {
    return [
      {
        id: makeId('ch'),
        title: '章节 1：核心概念',
        goal: `建立「${topic}」基本认知`,
        order: 1,
        difficulty: 'easy',
      },
      {
        id: makeId('ch'),
        title: '章节 2：典型例题',
        goal: '掌握基础解题链路',
        order: 2,
        difficulty: 'medium',
      },
      {
        id: makeId('ch'),
        title: '章节 3：易错辨析',
        goal: '识别常见误区并纠正',
        order: 3,
        difficulty: 'medium',
      },
      {
        id: makeId('ch'),
        title: '章节 4：迁移应用',
        goal: '将知识迁移到综合问题',
        order: 4,
        difficulty: 'hard',
      },
    ];
  }

  compilePageBlocks(
    book: LiveBookRecord,
    page: LiveBookPage,
    chapter: LiveBookChapter,
  ): LiveBookBlock[] {
    return liveBookCompiler.compilePage(book, page, chapter).blocks;
  }

  recompileBlock(block: LiveBookBlock): LiveBookBlock {
    const ts = now();
    return {
      ...block,
      content: `${block.content}\n\n[已重新生成 ${new Date().toLocaleTimeString('zh-CN')}]`,
      paramsJson: {
        ...(block.paramsJson || {}),
        regeneratedAt: new Date().toISOString(),
      },
      metadataJson: {
        ...(block.metadataJson || {}),
        regeneratedBy: 'live-book-engine',
      },
      updatedAt: ts,
      payloadJson: {
        ...(block.payloadJson || {}),
        regeneratedAt: new Date().toISOString(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Books
  // -------------------------------------------------------------------------

  async createBook(params: {
    title: string;
    topic: string;
    userId?: string;
    language: 'zh-CN' | 'en-US';
    targetLevel?: string;
    proposal: LiveBookRecord['proposal'];
    chapters: LiveBookChapter[];
    pages: LiveBookPage[];
    progress: LiveBookProgress;
    quality: LiveBookQuality;
    conceptGraphJson?: Record<string, unknown>;
  }): Promise<LiveBookRecord> {
    const bookId = makeId('book');
    const ts = now();

    await withLiveBookDatabase((db) => {
      runSql(
        db,
        `INSERT INTO live_books (
          id, title, topic, user_id, language, target_level, status,
          proposal_title, proposal_description, proposal_scope, proposal_target_level, proposal_estimated_chapters, proposal_rationale,
          progress_current_page_id, progress_visited_page_ids, progress_bookmarked_page_ids, progress_quiz_attempts, progress_weak_chapter_ids, progress_score, progress_updated_at,
          quality_compile_total, quality_compile_failed, quality_block_errors, quality_supplement_hits,
          concept_graph_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookId,
          params.title,
          params.topic,
          params.userId || 'local-user',
          params.language,
          params.targetLevel || '通用',
          'draft',
          params.proposal.title,
          params.proposal.description,
          params.proposal.scope,
          params.proposal.targetLevel,
          params.proposal.estimatedChapters,
          params.proposal.rationale,
          params.progress.currentPageId,
          toJson(params.progress.visitedPageIds),
          toJson(params.progress.bookmarkedPageIds),
          toJson(params.progress.quizAttempts),
          toJson(params.progress.weakChapterIds),
          params.progress.score,
          params.progress.updatedAt,
          params.quality.compileTotal,
          params.quality.compileFailed,
          params.quality.blockErrors,
          params.quality.supplementHits,
          toJson(params.conceptGraphJson || {}),
          ts,
          ts,
        ],
      );

      for (const chapter of params.chapters) {
        runSql(
          db,
          `INSERT INTO live_book_chapters (
            id, book_id, title, goal, learning_objectives_json, content_type,
            source_refs_json, prerequisites_json, summary, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chapter.id,
            bookId,
            chapter.title,
            chapter.goal,
            toJson(chapter.learningObjectives || []),
            chapter.contentType || 'mixed',
            toJson(chapter.sourceRefs || []),
            toJson(chapter.prerequisites || []),
            chapter.summary || '',
            chapter.order,
            ts,
            ts,
          ],
        );
        runSql(
          db,
          `INSERT INTO live_book_spines (
            id, book_id, chapter_id, sort_order, title, goal, difficulty,
            learning_objectives_json, content_type, source_refs_json, prerequisites_json, summary,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            chapter.id,
            bookId,
            chapter.id,
            chapter.order,
            chapter.title,
            chapter.goal,
            chapter.difficulty || 'medium',
            toJson(chapter.learningObjectives || []),
            chapter.contentType || 'mixed',
            toJson(chapter.sourceRefs || []),
            toJson(chapter.prerequisites || []),
            chapter.summary || '',
            ts,
            ts,
          ],
        );
      }

      for (const page of params.pages) {
        runSql(
          db,
          `INSERT INTO live_book_pages (id, page_id, book_id, chapter_id, title, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [page.id, page.id, bookId, page.chapterId, page.title, page.order, page.status, ts, ts],
        );

        for (let i = 0; i < page.blocks.length; i++) {
          const block = page.blocks[i];
          const normalizedBlock = normalizeLiveBookBlockStorage({
            paramsJson: block.paramsJson,
            metadataJson: block.metadataJson,
            payloadJson: block.payloadJson || { text: block.content },
            sourceRefsJson: block.sourceRefsJson || [],
            error: block.error,
          });
          runSql(
            db,
            `INSERT INTO live_book_blocks (
              id, block_id, book_id, page_id, type, title, content, status,
              payload_json, source_refs_json, params_json, metadata_json, block_error,
              sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              block.id,
              block.id,
              bookId,
              page.id,
              block.type,
              block.title,
              block.content,
              block.status,
              toJson(normalizedBlock.payloadJson),
              toJson(normalizedBlock.sourceRefsJson),
              toJson(normalizedBlock.paramsJson),
              toJson(normalizedBlock.metadataJson),
              normalizedBlock.error || null,
              i,
              block.createdAt || ts,
              block.updatedAt || ts,
            ],
          );
        }
      }

      runSql(
        db,
        `INSERT INTO live_book_progress (book_id, current_page_id, visited_pages, bookmarks, weak_points, weak_chapter_ids, score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookId,
          params.progress.currentPageId,
          toJson(params.progress.visitedPageIds),
          toJson(params.progress.bookmarkedPageIds),
          toJson(params.progress.weakChapterIds),
          toJson(params.progress.weakChapterIds),
          params.progress.score,
          params.progress.updatedAt,
        ],
      );
    });

    const book = await this.getBook(bookId);
    if (!book) throw new Error('Failed to create live-book');
    return book;
  }

  async listBooks(): Promise<Array<{ id: string; title: string; topic: string; status: LiveBookRecord['status']; chapterCount: number; pageCount: number; updatedAt: number }>> {
    return withLiveBookDatabase((db) => {
      const books = queryRows<BookRow>(db, `SELECT * FROM live_books ORDER BY updated_at DESC`);
      return books.map((row) => {
        const chapterCount = queryRows<ChapterRow>(db, `SELECT id FROM live_book_chapters WHERE book_id = ?`, [row.id]).length;
        const pageCount = queryRows<PageRow>(db, `SELECT id FROM live_book_pages WHERE book_id = ?`, [row.id]).length;
        return {
          id: row.id,
          title: row.title,
          topic: row.topic,
          status: row.status as LiveBookRecord['status'],
          chapterCount,
          pageCount,
          updatedAt: row.updated_at,
        };
      });
    });
  }

  async getBook(bookId: string): Promise<LiveBookRecord | null> {
    return withLiveBookDatabase((db) => {
      const row = queryOne<BookRow>(db, `SELECT * FROM live_books WHERE id = ?`, [bookId]);
      if (!row) return null;

      let book = mapBookRow(row);
      const spineRows = queryRows<ChapterRow>(
        db,
        `SELECT
          chapter_id AS id,
          book_id,
          title,
          goal,
          learning_objectives_json,
          content_type,
          source_refs_json,
          prerequisites_json,
          summary,
          sort_order,
          difficulty,
          created_at,
          updated_at
        FROM live_book_spines
        WHERE book_id = ?
        ORDER BY sort_order`,
        [bookId],
      );
      book.chapters = (spineRows.length > 0
        ? spineRows
        : queryRows<ChapterRow>(db, `SELECT * FROM live_book_chapters WHERE book_id = ? ORDER BY sort_order`, [bookId])
      ).map(mapChapterRow);
      book.pages = queryRows<PageRow>(db, `SELECT * FROM live_book_pages WHERE book_id = ? ORDER BY sort_order`, [bookId]).map(mapPageRow);

      for (const page of book.pages) {
        page.blocks = queryRows<BlockRow>(db, `SELECT * FROM live_book_blocks WHERE page_id = ? ORDER BY sort_order`, [page.id]).map(mapBlockRow);
      }

      book = mergeProgressRow(
        book,
        queryOne<ProgressRow>(db, `SELECT * FROM live_book_progress WHERE book_id = ?`, [bookId]),
      );
      const attempts = queryRows<QuizAttemptRow>(
        db,
        `SELECT * FROM live_book_quiz_attempts WHERE book_id = ? ORDER BY created_at`,
        [bookId],
      ).map((attempt) => ({
        pageId: attempt.page_id,
        blockId: attempt.block_id,
        questionId: attempt.question_id,
        userAnswer: attempt.user_answer,
        isCorrect: Boolean(attempt.is_correct),
        timestamp: attempt.created_at,
      }));
      if (attempts.length > 0) {
        book.progress.quizAttempts = attempts;
      }

      return book;
    });
  }

  async updateBook(bookId: string, updater: (book: LiveBookRecord) => LiveBookRecord): Promise<LiveBookRecord | null> {
    const book = await this.getBook(bookId);
    if (!book) return null;
    const next = updater(book);
    await this.saveBook(next);
    return next;
  }

  async saveBook(book: LiveBookRecord): Promise<void> {
    const ts = now();
    await withLiveBookDatabase((db) => {
      runSql(
        db,
        `UPDATE live_books SET
          title = ?, topic = ?, user_id = ?, language = ?, target_level = ?, status = ?,
          proposal_title = ?, proposal_description = ?, proposal_scope = ?, proposal_target_level = ?, proposal_estimated_chapters = ?, proposal_rationale = ?,
          progress_current_page_id = ?, progress_visited_page_ids = ?, progress_bookmarked_page_ids = ?, progress_quiz_attempts = ?, progress_weak_chapter_ids = ?, progress_score = ?, progress_updated_at = ?,
          quality_compile_total = ?, quality_compile_failed = ?, quality_block_errors = ?, quality_supplement_hits = ?,
          concept_graph_json = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          book.title, book.topic, book.userId || 'local-user', book.language, book.targetLevel, book.status,
          book.proposal.title, book.proposal.description, book.proposal.scope, book.proposal.targetLevel, book.proposal.estimatedChapters, book.proposal.rationale,
          book.progress.currentPageId, toJson(book.progress.visitedPageIds), toJson(book.progress.bookmarkedPageIds), toJson(book.progress.quizAttempts), toJson(book.progress.weakChapterIds), book.progress.score, book.progress.updatedAt,
          book.quality.compileTotal, book.quality.compileFailed, book.quality.blockErrors, book.quality.supplementHits,
          toJson(book.conceptGraphJson || {}),
          ts, book.id,
        ],
      );

      // Sync chapters
      const existingChapters = queryRows<ChapterRow>(db, `SELECT id FROM live_book_chapters WHERE book_id = ?`, [book.id]);
      const chapterIds = new Set(book.chapters.map((c) => c.id));
      for (const existing of existingChapters) {
        if (!chapterIds.has(existing.id)) {
          runSql(db, `DELETE FROM live_book_spines WHERE chapter_id = ?`, [existing.id]);
          runSql(db, `DELETE FROM live_book_chapters WHERE id = ?`, [existing.id]);
        }
      }
      for (const chapter of book.chapters) {
        runSql(
          db,
          `INSERT OR REPLACE INTO live_book_chapters (
            id, book_id, title, goal, learning_objectives_json, content_type,
            source_refs_json, prerequisites_json, summary,
            sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM live_book_chapters WHERE id = ?), ?), ?)`,
          [
            chapter.id,
            book.id,
            chapter.title,
            chapter.goal,
            toJson(chapter.learningObjectives || []),
            chapter.contentType || 'mixed',
            toJson(chapter.sourceRefs || []),
            toJson(chapter.prerequisites || []),
            chapter.summary || '',
            chapter.order,
            chapter.id,
            ts,
            ts,
          ],
        );
        runSql(
          db,
          `INSERT OR REPLACE INTO live_book_spines (
            id, book_id, chapter_id, sort_order, title, goal, difficulty,
            learning_objectives_json, content_type, source_refs_json, prerequisites_json, summary,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM live_book_spines WHERE id = ?), ?), ?)`,
          [
            chapter.id,
            book.id,
            chapter.id,
            chapter.order,
            chapter.title,
            chapter.goal,
            chapter.difficulty || 'medium',
            toJson(chapter.learningObjectives || []),
            chapter.contentType || 'mixed',
            toJson(chapter.sourceRefs || []),
            toJson(chapter.prerequisites || []),
            chapter.summary || '',
            chapter.id,
            ts,
            ts,
          ],
        );
      }

      // Sync pages and blocks
      const existingPages = queryRows<PageRow>(db, `SELECT id FROM live_book_pages WHERE book_id = ?`, [book.id]);
      const pageIds = new Set(book.pages.map((p) => p.id));
      for (const existing of existingPages) {
        if (!pageIds.has(existing.id)) {
          runSql(db, `DELETE FROM live_book_blocks WHERE page_id = ?`, [existing.id]);
          runSql(db, `DELETE FROM live_book_pages WHERE id = ?`, [existing.id]);
        }
      }
      for (const page of book.pages) {
        runSql(
          db,
          `INSERT OR REPLACE INTO live_book_pages (id, page_id, book_id, chapter_id, title, sort_order, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM live_book_pages WHERE id = ?), ?), ?)`,
          [page.id, page.id, book.id, page.chapterId, page.title, page.order, page.status, page.id, ts, ts],
        );

        const existingBlocks = queryRows<BlockRow>(db, `SELECT id FROM live_book_blocks WHERE page_id = ?`, [page.id]);
        const blockIds = new Set(page.blocks.map((b) => b.id));
        for (const existing of existingBlocks) {
          if (!blockIds.has(existing.id)) {
            runSql(db, `DELETE FROM live_book_blocks WHERE id = ?`, [existing.id]);
          }
        }
        for (let i = 0; i < page.blocks.length; i++) {
          const block = page.blocks[i];
          const normalizedBlock = normalizeLiveBookBlockStorage({
            paramsJson: block.paramsJson,
            metadataJson: block.metadataJson,
            payloadJson: block.payloadJson || { text: block.content },
            sourceRefsJson: block.sourceRefsJson || [],
            error: block.error,
          });
          runSql(
            db,
            `INSERT OR REPLACE INTO live_book_blocks (
              id, block_id, book_id, page_id, type, title, content, status,
              payload_json, source_refs_json, params_json, metadata_json, block_error,
              sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM live_book_blocks WHERE id = ?), ?), ?)`,
            [
              block.id,
              block.id,
              book.id,
              page.id,
              block.type,
              block.title,
              block.content,
              block.status,
              toJson(normalizedBlock.payloadJson),
              toJson(normalizedBlock.sourceRefsJson),
              toJson(normalizedBlock.paramsJson),
              toJson(normalizedBlock.metadataJson),
              normalizedBlock.error || null,
              i,
              block.id,
              block.createdAt || ts,
              block.updatedAt || ts,
            ],
          );
        }
      }

      runSql(
        db,
        `INSERT OR REPLACE INTO live_book_progress (book_id, current_page_id, visited_pages, bookmarks, weak_points, weak_chapter_ids, score, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          book.id,
          book.progress.currentPageId,
          toJson(book.progress.visitedPageIds),
          toJson(book.progress.bookmarkedPageIds),
          toJson(book.progress.weakChapterIds),
          toJson(book.progress.weakChapterIds),
          book.progress.score,
          book.progress.updatedAt,
        ],
      );
    });
  }

  // -------------------------------------------------------------------------
  // Jobs & Events
  // -------------------------------------------------------------------------

  async createJob(bookId: string): Promise<LiveBookJobRecord> {
    const jobId = makeId('job');
    const ts = now();

    await withLiveBookDatabase((db) => {
      runSql(
        db,
        `INSERT INTO live_book_jobs (id, book_id, status, stage, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [jobId, bookId, 'queued', 'queued', 0, ts, ts],
      );
    });

    return {
      id: jobId,
      bookId,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      events: [],
      createdAt: ts,
      updatedAt: ts,
    };
  }

  async getJob(jobId: string): Promise<LiveBookJobRecord | null> {
    return withLiveBookDatabase((db) => {
      const row = queryOne<JobRow>(db, `SELECT * FROM live_book_jobs WHERE id = ?`, [jobId]);
      if (!row) return null;
      const job = mapJobRow(row);
      job.events = queryRows<EventRow>(db, `SELECT * FROM live_book_job_events WHERE job_id = ? ORDER BY created_at`, [jobId]).map(mapEventRow);
      return job;
    });
  }

  async listJobs(bookId?: string): Promise<LiveBookJobRecord[]> {
    return withLiveBookDatabase((db) => {
      const rows = bookId
        ? queryRows<JobRow>(db, `SELECT * FROM live_book_jobs WHERE book_id = ? ORDER BY created_at DESC`, [bookId])
        : queryRows<JobRow>(db, `SELECT * FROM live_book_jobs ORDER BY created_at DESC`);
      return rows.map(mapJobRow);
    });
  }

  async updateJob(jobId: string, updater: (job: LiveBookJobRecord) => LiveBookJobRecord): Promise<LiveBookJobRecord | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;
    const next = updater(job);
    await withLiveBookDatabase((db) => {
      runSql(
        db,
        `UPDATE live_book_jobs SET status = ?, stage = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?`,
        [next.status, next.stage, next.progress, next.error ?? null, now(), jobId],
      );
    });
    return next;
  }

  async appendJobEvent(
    jobId: string,
    event: Omit<LiveBookJobEvent, 'id' | 'timestamp'>,
  ): Promise<void> {
    const eventId = makeId('evt');
    const ts = now();

    await withLiveBookDatabase((db) => {
      runSql(
        db,
        `INSERT INTO live_book_job_events (id, job_id, type, stage, message, progress, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, jobId, event.type, event.stage, event.message, event.progress, event.metadata ? toJson(event.metadata) : null, ts],
      );
    });

    this.publishJobEvent(jobId, { ...event, id: eventId, timestamp: ts });
  }

  subscribeJob(jobId: string, listener: (event: LiveBookJobEvent) => void): () => void {
    const set = this.jobSubscribers.get(jobId) || new Set<(event: LiveBookJobEvent) => void>();
    set.add(listener);
    this.jobSubscribers.set(jobId, set);
    return () => {
      const current = this.jobSubscribers.get(jobId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.jobSubscribers.delete(jobId);
    };
  }

  private publishJobEvent(jobId: string, event: LiveBookJobEvent): void {
    const listeners = this.jobSubscribers.get(jobId);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Quiz attempts
  // -------------------------------------------------------------------------

  async addQuizAttempt(bookId: string, attempt: LiveBookQuizAttempt): Promise<void> {
    const id = makeId('qa');
    await withLiveBookDatabase((db) => {
      runSql(
        db,
        `INSERT INTO live_book_quiz_attempts (id, book_id, page_id, block_id, question_id, user_answer, is_correct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, bookId, attempt.pageId, attempt.blockId, attempt.questionId, attempt.userAnswer, attempt.isCorrect ? 1 : 0, attempt.timestamp],
      );
    });
  }

  async getQuizAttempts(bookId: string): Promise<LiveBookQuizAttempt[]> {
    return withLiveBookDatabase((db) => {
      const rows = queryRows<QuizAttemptRow>(db, `SELECT * FROM live_book_quiz_attempts WHERE book_id = ? ORDER BY created_at`, [bookId]);
      return rows.map((row) => ({
        pageId: row.page_id,
        blockId: row.block_id,
        questionId: row.question_id,
        userAnswer: row.user_answer,
        isCorrect: Boolean(row.is_correct),
        timestamp: row.created_at,
      }));
    });
  }

  // -------------------------------------------------------------------------
  // Explorations
  // -------------------------------------------------------------------------

  async listExplorations(bookId: string, chapterId?: string): Promise<LiveBookExplorationRecord[]> {
    return withLiveBookDatabase((db) => {
      const rows = chapterId
        ? queryRows<ExplorationRow>(
            db,
            `SELECT * FROM live_book_explorations WHERE book_id = ? AND chapter_id = ? ORDER BY updated_at DESC`,
            [bookId, chapterId],
          )
        : queryRows<ExplorationRow>(
            db,
            `SELECT * FROM live_book_explorations WHERE book_id = ? ORDER BY updated_at DESC`,
            [bookId],
          );
      return rows.map(mapExplorationRow);
    });
  }

  async saveExploration(params: {
    bookId: string;
    topic: string;
    report: LiveBookExplorationReport;
    chapterId?: string;
    id?: string;
  }): Promise<LiveBookExplorationRecord> {
    const ts = now();
    const explorationId = params.id || makeId('exp');

    await withLiveBookDatabase((db) => {
      runSql(
        db,
        `INSERT OR REPLACE INTO live_book_explorations (
          id, book_id, chapter_id, topic, report_json,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          COALESCE((SELECT created_at FROM live_book_explorations WHERE id = ?), ?), ?
        )`,
        [
          explorationId,
          params.bookId,
          params.chapterId || null,
          params.topic,
          toJson(params.report),
          explorationId,
          ts,
          ts,
        ],
      );
    });

    return {
      id: explorationId,
      bookId: params.bookId,
      chapterId: params.chapterId,
      topic: params.topic,
      report: params.report,
      createdAt: ts,
      updatedAt: ts,
    };
  }
}

// Singleton instance
export const liveBookEngine = new LiveBookEngine();
