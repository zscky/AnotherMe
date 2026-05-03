import type {
  LiveBookBlockType,
  LiveBookChapter,
  LiveBookExplorationReport,
  LiveBookRecord,
} from '@/lib/server/live-book-store';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';

const log = createLogger('SectionArchitect');

export interface BlockPlan {
  type: LiveBookBlockType;
  title: string;
  rationale: string;
  transitionIn?: string; // bridge text between blocks (like DeepTutor)
  params?: Record<string, unknown>;
}

export interface SectionPlan {
  chapterId: string;
  blocks: BlockPlan[];
}

interface LLMBlockPlan {
  type: string;
  title: string;
  rationale: string;
  transition_in?: string;
  params?: Record<string, unknown>;
}

interface LLMSectionPlan {
  chapterId: string;
  blocks: LLMBlockPlan[];
}

// ---------------------------------------------------------------------------
// Static fallback templates by contentType (v2 with transitions)
// ---------------------------------------------------------------------------

const FALLBACK_TEMPLATES: Record<string, BlockPlan[]> = {
  overview: [
    { type: 'section', title: '本书导览', rationale: '导览章节必须包含章节概览' },
    { type: 'concept_graph', title: '概念依赖图', rationale: '展示全书概念关系', transitionIn: '首先，让我们了解整本书的知识结构' },
    { type: 'timeline', title: '学习路径', rationale: '给出推荐学习顺序', transitionIn: '接下来是推荐的学习路径' },
  ],
  theory: [
    { type: 'section', title: '学习目标', rationale: '明确本章学习方向' },
    { type: 'text', title: '概念讲解', rationale: '核心理论内容', transitionIn: '让我们从基础概念开始' },
    { type: 'callout', title: '要点提示', rationale: '强调关键定理/定义', transitionIn: '这里有一个关键要点需要特别注意' },
    { type: 'figure', title: '示意图', rationale: '可视化理论结构', transitionIn: '下图展示了核心结构关系' },
    { type: 'quiz', title: '快速测验', rationale: '检验理解程度', transitionIn: '现在来检验一下你的理解' },
    { type: 'deep_dive', title: '深入探讨', rationale: '拓展理论深度', transitionIn: '如果你想更深入地了解' },
  ],
  concept: [
    { type: 'section', title: '学习目标', rationale: '明确本章学习方向' },
    { type: 'text', title: '概念讲解', rationale: '核心概念内容', transitionIn: '让我们深入理解这个概念' },
    { type: 'concept_graph', title: '概念依赖图', rationale: '展示概念关系', transitionIn: '这个概念与其他知识点的关系如下' },
    { type: 'flash_cards', title: '记忆卡片', rationale: '巩固核心概念', transitionIn: '用记忆卡片巩固关键要点' },
    { type: 'quiz', title: '快速测验', rationale: '检验理解程度', transitionIn: '来测试一下你的掌握程度' },
    { type: 'interactive', title: '互动提问', rationale: '引导主动思考', transitionIn: '有什么想深入探讨的问题吗' },
  ],
  derivation: [
    { type: 'section', title: '学习目标', rationale: '明确本章学习方向' },
    { type: 'text', title: '推导过程', rationale: '逐步展示推导', transitionIn: '让我们一步步展开推导' },
    { type: 'code', title: '代码示例', rationale: '用代码验证推导', transitionIn: '通过代码来验证这个推导' },
    { type: 'figure', title: '示意图', rationale: '可视化推导步骤', transitionIn: '下图展示了推导的关键步骤' },
    { type: 'quiz', title: '快速测验', rationale: '检验推导理解', transitionIn: '来检验一下对推导过程的理解' },
    { type: 'deep_dive', title: '深入探讨', rationale: '拓展推导变式', transitionIn: '进一步探索推导的变式' },
  ],
  practice: [
    { type: 'section', title: '学习目标', rationale: '明确本章学习方向' },
    { type: 'text', title: '方法总结', rationale: '归纳解题方法', transitionIn: '首先总结本章的核心方法' },
    { type: 'quiz', title: '例题演练', rationale: '通过例题巩固', transitionIn: '现在通过例题来巩固所学' },
    { type: 'remedial', title: '补偿练习', rationale: '针对薄弱点补强', transitionIn: '针对常见薄弱点进行补强' },
    { type: 'user_note', title: '学习笔记', rationale: '记录练习心得', transitionIn: '记录你的学习心得' },
    { type: 'interactive', title: '互动提问', rationale: '解决练习疑问', transitionIn: '有什么练习中的疑问吗' },
  ],
  mixed: [
    { type: 'section', title: '学习目标', rationale: '明确本章学习方向' },
    { type: 'text', title: '概念讲解', rationale: '核心理论内容', transitionIn: '首先了解核心概念' },
    { type: 'callout', title: '要点提示', rationale: '强调关键要点', transitionIn: '特别注意以下要点' },
    { type: 'quiz', title: '快速测验', rationale: '检验理解程度', transitionIn: '来检验一下理解程度' },
    { type: 'interactive', title: '互动提问', rationale: '引导主动思考', transitionIn: '有什么想深入探讨的吗' },
    { type: 'deep_dive', title: '深入探讨', rationale: '拓展知识深度', transitionIn: '进一步深入探讨' },
  ],
};

const VALID_BLOCK_TYPES: Set<string> = new Set([
  'section', 'text', 'quiz', 'interactive', 'animation', 'deep_dive',
  'remedial', 'callout', 'figure', 'flash_cards', 'code', 'timeline',
  'concept_graph', 'user_note', 'placeholder',
]);

