
/**
 * Vector Store with LlamaIndex Integration
 * Hybrid search: BM25 + vector similarity
 */

import fs from 'fs';
import path from 'path';
import { EmbeddingService } from './embedding';
import { BM25Retriever } from './bm25';
import { DocumentChunk, IndexedDocument, RAGSourceSummary, RetrievalResult } from './types';
import { getRAGConfig, RAGConfig } from './config';
import { createLogger } from '@/lib/logger';

const log = createLogger('VectorStore');

type LlamaNodeWithScore = {
  node: {
    metadata: Record<string, unknown>;
    id_: string;
    getContent: (mode?: unknown) => string;
  };
  score?: number;
};

type LlamaIndexModule = {
  Document: new (args: { text: string; metadata: Record<string, unknown> }) => unknown;
  VectorStoreIndex: {
    init: (args: Record<string, unknown>) => Promise<unknown>;
    fromDocuments: (docs: unknown[], options: Record<string, unknown>) => Promise<unknown>;
  };
  StorageContext: {
    fromDefaultPersistDir: (dir: string) => Promise<unknown>;
  };
  serviceContextFromDefaults: (args: Record<string, unknown>) => {
    nodeParser: {
      getNodesFromDocuments: (docs: unknown[]) => unknown[];
    };
  };
  SimpleNodeParser: new (args: Record<string, unknown>) => unknown;
  MetadataMode: { NONE: unknown };
  SimilarityPostprocessor: new (args: Record<string, unknown>) => unknown;
};

type LlamaIndexInstance = {
  storageContext: { persist: (dir: string) => Promise<void> };
  insertNodes: (nodes: unknown[]) => Promise<void>;
  asRetriever: (args: Record<string, unknown>) => {
    retrieve: (args: { query: string }) => Promise<LlamaNodeWithScore[]>;
  };
};

async function loadLlamaIndex(): Promise<LlamaIndexModule | null> {
  try {
    // Use a dynamic import with a literal string to avoid bundler issues
    // while maintaining type safety. The module path is hardcoded and safe.
    const mod = await import('llamaindex');
    return mod as unknown as LlamaIndexModule;
  } catch (error) {
    log.warn('LlamaIndex package is unavailable; vector RAG will be skipped:', error);
    return null;
  }
}

export class RAGVectorStore {
  private config: RAGConfig;
  private embeddingService: EmbeddingService;
  private index: LlamaIndexInstance | null = null;
  private bm25Retriever: BM25Retriever;
  private persistDir: string;
  private isInitialized: boolean = false;
  private llamaIndex: LlamaIndexModule | null | undefined;

  constructor(config?: Partial<RAGConfig>) {
    this.config = { ...getRAGConfig(), ...config };
    this.embeddingService = new EmbeddingService({
      model: this.config.embeddingModel,
    });
    this.bm25Retriever = new BM25Retriever();
    this.persistDir = this.config.persistDir;

    this.ensurePersistDir();
  }

  private ensurePersistDir(): void {
    if (!fs.existsSync(this.persistDir)) {
      fs.mkdirSync(this.persistDir, { recursive: true });
      log.info(`Created persist directory: ${this.persistDir}`);
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const llamaIndex = await this.getLlamaIndex();
      if (!llamaIndex) {
        this.isInitialized = true;
        return;
      }

      const storageDir = path.join(this.persistDir, 'storage');
      if (fs.existsSync(storageDir)) {
        log.info('Loading existing index from storage...');
        const storageContext = await llamaIndex.StorageContext.fromDefaultPersistDir(storageDir);
        this.index = await llamaIndex.VectorStoreIndex.init({
          storageContext,
          logProgress: true,
        }) as LlamaIndexInstance;
        log.info('Index loaded successfully');
      }

      this.isInitialized = true;
    } catch (error) {
      log.warn('Failed to load existing index, will create new one when needed:', error);
    }
  }

