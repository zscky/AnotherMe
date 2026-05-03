import type {
  LiveBookChapter,
  LiveBookExplorationReport,
  LiveBookRecord,
} from '@/lib/server/live-book-store';
import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';

const log = createLogger('SpineSynthesizer');

interface ConceptNode {
  id: string;
  label: string;
  chapterId?: string;
  description?: string;
  weight?: number;
}

interface ConceptEdge {
  src: string;
  dst: string;
  relation: 'depends_on' | 'extends' | 'related';
  rationale?: string;
}

export interface SynthesizedSpine {
  chapters: LiveBookChapter[];
  conceptGraphJson: {
    nodes: ConceptNode[];
    edges: ConceptEdge[];
  };
  critiqueIssues: string[];
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function clip(text: string, max = 22): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function pickContentType(index: number): LiveBookChapter['contentType'] {
  const cycle: LiveBookChapter['contentType'][] = ['theory', 'concept', 'derivation', 'practice'];
  return cycle[index % cycle.length];
}

function asConceptId(text: string, index: number): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized ? `c_${normalized}_${index + 1}` : `c_concept_${index + 1}`;
}

function slug(text: string): string {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 48) || 'concept';
}

// ---------------------------------------------------------------------------
// Template fallback (original deterministic behavior)
// ---------------------------------------------------------------------------

function buildChaptersTemplate(topic: string, concepts: string[], summary: string): LiveBookChapter[] {
  const seeds = concepts.length > 0 ? concepts : ['核心概念', '关键步骤', '易错点', '迁移应用'];
  const chapterCount = Math.min(6, Math.max(4, Math.ceil(seeds.length / 2)));

  const chapters: LiveBookChapter[] = [];
  for (let i = 0; i < chapterCount; i += 1) {
    const primary = seeds[i] || `主题 ${i + 1}`;
    const secondary = seeds[i + 1] || primary;
    chapters.push({
      id: makeId('ch'),
      title: `第${i + 1}章：${clip(primary, 16)}`,
      goal: `掌握「${clip(primary, 18)}」并能够连接到「${clip(secondary, 18)}」。`,
      order: i + 1,
      difficulty: i <= 1 ? 'easy' : i >= chapterCount - 1 ? 'hard' : 'medium',
      learningObjectives: [
        `理解 ${primary} 的核心定义`,
        `完成围绕 ${primary} 的基础练习`,
        `建立 ${primary} 与 ${secondary} 的联系`,
      ],
      contentType: pickContentType(i),
      sourceRefs: [
        {
          kind: 'exploration',
          ref: `concept:${asConceptId(primary, i)}`,
          snippet: `来源于资料探索候选概念：${primary}`,
        },
      ],
      prerequisites: i === 0 ? [] : [chapters[i - 1].title],
      summary: `${topic}：${primary}。${summary}`,
    });
  }

  return chapters;
}

function injectOverviewChapter(chapters: LiveBookChapter[], topic: string): LiveBookChapter[] {
  const already = chapters[0]?.contentType === 'overview';
  if (already) return chapters;

  const overview: LiveBookChapter = {
    id: makeId('ch'),
    title: '本书导览',
    goal: `快速了解「${topic}」的章节结构、先修关系与学习路径。`,
    order: 1,
    difficulty: 'easy',
    learningObjectives: ['了解章节顺序', '识别先修关系', '明确学习入口'],
    contentType: 'overview',
    sourceRefs: [{ kind: 'system', ref: 'overview', snippet: '自动生成导览章节' }],
    prerequisites: [],
    summary: '展示概念图与章节索引，作为整本活书的导航页。',
  };

  return [overview, ...chapters].map((chapter, index) => ({
    ...chapter,
    order: index + 1,
    prerequisites:
      chapter.contentType === 'overview'
        ? []
        : chapter.prerequisites && chapter.prerequisites.length > 0
          ? chapter.prerequisites
          : index > 1
            ? [chapters[index - 2]?.title].filter(Boolean) as string[]
            : [],
  }));
}

