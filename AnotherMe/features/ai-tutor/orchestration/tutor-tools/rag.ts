
/**
 * RAG 工具 - 检索增强生成
 * 支持两种模式：
 * 1. Legacy 模式：BM25 + n-gram (默认）
 * 2. LlamaIndex 模式：向量检索 + 混合搜索（新）
 */

import type { ToolExecutionContext, ToolExecutionResult } from './types';
import { listClassroomBooks } from '@/lib/server/classroom-book-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAGTool');

interface RAGDocument {
  id: string;
  title: string;
  content: string;
  source: string;
  relevanceScore: number;
}

interface RAGContext {
  notes?: Array<{
    id: string;
    title: string;
    content: string;
    tags: string[];
    subject: string;
    source: string;
    createdAt: number;
  }>;
  classroomBooks?: Array<{
    id: string;
    title: string;
    blocks: Array<{
      title: string;
      content: string;
      type: string;
    }>;
  }>;
  currentStage?: {
    title?: string;
    description?: string;
    scenes?: Array<{
      title?: string;
      content?: string;
    }>;
  };
  userId?: string;
}

function extractNGrams(text: string, n: number = 2): string[] {
  const grams: string[] = [];
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ');

  const chineseChars = cleaned.match(/[\u4e00-\u9fa5]/g);
  if (chineseChars && chineseChars.length >= n) {
    for (let i = 0; i <= chineseChars.length - n; i++) {
      grams.push(chineseChars.slice(i, i + n).join(''));
    }
  }

  const words = cleaned.match(/[a-z0-9]+/g) || [];
  for (const word of words) {
    if (word.length >= 2) {
      grams.push(word);
    }
  }

  return [...new Set(grams)];
}

