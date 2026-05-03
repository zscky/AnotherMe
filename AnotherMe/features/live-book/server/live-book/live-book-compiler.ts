import type {
  LiveBookBlock,
  LiveBookBlockType,
  LiveBookChapter,
  LiveBookPage,
  LiveBookRecord,
} from '@/lib/server/live-book-store';
import type { SectionPlan, BlockPlan } from './section-architect';
import { generateLLMBridgeText } from './bridge-text-generator';
import { selectEvidenceAnchors } from './source-registry';
import { createLogger } from '@/lib/logger';

export type CompilerPageStatus = 'ready' | 'partial' | 'error';

export interface BlockGeneratorInput {
  book: LiveBookRecord;
  page: LiveBookPage;
  chapter: LiveBookChapter;
  sourceRefs: Array<Record<string, unknown>>;
  explorationChunks?: Array<Record<string, unknown>>;
  transitionIn?: string;
  previousBlock?: LiveBookBlock;
  bridgeText?: string;
}

export interface BlockGeneratorOutput {
  type: LiveBookBlockType;
  title: string;
  content: string;
  payloadJson?: Record<string, unknown>;
  paramsJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}

export interface AsyncBlockGeneratorOutput {
  type: LiveBookBlockType;
  title: string;
  contentStream: AsyncIterable<string>;
  payloadJson?: Record<string, unknown>;
  paramsJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}

export interface BlockGenerator {
  type: LiveBookBlockType;
  generate(input: BlockGeneratorInput): BlockGeneratorOutput | BlockGeneratorOutput[];
  generateAsync?(input: BlockGeneratorInput): Promise<AsyncBlockGeneratorOutput>;
  supportsStreaming?: boolean;
}

export interface CompiledBlockResult {
  block: LiveBookBlock;
  ok: boolean;
  error?: string;
}

export interface CompilePageResult {
  blocks: LiveBookBlock[];
  blockResults: CompiledBlockResult[];
  pageStatus: CompilerPageStatus;
  successCount: number;
  errorCount: number;
  bridgeTexts?: Record<string, string>;
}

export interface BlockCompileEvent {
  type: 'block_start' | 'block_progress' | 'block_complete' | 'block_error' | 'bridge_text';
  blockType: LiveBookBlockType;
  blockIndex: number;
  totalBlocks: number;
  block?: LiveBookBlock;
  content?: string;
  progress?: number;
  error?: string;
  bridgeText?: string;
}

export type BlockEventListener = (event: BlockCompileEvent) => void | Promise<void>;

const log = createLogger('LiveBookCompiler');

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function asArray<T>(input: T | T[]): T[] {
  return Array.isArray(input) ? input : [input];
}

function normalizeSourceRefs(input: BlockGeneratorInput): Array<Record<string, unknown>> {
  const conceptGraph = input.book.conceptGraphJson || {};
  const conceptNodes = Array.isArray((conceptGraph as { nodes?: unknown[] }).nodes)
    ? (conceptGraph as { nodes: unknown[] }).nodes.length || 0
    : 0;

  const chapterSourceRefs = input.chapter.sourceRefs || [];

  const explorationAnchors = selectEvidenceAnchors({
    topic: input.book.topic,
    chapterTitle: input.chapter.title,
    pageTitle: input.page.title,
    chunks: input.explorationChunks,
    limit: 5,
  }).map((anchor) => ({ ...anchor })) as Array<Record<string, unknown>>;

  return [
    {
      kind: 'live_book_spine',
      bookId: input.book.id,
      chapterId: input.chapter.id,
      pageId: input.page.id,
      conceptNodes,
    },
    ...(chapterSourceRefs as Array<Record<string, unknown>>),
    ...explorationAnchors,
  ];
}

function renderSourceEvidence(sourceRefs: Array<Record<string, unknown>>, limit = 3): string {
  const snippets = sourceRefs
    .filter((item) => item.kind !== 'live_book_spine')
    .map((item) => String(item.snippet || '').trim())
    .filter(Boolean)
    .slice(0, limit);

  return snippets.length > 0
    ? snippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n')
    : '';
}