function buildConceptGraphTemplate(chapters: LiveBookChapter[], concepts: string[]) {
  const nodes: ConceptNode[] = [
    {
      id: 'book_root',
      label: '学习地图',
      description: '整本活书概览',
      weight: 1,
    },
  ];
  const edges: ConceptEdge[] = [];

  for (let i = 0; i < chapters.length; i += 1) {
    const chapter = chapters[i];
    const concept = concepts[i] || chapter.title;
    const nodeId = asConceptId(concept, i);
    nodes.push({
      id: nodeId,
      label: concept,
      chapterId: chapter.id,
      description: chapter.goal,
      weight: Math.max(0.2, 1 - i * 0.1),
    });
    edges.push({
      src: 'book_root',
      dst: nodeId,
      relation: 'related',
      rationale: '章节入口',
    });
    if (i > 0) {
      const prev = concepts[i - 1] || chapters[i - 1].title;
      edges.push({
        src: asConceptId(prev, i - 1),
        dst: nodeId,
        relation: 'depends_on',
        rationale: '先修依赖',
      });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// LLM-first spine synthesis: Draft -> Critique -> Revise
// ---------------------------------------------------------------------------

interface LLMChapterDraft {
  title: string;
  goal: string;
  difficulty: 'easy' | 'medium' | 'hard';
  learningObjectives: string[];
  contentType: LiveBookChapter['contentType'];
  prerequisites: string[];
  summary: string;
  covers?: string[]; // concept node ids this chapter covers
  sourceAnchors?: Array<{
    kind: string;
    ref: string;
    snippet: string;
  }>;
}

interface LLMConceptNode {
  id: string;
  label: string;
  description?: string;
}

interface LLMConceptEdge {
  src: string;
  dst: string;
  relation: 'depends_on' | 'extends' | 'related';
  rationale?: string;
}

interface LLMSpineDraft {
  chapters: LLMChapterDraft[];
  conceptNodes: LLMConceptNode[];
  conceptEdges: LLMConceptEdge[];
}

function buildSpinePrompt(topic: string, exploration: LiveBookExplorationReport): string {
  const concepts = exploration.candidateConcepts || [];
  const chunks = exploration.chunks || [];
  const summary = exploration.summary || '';

  return `你是一位资深课程设计师，负责为一本交互式学习书（活书）设计章节结构（书脊）。

## 主题
${topic}

## 资料探索摘要
${summary}

## 候选核心概念
${concepts.map((c, i) => `${i + 1}. ${c}`).join('\n') || '（无候选概念，请自行推导）'}

## 证据片段（前10条）
${chunks.slice(0, 10).map((c, i) => `${i + 1}. [${(c as Record<string, unknown>).kind || 'unknown'}] ${(c as Record<string, unknown>).snippet || ''}`).join('\n')}

## 任务
请输出一份 JSON，包含以下字段：
- chapters: 章节数组，每章包含 title（标题，不超过20字）、goal（学习目标，一句话）、difficulty（easy/medium/hard）、learningObjectives（字符串数组，2-4条）、contentType（theory/derivation/practice/concept/mixed）、prerequisites（先修章节标题数组，可空）、summary（章节摘要，50字以内）、covers（本章节覆盖的概念节点id数组）、sourceAnchors（来源锚点数组，每锚点包含 kind/ref/snippet）
- conceptNodes: 概念节点数组，每节点包含 id（英文小写下划线格式）、label（显示名称）、description（可选描述）
- conceptEdges: 概念边数组，每边包含 src（源节点id）、dst（目标节点id）、relation（depends_on/extends/related）、rationale（关系理由）

设计要求：
1. 章节数控制在 4-7 章（不含导览），必须包含一个 overview 类型的导览章作为第1章
2. 概念图节点数 >= 章节数，每个核心概念对应一个节点
3. 边必须构成有向无环图（DAG），不得出现循环依赖
4. 先修关系必须与实际边的 depends_on 一致
5. 难度递进：前面章节偏 easy/medium，后面偏 medium/hard
6. 每章的 learningObjectives 必须具体、可衡量
7. 每章必须包含 sourceAnchors，引用资料探索中的证据片段

请只输出纯 JSON，不要包含 markdown 代码块或其他说明文字。`;
}

function buildCritiquePrompt(draft: LLMSpineDraft, topic: string): string {
  return `你是一位严格的课程评审专家。请评审以下活书书脊草案，指出问题并给出修订建议。

## 主题
${topic}

## 草案章节
${draft.chapters.map((c, i) => `${i + 1}. ${c.title} (${c.contentType}, ${c.difficulty}) - 目标：${c.goal}`).join('\n')}

## 概念图节点
${draft.conceptNodes.map((n) => `- ${n.id}: ${n.label}`).join('\n')}

## 概念图边
${draft.conceptEdges.map((e) => `- ${e.src} → ${e.dst} (${e.relation}): ${e.rationale || ''}`).join('\n')}

## 评审要求
请检查以下问题并输出 JSON：
- issues: 字符串数组，每条描述一个发现的问题（如：循环依赖、概念覆盖不足、难度跳跃过大、先修关系缺失等）
- suggestions: 字符串数组，每条是一个具体修订建议
- verdict: "ok" 或 "needs_revision"

请只输出纯 JSON。`;
}

function buildRevisePrompt(
  draft: LLMSpineDraft,
  critique: { issues: string[]; suggestions: string[] },
  topic: string,
): string {
  return `你是一位资深课程设计师。请根据评审意见修订活书书脊草案。

## 主题
${topic}

## 原草案章节
${draft.chapters.map((c, i) => `${i + 1}. ${c.title} (${c.contentType}, ${c.difficulty}) - 目标：${c.goal}`).join('\n')}

## 评审问题
${critique.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}

## 修订建议
${critique.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## 任务
请输出修订后的完整 JSON，格式与 Draft 阶段相同（chapters + conceptNodes + conceptEdges）。
必须保留 overview 导览章，确保 DAG 无环，先修关系一致。

请只输出纯 JSON。`;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function callLLMSpineDraft(topic: string, exploration: LiveBookExplorationReport): Promise<LLMSpineDraft | null> {
  try {
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: '你是一个专业的课程结构设计师，擅长将学习主题拆解为结构化的章节与概念依赖图。',
        prompt: buildSpinePrompt(topic, exploration),
        maxOutputTokens: 4096,
        temperature: 0.4,
      },
      'spine-synthesizer:draft',
      { retries: 1, validate: (text) => text.trim().length > 100 && text.includes('chapters') },
    );
    return safeJsonParse<LLMSpineDraft>(result.text);
  } catch (error) {
    log.warn('LLM spine draft failed, will fallback to template', error);
    return null;
  }
}

async function callLLMCritique(draft: LLMSpineDraft, topic: string): Promise<{ issues: string[]; suggestions: string[]; verdict?: string } | null> {
  try {
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: '你是一位严格的课程评审专家，擅长发现书脊结构中的逻辑问题。',
        prompt: buildCritiquePrompt(draft, topic),
        maxOutputTokens: 2048,
        temperature: 0.3,
      },
      'spine-synthesizer:critique',
      { retries: 1, validate: (text) => text.trim().length > 50 },
    );
    return safeJsonParse<{ issues: string[]; suggestions: string[]; verdict?: string }>(result.text);
  } catch (error) {
    log.warn('LLM critique failed, using default checks', error);
    return null;
  }
}

