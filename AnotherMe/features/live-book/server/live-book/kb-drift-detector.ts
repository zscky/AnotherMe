import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';
import type {
  LiveBookChapter,
  LiveBookPage,
  LiveBookRecord,
  LiveBookSourceInput,
} from '@/lib/server/live-book-store';

const log = createLogger('KBDriftDetector');

export interface KBDriftReport {
  bookId: string;
  overallStatus: 'healthy' | 'stale' | 'drifted' | 'error';
  pageReports: PageDriftReport[];
  summary: {
    totalPages: number;
    healthyPages: number;
    stalePages: number;
    driftedPages: number;
    errorPages: number;
  };
  recommendations: string[];
  checkedAt: number;
}

export interface PageDriftReport {
  pageId: string;
  pageTitle: string;
  chapterId: string;
  chapterTitle: string;
  status: 'healthy' | 'stale' | 'drifted' | 'error';
  reasons: string[];
  fingerprintMismatch?: boolean;
  sourceChanged?: boolean;
  contentOutdated?: boolean;
  kbChanged?: boolean;
  suggestedAction: 'recompile' | 'review' | 'none';
}

export interface KBDriftCheckOptions {
  checkFingerprints?: boolean;
  checkSources?: boolean;
  checkKB?: boolean;
  useLLM?: boolean;
}

function createHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function computeContentFingerprint(page: LiveBookPage): string {
  const blockData = page.blocks.map((b) => `${b.type}:${b.title}:${b.content.slice(0, 100)}`).join('|');
  return createHash(`${page.title}|${page.status}|${blockData}`);
}

function computeSourceFingerprint(sources: LiveBookSourceInput[]): string {
  const data = sources
    .map((s) => `${s.kind}:${s.text.slice(0, 100)}:${s.weight}`)
    .join('|');
  return createHash(data);
}

async function checkPageWithLLM(
  book: LiveBookRecord,
  page: LiveBookPage,
  chapter: LiveBookChapter,
  options?: KBDriftCheckOptions,
): Promise<PageDriftReport | null> {
  if (options?.useLLM === false) return null;

  try {
    const isZh = book.language === 'zh-CN';
    const blockSummary = page.blocks
      .map((b) => `[${b.type}] ${b.title}`)
      .join('\n');

    const prompt = `${isZh ? '你是一位知识库质量审核员，负责检测活书页面内容是否过时或需要更新。' : 'You are a knowledge base quality auditor, checking if live book pages need updates.'}

${isZh ? '主题' : 'Topic'}: ${book.topic}
${isZh ? '章节' : 'Chapter'}: ${chapter.title}
${isZh ? '页面' : 'Page'}: ${page.title}
${isZh ? '章节目标' : 'Chapter Goal'}: ${chapter.goal || ''}

${isZh ? '页面内容块' : 'Page Blocks'}:
${blockSummary}

${isZh ? '任务' : 'Task'}: ${isZh ? '分析这个页面是否存在以下问题（只输出JSON）：' : 'Analyze if this page has the following issues (output JSON only):'}
1. ${isZh ? '内容是否完整' : 'Is content complete?'}
2. ${isZh ? '是否有明显的错误或过时的信息' : 'Any obvious errors or outdated info?'}
3. ${isZh ? '内容块类型是否合理' : 'Are block types reasonable?'}

${isZh ? '输出格式' : 'Output format'}:
{
  "status": "healthy|stale|drifted",
  "reasons": ["${isZh ? '原因1' : 'reason1'}"],
  "suggestedAction": "none|recompile|review"
}`;

    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: isZh
          ? '你是一位知识库质量审核员，只输出JSON格式的审核结果。'
          : 'You are a knowledge base auditor. Output only JSON format audit results.',
        prompt,
        maxOutputTokens: 512,
        temperature: 0.2,
      },
      'kb-drift-detector',
      { retries: 1, validate: (text) => text.includes('status') && text.includes('suggestedAction') },
    );

    const cleaned = result.text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned) as {
      status: string;
      reasons: string[];
      suggestedAction: string;
    };

    const validStatuses = ['healthy', 'stale', 'drifted', 'error'] as const;
    const validActions = ['none', 'recompile', 'review'] as const;

    return {
      pageId: page.id,
      pageTitle: page.title,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      status: validStatuses.includes(parsed.status as typeof validStatuses[number]) ? (parsed.status as typeof validStatuses[number]) : 'healthy',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      suggestedAction: validActions.includes(parsed.suggestedAction as typeof validActions[number]) ? (parsed.suggestedAction as typeof validActions[number]) : 'none',
    };
  } catch (error) {
    log.warn('LLM drift check failed for page:', page.id, error);
    return null;
  }
}

