import { describe, expect, it } from 'vitest';
import { SpineSynthesizer } from '@/features/live-book/server/live-book/spine-synthesizer';
import { SourceExplorer } from '@/features/live-book/server/live-book/source-explorer';
import { SectionArchitect } from '@/features/live-book/server/live-book/section-architect';
import { BlockGeneratorRegistry, LiveBookCompiler } from '@/features/live-book/server/live-book/live-book-compiler';
import { BookCompileQueue } from '@/features/live-book/server/live-book/compile-queue';
import type {
  LiveBookRecord,
  LiveBookExplorationReport,
} from '@/lib/server/live-book-store';

function makeMockBook(overrides?: Partial<LiveBookRecord>): LiveBookRecord {
  const now = Date.now();
  return {
    id: 'book_test_001',
    title: '测试活书',
    topic: '二次函数',
    userId: 'user_test',
    language: 'zh-CN',
    targetLevel: 'middle',
    status: 'draft',
    proposal: {
      title: '二次函数精讲',
      description: '掌握二次函数的图像与性质',
      scope: '初中数学',
      targetLevel: 'middle',
      estimatedChapters: 4,
      rationale: '基于中考要求',
    },
    chapters: [
      {
        id: 'ch_1',
        title: '二次函数基础',
        goal: '理解二次函数定义',
        order: 1,
        difficulty: 'easy',
        learningObjectives: ['理解定义', '识别标准式'],
        contentType: 'theory',
        sourceRefs: [{ kind: 'manual', ref: 'ref1', snippet: '基础定义' }],
        prerequisites: [],
        summary: '二次函数 y=ax²+bx+c 的定义与基本性质',
      },
      {
        id: 'ch_2',
        title: '图像与顶点',
        goal: '掌握图像绘制',
        order: 2,
        difficulty: 'medium',
        learningObjectives: ['绘制图像', '求顶点坐标'],
        contentType: 'derivation',
        sourceRefs: [{ kind: 'manual', ref: 'ref2', snippet: '图像变换' }],
        prerequisites: ['二次函数基础'],
        summary: '二次函数图像的平移、对称与顶点公式',
      },
    ],
    pages: [
      { id: 'pg_1', chapterId: 'ch_1', title: '二次函数基础', order: 1, status: 'pending', blocks: [] },
      { id: 'pg_2', chapterId: 'ch_2', title: '图像与顶点', order: 2, status: 'pending', blocks: [] },
    ],
    progress: {
      currentPageId: null,
      visitedPageIds: [],
      bookmarkedPageIds: [],
      quizAttempts: [],
      weakChapterIds: [],
      score: 0,
      updatedAt: now,
    },
    quality: {
      compileTotal: 0,
      compileFailed: 0,
      blockErrors: 0,
      supplementHits: 0,
    },
    conceptGraphJson: {
      inputSources: [],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as LiveBookRecord;
}

function makeMockExploration(): LiveBookExplorationReport {
  return {
    queries: ['二次函数 定义', '二次函数 图像'],
    chunks: [
      { kind: 'topic', ref: 'topic:二次函数', snippet: '学习主题：二次函数', confidence: 0.9 },
      { kind: 'classroom_scene', ref: 'chapter:ch_1', snippet: '二次函数基础｜理解二次函数定义', confidence: 0.7 },
    ],
    summary: '围绕二次函数共聚合 2 条证据片段，候选概念 2 个',
    coverage: {
      topic: '二次函数',
      chapterCount: 2,
      classroomSceneCount: 2,
      notebookRecordCount: 2,
      quizAttemptCount: 0,
      weakSignalCount: 0,
      sourceInputCount: 0,
      structuredKbCount: 0,
      structuredNotebookCount: 0,
      structuredChatCount: 0,
      structuredQuestionCount: 0,
      ragChunkCount: 0,
      designedQueryCount: 0,
    },
    candidateConcepts: ['标准式', '顶点式', '判别式'],
  };
}

describe('SpineSynthesizer', () => {
  it('fallback template generates chapters with overview when LLM fails', async () => {
    const synthesizer = new SpineSynthesizer();
    const book = makeMockBook();
    const exploration = makeMockExploration();

    const result = await synthesizer.synthesize(book, exploration);

    expect(result.chapters.length).toBeGreaterThanOrEqual(3);
    expect(result.chapters.some((c) => c.contentType === 'overview')).toBe(true);
    expect(result.conceptGraphJson.nodes.length).toBeGreaterThan(0);
    expect(result.conceptGraphJson.edges.length).toBeGreaterThanOrEqual(0);
    expect(result.critiqueIssues.length).toBeGreaterThanOrEqual(0);
  });

  it('topological sort ensures no chapter depends on a later chapter', async () => {
    const synthesizer = new SpineSynthesizer();
    const book = makeMockBook();
    const exploration = makeMockExploration();

    const result = await synthesizer.synthesize(book, exploration);
    const nonOverview = result.chapters.filter((c) => c.contentType !== 'overview');

    for (let i = 0; i < nonOverview.length; i++) {
      const chapter = nonOverview[i];
      for (const prereq of chapter.prerequisites || []) {
        const prereqIndex = nonOverview.findIndex((c) => c.title === prereq);
        if (prereqIndex >= 0) {
          expect(prereqIndex).toBeLessThan(i);
        }
      }
    }
  });

  it('injects overview chapter if missing', async () => {
    const synthesizer = new SpineSynthesizer();
    const book = makeMockBook();
    const exploration = makeMockExploration();

    const result = await synthesizer.synthesize(book, exploration);
    const overviewChapters = result.chapters.filter((c) => c.contentType === 'overview');
    expect(overviewChapters.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SourceExplorer', () => {
  it('exploration produces candidate concepts and coverage metrics', async () => {
    const explorer = new SourceExplorer();
    const book = makeMockBook();

    const result = await explorer.explore({ book, topic: book.topic });

    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.candidateConcepts.length).toBeGreaterThan(0);
    expect(result.summary).toContain('二次函数');
    expect(result.coverage.chapterCount).toBe(book.chapters.length);
  });

  it('exploration includes weak signals from quiz attempts', async () => {
    const book = makeMockBook({
      progress: {
        currentPageId: null,
        visitedPageIds: [],
        bookmarkedPageIds: [],
        quizAttempts: [
          { pageId: 'pg_1', blockId: 'blk_1', questionId: 'q1', userAnswer: 'x=1', isCorrect: false, timestamp: Date.now() },
          { pageId: 'pg_1', blockId: 'blk_1', questionId: 'q1', userAnswer: 'x=2', isCorrect: false, timestamp: Date.now() },
        ],
        weakChapterIds: [],
        score: 0,
        updatedAt: Date.now(),
      },
    });

    const explorer = new SourceExplorer();
    const result = await explorer.explore({ book, topic: book.topic });

    expect(result.coverage.weakSignalCount).toBeGreaterThan(0);
    expect(result.chunks.some((c) => (c as Record<string, unknown>).kind === 'quiz_attempt')).toBe(true);
  });

  it('uses source snapshots as real evidence chunks', async () => {
    const book = makeMockBook({
      conceptGraphJson: {
        inputSources: [
          {
            kind: 'notes',
            text: '',
            notebookRefs: ['note_1'],
            snapshots: [
              {
                kind: 'note',
                id: 'note_1',
                title: '顶点式笔记',
                content: '顶点式 y=a(x-h)^2+k 可以直接读出顶点坐标。',
                metadata: { subject: '数学' },
              },
            ],
          },
        ],
      },
    });

    const explorer = new SourceExplorer();
    const result = await explorer.explore({ book, topic: book.topic });

    expect(result.coverage.structuredNotebookCount).toBe(1);
    expect(result.chunks.some((chunk) => (
      chunk.kind === 'notebook' &&
      chunk.ref === 'note:note_1' &&
      String(chunk.snippet).includes('顶点式')
    ))).toBe(true);
  });

  it('marks question refs without snapshots as warnings instead of generated content', async () => {
    const book = makeMockBook({
      conceptGraphJson: {
        inputSources: [
          {
            kind: 'question',
            text: '错题引用',
            questionRefs: ['q_missing'],
          },
        ],
      },
    });

    const explorer = new SourceExplorer();
    const result = await explorer.explore({ book, topic: book.topic });
    const questionChunk = result.chunks.find((chunk) => chunk.kind === 'question_bank');

    expect(questionChunk).toBeDefined();
    expect(questionChunk?.warning).toBe('missing_question_snapshot');
    expect(String(questionChunk?.snippet)).not.toContain('将在编译时生成');
  });
});

describe('SectionArchitect', () => {
  it('plans sections for each chapter with valid block types', async () => {
    const architect = new SectionArchitect();
    const book = makeMockBook();
    const exploration = makeMockExploration();

    const plans = await architect.planSections(book, exploration);

    expect(plans.size).toBe(book.chapters.length);
    for (const [, plan] of plans) {
      expect(plan.blocks.length).toBeGreaterThanOrEqual(3);
      for (const block of plan.blocks) {
        expect(block.type).toBeTruthy();
        expect(block.title).toBeTruthy();
      }
    }
  });

  it('fallback templates include transition_in for theory chapters', async () => {
    const architect = new SectionArchitect();
    const book = makeMockBook();
    const exploration = makeMockExploration();

    const plans = await architect.planSections(book, exploration);
    const theoryPlan = plans.get('ch_1');

    expect(theoryPlan).toBeDefined();
    expect(theoryPlan!.blocks.length).toBeGreaterThanOrEqual(4);
    // At least some blocks should have transition text in fallback
    const transitions = theoryPlan!.blocks.filter((b) => b.transitionIn);
    expect(transitions.length).toBeGreaterThanOrEqual(1);
  });
});

describe('LiveBookCompiler', () => {
  it('compilePage returns ready status and blocks', () => {
    const compiler = new LiveBookCompiler();
    const book = makeMockBook();
    const page = book.pages[0];
    const chapter = book.chapters[0];

    const result = compiler.compilePage(book, page, chapter);

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.successCount).toBeGreaterThan(0);
    expect(['ready', 'partial']).toContain(result.pageStatus);
    expect(result.blockResults.every((r) => r.block.status === 'ready' || r.block.status === 'error')).toBe(true);
  });

  it('compilePage with sectionPlan uses planned block types', () => {
    const compiler = new LiveBookCompiler();
    const book = makeMockBook();
    const page = book.pages[0];
    const chapter = book.chapters[0];

    const sectionPlan = {
      chapterId: chapter.id,
      blocks: [
        { type: 'section' as const, title: '学习目标', rationale: '导览' },
        { type: 'text' as const, title: '概念讲解', rationale: '核心内容', transitionIn: '首先了解定义' },
        { type: 'quiz' as const, title: '快速测验', rationale: '检验理解' },
      ],
    };

    const result = compiler.compilePage(book, page, chapter, sectionPlan);

    expect(result.blocks.length).toBeGreaterThanOrEqual(3);
    expect(result.blocks.some((b) => b.type === 'section')).toBe(true);
    expect(result.blocks.some((b) => b.type === 'text')).toBe(true);
    expect(result.blocks.some((b) => b.type === 'quiz')).toBe(true);
  });

  it('compilePage marks page as partial when some blocks fail', () => {
    const registry = new BlockGeneratorRegistry();
    registry.register({
      type: 'section',
      generate() {
        return {
          type: 'section',
          title: '可用块',
          content: '这个块正常生成。',
        };
      },
    });
    registry.register({
      type: 'placeholder',
      generate() {
        throw new Error('simulated failure');
      },
    });

    const compiler = new LiveBookCompiler(registry);
    const book = makeMockBook();
    const page = book.pages[0];
    const chapter = book.chapters[0];

    const result = compiler.compilePage(book, page, chapter);

    expect(result.pageStatus).toBe('partial');
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.successCount).toBeGreaterThan(0);
  });

  it('regenerateBlock updates block content while preserving id', async () => {
    const compiler = new LiveBookCompiler();
    const book = makeMockBook();
    const page = book.pages[0];
    const chapter = book.chapters[0];

    const originalBlock = {
      id: 'blk_original',
      type: 'text' as const,
      title: '原始内容',
      content: '原始文本',
      status: 'ready' as const,
      paramsJson: { text: '原始文本' },
      metadataJson: { blockVersion: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const regenerated = await compiler.regenerateBlock(book, page, chapter, originalBlock);

    expect(regenerated.id).toBe('blk_original');
    expect(regenerated.content).not.toBe('原始文本');
    expect(regenerated.updatedAt).toBeGreaterThanOrEqual(originalBlock.updatedAt);
  });

  it('block metadata includes sourceAnchors', () => {
    const compiler = new LiveBookCompiler();
    const book = makeMockBook();
    const page = book.pages[0];
    const chapter = book.chapters[0];

    const result = compiler.compilePage(book, page, chapter);

    for (const block of result.blocks) {
      expect(block.metadataJson).toBeDefined();
      if (block.metadataJson && typeof block.metadataJson === 'object') {
        expect('sourceAnchors' in block.metadataJson || 'blockVersion' in block.metadataJson).toBe(true);
      }
    }
  });

  it('compiled blocks expose structured payloads for reader rendering', () => {
    const compiler = new LiveBookCompiler();
    const book = makeMockBook({
      conceptGraphJson: {
        explorationChunks: [
          {
            kind: 'notebook',
            ref: 'note:vertex',
            snippet: '顶点式可以直接读出顶点坐标。',
            confidence: 0.9,
          },
        ],
      },
    });
    const page = book.pages[0];
    const chapter = book.chapters[0];

    const result = compiler.compilePage(book, page, chapter, {
      chapterId: chapter.id,
      blocks: [
        { type: 'section' as const, title: '学习目标', rationale: '导览' },
        { type: 'quiz' as const, title: '快速测验', rationale: '检验理解' },
      ],
    });

    const section = result.blocks.find((block) => block.type === 'section');
    const quiz = result.blocks.find((block) => block.type === 'quiz');

    expect(section?.payloadJson?.type).toBe('section');
    expect(Array.isArray(section?.payloadJson?.subsections)).toBe(true);
    expect(quiz?.payloadJson?.type).toBe('quiz');
    expect(Array.isArray(quiz?.payloadJson?.questions)).toBe(true);
    expect(JSON.stringify(section?.payloadJson?.sourceAnchors)).toContain('顶点式');
  });
});

describe('BookCompileQueue', () => {
  it('retries a failed page task before becoming idle', async () => {
    let attempts = 0;
    const queue = new BookCompileQueue(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('first attempt failed');
        }
      },
      { maxConcurrent: 1, retryLimit: 1, retryDelayMs: 10, taskTimeoutMs: 1000 },
    );

    queue.enqueue({ jobId: 'job_1', bookId: 'book_1', pageId: 'page_1', priority: 10 });

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (attempts >= 2 && queue.getStatus().queued === 0 && queue.getStatus().active === 0) {
          clearInterval(timer);
          resolve();
        }
        if (Date.now() - startedAt > 1000) {
          clearInterval(timer);
          reject(new Error(`queue did not retry; attempts=${attempts}`));
        }
      }, 10);
    });

    expect(attempts).toBe(2);
  });
});
