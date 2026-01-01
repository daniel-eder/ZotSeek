/**
 * Embedding Providers - Abstract interface and implementations for different providers
 */

import { Logger } from '../utils/logger';

export interface EmbeddingResult {
  embedding: number[];
  modelId: string;
  processingTimeMs: number;
}

export interface IEmbeddingProvider {
  init(): Promise<void>;
  embed(text: string, isQuery?: boolean): Promise<EmbeddingResult>;
  getModelId(): string;
  destroy?(): void;
}

/**
 * OpenAI Provider
 */
export class OpenAIProvider implements IEmbeddingProvider {
  private logger: Logger;
  private apiKey: string;
  private modelId: string;

  constructor(apiKey: string, modelId: string = 'text-embedding-3-small') {
    this.logger = new Logger('OpenAIProvider');
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('OpenAI API Key is required');
    }
  }

  async embed(text: string, isQuery: boolean = false): Promise<EmbeddingResult> {
    const startTime = Date.now();

    // Zotero 8 has native fetch support
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text,
        model: this.modelId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API error: ${error?.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const embedding = data.data[0].embedding;
    const processingTimeMs = Date.now() - startTime;

    return {
      embedding,
      modelId: this.modelId,
      processingTimeMs,
    };
  }

  getModelId(): string {
    return this.modelId;
  }
}

/**
 * Google Gemini Provider
 */
export class GoogleProvider implements IEmbeddingProvider {
  private logger: Logger;
  private apiKey: string;
  private modelId: string;

  constructor(apiKey: string, modelId: string = 'text-embedding-004') {
    this.logger = new Logger('GoogleProvider');
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Google API Key is required');
    }
  }

  async embed(text: string, isQuery: boolean = false): Promise<EmbeddingResult> {
    const startTime = Date.now();

    const taskType = isQuery ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:embedContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
        taskType,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Google API error: ${error?.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const embedding = data.embedding.values;
    const processingTimeMs = Date.now() - startTime;

    return {
      embedding,
      modelId: this.modelId,
      processingTimeMs,
    };
  }

  getModelId(): string {
    return this.modelId;
  }
}

/**
 * Generic OpenAI-Compatible Provider (e.g., Ollama)
 */
export class GenericProvider implements IEmbeddingProvider {
  private logger: Logger;
  private apiKey: string;
  private modelId: string;
  private endpoint: string;

  constructor(endpoint: string, apiKey: string, modelId: string) {
    this.logger = new Logger('GenericProvider');
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  async init(): Promise<void> {
    if (!this.endpoint) {
      throw new Error('API Endpoint is required for Generic provider');
    }
  }

  async embed(text: string, isQuery: boolean = false): Promise<EmbeddingResult> {
    const startTime = Date.now();

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        input: text,
        model: this.modelId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json();

    // Attempt to handle both OpenAI-style and generic array responses
    let embedding: number[];
    if (data.data && Array.isArray(data.data) && data.data[0].embedding) {
      embedding = data.data[0].embedding;
    } else if (data.embedding && Array.isArray(data.embedding)) {
      embedding = data.embedding;
    } else if (Array.isArray(data)) {
      embedding = data;
    } else {
      throw new Error('Unexpected response format from embedding API');
    }

    const processingTimeMs = Date.now() - startTime;

    return {
      embedding,
      modelId: this.modelId,
      processingTimeMs,
    };
  }

  getModelId(): string {
    return this.modelId;
  }
}

/**
 * Local Transformers.js Provider
 */
export class LocalProvider implements IEmbeddingProvider {
  private logger: Logger;
  private worker: any = null;
  private workerReady = false;
  private pendingJobs = new Map<string, { resolve: Function; reject: Function }>();
  private ready = false;

  constructor() {
    this.logger = new Logger('LocalProvider');
  }

  async init(): Promise<void> {
    if (this.ready) return;

    return new Promise((resolve, reject) => {
      try {
        // @ts-ignore
        const ChromeWorker = globalThis.ChromeWorker;
        const workerPath = 'chrome://zotseek/content/scripts/embedding-worker.js';
        this.logger.info(`Creating ChromeWorker: ${workerPath}`);

        if (typeof ChromeWorker === 'undefined') {
          reject(new Error('ChromeWorker is not defined. This provider must run in Zotero.'));
          return;
        }

        this.worker = new ChromeWorker(workerPath);

        const timeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'));
        }, 30000);

        this.worker.onmessage = (event: any) => {
          const { type, status, jobId, error, embedding, modelId, processingTimeMs, message, level, data } = event.data;

          if (type === 'log') {
            const logMessage = data ? `${message} - ${JSON.stringify(data)}` : message;
            switch (level) {
              case 'error': this.logger.error(logMessage); break;
              case 'warn': this.logger.warn(logMessage); break;
              default: this.logger.info(logMessage); break;
            }
          } else if (type === 'status') {
            if (status === 'ready') {
              clearTimeout(timeout);
              this.workerReady = true;
              this.ready = true;
              resolve();
            }
          } else if (type === 'error') {
            this.logger.error(`Worker error: ${error}`);
            if (jobId && this.pendingJobs.has(jobId)) {
              const job = this.pendingJobs.get(jobId)!;
              this.pendingJobs.delete(jobId);
              job.reject(new Error(error));
            } else {
              clearTimeout(timeout);
              reject(new Error(error));
            }
          } else if (type === 'embedding' && jobId) {
            const job = this.pendingJobs.get(jobId);
            if (job) {
              this.pendingJobs.delete(jobId);
              job.resolve({ embedding, modelId, processingTimeMs });
            }
          }
        };

        this.worker.onerror = (error: any) => {
          this.logger.error('Worker error:', error);
          clearTimeout(timeout);
          reject(error);
        };

        this.worker.postMessage({ type: 'init' });
      } catch (error) {
        this.logger.error('Failed to create ChromeWorker:', error);
        reject(error);
      }
    });
  }

  async embed(text: string, isQuery: boolean = false): Promise<EmbeddingResult> {
    if (!this.workerReady) {
      throw new Error('Local embedding worker not ready');
    }

    return new Promise((resolve, reject) => {
      const jobId = Math.random().toString(36).substring(2, 15);
      this.pendingJobs.set(jobId, { resolve, reject });

      this.worker.postMessage({
        type: 'embed',
        jobId,
        data: { text, isQuery },
      });

      setTimeout(() => {
        if (this.pendingJobs.has(jobId)) {
          this.pendingJobs.delete(jobId);
          reject(new Error('Embedding timeout'));
        }
      }, 60000);
    });
  }

  getModelId(): string {
    return 'Xenova/nomic-embed-text-v1.5';
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    this.ready = false;
    this.pendingJobs.clear();
  }
}
