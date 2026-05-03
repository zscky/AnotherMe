
/**
 * BM25 Keyword Retrieval
 * Chinese-friendly implementation
 */

import { BM25Config, DEFAULT_BM25_CONFIG, DocumentChunk, RAGSourceSummary } from './types';
import { createLogger } from '@/lib/logger';

const log = createLogger('BM25Retriever');

function extractNGrams(text: string, n: number = 2): string[] {
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ');
  const grams: string[] = [];

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

export class BM25Retriever {
  private chunks: DocumentChunk[] = [];
  private termFreq: Map<string, Map<string, number>> = new Map();
  private docFreq: Map<string, number> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private config: BM25Config;

  constructor(config?: Partial<BM25Config>) {
    this.config = { ...DEFAULT_BM25_CONFIG, ...config };
  }

  addChunks(chunks: DocumentChunk[]): void {
    this.chunks = chunks;
    this.buildIndex();
  }

  private buildIndex(): void {
    log.info(`Building BM25 index for ${this.chunks.length} chunks`);

    this.termFreq.clear();
    this.docFreq.clear();
    this.docLengths.clear();

    let totalLength = 0;

    for (const chunk of this.chunks) {
      const terms = extractNGrams(chunk.text);
      this.docLengths.set(chunk.id, terms.length);
      totalLength += terms.length;

      const tf = new Map<string, number>();
      for (const term of terms) {
        tf.set(term, (tf.get(term) || 0) + 1);
      }
      this.termFreq.set(chunk.id, tf);

      for (const term of new Set(terms)) {
        this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
      }
    }

    this.avgDocLength = this.chunks.length > 0 ? totalLength / this.chunks.length : 0;
    log.info(`BM25 index built. Avg doc length: ${this.avgDocLength.toFixed(2)}`);
  }

  search(query: string, topK: number = 5): DocumentChunk[] {
    const queryTerms = extractNGrams(query);
    if (queryTerms.length === 0) {
      return [];
    }

    const scores = new Map<string, number>();

    for (const chunk of this.chunks) {
      const docTf = this.termFreq.get(chunk.id) || new Map();
      const docLen = this.docLengths.get(chunk.id) || 0;

      let score = 0;

      for (const term of queryTerms) {
        const f = docTf.get(term) || 0;
        if (f === 0) continue;

        const n = this.chunks.length;
        const df = this.docFreq.get(term) || 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));

        const numerator = f * (this.config.k1 + 1);
        const denominator = f + this.config.k1 * (1 - this.config.b + this.config.b * (docLen / this.avgDocLength));
        score += idf * (numerator / denominator);
      }

      scores.set(chunk.id, score);
    }

    const sortedChunks = this.chunks
      .map(chunk => ({ ...chunk, score: scores.get(chunk.id) || 0 }))
      .filter(chunk => chunk.score! > 0)
      .sort((a, b) => b.score! - a.score!)
      .slice(0, topK);

    return sortedChunks;
  }

  listSources(): RAGSourceSummary[] {
    const grouped = new Map<string, RAGSourceSummary>();

    for (const chunk of this.chunks) {
      const metadata = chunk.metadata || {};
      const kbId = typeof metadata.kbId === 'string' ? metadata.kbId : undefined;
      const kbName = typeof metadata.kbName === 'string' ? metadata.kbName : undefined;
      const source = typeof metadata.source === 'string' ? metadata.source : chunk.id;
      const title = typeof metadata.title === 'string' ? metadata.title : kbName || source;
      const id = kbId || kbName || source || chunk.id;
      const existing = grouped.get(id);

      if (existing) {
        existing.chunkCount += 1;
      } else {
        grouped.set(id, {
          id,
          title,
          source,
          ...(kbId ? { kbId } : {}),
          ...(kbName ? { kbName } : {}),
          chunkCount: 1,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.chunkCount - a.chunkCount);
  }
}
