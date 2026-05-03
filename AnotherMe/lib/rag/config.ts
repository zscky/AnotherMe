
/**
 * RAG System Configuration
 */

export interface RAGConfig {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  embeddingModel: string;
  persistDir: string;
  hybridSearch: boolean;
  bm25Weight: number;
  vectorWeight: number;
}

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  chunkSize: 512,
  chunkOverlap: 50,
  topK: 5,
  embeddingModel: 'text-embedding-ada-002',
  persistDir: './data/rag',
  hybridSearch: true,
  bm25Weight: 0.5,
  vectorWeight: 0.5,
};

export function getRAGConfig(): RAGConfig {
  return {
    ...DEFAULT_RAG_CONFIG,
    chunkSize: process.env.RAG_CHUNK_SIZE ? parseInt(process.env.RAG_CHUNK_SIZE, 10) : DEFAULT_RAG_CONFIG.chunkSize,
    chunkOverlap: process.env.RAG_CHUNK_OVERLAP ? parseInt(process.env.RAG_CHUNK_OVERLAP, 10) : DEFAULT_RAG_CONFIG.chunkOverlap,
    topK: process.env.RAG_TOP_K ? parseInt(process.env.RAG_TOP_K, 10) : DEFAULT_RAG_CONFIG.topK,
    embeddingModel: process.env.RAG_EMBEDDING_MODEL || DEFAULT_RAG_CONFIG.embeddingModel,
    persistDir: process.env.RAG_PERSIST_DIR || DEFAULT_RAG_CONFIG.persistDir,
    hybridSearch: process.env.RAG_HYBRID_SEARCH !== 'false',
    bm25Weight: process.env.RAG_BM25_WEIGHT ? parseFloat(process.env.RAG_BM25_WEIGHT) : DEFAULT_RAG_CONFIG.bm25Weight,
    vectorWeight: process.env.RAG_VECTOR_WEIGHT ? parseFloat(process.env.RAG_VECTOR_WEIGHT) : DEFAULT_RAG_CONFIG.vectorWeight,
  };
}

