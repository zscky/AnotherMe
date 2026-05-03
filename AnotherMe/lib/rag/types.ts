
/**
 * RAG System Types
 */

export interface DocumentChunk {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  score?: number;
}

export interface IndexedDocument {
  id: string;
  title: string;
  chunks: DocumentChunk[];
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface RetrievalResult {
  query: string;
  chunks: DocumentChunk[];
  sources: Array<{
    title: string;
    content: string;
    source: string;
    score: number;
  }>;
  totalTime: number;
}

export interface RAGSourceSummary {
  id: string;
  title: string;
  source: string;
  kbId?: string;
  kbName?: string;
  chunkCount: number;
}

export interface BM25Config {
  k1: number;
  b: number;
}

export const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.5,
  b: 0.75,
};
