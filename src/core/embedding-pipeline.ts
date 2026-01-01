/**
 * Embedding Pipeline - Generate embeddings for semantic search
 */

import { Logger } from '../utils/logger';
import {
  IEmbeddingProvider,
  LocalProvider,
  OpenAIProvider,
  GoogleProvider,
  GenericProvider,
  EmbeddingResult
} from './embedding-providers';

declare const Zotero: any;

export interface EmbeddingProgress {
  current: number;
  total: number;
  currentTitle: string;
  status: 'loading' | 'processing' | 'done' | 'error';
}

export type ProgressCallback = (progress: EmbeddingProgress) => void;

/**
 * Embedding Pipeline that delegates to a provider
 */
export class EmbeddingPipeline {
  private logger: Logger;
  private provider: IEmbeddingProvider | null = null;
  private ready = false;

  constructor() {
    this.logger = new Logger('EmbeddingPipeline');
  }

  /**
   * Initialize the embedding pipeline by selecting the correct provider
   */
  async init(): Promise<void> {
    if (this.ready) return;

    this.logger.info('Initializing embedding pipeline...');

    try {
      // Load configuration from Zotero preferences
      const providerType = Zotero.Prefs.get('zotseek.embeddingProvider', true) || 'local';
      const modelId = Zotero.Prefs.get('zotseek.embeddingModel', true);
      const apiKey = Zotero.Prefs.get('zotseek.apiKey', true);
      const apiEndpoint = Zotero.Prefs.get('zotseek.apiEndpoint', true);

      this.logger.info(`Using embedding provider: ${providerType}`);

      switch (providerType) {
        case 'openai':
          this.provider = new OpenAIProvider(apiKey, modelId || 'text-embedding-3-small');
          break;
        case 'google':
          this.provider = new GoogleProvider(apiKey, modelId || 'text-embedding-004');
          break;
        case 'generic':
          this.provider = new GenericProvider(apiEndpoint, apiKey, modelId || 'custom-model');
          break;
        case 'local':
        default:
          this.provider = new LocalProvider();
          break;
      }

      await this.provider.init();
      this.ready = true;
      this.logger.info(`Embedding pipeline ready with ${this.provider.getModelId()}`);
    } catch (error) {
      this.logger.error(`Failed to initialize embedding pipeline: ${error}`);
      throw error;
    }
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string, isQuery: boolean = false): Promise<EmbeddingResult> {
    if (!this.ready) {
      await this.init();
    }

    if (!this.provider) {
      throw new Error('Embedding provider not initialized');
    }

    return this.provider.embed(text, isQuery);
  }

  /**
   * Convenience method for embedding search queries
   */
  async embedQuery(query: string): Promise<EmbeddingResult> {
    return this.embed(query, true);
  }

  /**
   * Convenience method for embedding documents
   */
  async embedDocument(text: string): Promise<EmbeddingResult> {
    return this.embed(text, false);
  }

  /**
   * Generate embeddings for multiple texts with progress callback
   */
  async embedBatch(
    texts: { id: number; text: string; title: string }[],
    onProgress?: ProgressCallback
  ): Promise<Map<number, EmbeddingResult>> {
    if (!this.ready) {
      await this.init();
    }

    const results = new Map<number, EmbeddingResult>();
    const total = texts.length;

    for (let i = 0; i < texts.length; i++) {
      const { id, text, title } = texts[i];

      if (onProgress) {
        onProgress({
          current: i + 1,
          total,
          currentTitle: title,
          status: 'processing',
        });
      }

      try {
        const result = await this.embedDocument(text);
        results.set(id, result);
      } catch (error) {
        this.logger.error(`Failed to embed item ${id}:`, error);
      }

      // Yield to UI thread periodically
      if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    if (onProgress) {
      onProgress({
        current: total,
        total,
        currentTitle: '',
        status: 'done',
      });
    }

    return results;
  }

  /**
   * Check if pipeline is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Reset pipeline to force re-initialization with new settings
   */
  reset(): void {
    this.logger.info('Resetting embedding pipeline');
    if (this.provider?.destroy) {
      this.provider.destroy();
    }
    this.provider = null;
    this.ready = false;
  }

  /**
   * Get current model ID
   */
  getModelId(): string {
    return this.provider ? this.provider.getModelId() : 'unknown';
  }

  /**
   * Get model info
   */
  getModelInfo(): { id: string; dimensions?: number; description: string } {
    const id = this.getModelId();
    return {
      id,
      description: `Embedding provider: ${id}`,
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.provider?.destroy) {
      this.provider.destroy();
    }
    this.provider = null;
  }
}

// Singleton instance
export const embeddingPipeline = new EmbeddingPipeline();