  async addDocument(doc: IndexedDocument): Promise<void> {
    const llamaIndex = await this.getLlamaIndex();
    if (!llamaIndex) {
      this.bm25Retriever.addChunks(doc.chunks);
      return;
    }

    log.info(`Adding document: ${doc.title} (${doc.chunks.length} chunks)`);

    const llamaDocs = doc.chunks.map(
      chunk =>
        new llamaIndex.Document({
          text: chunk.text,
          metadata: {
            title: doc.title,
            source: chunk.metadata.source || doc.id,
            chunkId: chunk.id,
            ...chunk.metadata,
          },
        })
    );

    const serviceContext = llamaIndex.serviceContextFromDefaults({
      nodeParser: new llamaIndex.SimpleNodeParser({
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap,
        includeMetadata: true,
        includePrevNextRel: false,
      }),
    });

    if (!this.index) {
      log.info('Creating new vector index...');
      this.index = await llamaIndex.VectorStoreIndex.fromDocuments(llamaDocs, {
        serviceContext,
        logProgress: true,
      }) as LlamaIndexInstance;
    } else {
      log.info('Inserting into existing index...');
      for (const llamaDoc of llamaDocs) {
        const nodes = serviceContext.nodeParser.getNodesFromDocuments([llamaDoc]);
        await this.index.insertNodes(nodes);
      }
    }

    this.bm25Retriever.addChunks(doc.chunks);
    await this.persistIndex();

    log.info(`Document added successfully: ${doc.title}`);
  }

  listSources(): RAGSourceSummary[] {
    return this.bm25Retriever.listSources();
  }

  async addDocuments(docs: IndexedDocument[]): Promise<void> {
    for (const doc of docs) {
      await this.addDocument(doc);
    }
  }

  async addRawDocument(
    id: string,
    title: string,
    text: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const chunks = this.chunkText(text, id, title, metadata);
    const doc: IndexedDocument = {
      id,
      title,
      chunks,
      metadata,
      createdAt: Date.now(),
    };
    await this.addDocument(doc);
  }

  private chunkText(
    text: string,
    docId: string,
    title: string,
    metadata: Record<string, unknown>
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const words = text.split(/\s+/);

    for (let i = 0; i < words.length; i += this.config.chunkSize - this.config.chunkOverlap) {
      const chunkText = words
        .slice(i, i + this.config.chunkSize)
        .join(' ')
        .trim();
      if (chunkText) {
        chunks.push({
          id: `${docId}-chunk-${chunks.length}`,
          text: chunkText,
          metadata: { ...metadata, title, source: docId },
        });
      }
    }

    if (chunks.length === 0 && text.trim()) {
      chunks.push({
        id: `${docId}-chunk-0`,
        text: text.trim(),
        metadata: { ...metadata, title, source: docId },
      });
    }

    return chunks;
  }

  private async persistIndex(): Promise<void> {
    if (!this.index) return;

    const storageDir = path.join(this.persistDir, 'storage');
    this.ensurePersistDir();
    await this.index.storageContext.persist(storageDir);
    log.info(`Index persisted to ${storageDir}`);
  }

  async search(
    query: string,
    options?: { topK?: number; useHybrid?: boolean }
  ): Promise<RetrievalResult> {
    const startTime = Date.now();
    const topK = options?.topK || this.config.topK;
    const useHybrid = options?.useHybrid ?? this.config.hybridSearch;

    log.info(`Searching for: "${query.slice(0, 50)}..." (topK: ${topK}, hybrid: ${useHybrid})`);

    let results: DocumentChunk[] = [];

    if (useHybrid) {
      const [vectorResults, bm25Results] = await Promise.all([
        this.searchVector(query, topK * 2),
        this.searchBM25(query, topK * 2),
      ]);

      results = this.combineResults(vectorResults, bm25Results, topK);
    } else {
      results = await this.searchVector(query, topK);
    }

    const sources = results.map(chunk => ({
      title: typeof chunk.metadata.title === 'string' ? chunk.metadata.title : chunk.id,
      content: chunk.text,
      source: typeof chunk.metadata.source === 'string' ? chunk.metadata.source : 'unknown',
      score: chunk.score || 0,
    }));

    const totalTime = Date.now() - startTime;
    log.info(`Search complete. Found ${results.length} results in ${totalTime}ms`);

    return {
      query,
      chunks: results,
      sources,
      totalTime,
    };
  }