function calculateBM25Score(
  queryTerms: string[],
  document: string,
  avgDocLength: number,
  k1: number = 1.5,
  b: number = 0.75,
): number {
  const docLength = document.length;
  const docTerms = extractNGrams(document, 2);
  const docTermFreq = new Map<string, number>();

  for (const term of docTerms) {
    docTermFreq.set(term, (docTermFreq.get(term) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const tf = docTermFreq.get(term) || 0;
    if (tf === 0) continue;

    const idf = Math.log(1 + (avgDocLength / (docLength + 1)));
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
    score += idf * (numerator / denominator);
  }

  return score;
}

async function retrieveDocuments(
  query: string,
  context: RAGContext,
  maxResults: number = 5,
): Promise<RAGDocument[]> {
  const documents: RAGDocument[] = [];
  const queryTerms = extractNGrams(query, 2);

  if (queryTerms.length === 0) {
    return [];
  }

  let totalLength = 0;
  let docCount = 0;

  if (context.notes) {
    for (const note of context.notes) {
      const content = `${note.title} ${note.content} ${note.tags.join(' ')}`;
      totalLength += content.length;
      docCount++;
    }
  }

  if (context.classroomBooks) {
    for (const book of context.classroomBooks) {
      for (const block of book.blocks) {
        const content = `${block.title} ${block.content}`;
        totalLength += content.length;
        docCount++;
      }
    }
  }

  if (context.currentStage) {
    const stageContent = [
      context.currentStage.title,
      context.currentStage.description,
      ...(context.currentStage.scenes?.map((s) => `${s.title} ${s.content}`) || []),
    ]
      .filter(Boolean)
      .join(' ');
    totalLength += stageContent.length;
    docCount++;
  }

  const avgDocLength = docCount > 0 ? totalLength / docCount : 100;

  if (context.notes) {
    for (const note of context.notes) {
      const content = `${note.title} ${note.content} ${note.tags.join(' ')}`;
      const score = calculateBM25Score(queryTerms, content, avgDocLength);

      if (score > 0) {
        documents.push({
          id: note.id,
          title: note.title,
          content: note.content.slice(0, 500),
          source: `笔记 (${note.subject})`,
          relevanceScore: score,
        });
      }
    }
  }

  if (context.classroomBooks) {
    for (const book of context.classroomBooks) {
      for (const block of book.blocks) {
        const content = `${block.title} ${block.content}`;
        const score = calculateBM25Score(queryTerms, content, avgDocLength);

        if (score > 0) {
          documents.push({
            id: `${book.id}-${block.title}`,
            title: block.title,
            content: block.content.slice(0, 500),
            source: `课堂资料 (${book.title})`,
            relevanceScore: score,
          });
        }
      }
    }
  }

  if (context.currentStage) {
    const stageContent = [
      context.currentStage.title,
      context.currentStage.description,
      ...(context.currentStage.scenes?.map((s) => `${s.title} ${s.content}`) || []),
    ]
      .filter(Boolean)
      .join(' ');

    const score = calculateBM25Score(queryTerms, stageContent, avgDocLength);
    if (score > 0) {
      documents.push({
        id: 'current-stage',
        title: context.currentStage.title || '当前课堂',
        content: stageContent.slice(0, 500),
        source: '当前课堂',
        relevanceScore: score * 1.2,
      });
    }
  }

  return documents.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, maxResults);
}

async function fetchClassroomBooksFromServer(userId?: string): Promise<RAGContext['classroomBooks']> {
  if (!userId) return undefined;

  try {
    const books = await listClassroomBooks(userId);
    return books.map((book) => ({
      id: book.id,
      title: book.title,
      blocks: book.blocks.map((block) => ({
        title: block.title,
        content: block.content,
        type: block.type,
      })),
    }));
  } catch (error) {
    log.warn('Failed to fetch classroom books:', error);
    return undefined;
  }
}

async function retrieveWithLlamaIndex(
  query: string,
  context: RAGContext,
  maxResults: number,
): Promise<RAGDocument[]> {
  try {
    const { initRAGStore, getRAGStore } = await import('@/lib/rag');
    
    let ragStore;
    try {
      ragStore = getRAGStore();
    } catch {
      ragStore = await initRAGStore();
    }

    const documents: RAGDocument[] = [];

    if (context.notes) {
      for (const note of context.notes) {
        await ragStore.addRawDocument(note.id, note.title, note.content, { source: note.source });
      }
    }

    if (context.classroomBooks) {
      for (const book of context.classroomBooks) {
        for (const block of book.blocks) {
          const content = `${block.title}\n${block.content}`;
          await ragStore.addRawDocument(
            `${book.id}-${block.title}`,
            block.title,
            content,
            { source: `课堂资料 (${book.title})` }
          );
        }
      }
    }

    if (context.currentStage) {
      const content = [
        context.currentStage.title,
        context.currentStage.description,
        ...(context.currentStage.scenes?.map((s) => `${s.title}\n${s.content}`) || []),
      ].filter(Boolean).join('\n');

      if (content) {
        await ragStore.addRawDocument(
          'current-stage',
          context.currentStage.title || '当前课堂',
          content,
          { source: '当前课堂' }
        );
      }
    }

    const result = await ragStore.search(query, { topK: maxResults, useHybrid: true });

    return result.sources.map((source, index) => ({
      id: `llama-${index}`,
      title: source.title,
      content: source.content,
      source: source.source,
      relevanceScore: source.score,
    }));
  } catch (error) {
    log.warn('LlamaIndex not available, falling back to legacy RAG:', error);
    return [];
  }
}

function formatRetrievalResults(documents: RAGDocument[], mode: 'legacy' | 'llamaindex' = 'legacy'): string {
  const modeLabel = mode === 'llamaindex' ? '向量' : '';
  let output = `📚 知识库${modeLabel}检索结果（找到 ${documents.length} 条相关资料）：\n\n`;

  documents.forEach((doc, index) => {
    output += `[${index + 1}] ${doc.title}\n`;
    output += `    来源：${doc.source}\n`;
    output += `    内容：${doc.content.slice(0, 200)}${doc.content.length > 200 ? '...' : ''}\n`;
    if (doc.relevanceScore) {
      output += `    相关性：${(doc.relevanceScore * 100).toFixed(1)}%\n`;
    }
    output += `\n`;
  });

  output += `---\n`;
  output += `请基于以上资料回答用户问题。如果资料不足以回答问题，请明确说明。\n`;

  return output;
}

export async function executeRAG(context: ToolExecutionContext): Promise<ToolExecutionResult> {
  try {
    const { message, config } = context;

    const useLlamaIndex = config.useLlamaIndex || process.env.RAG_USE_LLAMAINDEX === 'true';

    const ragContext: RAGContext = config.ragDataSource || {};

    if (config.userId && !ragContext.classroomBooks) {
      ragContext.classroomBooks = await fetchClassroomBooksFromServer(config.userId);
    }

    if (!ragContext.notes?.length && !ragContext.classroomBooks?.length && !ragContext.currentStage) {
      return {
        success: true,
        output: `📚 知识库检索

暂无本地学习资料。您可以通过以下方式添加：
1. 在课堂中生成知识卡片，自动保存到笔记
2. 使用"拍题视频"功能，保存讲解内容
3. 手动创建学习笔记

用户问题：${message.slice(0, 100)}`,
        metadata: {
          tool: 'rag',
          documentCount: 0,
          mode: useLlamaIndex ? 'llamaindex' : 'legacy',
        },
      };
    }

    const maxResults = config.maxRAGResults || 5;
    let documents: RAGDocument[] = [];
    let mode: 'legacy' | 'llamaindex' = 'legacy';

    if (useLlamaIndex) {
      documents = await retrieveWithLlamaIndex(message, ragContext, maxResults);
      if (documents.length > 0) {
        mode = 'llamaindex';
      }
    }

    if (documents.length === 0) {
      documents = await retrieveDocuments(message, ragContext, maxResults);
      mode = 'legacy';
    }

    if (documents.length === 0) {
      return {
        success: true,
        output: `📚 知识库检索

未找到与问题相关的本地资料。

用户问题：${message.slice(0, 100)}`,
        metadata: {
          tool: 'rag',
          documentCount: 0,
          mode,
        },
      };
    }

    const formattedOutput = formatRetrievalResults(documents, mode);

    return {
      success: true,
      output: formattedOutput,
      metadata: {
        tool: 'rag',
        documentCount: documents.length,
        sources: documents.map((d) => d.source),
        mode,
      },
    };
  } catch (error) {
    log.error('RAG execution failed:', error);
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'RAG 检索失败',
    };
  }
}