function buildBlockPayload(input: {
  type: LiveBookBlockType;
  title: string;
  content: string;
  payloadJson?: Record<string, unknown>;
  paramsJson: Record<string, unknown>;
  sourceRefs: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  if (input.payloadJson && Object.keys(input.payloadJson).length > 0) {
    return {
      schemaVersion: 1,
      type: input.type,
      ...input.payloadJson,
      sourceAnchors: input.payloadJson.sourceAnchors || input.sourceRefs,
    };
  }

  if (input.type === 'section') {
    return {
      schemaVersion: 1,
      type: 'section',
      title: input.title,
      body: input.content,
      subsections: [
        {
          id: `${input.title}-core`,
          heading: input.title,
          body: input.content,
        },
      ],
      sourceAnchors: input.sourceRefs,
    };
  }

  if (input.type === 'quiz') {
    return {
      schemaVersion: 1,
      type: 'quiz',
      questions: [
        {
          id: String(input.paramsJson.questionId || 'q1'),
          prompt: String(input.paramsJson.question || input.content),
          answerType: input.paramsJson.answerType || 'short_answer',
        },
      ],
      sourceAnchors: input.sourceRefs,
    };
  }

  if (input.type === 'flash_cards') {
    return {
      schemaVersion: 1,
      type: 'flash_cards',
      cards: Array.isArray(input.paramsJson.cards) ? input.paramsJson.cards : [],
      sourceAnchors: input.sourceRefs,
    };
  }

  return {
    schemaVersion: 1,
    type: input.type,
    title: input.title,
    body: input.content,
    text: input.content,
    params: input.paramsJson,
    sourceAnchors: input.sourceRefs,
  };
}

function makeBlock(input: {
  type: LiveBookBlockType;
  title: string;
  content: string;
  sourceRefs: Array<Record<string, unknown>>;
  paramsJson?: Record<string, unknown>;
  payloadJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
  status?: 'ready' | 'error';
  error?: string;
  id?: string;
}): LiveBookBlock {
  const ts = Date.now();
  const paramsJson = input.paramsJson || { text: input.content };
  const payloadJson = buildBlockPayload({
    type: input.type,
    title: input.title,
    content: input.content,
    payloadJson: input.payloadJson,
    paramsJson,
    sourceRefs: input.sourceRefs,
  });
  const metadataJson = {
    sourceAnchors: input.sourceRefs,
    blockVersion: 2,
    payloadSchemaVersion: 1,
    ...(input.metadataJson || {}),
  };

  return {
    id: input.id || makeId('blk'),
    type: input.type,
    title: input.title,
    content: input.content,
    status: input.status || 'ready',
    paramsJson,
    metadataJson,
    ...(input.error ? { error: input.error } : {}),
    createdAt: ts,
    updatedAt: ts,
    payloadJson,
    sourceRefsJson: input.sourceRefs,
  };
}

function fallbackTemplate(input: BlockGeneratorInput): BlockGeneratorOutput[] {
  const sourceAnchorPreview = input.chapter.sourceRefs
    ? input.chapter.sourceRefs
        .map((item) => String(item.snippet || '').trim())
        .filter(Boolean)
        .slice(0, 2)
    : [];

  return [
    {
      type: 'section',
      title: `${input.chapter.title} - 学习目标`,
      content:
        sourceAnchorPreview.length > 0
          ? `${input.chapter.goal}\n\n依据资料：${sourceAnchorPreview.join('；')}`
          : input.chapter.goal,
      paramsJson: { goal: input.chapter.goal, difficulty: input.chapter.difficulty || 'medium' },
    },
    {
      type: 'text',
      title: '概念讲解',
      content: input.chapter.summary
        ? `${input.chapter.summary}\n\n围绕「${input.book.topic}」建立关键定义、判定边界和常见变形。`
        : `围绕「${input.book.topic}」建立关键定义、判定边界和常见变形。`,
    },
    {
      type: 'interactive',
      title: '互动提问',
      content: '可以在页内提问"为什么这样做"，系统会追加深挖解释块。',
      paramsJson: { prompt: '为什么这样做', mode: 'follow_up' },
    },
    {
      type: 'quiz',
      title: '快速测验',
      content: `问题(${input.page.id}_q1): 请简述本页最关键的解题策略。`,
      paramsJson: {
        questionId: `${input.page.id}_q1`,
        question: '请简述本页最关键的解题策略。',
        answerType: 'short_answer',
      },
    },
    {
      type: 'animation',
      title: '动态演示建议',
      content: '建议把关键步骤做成逐步高亮动画，帮助理解推理过程。',
      paramsJson: { animationKind: 'step_highlight' },
    },
  ];
}

// Fallback template-based bridge text (used when LLM fails or is disabled)
function fallbackBridgeText(
  fromBlock: BlockGeneratorOutput | undefined,
  toBlock: BlockPlan,
): string {
  if (!fromBlock) {
    return '';
  }

  const transitions: Record<string, Record<string, string>> = {
    section: {
      text: '了解了学习目标后，让我们深入探讨具体内容。',
      quiz: '在深入学习之前，先检验一下你对基础概念的理解。',
      interactive: '学习过程中有任何疑问，随时可以通过互动提问来探索。',
    },
    text: {
      quiz: '理解了概念之后，来做几道练习题巩固一下。',
      interactive: '有什么想深入探讨的问题吗？',
      figure: '为了更直观地理解，我们来看一张示意图。',
      animation: '下面通过动态演示来加深理解。',
      deep_dive: '想更深入地理解这个概念吗？让我们进一步探讨。',
      callout: '这里有一个重要的提示需要特别注意。',
    },
    quiz: {
      text: '做完练习后，让我们继续深入学习相关内容。',
      callout: '根据刚才的练习，这里有一个关键提醒。',
      deep_dive: '如果还有疑问，可以查看深入解析。',
    },
    interactive: {
      text: '让我们回到主题，继续学习核心内容。',
      deep_dive: '如果你想更深入地了解，可以查看详细解析。',
    },
    figure: {
      text: '结合图示，我们来详细讲解相关概念。',
      quiz: '理解了图示内容后，来检验一下你的掌握程度。',
    },
    animation: {
      text: '看完动态演示后，我们来总结一下关键要点。',
      quiz: '通过动画理解了过程后，来做几道相关练习。',
    },
    deep_dive: {
      text: '深入探讨之后，让我们回到主线继续学习。',
      quiz: '深入理解了概念后，来检验一下掌握程度。',
    },
    callout: {
      text: '记住这个要点后，让我们继续学习。',
      quiz: '基于刚才的提示，来做一个相关练习。',
    },
  };

  const fromType = fromBlock.type;
  const toType = toBlock.type;

  if (transitions[fromType]?.[toType]) {
    return transitions[fromType][toType];
  }

  const genericTransitions: Record<string, string> = {
    section: '接下来，',
    text: '进一步地，',
    quiz: '接下来我们通过练习来巩固：',
    interactive: '如果你想深入探索：',
    figure: '如图所示：',
    animation: '动态展示如下：',
    deep_dive: '深入来看：',
    callout: '特别注意：',
    flash_cards: '记忆要点：',
    code: '代码实现：',
    timeline: '时间线如下：',
    concept_graph: '概念关系：',
    user_note: '记录你的思考：',
    remedial: '补偿练习：',
  };

  return genericTransitions[toType] || '';
}

// Async bridge text generation with LLM fallback
async function generateBridgeTextAsync(
  fromBlock: BlockGeneratorOutput | undefined,
  toBlock: BlockPlan,
  book: LiveBookRecord,
  chapter: LiveBookChapter,
  options?: { useLLM?: boolean },
): Promise<string> {
  if (!fromBlock) {
    return '';
  }

  // Try LLM first if enabled
  if (options?.useLLM !== false) {
    try {
      const llmBridge = await generateLLMBridgeText({
        book,
        chapter,
        previousBlock: { type: fromBlock.type, title: fromBlock.title },
        nextBlock: { type: toBlock.type, title: toBlock.title, hint: toBlock.rationale },
        language: book.language,
      });
      if (llmBridge) {
        return llmBridge;
      }
    } catch (error) {
      log.warn('LLM bridge text failed, using fallback:', error);
    }
  }

  return fallbackBridgeText(fromBlock, toBlock);
}

export class BlockGeneratorRegistry {
  private generators = new Map<LiveBookBlockType, BlockGenerator>();
  private order: LiveBookBlockType[] = [];

  register(generator: BlockGenerator): void {
    this.generators.set(generator.type, generator);
    if (!this.order.includes(generator.type)) {
      this.order.push(generator.type);
    }
  }

  get(type: LiveBookBlockType): BlockGenerator | undefined {
    return this.generators.get(type);
  }

  list(): BlockGenerator[] {
    return this.order
      .map((type) => this.generators.get(type))
      .filter((item): item is BlockGenerator => Boolean(item));
  }

  // Generate a block using the registered generator for the given plan
  async generateBlock(
    plan: BlockPlan,
    book: LiveBookRecord,
    page: LiveBookPage,
    chapter: LiveBookChapter,
  ): Promise<BlockGeneratorOutput> {
    const generator = this.get(plan.type);
    if (!generator) {
      throw new Error(`No generator registered for block type: ${plan.type}`);
    }

    const explorationChunks = book.conceptGraphJson?.explorationChunks as
      | Array<Record<string, unknown>>
      | undefined;
    const sourceRefs = normalizeSourceRefs({
      book,
      page,
      chapter,
      sourceRefs: [],
      explorationChunks,
    });

    const context: BlockGeneratorInput = {
      book,
      page,
      chapter,
      sourceRefs,
      explorationChunks,
      transitionIn: plan.transitionIn,
      bridgeText: plan.transitionIn,
    };

    if (generator.generateAsync) {
      const asyncOutput = await generator.generateAsync(context);
      let content = '';
      for await (const chunk of asyncOutput.contentStream) {
        content += chunk;
      }
      return {
        type: asyncOutput.type,
        title: asyncOutput.title,
        content,
        payloadJson: asyncOutput.payloadJson,
        paramsJson: asyncOutput.paramsJson,
        metadataJson: asyncOutput.metadataJson,
      };
    }

    const outputs = asArray(generator.generate(context));
    const first = outputs[0];
    if (!first) {
      throw new Error(`Generator for ${plan.type} returned empty output`);
    }
    return first;
  }
}

function createDefaultRegistry(): BlockGeneratorRegistry {
  const registry = new BlockGeneratorRegistry();

  registry.register({
    type: 'section',
    generate(input) {
      const sourceAnchorPreview = renderSourceEvidence(input.sourceRefs, 3);
      const objectives = input.chapter.learningObjectives || [];
      return {
        type: 'section',
        title: `${input.chapter.title} - 学习目标`,
        content: sourceAnchorPreview
          ? `${input.chapter.goal}\n\n依据资料：\n${sourceAnchorPreview}`
          : input.chapter.goal,
        payloadJson: {
          type: 'section',
          title: `${input.chapter.title} - 学习目标`,
          body: input.chapter.goal,
          objectives,
          evidence: sourceAnchorPreview,
          subsections: [
            { id: 'goal', heading: '学习目标', body: input.chapter.goal },
            ...(sourceAnchorPreview
              ? [{ id: 'evidence', heading: '来源依据', body: sourceAnchorPreview }]
              : []),
          ],
        },
        paramsJson: {
          goal: input.chapter.goal,
          difficulty: input.chapter.difficulty || 'medium',
          learningObjectives: objectives,
        },
      };
    },
  });

  registry.register({
    type: 'text',
    generate(input) {
      const chapterSummary = input.chapter.summary?.trim();
      const transition = input.transitionIn ? `${input.transitionIn}\n\n` : '';
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      const evidence = renderSourceEvidence(input.sourceRefs, 2);
      const body = chapterSummary
        ? `${bridge}${transition}${chapterSummary}\n\n围绕「${input.book.topic}」建立关键定义、判定边界和常见变形。`
        : `${bridge}${transition}围绕「${input.book.topic}」建立关键定义、判定边界和常见变形。`;
      return {
        type: 'text',
        title: '概念讲解',
        content: evidence ? `${body}\n\n参考证据：\n${evidence}` : body,
        payloadJson: {
          type: 'text',
          format: 'markdown',
          body,
          evidence,
        },
      };
    },
  });

  registry.register({
    type: 'concept_graph',
    generate(input) {
      const graph =
        input.book.conceptGraphJson && Object.keys(input.book.conceptGraphJson).length > 0
          ? input.book.conceptGraphJson
          : { nodes: [], edges: [] };
      const nodeCount = Array.isArray((graph as { nodes?: unknown[] }).nodes)
        ? (graph as { nodes: unknown[] }).nodes.length || 0
        : 0;
      const edgeCount = Array.isArray((graph as { edges?: unknown[] }).edges)
        ? (graph as { edges: unknown[] }).edges.length || 0
        : 0;

      const shouldRender =
        input.chapter.contentType === 'overview' || input.chapter.contentType === 'concept';
      if (!shouldRender) {
        return [];
      }

      return {
        type: 'concept_graph',
        title: '概念依赖图',
        content: `本图包含 ${nodeCount} 个节点、${edgeCount} 条关系，用于串联本书章节。`,
        payloadJson: {
          type: 'concept_graph',
          graph,
          nodeCount,
          edgeCount,
        },
        paramsJson: {
          graph,
          nodeCount,
          edgeCount,
        },
        metadataJson: {
          renderType: 'concept_graph',
        },
      };
    },
  });

  registry.register({
    type: 'interactive',
    generate(input) {
      const transition = input.transitionIn || '有什么想深入探讨的问题吗？';
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'interactive',
        title: '互动提问',
        content: `${bridge}${transition}`,
        payloadJson: {
          type: 'interactive',
          prompt: '为什么这样做',
          mode: 'follow_up',
          suggestions: ['换个例子解释', '生成练习题', '展开易错点'],
        },
        paramsJson: { prompt: '为什么这样做', mode: 'follow_up' },
      };
    },
  });

  registry.register({
    type: 'quiz',
    generate(input) {
      const objectives = input.chapter.learningObjectives || [];
      const questionText =
        objectives.length > 0
          ? `请解释「${objectives[0]}」的核心含义。`
          : '请简述本页最关键的解题策略。';
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      const questionId = `${input.page.id}_q1`;
      return {
        type: 'quiz',
        title: '快速测验',
        content: `${bridge}问题(${questionId}): ${questionText}`,
        payloadJson: {
          type: 'quiz',
          questions: [
            {
              id: questionId,
              prompt: questionText,
              answerType: 'short_answer',
              objectives,
            },
          ],
        },
        paramsJson: {
          questionId,
          question: questionText,
          answerType: 'short_answer',
          learningObjectives: objectives,
        },
      };
    },
  });

  registry.register({
    type: 'animation',
    generate(input) {
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'animation',
        title: '动态演示建议',
        content: `${bridge}建议把关键步骤做成逐步高亮动画，帮助理解推理过程。`,
        paramsJson: { animationKind: 'step_highlight' },
      };
    },
  });

  registry.register({
    type: 'callout',
    generate(input) {
      const calloutTypes: Record<string, { icon: string; tone: string }> = {
        theory: { icon: 'lightbulb', tone: 'info' },
        derivation: { icon: 'calculator', tone: 'warning' },
        practice: { icon: 'target', tone: 'success' },
        concept: { icon: 'book-open', tone: 'info' },
        overview: { icon: 'map', tone: 'neutral' },
        mixed: { icon: 'sparkles', tone: 'neutral' },
      };
      const config = calloutTypes[input.chapter.contentType || 'mixed'];
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'callout',
        title: '要点提示',
        content: `${bridge}本章「${input.chapter.title}」的核心要点：${input.chapter.goal}。建议重点关注概念定义与适用边界。`,
        payloadJson: {
          type: 'callout',
          tone: config.tone,
          icon: config.icon,
          body: `本章「${input.chapter.title}」的核心要点：${input.chapter.goal}。建议重点关注概念定义与适用边界。`,
        },
        paramsJson: {
          calloutType: config.tone,
          icon: config.icon,
          dismissible: true,
        },
        metadataJson: {
          renderType: 'callout',
          chapterContentType: input.chapter.contentType,
        },
      };
    },
  });

  registry.register({
    type: 'figure',
    generate(input) {
      const shouldRender =
        input.chapter.contentType === 'theory' || input.chapter.contentType === 'derivation';
      if (!shouldRender) {
        return [];
      }
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'figure',
        title: '示意图',
        content: `${bridge}展示「${input.book.topic}」的关键结构关系图。`,
        payloadJson: {
          type: 'figure',
          figureType: 'mermaid',
          caption: `图 1：${input.chapter.title} 概念示意图`,
          code: `graph TD\nA[${input.book.topic}] --> B[核心概念]\nB --> C[应用场景]`,
        },
        paramsJson: {
          figureType: 'diagram',
          caption: `图 1：${input.chapter.title} 概念示意图`,
          altText: `${input.book.topic} 示意图`,
        },
        metadataJson: {
          renderType: 'figure',
          suggestedMermaid: `graph TD\nA[${input.book.topic}] --> B[核心概念]\nB --> C[应用场景]`,
        },
      };
    },
  });

  registry.register({
    type: 'flash_cards',
    generate(input) {
      const objectives = input.chapter.learningObjectives || [];
      const cards =
        objectives.length > 0
          ? objectives.map((obj, idx) => ({
              id: `fc_${idx + 1}`,
              front: obj,
              back: `掌握「${obj}」的关键在于理解其定义、适用条件和常见变式。`,
            }))
          : [
              {
                id: 'fc_1',
                front: `什么是「${input.book.topic}」的核心定义？`,
                back: `核心定义围绕「${input.chapter.goal}」展开，需要理解其本质特征。`,
              },
            ];
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'flash_cards',
        title: '记忆卡片',
        content: `${bridge}本章节包含 ${cards.length} 张记忆卡片，用于巩固核心概念。`,
        payloadJson: {
          type: 'flash_cards',
          cards,
          shuffle: true,
        },
        paramsJson: {
          cards,
          shuffle: true,
          showProgress: true,
        },
        metadataJson: {
          renderType: 'flash_cards',
          cardCount: cards.length,
        },
      };
    },
  });

  registry.register({
    type: 'code',
    generate(input) {
      const shouldRender =
        input.chapter.contentType === 'derivation' || input.chapter.contentType === 'practice';
      if (!shouldRender) {
        return [];
      }
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'code',
        title: '代码示例',
        content: `${bridge}// 示例代码框架\nfunction solveProblem(input) {\n  // 1. 理解题意\n  // 2. 建立模型\n  // 3. 执行计算\n  // 4. 验证结果\n  return result;\n}`,
        payloadJson: {
          type: 'code',
          language: 'javascript',
          code: `function solveProblem(input) {\n  // 1. 理解题意\n  // 2. 建立模型\n  // 3. 执行计算\n  // 4. 验证结果\n  return result;\n}`,
          runnable: false,
        },
        paramsJson: {
          language: 'javascript',
          runnable: false,
          lineNumbers: true,
          collapsible: true,
        },
        metadataJson: {
          renderType: 'code',
          topic: input.book.topic,
        },
      };
    },
  });

  registry.register({
    type: 'timeline',
    generate(input) {
      const shouldRender =
        input.chapter.contentType === 'concept' || input.chapter.contentType === 'overview';
      if (!shouldRender) {
        return [];
      }
      const steps = [
        { id: 't1', title: '引入概念', description: `认识「${input.book.topic}」的基本定义` },
        { id: 't2', title: '理解原理', description: '掌握核心性质与判定方法' },
        { id: 't3', title: '典型例题', description: '通过例题巩固应用能力' },
        { id: 't4', title: '迁移应用', description: '解决综合性问题' },
      ];
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'timeline',
        title: '学习路径',
        content: `${bridge}「${input.book.topic}」的推荐学习路径，共 ${steps.length} 个阶段。`,
        payloadJson: {
          type: 'timeline',
          steps,
          orientation: 'vertical',
        },
        paramsJson: {
          steps,
          orientation: 'vertical',
          interactive: true,
        },
        metadataJson: {
          renderType: 'timeline',
          stepCount: steps.length,
        },
      };
    },
  });

  registry.register({
    type: 'user_note',
    generate(input) {
      const shouldRender =
        input.chapter.contentType === 'practice' || input.chapter.contentType === 'overview';
      if (!shouldRender) {
        return [];
      }
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'user_note',
        title: '学习笔记',
        content: `${bridge}在这里记录你的学习心得、重点标注和疑问。笔记内容仅自己可见。`,
        payloadJson: {
          type: 'user_note',
          placeholder: '输入你的笔记...',
          maxLength: 2000,
        },
        paramsJson: {
          placeholder: '输入你的笔记...',
          maxLength: 2000,
        },
        metadataJson: {
          renderType: 'user_note',
        },
      };
    },
  });

  registry.register({
    type: 'deep_dive',
    generate(input) {
      const learningObjectives = input.chapter.learningObjectives || [];
      const defaultQuestions = [
        '这个概念的本质是什么？',
        '适用条件是什么？',
        '和其他概念有什么区别？',
      ];
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'deep_dive',
        title: '深入探讨',
        content: `${bridge}围绕「${input.book.topic}」的关键问题：\n\n${
          learningObjectives.length > 0
            ? learningObjectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n')
            : defaultQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
        }\n\n点击展开查看详细解析，或在页内追问具体问题。`,
        payloadJson: {
          type: 'deep_dive',
          topic: input.book.topic,
          questions: learningObjectives.length > 0 ? learningObjectives : defaultQuestions,
        },
        paramsJson: {
          mode: 'static',
          defaultQuestions: learningObjectives.length > 0 ? learningObjectives : defaultQuestions,
        },
        metadataJson: {
          renderType: 'deep_dive',
          chapterGoal: input.chapter.goal,
        },
      };
    },
  });

  registry.register({
    type: 'remedial',
    generate(input) {
      const shouldRender = input.chapter.contentType === 'practice';
      if (!shouldRender) {
        return [];
      }
      const objectives = input.chapter.learningObjectives || [];
      const bridge = input.bridgeText ? `${input.bridgeText}\n\n` : '';
      return {
        type: 'remedial',
        title: '补偿练习',
        content: `${bridge}【错题回顾】\n本章涉及的关键知识点：\n\n${
          objectives.length > 0
            ? objectives.map((obj, i) => `${i + 1}. ${obj}`).join('\n')
            : '• 核心定义与性质\n• 常见题型与解法\n• 易错点提醒'
        }\n\n【练习建议】\n1. 先复习上述知识点\n2. 完成课后习题并核对答案\n3. 整理错题原因并归类`,
        payloadJson: {
          type: 'remedial',
          objectives,
          steps: ['复习知识点', '完成课后习题并核对答案', '整理错题原因并归类'],
        },
        paramsJson: {
          mode: 'static',
          chapterGoal: input.chapter.goal,
          learningObjectives: objectives,
        },
        metadataJson: {
          renderType: 'remedial',
          difficulty: input.chapter.difficulty || 'medium',
        },
      };
    },
  });

  return registry;
}