function getFallbackPlan(chapter: LiveBookChapter): SectionPlan {
  const plans = FALLBACK_TEMPLATES[chapter.contentType || 'mixed'] || FALLBACK_TEMPLATES.mixed;
  return {
    chapterId: chapter.id,
    blocks: plans.map((p) => ({ ...p })),
  };
}

// ---------------------------------------------------------------------------
// LLM-based block planning with transitions
// ---------------------------------------------------------------------------

function buildSectionArchitectPrompt(
  book: LiveBookRecord,
  chapters: LiveBookChapter[],
  exploration: LiveBookExplorationReport,
): string {
  const topic = book.topic;
  const summary = exploration.summary || '';
  const concepts = exploration.candidateConcepts || [];

  const chapterDescriptions = chapters.map((ch, i) => {
    return `${i + 1}. ${ch.title} (类型: ${ch.contentType || 'mixed'}, 难度: ${ch.difficulty || 'medium'})
   目标: ${ch.goal}
   摘要: ${ch.summary || '无'}
   先修: ${ch.prerequisites?.join(', ') || '无'}`;
  }).join('\n');

  return `你是一位活书页面架构师，负责为每个章节规划内容块序列。

## 主题
${topic}

## 资料探索摘要
${summary}

## 候选核心概念
${concepts.map((c, i) => `${i + 1}. ${c}`).join('\n') || '（无）'}

## 章节列表
${chapterDescriptions}

## 任务
为每个章节规划一组内容块（block），输出 JSON 数组，每个元素包含：
- chapterId: 章节标题（用上面的标题）
- blocks: 块数组，每块包含 type（类型）、title（标题）、rationale（放置理由）、transition_in（可选，块之间的过渡语，引导读者进入下一个内容）

可用的块类型：
- section: 章节标题/学习目标
- text: 概念讲解/文本内容
- quiz: 测验/练习题
- interactive: 互动提问
- animation: 动态演示建议
- deep_dive: 深入探讨
- remedial: 补偿练习
- callout: 要点提示
- figure: 示意图
- flash_cards: 记忆卡片
- code: 代码示例
- timeline: 学习路径/时间线
- concept_graph: 概念依赖图
- user_note: 学习笔记

规划原则：
1. overview 章节必须有 concept_graph 和 timeline
2. theory 章节必须有 text、callout、figure
3. derivation 章节必须有 text、code、figure
4. practice 章节必须有 quiz、remedial
5. concept 章节必须有 concept_graph、flash_cards
6. 每章至少 4 个块，最多 8 个块
7. 块顺序应符合认知规律：先概览→再讲解→再互动→最后测验
8. transition_in 用于块之间的过渡，增强阅读流畅性

请只输出纯 JSON 数组，不要包含 markdown 代码块。`;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function normalizeBlockType(type: string): LiveBookBlockType | null {
  const normalized = type.toLowerCase().trim();
  if (VALID_BLOCK_TYPES.has(normalized)) return normalized as LiveBookBlockType;
  return null;
}

async function callLLMSectionPlans(
  book: LiveBookRecord,
  chapters: LiveBookChapter[],
  exploration: LiveBookExplorationReport,
): Promise<SectionPlan[] | null> {
  try {
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: '你是一位专业的学习内容架构师，擅长将章节拆解为合理的内容块序列，并设计块之间的过渡语。',
        prompt: buildSectionArchitectPrompt(book, chapters, exploration),
        maxOutputTokens: 4096,
        temperature: 0.35,
      },
      'section-architect',
      { retries: 1, validate: (text) => text.trim().length > 200 && text.includes('blocks') },
    );
    const parsed = safeJsonParse<LLMSectionPlan[]>(result.text);
    if (!parsed || !Array.isArray(parsed)) return null;

    const plans: SectionPlan[] = [];
    const chapterMap = new Map(chapters.map((c) => [c.title, c.id]));

    for (const plan of parsed) {
      const chapterId = chapterMap.get(plan.chapterId) || plan.chapterId;
      const blocks: BlockPlan[] = [];
      for (const b of plan.blocks) {
        const type = normalizeBlockType(b.type);
        if (type) {
          blocks.push({
            type,
            title: b.title || `${type} 块`,
            rationale: b.rationale || 'LLM 规划',
            transitionIn: b.transition_in,
            params: b.params,
          });
        }
      }
      if (blocks.length > 0) {
        plans.push({ chapterId, blocks });
      }
    }

    return plans;
  } catch (error) {
    log.warn('LLM section architect failed, will fallback to templates', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main SectionArchitect
// ---------------------------------------------------------------------------

export class SectionArchitect {
  async planSections(
    book: LiveBookRecord,
    exploration: LiveBookExplorationReport,
  ): Promise<Map<string, SectionPlan>> {
    const chapters = book.chapters;
    if (chapters.length === 0) return new Map();

    // Try LLM first
    const llmPlans = await callLLMSectionPlans(book, chapters, exploration);

    const result = new Map<string, SectionPlan>();

    for (const chapter of chapters) {
      const llmPlan = llmPlans?.find((p) => p.chapterId === chapter.id);
      if (llmPlan && llmPlan.blocks.length >= 3) {
        result.set(chapter.id, llmPlan);
      } else {
        // Fallback to template
        result.set(chapter.id, getFallbackPlan(chapter));
      }
    }

    return result;
  }
}

export const sectionArchitect = new SectionArchitect();
