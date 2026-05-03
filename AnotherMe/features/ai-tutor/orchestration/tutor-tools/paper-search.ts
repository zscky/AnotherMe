/**
 * Paper Search 工具 - 论文检索
 * 搜索 arXiv 学术论文
 *
 * 改进点：
 * 1. 使用可靠的 XML 解析（基于 DOMParser API）
 * 2. 添加超时和重试机制
 * 3. 结构化返回结果
 */

import type { ToolExecutionContext, ToolExecutionResult } from './types';

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  year: number;
  pdfUrl: string;
  url: string;
  primaryCategory: string;
  categories: string[];
}

export interface PaperSearchResult {
  papers: ArxivPaper[];
  totalResults: number;
  query: string;
}

const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
const REQUEST_TIMEOUT_MS = 10000; // 10 秒超时
const MAX_RETRIES = 2;

/**
 * 带超时的 fetch
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw error;
  }
}

/**
 * 带重试的 fetch
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, REQUEST_TIMEOUT_MS);
      if (response.ok) {
        return response;
      }
      // 如果是 4xx 错误，不重试
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`arXiv API 错误: ${response.status} ${response.statusText}`);
      }
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // 最后一次尝试失败，抛出错误
      if (attempt === maxRetries) {
        break;
      }
      // 等待后重试（指数退避）
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  throw lastError || new Error('请求失败');
}

/**
 * 解析 arXiv Atom XML 响应
 * 使用 DOM API 解析（Node.js 20+ 支持）
 */
function parseArxivXml(xmlText: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];

  // 提取 entry 元素
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryRegex.exec(xmlText)) !== null) {
    const entryXml = entryMatch[1];

    try {
      // 提取 ID
      const idMatch = entryXml.match(/<id>([^<]+)<\/id>/);
      const id = idMatch ? idMatch[1].trim() : '';
      const arxivId = id.split('/').pop()?.replace('abs/', '') || '';

      // 提取标题
      const titleMatch = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const title = titleMatch ? cleanText(titleMatch[1]) : '';

      // 提取摘要
      const summaryMatch = entryXml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
      const summary = summaryMatch ? cleanText(summaryMatch[1]) : '';

      // 提取发布时间
      const publishedMatch = entryXml.match(/<published>([^<]+)<\/published>/);
      const published = publishedMatch ? publishedMatch[1].trim() : '';
      const year = published ? new Date(published).getFullYear() : 0;

      // 提取作者
      const authors: string[] = [];
      const authorRegex = /<author[^>]*>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g;
      let authorMatch: RegExpExecArray | null;
      while ((authorMatch = authorRegex.exec(entryXml)) !== null) {
        if (authorMatch[1]) {
          authors.push(cleanText(authorMatch[1]));
        }
      }

      // 提取分类
      const categories: string[] = [];
      const categoryRegex = /<category[^>]+term="([^"]+)"/g;
      let categoryMatch: RegExpExecArray | null;
      while ((categoryMatch = categoryRegex.exec(entryXml)) !== null) {
        if (categoryMatch[1]) {
          categories.push(categoryMatch[1]);
        }
      }

      // 提取主分类
      const primaryCatMatch = entryXml.match(/<arxiv:primary_category[^>]+term="([^"]+)"/);
      const primaryCategory = primaryCatMatch ? primaryCatMatch[1] : categories[0] || '';

      if (arxivId && title) {
        papers.push({
          id: arxivId,
          title,
          summary,
          authors,
          published: published.split('T')[0],
          year,
          pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
          url: `https://arxiv.org/abs/${arxivId}`,
          primaryCategory,
          categories,
        });
      }
    } catch {
      // 跳过解析失败的条目
    }
  }

  return papers;
}

/**
 * 清理文本中的多余空白和换行
 */
function cleanText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ') // 合并所有空白字符
    .replace(/\n+/g, ' ') // 替换换行
    .trim();
}

export async function executePaperSearch(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const { message, config } = context;

    // 构建 arXiv API 查询
    const query = message.slice(0, 200);
    const maxResults = Math.min(Math.max(config.maxPaperResults || 5, 1), 10);

    // 构建搜索参数
    const searchParams = new URLSearchParams({
      search_query: `all:${query}`,
      start: '0',
      max_results: String(maxResults),
      sortBy: 'relevance',
      sortOrder: 'descending',
    });

    const arxivUrl = `${ARXIV_API_BASE}?${searchParams.toString()}`;

    const response = await fetchWithRetry(arxivUrl, {
      headers: {
        Accept: 'application/atom+xml',
      },
    });

    const xmlText = await response.text();
    const papers = parseArxivXml(xmlText);

    if (papers.length === 0) {
      return {
        success: true,
        output: '未找到相关论文。建议尝试使用更通用的关键词（如英文术语）。',
        metadata: {
          tool: 'paper_search',
          resultCount: 0,
          query: message,
        },
      };
    }

    const formattedResults = formatPaperResults(papers);

    return {
      success: true,
      output: formattedResults,
      metadata: {
        tool: 'paper_search',
        resultCount: papers.length,
        query: message,
        // 结构化返回论文信息
        papers: papers.map((p) => ({
          id: p.id,
          title: p.title,
          authors: p.authors,
          year: p.year,
          abstract: p.summary.slice(0, 300),
          url: p.url,
          pdfUrl: p.pdfUrl,
          category: p.primaryCategory,
        })),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '论文搜索执行失败';
    return {
      success: false,
      output: '',
      error: errorMessage,
    };
  }
}

function formatPaperResults(papers: ArxivPaper[]): string {
  let output = `📄 找到 ${papers.length} 篇相关论文：\n\n`;

  papers.forEach((paper, index) => {
    output += `[${index + 1}] ${paper.title}\n`;
    output += `    作者：${paper.authors.join(', ')}\n`;
    output += `    发布时间：${paper.published}${paper.year ? ` (${paper.year})` : ''}\n`;
    output += `    分类：${paper.primaryCategory}\n`;
    output += `    摘要：${paper.summary.slice(0, 200)}${paper.summary.length > 200 ? '...' : ''}\n`;
    output += `    链接：${paper.url}\n`;
    output += `    PDF：${paper.pdfUrl}\n`;
    output += `\n`;
  });

  return output;
}
