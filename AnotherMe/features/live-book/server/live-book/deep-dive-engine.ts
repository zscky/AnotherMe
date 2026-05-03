import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';
import type {
  LiveBookBlock,
  LiveBookBlockType,
  LiveBookChapter,
  LiveBookPage,
  LiveBookRecord,
} from '@/lib/server/live-book-store';

const log = createLogger('DeepDiveEngine');

export interface DeepDiveSubpageInput {
  book: LiveBookRecord;
  parentPage: LiveBookPage;
  parentChapter: LiveBookChapter;
  triggerQuestion: string;
  triggerBlockId?: string;
  depth?: number; // 0 = first level, 1 = second level, etc.
}

export interface DeepDiveSubpageResult {
  page: LiveBookPage;
  chapter: LiveBookChapter;
  reply: string;
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function buildDeepDivePrompt(input: DeepDiveSubpageInput): string {
  const { book, parentPage, parentChapter, triggerQuestion, depth = 0 } = input;
  const isZh = book.language === 'zh-CN';
  const depthLabel = depth > 0 ? (isZh ? `（深挖层级 ${depth + 1}）` : ` (Deep Dive Level ${depth + 1})`) : '';

  const parentBlocksSummary = parentPage.blocks
    .map((b, i) => `${i + 1}. [${b.type}] ${b.title}`)
    .join('\n');

  return `${isZh ? '你是一位专业的教学内容设计师，负责为学生的追问创建深挖子页面。' : 'You are a professional instructional content designer, creating deep-dive subpages for student follow-up questions.'}${depthLabel}

${isZh ? '主题' : 'Topic'}: ${book.topic}
${isZh ? '当前章节' : 'Current Chapter'}: ${parentChapter.title}
${isZh ? '章节目标' : 'Chapter Goal'}: ${parentChapter.goal || (isZh ? '掌握核心概念' : 'Master core concepts')}
${isZh ? '原页面内容' : 'Original Page Content'}:
${parentBlocksSummary}

${isZh ? '学生追问' : 'Student Question'}: "${triggerQuestion}"

${isZh ? '任务' : 'Task'}: ${isZh ? '为这个追问设计一个深挖子页面，包含：' : 'Design a deep-dive subpage for this question, including:'}
1. ${isZh ? '页面标题（简洁，反映追问核心）' : 'Page title (concise, reflecting the question core)'}
2. ${isZh ? '3-5个内容块，逐步深入解答' : '3-5 content blocks, progressively deepening the answer'}
3. ${isZh ? '每个块的类型和标题' : 'Each block type and title'}
4. ${isZh ? '块之间的过渡逻辑' : 'Transition logic between blocks'}

${isZh ? '可用的块类型' : 'Available block types'}:
- section: ${isZh ? '章节标题/学习目标' : 'Section title / learning objective'}
- text: ${isZh ? '概念讲解/详细解释' : 'Concept explanation / detailed answer'}
- quiz: ${isZh ? '测验/验证理解' : 'Quiz / verify understanding'}
- interactive: ${isZh ? '互动提问/引导思考' : 'Interactive / guided thinking'}
- figure: ${isZh ? '示意图/可视化' : 'Figure / visualization'}
- code: ${isZh ? '代码示例' : 'Code example'}
- callout: ${isZh ? '要点提示' : 'Key callout'}
- deep_dive: ${isZh ? '进一步深挖链接' : 'Further deep dive link'}

${isZh ? '输出格式：纯JSON对象' : 'Output format: Pure JSON object'}
{
  "title": "${isZh ? '页面标题' : 'Page Title'}",
  "blocks": [
    { "type": "section", "title": "${isZh ? '学习目标' : 'Learning Objective'}" },
    { "type": "text", "title": "${isZh ? '详细解释' : 'Detailed Explanation'}" },
    { "type": "quiz", "title": "${isZh ? '理解验证' : 'Understanding Check'}" }
  ]
}`;
}

interface LLMDeepDivePlan {
  title: string;
  blocks: Array<{
    type: string;
    title: string;
    rationale?: string;
  }>;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

const VALID_BLOCK_TYPES: Set<string> = new Set([
  'section', 'text', 'quiz', 'interactive', 'animation', 'deep_dive',
  'remedial', 'callout', 'figure', 'flash_cards', 'code', 'timeline',
  'concept_graph', 'user_note', 'placeholder',
]);

function normalizeBlockType(type: string): LiveBookBlockType | null {
  const normalized = type.toLowerCase().trim();
  if (VALID_BLOCK_TYPES.has(normalized)) return normalized as LiveBookBlockType;
  return null;
}

function generateDeepDiveBlocks(plan: LLMDeepDivePlan, book: LiveBookRecord, parentPage: LiveBookPage): LiveBookBlock[] {
  const ts = Date.now();
  const blocks: LiveBookBlock[] = [];

  for (const planBlock of plan.blocks) {
    const type = normalizeBlockType(planBlock.type) || 'text';
    const title = planBlock.title || `${type} 块`;

    let content = '';
    switch (type) {
      case 'section':
        content = `${title} - ${planBlock.rationale || '深挖子页面导览'}`;
        break;
      case 'text':
        content = `关于「${plan.title}」的详细解释将在这里展开。`;
        break;
      case 'quiz':
        content = `针对「${plan.title}」的理解验证题。`;
        break;
      case 'interactive':
        content = `关于「${plan.title}」，你还有什么想深入了解的？`;
        break;
      case 'figure':
        content = `「${plan.title}」的可视化示意图。`;
        break;
      case 'code':
        content = `// 「${plan.title}」的代码示例\n// 待补充具体实现`;
        break;
      case 'callout':
        content = `关键要点：${planBlock.rationale || '需要特别注意的核心概念'}`;
        break;
      default:
        content = `「${title}」内容待生成。`;
    }

    blocks.push({
      id: makeId('blk'),
      type,
      title,
      content,
      status: 'ready',
      paramsJson: { text: content, deepDiveSource: parentPage.id },
      metadataJson: {
        blockVersion: 1,
        source: 'deep_dive_subpage',
        parentPageId: parentPage.id,
        parentBlockId: parentPage.blocks[0]?.id,
        deepDiveTitle: plan.title,
      },
      createdAt: ts,
      updatedAt: ts,
    });
  }

  return blocks;
}

export async function createDeepDiveSubpage(input: DeepDiveSubpageInput): Promise<DeepDiveSubpageResult | null> {
  try {
    const { book, parentPage, parentChapter, triggerQuestion, depth = 0 } = input;
    const isZh = book.language === 'zh-CN';

    // Call LLM to plan the deep dive subpage
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: isZh
          ? '你是一位专业的教学内容设计师，只输出JSON格式的深挖页面规划。'
          : 'You are a professional instructional designer. Output only JSON-format deep dive page plans.',
        prompt: buildDeepDivePrompt(input),
        maxOutputTokens: 2048,
        temperature: 0.35,
      },
      'deep-dive-engine',
      { retries: 1, validate: (text) => text.trim().length > 100 && text.includes('blocks') },
    );