export class LiveBookCompiler {
  constructor(private readonly registry: BlockGeneratorRegistry = createDefaultRegistry()) {}

  compilePage(
    book: LiveBookRecord,
    page: LiveBookPage,
    chapter: LiveBookChapter,
    sectionPlan?: SectionPlan,
  ): CompilePageResult {
    const explorationChunks = book.conceptGraphJson?.explorationChunks as
      | Array<Record<string, unknown>>
      | undefined;

    const context: BlockGeneratorInput = {
      book,
      page,
      chapter,
      sourceRefs: normalizeSourceRefs({ book, page, chapter, sourceRefs: [], explorationChunks }),
      explorationChunks,
    };

    const blockResults: CompiledBlockResult[] = [];
    const bridgeTexts: Record<string, string> = {};

    const plannedTypes = sectionPlan?.blocks.map((b) => b.type) || [];
    let previousOutput: BlockGeneratorOutput | undefined;

    for (let i = 0; i < (sectionPlan?.blocks.length || 0); i++) {
      const planBlock = sectionPlan!.blocks[i];
      const generator = this.registry.get(planBlock.type);

      const bridgeText = planBlock.transitionIn || fallbackBridgeText(previousOutput, planBlock);
      if (bridgeText) {
        bridgeTexts[`${planBlock.type}_${i}`] = bridgeText;
      }

      try {
        const blockContext: BlockGeneratorInput = {
          ...context,
          transitionIn: planBlock.transitionIn,
          bridgeText,
        };
        const generated = generator
          ? asArray(generator.generate(blockContext))
          : asArray(fallbackTemplate(context).find((f) => f.type === planBlock.type) || []);

        for (const item of generated) {
          const block = makeBlock({
            type: item.type,
            title: item.title || planBlock.title,
            content: item.content,
            payloadJson: item.payloadJson,
            paramsJson: {
              ...(item.paramsJson || {}),
              planRationale: planBlock.rationale,
              ...(bridgeText ? { bridgeText } : {}),
            },
            metadataJson: {
              ...(item.metadataJson || {}),
              plannedTitle: planBlock.title,
              plannedRationale: planBlock.rationale,
              sourceAnchors: context.sourceRefs,
              ...(bridgeText ? { bridgeText } : {}),
            },
            sourceRefs: context.sourceRefs,
          });
          blockResults.push({ block, ok: true });
          previousOutput = item;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'generator failed';
        const errorBlock = makeBlock({
          type: planBlock.type,
          title: planBlock.title,
          content: `区块生成失败：${message}`,
          sourceRefs: context.sourceRefs,
          paramsJson: { failedType: planBlock.type, planRationale: planBlock.rationale },
          metadataJson: { failedGenerator: planBlock.type, plannedRationale: planBlock.rationale },
          status: 'error',
          error: message,
        });
        blockResults.push({ block: errorBlock, ok: false, error: message });
        previousOutput = undefined;
      }
    }

    for (const generator of this.registry.list()) {
      if (plannedTypes.includes(generator.type)) continue;
      try {
        const generated = asArray(generator.generate(context));
        for (const item of generated) {
          const block = makeBlock({
            type: item.type,
            title: item.title,
            content: item.content,
            payloadJson: item.payloadJson,
            paramsJson: item.paramsJson,
            metadataJson: item.metadataJson,
            sourceRefs: context.sourceRefs,
          });
          blockResults.push({ block, ok: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'generator failed';
        const errorBlock = makeBlock({
          type: 'placeholder',
          title: `${generator.type} 生成失败`,
          content: `区块生成失败：${message}`,
          sourceRefs: context.sourceRefs,
          paramsJson: { failedType: generator.type },
          metadataJson: { failedGenerator: generator.type },
          status: 'error',
          error: message,
        });
        blockResults.push({ block: errorBlock, ok: false, error: message });
      }
    }

    const readyBlocks = blockResults.filter((item) => item.ok).map((item) => item.block);

    if (blockResults.length === 0) {
      const fallback = fallbackTemplate(context).map((item) =>
        makeBlock({
          type: item.type,
          title: item.title,
          content: item.content,
          payloadJson: item.payloadJson,
          paramsJson: item.paramsJson,
          metadataJson: item.metadataJson,
          sourceRefs: context.sourceRefs,
        }),
      );
      return {
        blocks: fallback,
        blockResults: fallback.map((block) => ({ block, ok: true })),
        pageStatus: 'ready',
        successCount: fallback.length,
        errorCount: 0,
        bridgeTexts,
      };
    }

    if (readyBlocks.length === 0) {
      return {
        blocks: blockResults.map((item) => item.block),
        blockResults,
        pageStatus: 'error',
        successCount: 0,
        errorCount: blockResults.length,
        bridgeTexts,
      };
    }

    const errorCount = blockResults.length - readyBlocks.length;
    return {
      blocks: blockResults.map((item) => item.block),
      blockResults,
      pageStatus: errorCount > 0 ? 'partial' : 'ready',
      successCount: readyBlocks.length,
      errorCount,
      bridgeTexts,
    };
  }

  async compilePageAsync(
    book: LiveBookRecord,
    page: LiveBookPage,
    chapter: LiveBookChapter,
    sectionPlan?: SectionPlan,
    options?: {
      onBlockEvent?: BlockEventListener;
      concurrency?: number;
    },
  ): Promise<CompilePageResult> {
    const explorationChunks = book.conceptGraphJson?.explorationChunks as
      | Array<Record<string, unknown>>
      | undefined;

    const context: BlockGeneratorInput = {
      book,
      page,
      chapter,
      sourceRefs: normalizeSourceRefs({ book, page, chapter, sourceRefs: [], explorationChunks }),
      explorationChunks,
    };

    const blockResults: CompiledBlockResult[] = [];
    const bridgeTexts: Record<string, string> = {};
    const plannedTypes = sectionPlan?.blocks.map((b) => b.type) || [];

    const totalBlocks =
      (sectionPlan?.blocks.length || 0) +
      this.registry.list().filter((g) => !plannedTypes.includes(g.type)).length;

    if (options?.onBlockEvent) {
      await options.onBlockEvent({
        type: 'block_start',
        blockType: 'section',
        blockIndex: 0,
        totalBlocks,
        progress: 0,
      });
    }

    const plannedBlockPromises: Promise<void>[] = [];
    let previousOutput: BlockGeneratorOutput | undefined;

    for (let i = 0; i < (sectionPlan?.blocks.length || 0); i++) {
      const planBlock = sectionPlan!.blocks[i];
      const generator = this.registry.get(planBlock.type);

      // Use LLM bridge text generation with fallback
      const bridgeText =
        planBlock.transitionIn ||
        (await generateBridgeTextAsync(previousOutput, planBlock, book, chapter, { useLLM: true }));
      if (bridgeText) {
        bridgeTexts[`${planBlock.type}_${i}`] = bridgeText;
      }

      if (options?.onBlockEvent) {
        await options.onBlockEvent({
          type: 'bridge_text',
          blockType: planBlock.type,
          blockIndex: i,
          totalBlocks,
          bridgeText,
        });
      }

      const blockPromise = (async () => {
        try {
          if (options?.onBlockEvent) {
            await options.onBlockEvent({
              type: 'block_start',
              blockType: planBlock.type,
              blockIndex: i,
              totalBlocks,
              progress: Math.round((i / totalBlocks) * 100),
            });
          }

          const blockContext: BlockGeneratorInput = {
            ...context,
            transitionIn: planBlock.transitionIn,
            bridgeText,
          };

          let generated: BlockGeneratorOutput[];

          if (generator?.generateAsync) {
            const asyncOutput = await generator.generateAsync(blockContext);
            let content = '';
            for await (const chunk of asyncOutput.contentStream) {
              content += chunk;
              if (options?.onBlockEvent) {
                await options.onBlockEvent({
                  type: 'block_progress',
                  blockType: planBlock.type,
                  blockIndex: i,
                  totalBlocks,
                  content: chunk,
                });
              }
            }
            generated = [
              {
                type: asyncOutput.type,
                title: asyncOutput.title,
                content,
                payloadJson: asyncOutput.payloadJson,
                paramsJson: asyncOutput.paramsJson,
                metadataJson: asyncOutput.metadataJson,
              },
            ];
          } else {
            generated = generator
              ? asArray(generator.generate(blockContext))
              : asArray(fallbackTemplate(context).find((f) => f.type === planBlock.type) || []);
          }

          for (const item of generated) {
            const block = makeBlock({
              type: item.type,
              title: item.title || planBlock.title,
              content: item.content,
              payloadJson: item.payloadJson,
              paramsJson: {
                ...(item.paramsJson || {}),
                planRationale: planBlock.rationale,
                ...(bridgeText ? { bridgeText } : {}),
              },
              metadataJson: {
                ...(item.metadataJson || {}),
                plannedTitle: planBlock.title,
                plannedRationale: planBlock.rationale,
                sourceAnchors: context.sourceRefs,
                ...(bridgeText ? { bridgeText } : {}),
              },
              sourceRefs: context.sourceRefs,
            });
            blockResults.push({ block, ok: true });
            previousOutput = item;
          }

          if (options?.onBlockEvent) {
            await options.onBlockEvent({
              type: 'block_complete',
              blockType: planBlock.type,
              blockIndex: i,
              totalBlocks,
              block: blockResults[blockResults.length - 1]?.block,
              progress: Math.round(((i + 1) / totalBlocks) * 100),
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'generator failed';
          const errorBlock = makeBlock({
            type: planBlock.type,
            title: planBlock.title,
            content: `区块生成失败：${message}`,
            sourceRefs: context.sourceRefs,
            paramsJson: { failedType: planBlock.type, planRationale: planBlock.rationale },
            metadataJson: {
              failedGenerator: planBlock.type,
              plannedRationale: planBlock.rationale,
            },
            status: 'error',
            error: message,
          });
          blockResults.push({ block: errorBlock, ok: false, error: message });
          previousOutput = undefined;

          if (options?.onBlockEvent) {
            await options.onBlockEvent({
              type: 'block_error',
              blockType: planBlock.type,
              blockIndex: i,
              totalBlocks,
              block: errorBlock,
              error: message,
            });
          }
        }
      })();

      plannedBlockPromises.push(blockPromise);

      const concurrency = options?.concurrency || 1;
      if (plannedBlockPromises.length >= concurrency) {
        await Promise.all(plannedBlockPromises);
        plannedBlockPromises.length = 0;
      }
    }

    if (plannedBlockPromises.length > 0) {
      await Promise.all(plannedBlockPromises);
    }

    const remainingGenerators = this.registry.list().filter((g) => !plannedTypes.includes(g.type));
    for (let i = 0; i < remainingGenerators.length; i++) {
      const generator = remainingGenerators[i];
      const globalIndex = (sectionPlan?.blocks.length || 0) + i;

      try {
        const generated = asArray(generator.generate(context));
        for (const item of generated) {
          const block = makeBlock({
            type: item.type,
            title: item.title,
            content: item.content,
            payloadJson: item.payloadJson,
            paramsJson: item.paramsJson,
            metadataJson: item.metadataJson,
            sourceRefs: context.sourceRefs,
          });
          blockResults.push({ block, ok: true });
        }

        if (options?.onBlockEvent) {
          await options.onBlockEvent({
            type: 'block_complete',
            blockType: generator.type,
            blockIndex: globalIndex,
            totalBlocks,
            block: blockResults[blockResults.length - 1]?.block,
            progress: Math.round(((globalIndex + 1) / totalBlocks) * 100),
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'generator failed';
        const errorBlock = makeBlock({
          type: 'placeholder',
          title: `${generator.type} 生成失败`,
          content: `区块生成失败：${message}`,
          sourceRefs: context.sourceRefs,
          paramsJson: { failedType: generator.type },
          metadataJson: { failedGenerator: generator.type },
          status: 'error',
          error: message,
        });
        blockResults.push({ block: errorBlock, ok: false, error: message });
        if (options?.onBlockEvent) {
          await options.onBlockEvent({
            type: 'block_error',
            blockType: generator.type,
            blockIndex: globalIndex,
            totalBlocks,
            block: errorBlock,
            error: message,
          });
        }
      }
    }

    const readyBlocks = blockResults.filter((item) => item.ok).map((item) => item.block);

    if (blockResults.length === 0) {
      const fallback = fallbackTemplate(context).map((item) =>
        makeBlock({
          type: item.type,
          title: item.title,
          content: item.content,
          payloadJson: item.payloadJson,
          paramsJson: item.paramsJson,
          metadataJson: item.metadataJson,
          sourceRefs: context.sourceRefs,
        }),
      );
      return {
        blocks: fallback,
        blockResults: fallback.map((block) => ({ block, ok: true })),
        pageStatus: 'ready',
        successCount: fallback.length,
        errorCount: 0,
        bridgeTexts,
      };
    }

    if (readyBlocks.length === 0) {
      return {
        blocks: blockResults.map((item) => item.block),
        blockResults,
        pageStatus: 'error',
        successCount: 0,
        errorCount: blockResults.length,
        bridgeTexts,
      };
    }

    const errorCount = blockResults.length - readyBlocks.length;
    return {
      blocks: blockResults.map((item) => item.block),
      blockResults,
      pageStatus: errorCount > 0 ? 'partial' : 'ready',
      successCount: readyBlocks.length,
      errorCount,
      bridgeTexts,
    };
  }

  async regenerateBlock(
    book: LiveBookRecord,
    page: LiveBookPage,
    chapter: LiveBookChapter,
    block: LiveBookBlock,
    options?: { useLLM?: boolean },
  ): Promise<LiveBookBlock> {
    const plan: BlockPlan = {
      type: block.type,
      title: block.title,
      rationale: `重新生成: ${(block.metadataJson as Record<string, unknown>)?.source || 'manual'}`,
    };

    try {
      const generated = await this.registry.generateBlock(plan, book, page, chapter);
      return {
        ...block,
        content: generated.content,
        payloadJson:
          generated.payloadJson ||
          buildBlockPayload({
            type: generated.type,
            title: generated.title,
            content: generated.content,
            paramsJson: generated.paramsJson || {},
            sourceRefs: block.sourceRefsJson || [],
          }),
        paramsJson: generated.paramsJson || {},
        metadataJson: {
          ...block.metadataJson,
          regeneratedAt: Date.now(),
          regenerationCount:
            (((block.metadataJson as Record<string, unknown>)?.regenerationCount as number) || 0) +
            1,
        },
        updatedAt: Date.now(),
      };
    } catch (error) {
      log.warn('Block regeneration failed, keeping original:', error);
      return {
        ...block,
        metadataJson: {
          ...block.metadataJson,
          regenerationError: error instanceof Error ? error.message : 'unknown',
          regeneratedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };
    }
  }

  async changeBlockType(
    book: LiveBookRecord,
    page: LiveBookPage,
    chapter: LiveBookChapter,
    block: LiveBookBlock,
    newType: LiveBookBlockType,
    options?: { useLLM?: boolean },
  ): Promise<LiveBookBlock> {
    const plan: BlockPlan = {
      type: newType,
      title: block.title,
      rationale: `类型变更: ${block.type} -> ${newType}`,
    };

    try {
      const generated = await this.registry.generateBlock(plan, book, page, chapter);
      return {
        ...block,
        type: newType,
        content: generated.content,
        payloadJson:
          generated.payloadJson ||
          buildBlockPayload({
            type: generated.type,
            title: generated.title,
            content: generated.content,
            paramsJson: generated.paramsJson || {},
            sourceRefs: block.sourceRefsJson || [],
          }),
        paramsJson: generated.paramsJson || {},
        metadataJson: {
          ...block.metadataJson,
          typeChangedFrom: block.type,
          changedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };
    } catch (error) {
      log.warn('Block type change failed:', error);
      return {
        ...block,
        type: newType,
        metadataJson: {
          ...block.metadataJson,
          typeChangedFrom: block.type,
          changeError: error instanceof Error ? error.message : 'unknown',
          changedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };
    }
  }
}

export const liveBookCompiler = new LiveBookCompiler();