export async function detectKBDrift(
  book: LiveBookRecord,
  options?: KBDriftCheckOptions,
): Promise<KBDriftReport> {
  const checkedAt = Date.now();
  const pageReports: PageDriftReport[] = [];

  // Get stored fingerprints from conceptGraphJson
  const conceptGraph = book.conceptGraphJson || {};
  const storedFingerprints = (conceptGraph.pageFingerprints as Record<string, string>) || {};
  const storedSourceFingerprint = (conceptGraph.sourceFingerprint as string) || '';

  // Compute current source fingerprint
  const currentSources = Array.isArray(conceptGraph.inputSources)
    ? (conceptGraph.inputSources as LiveBookSourceInput[])
    : [];
  const currentSourceFingerprint = computeSourceFingerprint(currentSources);
  const sourceChanged = storedSourceFingerprint && storedSourceFingerprint !== currentSourceFingerprint;

  for (const page of book.pages) {
    const chapter = book.chapters.find((c) => c.id === page.chapterId);
    if (!chapter) {
      pageReports.push({
        pageId: page.id,
        pageTitle: page.title,
        chapterId: page.chapterId,
        chapterTitle: 'Unknown',
        status: 'error',
        reasons: ['Chapter not found'],
        suggestedAction: 'review',
      });
      continue;
    }

    const reasons: string[] = [];
    let status: PageDriftReport['status'] = 'healthy';
    let suggestedAction: PageDriftReport['suggestedAction'] = 'none';

    // Check 1: Page status
    if (page.status === 'pending') {
      status = 'stale';
      reasons.push('Page has not been compiled yet');
      suggestedAction = 'recompile';
    } else if (page.status === 'error') {
      status = 'error';
      reasons.push('Page compilation failed');
      suggestedAction = 'recompile';
    } else if (page.status === 'partial') {
      status = 'stale';
      reasons.push('Page has partial compilation errors');
      suggestedAction = 'recompile';
    }

    // Check 2: Fingerprint mismatch
    if (options?.checkFingerprints !== false) {
      const currentFingerprint = computeContentFingerprint(page);
      const storedFingerprint = storedFingerprints[page.id];
      if (storedFingerprint && storedFingerprint !== currentFingerprint) {
        status = status === 'healthy' ? 'drifted' : status;
        reasons.push('Content fingerprint mismatch - page may have been modified externally');
        if (suggestedAction === 'none') suggestedAction = 'review';
      }
    }

    // Check 3: Source changes
    if (options?.checkSources !== false && sourceChanged) {
      status = status === 'healthy' ? 'drifted' : status;
      reasons.push('Input sources have changed since last compilation');
      if (suggestedAction === 'none') suggestedAction = 'recompile';
    }

    // Check 4: Empty or minimal blocks
    if (page.blocks.length === 0) {
      status = 'stale';
      reasons.push('Page has no content blocks');
      suggestedAction = 'recompile';
    } else if (page.blocks.length < 2 && page.blocks[0]?.type === 'section') {
      status = 'stale';
      reasons.push('Page has minimal content');
      suggestedAction = 'recompile';
    }

    // Check 5: Block errors
    const errorBlocks = page.blocks.filter((b) => b.status === 'error' || b.error);
    if (errorBlocks.length > 0) {
      status = status === 'healthy' ? 'stale' : status;
      reasons.push(`${errorBlocks.length} blocks have errors`);
      if (suggestedAction === 'none') suggestedAction = 'recompile';
    }

    // Check 6: LLM-based content quality check
    if (options?.useLLM !== false && status === 'healthy') {
      const llmReport = await checkPageWithLLM(book, page, chapter, options);
      if (llmReport && llmReport.status !== 'healthy') {
        status = llmReport.status;
        reasons.push(...llmReport.reasons);
        suggestedAction = llmReport.suggestedAction;
      }
    }

    pageReports.push({
      pageId: page.id,
      pageTitle: page.title,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      status,
      reasons: reasons.length > 0 ? reasons : ['No issues detected'],
      fingerprintMismatch: options?.checkFingerprints !== false
        ? storedFingerprints[page.id] !== computeContentFingerprint(page)
        : undefined,
      sourceChanged: sourceChanged || undefined,
      suggestedAction,
    });
  }

  // Compute summary
  const healthyPages = pageReports.filter((r) => r.status === 'healthy').length;
  const stalePages = pageReports.filter((r) => r.status === 'stale').length;
  const driftedPages = pageReports.filter((r) => r.status === 'drifted').length;
  const errorPages = pageReports.filter((r) => r.status === 'error').length;

  const overallStatus: KBDriftReport['overallStatus'] =
    errorPages > 0 ? 'error' :
    driftedPages > 0 ? 'drifted' :
    stalePages > 0 ? 'stale' :
    'healthy';

  // Generate recommendations
  const recommendations: string[] = [];
  const isZh = book.language === 'zh-CN';

  if (errorPages > 0) {
    recommendations.push(isZh
      ? `有 ${errorPages} 个页面编译失败，建议重新编译。`
      : `${errorPages} pages failed to compile. Recompilation recommended.`);
  }
  if (stalePages > 0) {
    recommendations.push(isZh
      ? `有 ${stalePages} 个页面内容不完整，建议补充编译。`
      : `${stalePages} pages have incomplete content. Compilation recommended.`);
  }
  if (driftedPages > 0) {
    recommendations.push(isZh
      ? `有 ${driftedPages} 个页面可能已过时，建议审核更新。`
      : `${driftedPages} pages may be outdated. Review and update recommended.`);
  }
  if (sourceChanged) {
    recommendations.push(isZh
      ? '输入来源已变更，建议重新编译整本书。'
      : 'Input sources have changed. Full recompilation recommended.');
  }
  if (recommendations.length === 0) {
    recommendations.push(isZh
      ? '所有页面状态良好，无需操作。'
      : 'All pages are healthy. No action needed.');
  }

  return {
    bookId: book.id,
    overallStatus,
    pageReports,
    summary: {
      totalPages: book.pages.length,
      healthyPages,
      stalePages,
      driftedPages,
      errorPages,
    },
    recommendations,
    checkedAt,
  };
}

// Quick check function for health endpoint
export async function quickDriftCheck(book: LiveBookRecord): Promise<{
  ok: boolean;
  stalePageIds: string[];
  driftedPageIds: string[];
  errorPageIds: string[];
}> {
  const report = await detectKBDrift(book, {
    checkFingerprints: true,
    checkSources: true,
    checkKB: false,
    useLLM: false,
  });

  return {
    ok: report.overallStatus === 'healthy',
    stalePageIds: report.pageReports.filter((r) => r.status === 'stale').map((r) => r.pageId),
    driftedPageIds: report.pageReports.filter((r) => r.status === 'drifted').map((r) => r.pageId),
    errorPageIds: report.pageReports.filter((r) => r.status === 'error').map((r) => r.pageId),
  };
}