  private async searchVector(query: string, topK: number): Promise<DocumentChunk[]> {
    if (!this.index) {
      log.warn('Index not initialized, returning empty results');
      return [];
    }

    try {
      const llamaIndex = await this.getLlamaIndex();
      if (!llamaIndex) return [];

      const retriever = this.index.asRetriever({
        similarityTopK: topK,
        nodePostprocessors: [new llamaIndex.SimilarityPostprocessor({ similarityCutoff: 0.5 })],
      });

      const nodes = await retriever.retrieve({ query });

      return nodes.map((node: LlamaNodeWithScore) => ({
        id: node.node.metadata.chunkId as string || node.node.id_,
        text: node.node.getContent(llamaIndex.MetadataMode.NONE),
        metadata: { ...node.node.metadata },
        score: node.score || 0,
      }));
    } catch (error) {
      log.error('Vector search failed:', error);
      return [];
    }
  }

  private searchBM25(query: string, topK: number): DocumentChunk[] {
    return this.bm25Retriever.search(query, topK);
  }

  private combineResults(
    vectorResults: DocumentChunk[],
    bm25Results: DocumentChunk[],
    topK: number
  ): DocumentChunk[] {
    const scoreMap = new Map<string, { chunk: DocumentChunk; vectorScore: number; bm25Score: number }>();

    for (const chunk of vectorResults) {
      const normalizedScore = this.normalizeScore(chunk.score || 0, vectorResults);
      scoreMap.set(chunk.id, {
        chunk,
        vectorScore: normalizedScore * this.config.vectorWeight,
        bm25Score: 0,
      });
    }

    for (const chunk of bm25Results) {
      const normalizedScore = this.normalizeScore(chunk.score || 0, bm25Results);
      const existing = scoreMap.get(chunk.id);
      if (existing) {
        existing.bm25Score = normalizedScore * this.config.bm25Weight;
      } else {
        scoreMap.set(chunk.id, {
          chunk,
          vectorScore: 0,
          bm25Score: normalizedScore * this.config.bm25Weight,
        });
      }
    }

    const combined = Array.from(scoreMap.values()).map(({ chunk, vectorScore, bm25Score }) => ({
      ...chunk,
      score: vectorScore + bm25Score,
    }));

    return combined.sort((a, b) => b.score! - a.score!).slice(0, topK);
  }

  private normalizeScore(score: number, results: DocumentChunk[]): number {
    if (results.length === 0) return 0;
    const min = Math.min(...results.map(r => r.score || 0));
    const max = Math.max(...results.map(r => r.score || 0));
    if (max - min === 0) return 1;
    return (score - min) / (max - min);
  }

  async clear(): Promise<void> {
    this.index = null;
    this.bm25Retriever = new BM25Retriever();

    const storageDir = path.join(this.persistDir, 'storage');
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true });
    }

    log.info('Vector store cleared');
  }

  getStats(): {
    hasIndex: boolean;
    persistDir: string;
    config: RAGConfig;
  } {
    return {
      hasIndex: this.index !== null,
      persistDir: this.persistDir,
      config: this.config,
    };
  }

  private async getLlamaIndex(): Promise<LlamaIndexModule | null> {
    if (this.llamaIndex !== undefined) return this.llamaIndex;
    this.llamaIndex = await loadLlamaIndex();
    return this.llamaIndex;
  }
}

export let ragStore: RAGVectorStore | null = null;

export async function initRAGStore(config?: Partial<RAGConfig>): Promise<RAGVectorStore> {
  if (!ragStore) {
    ragStore = new RAGVectorStore(config);
    await ragStore.initialize();
  }
  return ragStore;
}

export function getRAGStore(): RAGVectorStore {
  if (!ragStore) {
    throw new Error('RAG store not initialized. Call initRAGStore first.');
  }
  return ragStore;
}
