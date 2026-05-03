
/**
 * RAG System - Main Entry
 */

export * from './config';
export * from './embedding';
export * from './types';
export * from './bm25';
export * from './vectorStore';

import { initRAGStore, getRAGStore, RAGVectorStore } from './vectorStore';
import { createLogger } from '@/lib/logger';

const log = createLogger('RAG');

let isInitialized = false;

export async function initializeRAG(): Promise<void> {
  if (isInitialized) return;

  log.info('Initializing RAG system...');
  await initRAGStore();
  isInitialized = true;
  log.info('RAG system initialized successfully');
}

export function useRAG(): RAGVectorStore {
  if (!isInitialized) {
    throw new Error('RAG system not initialized. Call initializeRAG first.');
  }
  return getRAGStore();
}