    const plan = safeJsonParse<LLMDeepDivePlan>(result.text);
    if (!plan || !plan.title || !Array.isArray(plan.blocks) || plan.blocks.length === 0) {
      log.warn('LLM deep dive plan invalid, using fallback');
      return createFallbackDeepDiveSubpage(input);
    }

    // Create chapter and page
    const chapterId = makeId('ch');
    const pageId = makeId('pg');
    const ts = Date.now();

    const chapter: LiveBookChapter = {
      id: chapterId,
      title: `${plan.title}${depth > 0 ? ` ${isZh ? '深挖' : 'Deep Dive'} L${depth + 1}` : ''}`,
      goal: `${isZh ? '深入理解' : 'Deep understanding of'}: ${triggerQuestion}`,
      order: parentChapter.order + 0.5, // Insert after parent
      difficulty: parentChapter.difficulty,
      learningObjectives: [triggerQuestion],
      contentType: 'mixed',
      prerequisites: [parentChapter.id],
      summary: `${isZh ? '针对追问' : 'Follow-up on'}: ${triggerQuestion}`,
    };

    const blocks = generateDeepDiveBlocks(plan, book, parentPage);

    const page: LiveBookPage = {
      id: pageId,
      chapterId,
      title: plan.title,
      order: 1,
      status: 'ready',
      blocks,
    };