async function callLLMRevise(
  draft: LLMSpineDraft,
  critique: { issues: string[]; suggestions: string[] },
  topic: string,
): Promise<LLMSpineDraft | null> {
  try {
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: '你是一位专业的课程结构设计师，擅长根据评审意见修订书脊结构。',
        prompt: buildRevisePrompt(draft, critique, topic),
        maxOutputTokens: 4096,
        temperature: 0.35,
      },
      'spine-synthesizer:revise',
      { retries: 1, validate: (text) => text.trim().length > 100 && text.includes('chapters') },
    );
    return safeJsonParse<LLMSpineDraft>(result.text);
  } catch (error) {
    log.warn('LLM revise failed, keeping original draft', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post-processing: dedupe, topo-sort, cycle removal, coverage fill
// ---------------------------------------------------------------------------

function dedupeChapters(chapters: LLMChapterDraft[]): LLMChapterDraft[] {
  const seen = new Set<string>();
  return chapters.filter((c) => {
    const key = c.title.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function removeCycles(edges: LLMConceptEdge[]): LLMConceptEdge[] {
  const adj = new Map<string, string[]>();
  const allNodes = new Set<string>();
  for (const e of edges) {
    allNodes.add(e.src);
    allNodes.add(e.dst);
    if (!adj.has(e.src)) adj.set(e.src, []);
    adj.get(e.src)!.push(e.dst);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycleEdges = new Set<number>();

  function dfs(node: string, path: number[]) {
    visited.add(node);
    recStack.add(node);
    const neighbors = adj.get(node) || [];
    for (let i = 0; i < neighbors.length; i++) {
      const next = neighbors[i];
      const edgeIndex = edges.findIndex((e, idx) => e.src === node && e.dst === next && !cycleEdges.has(idx));
      if (edgeIndex < 0) continue;
      if (!visited.has(next)) {
        dfs(next, [...path, edgeIndex]);
      } else if (recStack.has(next)) {
        cycleEdges.add(edgeIndex);
      }
    }
    recStack.delete(node);
  }

  for (const node of allNodes) {
    if (!visited.has(node)) dfs(node, []);
  }

  return edges.filter((_, idx) => !cycleEdges.has(idx));
}

function topologicalSort(nodes: string[], edges: { src: string; dst: string }[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n, 0);
    adj.set(n, []);
  }
  for (const e of edges) {
    if (!inDegree.has(e.dst)) inDegree.set(e.dst, 0);
    if (!adj.has(e.src)) adj.set(e.src, []);
    adj.get(e.src)!.push(e.dst);
    inDegree.set(e.dst, (inDegree.get(e.dst) || 0) + 1);
  }

  const queue = Array.from(inDegree.entries())
    .filter(([, d]) => d === 0)
    .map(([n]) => n);
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const next of adj.get(node) || []) {
      inDegree.set(next, (inDegree.get(next) || 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  for (const n of nodes) {
    if (!result.includes(n)) result.push(n);
  }

  return result;
}

function fillCoverage(nodes: ConceptNode[], edges: ConceptEdge[], chapters: LiveBookChapter[]): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  const chapterNodeIds = new Set(chapters.map((c) => asConceptId(c.title, c.order)));
  const existingNodeIds = new Set(nodes.map((n) => n.id));

  const newNodes = [...nodes];
  const newEdges = [...edges];

  for (const chapter of chapters) {
    const nodeId = asConceptId(chapter.title, chapter.order);
    if (!existingNodeIds.has(nodeId)) {
      newNodes.push({
        id: nodeId,
        label: chapter.title,
        chapterId: chapter.id,
        description: chapter.goal,
        weight: 0.5,
      });
    }
  }

  for (const chapter of chapters) {
    const nodeId = asConceptId(chapter.title, chapter.order);
    if (nodeId !== 'book_root' && !newEdges.some((e) => e.src === 'book_root' && e.dst === nodeId)) {
      newEdges.push({
        src: 'book_root',
        dst: nodeId,
        relation: 'related',
        rationale: '章节入口',
      });
    }
  }

  const sortedChapters = [...chapters].sort((a, b) => a.order - b.order);
  for (let i = 1; i < sortedChapters.length; i++) {
    const prevId = asConceptId(sortedChapters[i - 1].title, sortedChapters[i - 1].order);
    const currId = asConceptId(sortedChapters[i].title, sortedChapters[i].order);
    if (!newEdges.some((e) => e.src === prevId && e.dst === currId && e.relation === 'depends_on')) {
      newEdges.push({
        src: prevId,
        dst: currId,
        relation: 'depends_on',
        rationale: '先修依赖',
      });
    }
  }

  return { nodes: newNodes, edges: newEdges };
}

function validateAndFixDraft(draft: LLMSpineDraft): { draft: LLMSpineDraft; issues: string[] } {
  const issues: string[] = [];

  const deduped = dedupeChapters(draft.chapters);
  if (deduped.length < draft.chapters.length) {
    issues.push(`发现 ${draft.chapters.length - deduped.length} 个重复章节，已去重`);
  }

  const acyclicEdges = removeCycles(draft.conceptEdges);
  if (acyclicEdges.length < draft.conceptEdges.length) {
    issues.push(`发现循环依赖，已移除 ${draft.conceptEdges.length - acyclicEdges.length} 条边`);
  }

  const hasOverview = deduped.some((c) => c.contentType === 'overview');
  if (!hasOverview) {
    issues.push('缺少导览章节，将自动注入');
  }

  const titles = new Set(deduped.map((c) => c.title));
  for (const ch of deduped) {
    for (const pre of ch.prerequisites) {
      if (!titles.has(pre)) {
        issues.push(`章节「${ch.title}」的先修「${pre}」不存在，将清空`);
        ch.prerequisites = ch.prerequisites.filter((p) => titles.has(p));
      }
    }
  }

  return {
    draft: { ...draft, chapters: deduped, conceptEdges: acyclicEdges },
    issues,
  };
}

function convertDraftToChapters(draft: LLMChapterDraft[]): LiveBookChapter[] {
  return draft.map((c, index) => ({
    id: makeId('ch'),
    title: c.title,
    goal: c.goal,
    order: index + 1,
    difficulty: c.difficulty,
    learningObjectives: c.learningObjectives || [],
    contentType: c.contentType || 'mixed',
    sourceRefs: c.sourceAnchors && c.sourceAnchors.length > 0
      ? c.sourceAnchors.map((a) => ({
          kind: a.kind || 'llm_synthesis',
          ref: a.ref || `chapter:${index + 1}`,
          snippet: a.snippet || `LLM 生成章节：${c.title}`,
        }))
      : [
          {
            kind: 'llm_synthesis',
            ref: `chapter:${index + 1}`,
            snippet: `LLM 生成章节：${c.title}`,
          },
        ],
    prerequisites: c.prerequisites || [],
    summary: c.summary || '',
  }));
}

function convertDraftToConceptGraph(draft: LLMSpineDraft, chapters: LiveBookChapter[]) {
  const nodes: ConceptNode[] = [
    {
      id: 'book_root',
      label: '学习地图',
      description: '整本活书概览',
      weight: 1,
    },
    ...draft.conceptNodes.map((n) => ({
      id: n.id,
      label: n.label,
      description: n.description,
      weight: 0.5,
    })),
  ];

  const edges: ConceptEdge[] = draft.conceptEdges.map((e) => ({
    src: e.src,
    dst: e.dst,
    relation: e.relation,
    rationale: e.rationale,
  }));

  const chapterTitleMap = new Map(chapters.map((c) => [c.title, c.id]));
  for (const node of nodes) {
    if (node.id === 'book_root') continue;
    const matched = chapters.find((c) => c.title.includes(node.label) || node.label.includes(c.title));
    if (matched) {
      node.chapterId = matched.id;
    }
  }

  return fillCoverage(nodes, edges, chapters);
}

// ---------------------------------------------------------------------------
// Chapter-level concept map (like DeepTutor _build_chapter_map)
// ---------------------------------------------------------------------------

function buildChapterMap(
  chapters: LiveBookChapter[],
  rawGraph: { nodes: ConceptNode[]; edges: ConceptEdge[] },
  bookTitle: string,
): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  const slugOf = new Map<string, string>();
  const titleToSlug = new Map<string, string>();
  const conceptToSlug = new Map<string, string>();
  const nodes: ConceptNode[] = [];

  for (let idx = 0; idx < chapters.length; idx++) {
    const ch = chapters[idx];
    let s = slug(ch.title) || `ch_${idx}`;
    const base = s;
    let counter = 2;
    while (nodes.some((n) => n.id === s)) {
      s = `${base}_${counter}`;
      counter += 1;
    }

    slugOf.set(ch.id, s);
    titleToSlug.set(ch.title.trim().toLowerCase(), s);

    const chRecord = ch as unknown as Record<string, unknown>;
    const pydanticExtra = chRecord.__pydantic_extra__ as Record<string, unknown> | undefined;
    const covers = Array.isArray(pydanticExtra?.covers) ? (pydanticExtra.covers as string[]) : [];
    for (const cid of covers) {
      if (!conceptToSlug.has(cid)) conceptToSlug.set(cid, s);
    }

    nodes.push({
      id: s,
      label: ch.title,
      description: ch.summary || '',
      weight: 1.0,
      chapterId: ch.id,
    });
  }

  const seenEdges = new Set<string>();
  const edges: ConceptEdge[] = [];

  for (const edge of rawGraph.edges) {
    if (edge.relation !== 'depends_on') continue;
    const srcSlug = conceptToSlug.get(edge.src);
    const dstSlug = conceptToSlug.get(edge.dst);
    if (!srcSlug || !dstSlug || srcSlug === dstSlug) continue;
    const pair = `${srcSlug}->${dstSlug}`;
    if (seenEdges.has(pair)) continue;
    seenEdges.add(pair);
    edges.push({ src: srcSlug, dst: dstSlug, relation: 'depends_on', rationale: edge.rationale });
  }

  for (const ch of chapters) {
    const dstSlug = slugOf.get(ch.id);
    if (!dstSlug) continue;
    for (const prereqTitle of ch.prerequisites || []) {
      const srcSlug = titleToSlug.get(prereqTitle.trim().toLowerCase());
      if (!srcSlug || srcSlug === dstSlug) continue;
      const pair = `${srcSlug}->${dstSlug}`;
      if (seenEdges.has(pair)) continue;
      seenEdges.add(pair);
      edges.push({ src: srcSlug, dst: dstSlug, relation: 'depends_on', rationale: '' });
    }
  }

  const incoming = new Set(edges.map((e) => e.dst));
  const roots = nodes.filter((n) => !incoming.has(n.id));
  if (roots.length > 1 && bookTitle) {
    let rootSlug = slug(bookTitle) || 'book';
    if (nodes.some((n) => n.id === rootSlug)) {
      rootSlug = `${rootSlug}_root`;
    }
    nodes.unshift({
      id: rootSlug,
      label: bookTitle,
      description: '',
      weight: 1.0,
    });
    for (const rn of roots) {
      edges.push({ src: rootSlug, dst: rn.id, relation: 'related', rationale: '' });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Main synthesizer
// ---------------------------------------------------------------------------

export class SpineSynthesizer {
  async synthesize(book: LiveBookRecord, exploration: LiveBookExplorationReport): Promise<SynthesizedSpine> {
    const topic = (book.topic || '').trim() || '未命名主题';

    // Attempt 1: LLM-first draft
    const draft = await callLLMSpineDraft(topic, exploration);

    if (draft && draft.chapters && draft.chapters.length > 0) {
      // Validate and fix
      const { draft: fixedDraft, issues: validationIssues } = validateAndFixDraft(draft);

      // Attempt critique (optional)
      const critique = await callLLMCritique(fixedDraft, topic);
      const critiqueIssues = critique?.issues || [];

      // Attempt revise if critique indicates issues
      let revisedDraft = fixedDraft;
      if (critique && critique.issues && critique.issues.length > 0 && critique.verdict !== 'ok') {
        const revised = await callLLMRevise(fixedDraft, critique, topic);
        if (revised && revised.chapters && revised.chapters.length > 0) {
          const { draft: validatedRevised } = validateAndFixDraft(revised);
          revisedDraft = validatedRevised;
          critiqueIssues.push('已根据评审意见修订');
        }
      }

      let chapters = convertDraftToChapters(revisedDraft.chapters);
      chapters = injectOverviewChapter(chapters, topic);

      // Store covers on chapters for chapter map building
      for (let i = 0; i < chapters.length; i++) {
        const draftChapter = revisedDraft.chapters[i];
        if (draftChapter?.covers && draftChapter.covers.length > 0) {
          (chapters[i] as unknown as Record<string, unknown>).__pydantic_extra__ = {
            covers: draftChapter.covers,
          };
        }
      }

      // Re-order chapters to respect topological order of concept graph
      const conceptGraph = convertDraftToConceptGraph(revisedDraft, chapters);
      const sortedNodeIds = topologicalSort(
        conceptGraph.nodes.map((n) => n.id),
        conceptGraph.edges,
      );

      const overviewChapters = chapters.filter((c) => c.contentType === 'overview');
      const nonOverviewChapters = chapters.filter((c) => c.contentType !== 'overview');
      const chapterToNodeId = new Map(nonOverviewChapters.map((c) => [c.id, asConceptId(c.title, c.order)]));
      const nodeIdToSortIndex = new Map(sortedNodeIds.map((id, idx) => [id, idx]));

      const sortedNonOverview = [...nonOverviewChapters].sort((a, b) => {
        const idxA = nodeIdToSortIndex.get(chapterToNodeId.get(a.id) || '') ?? 9999;
        const idxB = nodeIdToSortIndex.get(chapterToNodeId.get(b.id) || '') ?? 9999;
        return idxA - idxB;
      });

      chapters = [...overviewChapters, ...sortedNonOverview].map((c, index) => ({
        ...c,
        order: index + 1,
      }));

      // Build chapter-level mind map (like DeepTutor)
      const chapterMap = buildChapterMap(chapters, conceptGraph, book.title || topic);

      return {
        chapters,
        conceptGraphJson: chapterMap,
        critiqueIssues: [...validationIssues, ...critiqueIssues],
      };
    }

    // Fallback: template-based synthesis
    log.info(`LLM spine synthesis failed for topic="${topic}", falling back to template`);
    const templateChapters = buildChaptersTemplate(topic, exploration.candidateConcepts || [], exploration.summary || '');
    const withOverview = injectOverviewChapter(templateChapters, topic);
    return {
      chapters: withOverview,
      conceptGraphJson: buildConceptGraphTemplate(withOverview, exploration.candidateConcepts || []),
      critiqueIssues: ['LLM 生成失败，已回退到模板生成'],
    };
  }
}

export const spineSynthesizer = new SpineSynthesizer();
