
/**
 * Embedding Service
 * Supports OpenAI-compatible embedding APIs
 */

import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';

const log = createLogger('EmbeddingService');

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

export class EmbeddingService {
  private client: OpenAI;
  private model: string;

  constructor(config?: { apiKey?: string; baseURL?: string; model?: string }) {
    this.client = new OpenAI({
      apiKey: config?.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config?.baseURL || process.env.OPENAI_BASE_URL,
      dangerouslyAllowBrowser: false,
    });
    this.model = config?.model || process.env.RAG_EMBEDDING_MODEL || 'text-embedding-ada-002';
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { vectors: [], model: this.model, usage: { promptTokens: 0, totalTokens: 0 } };
    }

    log.info(`Embedding ${texts.length} text(s) with model ${this.model}`);

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });

      return {
        vectors: response.data.map(d => d.embedding),
        model: this.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      log.error('Embedding failed:', error);
      throw new Error(`Embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async embedQuery(text: string): Promise<number[]> {
    const result = await this.embed([text]);
    return result.vectors[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const batchSize = 100;
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const result = await this.embed(batch);
      allVectors.push(...result.vectors);
    }

    return allVectors;
  }
}

export const embeddingService = new EmbeddingService();