    const reply = isZh
      ? `已为你创建深挖页面「${plan.title}」，针对你的问题「${triggerQuestion}」进行了${plan.blocks.length}个内容块的深入分析。`
      : `Created deep dive page "${plan.title}" with ${plan.blocks.length} content blocks analyzing your question "${triggerQuestion}".`;

    return { page, chapter, reply };
  } catch (error) {
    log.warn('Deep dive subpage creation failed:', error);
    return createFallbackDeepDiveSubpage(input);
  }
}

function createFallbackDeepDiveSubpage(input: DeepDiveSubpageInput): DeepDiveSubpageResult | null {
  const { book, parentPage, parentChapter, triggerQuestion, depth = 0 } = input;
  const isZh = book.language === 'zh-CN';
  const ts = Date.now();

  const chapterId = makeId('ch');
  const pageId = makeId('pg');

  const chapter: LiveBookChapter = {
    id: chapterId,
    title: `${isZh ? '深挖' : 'Deep Dive'}: ${triggerQuestion.slice(0, 30)}${triggerQuestion.length > 30 ? '...' : ''}`,
    goal: `${isZh ? '深入理解' : 'Deep understanding'}: ${triggerQuestion}`,
    order: parentChapter.order + 0.5,
    difficulty: parentChapter.difficulty,
    learningObjectives: [triggerQuestion],
    contentType: 'mixed',
    prerequisites: [parentChapter.id],
    summary: `${isZh ? '针对追问' : 'Follow-up'}: ${triggerQuestion}`,
  };

  const blocks: LiveBookBlock[] = [
    {
      id: makeId('blk'),
      type: 'section',
      title: isZh ? '深挖目标' : 'Deep Dive Objective',
      content: `${isZh ? '深入探讨' : 'Deep exploration of'}: ${triggerQuestion}`,
      status: 'ready',
      paramsJson: { text: `${isZh ? '深入探讨' : 'Deep exploration of'}: ${triggerQuestion}` },
      metadataJson: { blockVersion: 1, source: 'deep_dive_fallback', parentPageId: parentPage.id },
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: makeId('blk'),
      type: 'text',
      title: isZh ? '详细解析' : 'Detailed Analysis',
      content: `${isZh ? '关于你的问题' : 'Regarding your question'}「${triggerQuestion}」，${isZh ? '这里将提供详细的解释和分析。' : 'a detailed explanation and analysis will be provided here.'}`,
      status: 'ready',
      paramsJson: { text: `${isZh ? '关于你的问题' : 'Regarding your question'}「${triggerQuestion}」...` },
      metadataJson: { blockVersion: 1, source: 'deep_dive_fallback', parentPageId: parentPage.id },
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: makeId('blk'),
      type: 'interactive',
      title: isZh ? '继续追问' : 'Continue Exploring',
      content: `${isZh ? '关于这个问题，你还有什么想深入了解的吗？' : 'What else would you like to explore about this topic?'}`,
      status: 'ready',
      paramsJson: { text: `${isZh ? '关于这个问题，你还有什么想深入了解的吗？' : 'What else would you like to explore?'}` },
      metadataJson: { blockVersion: 1, source: 'deep_dive_fallback', parentPageId: parentPage.id },
      createdAt: ts,
      updatedAt: ts,
    },
  ];

  const page: LiveBookPage = {
    id: pageId,
    chapterId,
    title: `${isZh ? '深挖' : 'Deep Dive'}: ${triggerQuestion.slice(0, 30)}${triggerQuestion.length > 30 ? '...' : ''}`,
    order: 1,
    status: 'ready',
    blocks,
  };

  const reply = isZh
    ? `已为你创建基础深挖页面，针对「${triggerQuestion}」进行了初步分析。你可以继续追问以获取更深入的内容。`
    : `Created a basic deep dive page for "${triggerQuestion}". You can continue asking for deeper content.`;

  return { page, chapter, reply };
}
