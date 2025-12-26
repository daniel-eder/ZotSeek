/**
 * Vector Store - SQLite-based storage for paper embeddings
 *
 * Creates tables directly in Zotero's main database (prefixed with "zs_")
 * This is simpler and more reliable than using ATTACH DATABASE.
 *
 * Much faster than JSON file for:
 * - Large libraries (1000+ papers)
 * - Partial lookups (single item)
 * - Incremental updates
 */

import { Logger } from '../utils/logger';

declare const Zotero: any;

// Text source types - now includes specific section types for better retrieval info
export type TextSourceType = 
  | 'abstract'      // Title + abstract (summary chunk)
  | 'fulltext'      // Legacy: generic full text
  | 'title_only'    // Title only (no abstract available)
  | 'summary'       // Same as abstract, from chunker
  | 'methods'       // Introduction, Background, Methods, etc.
  | 'findings'      // Results, Discussion, Conclusions, etc.
  | 'content';      // Generic content (fallback when sections not detected)

export interface PaperEmbedding {
  itemId: number;
  chunkIndex: number;       // 0 = summary (title+abstract), 1+ = fulltext chunks
  itemKey: string;
  libraryId: number;
  title: string;
  abstract?: string;
  chunkText?: string;       // The actual text that was embedded (for debugging)
  textSource: TextSourceType;
  embedding: number[];      // 768 dimensions (nomic-embed-text-v1.5)
  modelId: string;
  indexedAt: string;
  contentHash: string;
}

export interface VectorStoreStats {
  totalPapers: number;
  indexedPapers: number;
  totalChunks: number;
  avgChunksPerPaper: number;
  modelId: string;
  lastIndexed: Date | null;
  storageUsedBytes: number;
}

// Table prefix to avoid conflicts with Zotero's tables
const TABLE_PREFIX = 'zs_';
const SCHEMA_VERSION = 2;  // Bumped for chunk support

/**
 * SQLite-based Vector Store
 *
 * Uses Zotero's main database with prefixed tables.
 * Benefits: O(1) lookups, lower memory, atomic updates
 */
export class VectorStoreSQLite {
  private logger: Logger;
  private initialized = false;
  private cache: {
    data: Array<{
      itemId: number;
      chunkIndex: number;
      itemKey: string;
      title: string;
      textSource: TextSourceType;
      embedding: Float32Array;
    }>;
    validAt: number;  // timestamp
  } | null = null;

  constructor() {
    this.logger = new Logger('VectorStoreSQLite');
  }

  /**
   * Zotero 8 DB wrapper workaround:
   * - `queryAsync()` can return []/undefined for some SELECTs even when rows exist.
   * - `columnQueryAsync()` is often more reliable for simple one-column result sets.
   */
  private async getItemIdsSafe(whereSql = '', params: any[] = []): Promise<number[]> {
    await this.ensureInit();

    const sql = `
      SELECT item_id
      FROM ${TABLE_PREFIX}embeddings
      ${whereSql}
      ORDER BY item_id
    `;

    try {
      if (Zotero.DB.columnQueryAsync) {
        const ids = await Zotero.DB.columnQueryAsync(sql, params);
        return (ids || []).map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
      }
    } catch (e) {
      // Expected on some Zotero builds; we'll fall back to queryAsync below.
      this.logger.debug(`getItemIdsSafe(): columnQueryAsync failed: ${e}`);
    }

    try {
      const rows = await Zotero.DB.queryAsync(sql, params);
      if (!rows || rows.length === 0) return [];
      return rows.map((r: any) => Number(r.item_id)).filter((n: number) => Number.isFinite(n));
    } catch (e) {
      this.logger.debug(`getItemIdsSafe(): queryAsync failed: ${e}`);
      return [];
    }
  }

  /**
   * Initialize the SQLite tables in Zotero's main database
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.logger.info('Initializing SQLite vector store in Zotero database...');

    try {
      // Check if Zotero.DB exists
      if (!Zotero.DB) {
        throw new Error('Zotero.DB is not available');
      }

      // Create tables if they don't exist
      this.logger.debug('Creating tables...');
      await this.createTables();

      this.initialized = true;
      this.logger.info('SQLite store initialized successfully');

      // Get count
      const count = await this.getCount();
      const itemCount = await this.getItemCount();
      this.logger.info(`SQLite store has ${count} embedding chunks for ${itemCount} items`);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      this.logger.error(`Failed to initialize SQLite store: ${errorMsg}`);
      throw new Error(`SQLite init failed: ${errorMsg}`);
    }
  }

  /**
   * Create database schema
   */
  private async createTables(): Promise<void> {
    // Main embeddings table with chunk support
    await Zotero.DB.queryAsync(`
      CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}embeddings (
        item_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        item_key TEXT NOT NULL,
        library_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        abstract TEXT,
        chunk_text TEXT,
        text_source TEXT NOT NULL,
        embedding TEXT NOT NULL,
        model_id TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        PRIMARY KEY (item_id, chunk_index)
      )
    `);

    await this.createIndexes();
    await this.updateSchemaVersion();

    this.logger.debug('Tables created successfully');
  }

  /**
   * Create indexes for the embeddings table
   */
  private async createIndexes(): Promise<void> {
    // Index for item lookups (all chunks for an item)
    await Zotero.DB.queryAsync(`
      CREATE INDEX IF NOT EXISTS ${TABLE_PREFIX}idx_item_id
      ON ${TABLE_PREFIX}embeddings(item_id)
    `);

    // Index for library lookups
    await Zotero.DB.queryAsync(`
      CREATE INDEX IF NOT EXISTS ${TABLE_PREFIX}idx_library_id
      ON ${TABLE_PREFIX}embeddings(library_id)
    `);

    // Index for content hash
    await Zotero.DB.queryAsync(`
      CREATE INDEX IF NOT EXISTS ${TABLE_PREFIX}idx_content_hash
      ON ${TABLE_PREFIX}embeddings(content_hash)
    `);
  }

  /**
   * Update schema version in metadata
   */
  private async updateSchemaVersion(): Promise<void> {
    // Ensure metadata table exists
    await Zotero.DB.queryAsync(`
      CREATE TABLE IF NOT EXISTS ${TABLE_PREFIX}metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Set schema version
    await Zotero.DB.queryAsync(`
      INSERT OR REPLACE INTO ${TABLE_PREFIX}metadata (key, value) VALUES ('schema_version', ?)
    `, [String(SCHEMA_VERSION)]);
  }

  /**
   * Convert embedding array to JSON string for storage
   */
  private embeddingToString(embedding: number[]): string {
    return JSON.stringify(embedding);
  }

  /**
   * Convert stored string back to embedding array
   */
  private stringToEmbedding(str: string): number[] {
    if (!str) {
      this.logger.error('stringToEmbedding received null/undefined string');
      return [];
    }
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) {
        this.logger.error(`stringToEmbedding: parsed value is not an array: ${typeof parsed}`);
        return [];
      }
      return parsed;
    } catch (e) {
      this.logger.error(`stringToEmbedding failed to parse: ${e}`);
      return [];
    }
  }

  /**
   * Store a paper embedding (single chunk)
   */
  async put(embedding: PaperEmbedding): Promise<void> {
    await this.ensureInit();

    const embeddingStr = this.embeddingToString(embedding.embedding);
    const chunkIndex = embedding.chunkIndex ?? 0;

    await Zotero.DB.queryAsync(`
      INSERT OR REPLACE INTO ${TABLE_PREFIX}embeddings
      (item_id, chunk_index, item_key, library_id, title, abstract, chunk_text, text_source, embedding, model_id, indexed_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      embedding.itemId,
      chunkIndex,
      embedding.itemKey,
      embedding.libraryId,
      embedding.title,
      embedding.abstract || null,
      embedding.chunkText || null,
      embedding.textSource,
      embeddingStr,
      embedding.modelId,
      embedding.indexedAt,
      embedding.contentHash,
    ]);

    this.logger.debug(`Stored embedding for item ${embedding.itemId} chunk ${chunkIndex}`);
    this.invalidateCache();
  }

  /**
   * Store multiple embeddings in a batch using transaction
   */
  async putBatch(embeddings: PaperEmbedding[]): Promise<void> {
    await this.ensureInit();

    this.logger.info(`Storing ${embeddings.length} embeddings...`);
    // Log what item IDs we're storing (unique)
    const itemIds = [...new Set(embeddings.map(e => e.itemId))];
    this.logger.info(`Storing embeddings for ${itemIds.length} items: ${JSON.stringify(itemIds)}`);

    // Use Zotero's transaction for better performance
    await Zotero.DB.executeTransaction(async () => {
      for (const embedding of embeddings) {
        const embeddingStr = this.embeddingToString(embedding.embedding);
        const chunkIndex = embedding.chunkIndex ?? 0;

        await Zotero.DB.queryAsync(`
          INSERT OR REPLACE INTO ${TABLE_PREFIX}embeddings
          (item_id, chunk_index, item_key, library_id, title, abstract, chunk_text, text_source, embedding, model_id, indexed_at, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          embedding.itemId,
          chunkIndex,
          embedding.itemKey,
          embedding.libraryId,
          embedding.title,
          embedding.abstract || null,
          embedding.chunkText || null,
          embedding.textSource,
          embeddingStr,
          embedding.modelId,
          embedding.indexedAt,
          embedding.contentHash,
        ]);
      }
    });

    this.logger.info(`Stored ${embeddings.length} embeddings`);

    // Verify storage
    const verifyRows = await Zotero.DB.queryAsync(`SELECT COUNT(*) as count FROM ${TABLE_PREFIX}embeddings`);
    this.logger.info(`Verification: table now has ${verifyRows?.[0]?.count || 0} total embedding chunks`);
    this.invalidateCache();
  }

  /**
   * Delete all chunks for an item before re-indexing
   */
  async deleteItemChunks(itemId: number): Promise<void> {
    await this.ensureInit();

    await Zotero.DB.queryAsync(`
      DELETE FROM ${TABLE_PREFIX}embeddings WHERE item_id = ?
    `, [itemId]);

    this.logger.debug(`Deleted all chunks for item ${itemId}`);
    this.invalidateCache();
  }

  /**
   * Get all chunks for a specific item
   * Uses columnQueryAsync and parallel fetching for reliability
   */
  async getItemChunks(itemId: number): Promise<PaperEmbedding[]> {
    await this.ensureInit();

    // First get all chunk indexes for this item
    let chunkIndexes: number[] = [];
    try {
      const raw = await Zotero.DB.columnQueryAsync(
        `SELECT chunk_index FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? ORDER BY chunk_index`,
        [itemId]
      );
      chunkIndexes = (raw || []).map((v: any) => Number(v));
    } catch (e) {
      this.logger.error(`getItemChunks(${itemId}): Failed to get chunk indexes: ${e}`);
      return [];
    }

    if (chunkIndexes.length === 0) return [];

    // Fetch all chunks in parallel
    const chunks = await Promise.all(
      chunkIndexes.map(ci => this.getChunk(itemId, ci))
    );

    return chunks.filter((c): c is PaperEmbedding => c !== undefined);
  }

  /**
   * Get the summary embedding (chunk_index=0) for a specific item - O(1) lookup
   * Note: We select specific columns instead of SELECT * because Zotero's DB
   * wrapper can have issues with SELECT * on rows with large TEXT columns.
   */
  async get(itemId: number): Promise<PaperEmbedding | undefined> {
    await this.ensureInit();

    this.logger.debug(`Getting summary embedding for item ${itemId}`);

    // Check existence first using lightweight query - safe in Zotero 8
    const checkRow = await Zotero.DB.queryAsync(`SELECT item_id FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = 0`, [itemId]);
    if (!checkRow || checkRow.length === 0) {
      // Try to get any chunk if summary doesn't exist
      const anyChunk = await Zotero.DB.queryAsync(`SELECT item_id, chunk_index FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? ORDER BY chunk_index LIMIT 1`, [itemId]);
      if (!anyChunk || anyChunk.length === 0) {
        return undefined;
      }
      // Get the first available chunk
      return this.getChunk(itemId, anyChunk[0].chunk_index);
    }

    return this.getChunk(itemId, 0);
  }

  /**
   * Get a specific chunk for an item
   * Uses parallel valueQueryAsync calls - most reliable method in Zotero 8
   */
  async getChunk(itemId: number, chunkIndex: number): Promise<PaperEmbedding | undefined> {
    await this.ensureInit();

    // Use parallel valueQueryAsync calls - most reliable method in Zotero 8
    try {
      const [item_key, library_id, title, text_source, model_id, indexed_at, content_hash, abstract, chunk_text, embedding] = await Promise.all([
        Zotero.DB.valueQueryAsync(`SELECT item_key FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT library_id FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT title FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT text_source FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT model_id FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT indexed_at FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT content_hash FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT abstract FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT chunk_text FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
        Zotero.DB.valueQueryAsync(`SELECT embedding FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
      ]);

      // Check if row exists
      if (!item_key || !embedding) {
        return undefined;
      }

      return {
        itemId,
        chunkIndex,
        itemKey: item_key,
        libraryId: Number(library_id) || 0,
        title: title || '',
        abstract: abstract || undefined,
        chunkText: chunk_text || undefined,
        textSource: (text_source as TextSourceType) || 'abstract',
        embedding: this.stringToEmbedding(embedding),
        modelId: model_id || '',
        indexedAt: indexed_at || '',
        contentHash: content_hash || '',
      };
    } catch (e) {
      this.logger.error(`getChunk(${itemId}, ${chunkIndex}): Failed: ${e}`);
      return undefined;
    }
  }

  /**
   * Get all embeddings with in-memory caching
   * Returns cached data if available, otherwise fetches from DB and caches
   */
  async getAllCached(): Promise<Array<{
    itemId: number;
    chunkIndex: number;
    itemKey: string;
    title: string;
    textSource: 'abstract' | 'fulltext' | 'title_only';
    embedding: Float32Array;
  }>> {
    await this.ensureInit();

    // Check if cache is valid (less than 5 minutes old)
    const now = Date.now();
    if (this.cache && (now - this.cache.validAt) < 5 * 60 * 1000) {
      this.logger.debug(`getAllCached(): Cache hit! Returning ${this.cache.data.length} cached embeddings`);
      return this.cache.data;
    }

    this.logger.debug('getAllCached(): Cache miss, fetching from database...');

    // Fetch all embeddings using the reliable getAll method
    const embeddings = await this.getAll();

    // Convert to cached format with Float32Array and pre-normalized vectors
    const cachedData = embeddings.map(e => {
      // Convert to Float32Array
      const float32Embedding = new Float32Array(e.embedding);

      // Normalize the vector for faster similarity computation
      let norm = 0;
      for (let i = 0; i < float32Embedding.length; i++) {
        norm += float32Embedding[i] * float32Embedding[i];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < float32Embedding.length; i++) {
          float32Embedding[i] /= norm;
        }
      }

      return {
        itemId: e.itemId,
        chunkIndex: e.chunkIndex,
        itemKey: e.itemKey,
        title: e.title,
        textSource: e.textSource,
        embedding: float32Embedding,
      };
    });

    // Cache the data
    this.cache = {
      data: cachedData,
      validAt: now,
    };

    this.logger.debug(`getAllCached(): Cached ${cachedData.length} embeddings`);
    return cachedData;
  }

  /**
   * Invalidate the in-memory cache
   */
  invalidateCache(): void {
    if (this.cache) {
      this.logger.debug('invalidateCache(): Cache invalidated');
      this.cache = null;
    }
  }

  /**
   * Get all embeddings (all chunks)
   * Completely avoids queryAsync() for data retrieval - uses columnQueryAsync instead
   */
  async getAll(): Promise<PaperEmbedding[]> {
    await this.ensureInit();

    // Step 1: Get all (item_id, chunk_index) pairs using columnQueryAsync
    // This is more reliable than queryAsync for fetching lists
    let itemIds: number[] = [];
    let chunkIndexes: number[] = [];

    try {
      // Fetch item_ids and chunk_indexes as separate columns
      const rawIds = await Zotero.DB.columnQueryAsync(
        `SELECT item_id FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`
      );
      const rawChunks = await Zotero.DB.columnQueryAsync(
        `SELECT chunk_index FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`
      );

      if (rawIds && rawChunks && rawIds.length === rawChunks.length) {
        itemIds = rawIds.map((v: any) => Number(v));
        chunkIndexes = rawChunks.map((v: any) => Number(v));
      }
    } catch (e) {
      this.logger.error(`getAll(): columnQueryAsync failed: ${e}`);
      return [];
    }

    if (itemIds.length === 0) {
      this.logger.debug('getAll(): No embeddings found');
      return [];
    }

    this.logger.debug(`getAll(): Found ${itemIds.length} chunks, fetching data...`);

    // Step 2: Fetch all embeddings as a single column (most critical data)
    let embeddings: string[] = [];
    try {
      embeddings = await Zotero.DB.columnQueryAsync(
        `SELECT embedding FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`
      ) || [];
    } catch (e) {
      this.logger.error(`getAll(): Failed to fetch embeddings column: ${e}`);
      return [];
    }

    if (embeddings.length !== itemIds.length) {
      this.logger.error(`getAll(): Embedding count mismatch: ${embeddings.length} vs ${itemIds.length}`);
      return [];
    }

    // Step 3: Fetch other columns in parallel
    const [itemKeys, libraryIds, titles, textSources, modelIds, indexedAts, contentHashes, abstracts, chunkTexts] = await Promise.all([
      Zotero.DB.columnQueryAsync(`SELECT item_key FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT library_id FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT title FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT text_source FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT model_id FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT indexed_at FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT content_hash FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT abstract FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
      Zotero.DB.columnQueryAsync(`SELECT chunk_text FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index`),
    ]);

    // Step 4: Assemble results
    const results: PaperEmbedding[] = [];
    for (let i = 0; i < itemIds.length; i++) {
      results.push({
        itemId: itemIds[i],
        chunkIndex: chunkIndexes[i],
        itemKey: itemKeys?.[i] || '',
        libraryId: Number(libraryIds?.[i]) || 0,
        title: titles?.[i] || '',
        abstract: abstracts?.[i] || undefined,
        chunkText: chunkTexts?.[i] || undefined,
        textSource: (textSources?.[i] as TextSourceType) || 'abstract',
        embedding: this.stringToEmbedding(embeddings[i]),
        modelId: modelIds?.[i] || '',
        indexedAt: indexedAts?.[i] || '',
        contentHash: contentHashes?.[i] || '',
      });
    }

    this.logger.debug(`getAll(): Returning ${results.length} embeddings`);
    return results;
  }

  /**
   * Get all chunk keys (item_id, chunk_index pairs)
   * Uses robust fallback strategy for Zotero 8 DB wrapper quirks
   */
  private async getAllChunkKeys(): Promise<Array<{ itemId: number; chunkIndex: number }>> {
    // Try the batch query first
    const rows = await Zotero.DB.queryAsync(`
      SELECT item_id, chunk_index FROM ${TABLE_PREFIX}embeddings ORDER BY item_id, chunk_index
    `);

    if (rows && rows.length > 0) {
      return rows.map((r: any) => ({ itemId: r.item_id, chunkIndex: r.chunk_index }));
    }

    // Fallback: Get item IDs first using columnQueryAsync, then get chunk indexes per item
    this.logger.debug('getAllChunkKeys(): Batch query returned empty, using fallback...');

    const itemIds = await this.getItemIdsSafe();
    if (itemIds.length === 0) {
      this.logger.debug('getAllChunkKeys(): No item IDs found');
      return [];
    }

    this.logger.debug(`getAllChunkKeys(): Found ${itemIds.length} item IDs, fetching chunk indexes...`);
    const results: Array<{ itemId: number; chunkIndex: number }> = [];

    for (const itemId of itemIds) {
      try {
        // Try columnQueryAsync first for chunk indexes of this item
        let chunkIndexes: number[] = [];

        try {
          if (Zotero.DB.columnQueryAsync) {
            const indexes = await Zotero.DB.columnQueryAsync(
              `SELECT chunk_index FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? ORDER BY chunk_index`,
              [itemId]
            );
            if (indexes && indexes.length > 0) {
              chunkIndexes = indexes.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
            }
          }
        } catch (e) {
          this.logger.debug(`getAllChunkKeys(): columnQueryAsync failed for item ${itemId}: ${e}`);
        }

        // Fallback: try valueQueryAsync for single chunk (most items have chunk_index = 0)
        if (chunkIndexes.length === 0) {
          const singleIndex = await Zotero.DB.valueQueryAsync(
            `SELECT chunk_index FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? LIMIT 1`,
            [itemId]
          );
          if (singleIndex !== null && singleIndex !== undefined) {
            chunkIndexes = [Number(singleIndex)];
          }
        }

        // Add to results
        for (const chunkIndex of chunkIndexes) {
          results.push({ itemId, chunkIndex });
        }
      } catch (e) {
        this.logger.error(`getAllChunkKeys(): Error getting chunk indexes for item ${itemId}: ${e}`);
      }
    }

    this.logger.debug(`getAllChunkKeys(): Fallback found ${results.length} chunks`);
    return results;
  }

  /**
   * Get chunk keys for a specific library (item_id, chunk_index pairs)
   * Uses robust fallback strategy for Zotero 8 DB wrapper quirks
   */
  private async getChunkKeysByLibrary(libraryId: number): Promise<Array<{ itemId: number; chunkIndex: number }>> {
    // Try the batch query first
    const rows = await Zotero.DB.queryAsync(`
      SELECT item_id, chunk_index FROM ${TABLE_PREFIX}embeddings
      WHERE library_id = ? ORDER BY item_id, chunk_index
    `, [libraryId]);

    if (rows && rows.length > 0) {
      return rows.map((r: any) => ({ itemId: r.item_id, chunkIndex: r.chunk_index }));
    }

    // Fallback: Get item IDs first, then get chunk indexes per item
    this.logger.debug(`getChunkKeysByLibrary(${libraryId}): Batch query returned empty, using fallback...`);

    const itemIds = await this.getItemIdsSafe('WHERE library_id = ?', [libraryId]);
    if (itemIds.length === 0) {
      this.logger.debug(`getChunkKeysByLibrary(${libraryId}): No item IDs found`);
      return [];
    }

    this.logger.debug(`getChunkKeysByLibrary(${libraryId}): Found ${itemIds.length} item IDs, fetching chunk indexes...`);
    const results: Array<{ itemId: number; chunkIndex: number }> = [];

    for (const itemId of itemIds) {
      try {
        // Try columnQueryAsync first for chunk indexes of this item
        let chunkIndexes: number[] = [];

        try {
          if (Zotero.DB.columnQueryAsync) {
            const indexes = await Zotero.DB.columnQueryAsync(
              `SELECT chunk_index FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND library_id = ? ORDER BY chunk_index`,
              [itemId, libraryId]
            );
            if (indexes && indexes.length > 0) {
              chunkIndexes = indexes.map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
            }
          }
        } catch (e) {
          this.logger.debug(`getChunkKeysByLibrary(): columnQueryAsync failed for item ${itemId}: ${e}`);
        }

        // Fallback: try valueQueryAsync for single chunk
        if (chunkIndexes.length === 0) {
          const singleIndex = await Zotero.DB.valueQueryAsync(
            `SELECT chunk_index FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND library_id = ? LIMIT 1`,
            [itemId, libraryId]
          );
          if (singleIndex !== null && singleIndex !== undefined) {
            chunkIndexes = [Number(singleIndex)];
          }
        }

        // Add to results
        for (const chunkIndex of chunkIndexes) {
          results.push({ itemId, chunkIndex });
        }
      } catch (e) {
        this.logger.error(`getChunkKeysByLibrary(): Error getting chunk indexes for item ${itemId}: ${e}`);
      }
    }

    this.logger.debug(`getChunkKeysByLibrary(${libraryId}): Fallback found ${results.length} chunks`);
    return results;
  }

  /**
   * Get unique item IDs (for counting papers, not chunks)
   */
  async getUniqueItemIds(): Promise<number[]> {
    await this.ensureInit();

    try {
      if (Zotero.DB.columnQueryAsync) {
        const ids = await Zotero.DB.columnQueryAsync(`
          SELECT DISTINCT item_id FROM ${TABLE_PREFIX}embeddings ORDER BY item_id
        `);
        return (ids || []).map((v: any) => Number(v)).filter((n: number) => Number.isFinite(n));
      }
    } catch (e) {
      this.logger.debug(`getUniqueItemIds(): columnQueryAsync failed: ${e}`);
    }

    const rows = await Zotero.DB.queryAsync(`
      SELECT DISTINCT item_id FROM ${TABLE_PREFIX}embeddings ORDER BY item_id
    `);
    if (!rows) return [];
    return rows.map((r: any) => Number(r.item_id)).filter((n: number) => Number.isFinite(n));
  }

  /**
   * Get embeddings for a specific library
   * Note: We split queries to avoid DB wrapper issues.
   */
  async getByLibrary(libraryId: number): Promise<PaperEmbedding[]> {
    await this.ensureInit();

    // 1. Get metadata (including chunk_index for multi-chunk support)
    const metaRows = await Zotero.DB.queryAsync(`
      SELECT item_id, chunk_index, item_key, library_id, title, text_source,
             model_id, indexed_at, content_hash
      FROM ${TABLE_PREFIX}embeddings WHERE library_id = ? ORDER BY item_id, chunk_index
    `, [libraryId]);

    // Zotero 8 workaround for getByLibrary
    let rowsToProcess = metaRows || [];

    if (rowsToProcess.length === 0) {
        // Get chunks for this library using the robust chunk keys method
        const chunks = await this.getChunkKeysByLibrary(libraryId);

        if (chunks.length > 0) {
          this.logger.debug(`getByLibrary(${libraryId}): Batch metadata fetch returned no rows but found ${chunks.length} chunks. Fetching row-by-row.`);
          rowsToProcess = [];
          for (const { itemId, chunkIndex } of chunks) {
            try {
              // Since queryAsync often fails in Zotero 8, directly use parallel valueQueryAsync
              // This is more reliable and faster than sequential queries
              const row: any = { item_id: itemId, chunk_index: chunkIndex, library_id: libraryId };

              // Fetch all metadata fields in parallel
              const [item_key, title, text_source, model_id, indexed_at, content_hash] = await Promise.all([
                Zotero.DB.valueQueryAsync(`SELECT item_key FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
                Zotero.DB.valueQueryAsync(`SELECT title FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
                Zotero.DB.valueQueryAsync(`SELECT text_source FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
                Zotero.DB.valueQueryAsync(`SELECT model_id FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
                Zotero.DB.valueQueryAsync(`SELECT indexed_at FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex]),
                Zotero.DB.valueQueryAsync(`SELECT content_hash FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?`, [itemId, chunkIndex])
              ]);

              row.item_key = item_key;
              row.title = title;
              row.text_source = text_source;
              row.model_id = model_id;
              row.indexed_at = indexed_at;
              row.content_hash = content_hash;

              rowsToProcess.push(row);
            } catch (e) {
              this.logger.error(`getByLibrary(): Error fetching fields for item ${itemId} chunk ${chunkIndex}: ${e}`);
            }
          }
        }
    }

    if (rowsToProcess.length === 0) return [];

    // 2. Get abstracts
    let abstracts: string[] = [];
    try {
      if (Zotero.DB.columnQueryAsync) {
        abstracts = await Zotero.DB.columnQueryAsync(`
          SELECT abstract FROM ${TABLE_PREFIX}embeddings WHERE library_id = ? ORDER BY item_id, chunk_index
        `, [libraryId]);
      } else {
        const rows = await Zotero.DB.queryAsync(`
          SELECT abstract FROM ${TABLE_PREFIX}embeddings WHERE library_id = ? ORDER BY item_id, chunk_index
        `, [libraryId]);
        if (rows) abstracts = rows.map((r: any) => r.abstract);
      }
    } catch (e) {
      this.logger.warn(`Failed to batch fetch library abstracts: ${e}`);
    }

    // 3. Get embeddings
    let embeddingStrs: string[] = [];
    try {
      if (Zotero.DB.columnQueryAsync) {
        embeddingStrs = await Zotero.DB.columnQueryAsync(`
          SELECT embedding FROM ${TABLE_PREFIX}embeddings WHERE library_id = ? ORDER BY item_id, chunk_index
        `, [libraryId]);
      } else {
        const rows = await Zotero.DB.queryAsync(`
          SELECT embedding FROM ${TABLE_PREFIX}embeddings WHERE library_id = ? ORDER BY item_id, chunk_index
        `, [libraryId]);
        if (rows) embeddingStrs = rows.map((r: any) => r.embedding);
      }
    } catch (e) {
      this.logger.warn(`Failed to batch fetch library embeddings: ${e}`);
    }

    // Fallback
    if ((!embeddingStrs || embeddingStrs.length !== rowsToProcess.length) ||
        (!abstracts || abstracts.length !== rowsToProcess.length)) {
      const results: PaperEmbedding[] = [];
      for (const row of rowsToProcess) {
        const itemId = row.item_id;
        const chunkIndex = row.chunk_index ?? 0;

        if (row.abstract === undefined) {
            row.abstract = await Zotero.DB.valueQueryAsync(`
            SELECT abstract FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?
            `, [itemId, chunkIndex]);
        }

        if (row.embedding === undefined) {
            row.embedding = await Zotero.DB.valueQueryAsync(`
            SELECT embedding FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? AND chunk_index = ?
            `, [itemId, chunkIndex]);
        }

        results.push(this.rowToEmbedding(row));
      }
      return results;
    }

    return rowsToProcess.map((row: any, i: number) => {
      row.abstract = abstracts[i];
      row.embedding = embeddingStrs[i];
      return this.rowToEmbedding(row);
    });
  }

  /**
   * Get only the embedding vectors (for search) - more efficient
   */
  async getEmbeddingsOnly(): Promise<Array<{ itemId: number; embedding: number[] }>> {
    await this.ensureInit();

    // 1. Get IDs
    const ids = await this.getItemIdsSafe();
    if (ids.length === 0) return [];

    // 2. Get embeddings
    let embeddingStrs: string[] = [];
    try {
      if (Zotero.DB.columnQueryAsync) {
        embeddingStrs = await Zotero.DB.columnQueryAsync(`
          SELECT embedding FROM ${TABLE_PREFIX}embeddings ORDER BY item_id
        `);
      } else {
        const rows = await Zotero.DB.queryAsync(`
          SELECT embedding FROM ${TABLE_PREFIX}embeddings ORDER BY item_id
        `);
        if (rows) {
          embeddingStrs = rows.map((r: any) => r.embedding);
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to batch fetch embeddings only: ${e}`);
    }

    // Fallback
    if (!embeddingStrs || embeddingStrs.length !== ids.length) {
      const results = [];
      for (const id of ids) {
        const embeddingStr = await Zotero.DB.valueQueryAsync(`
          SELECT embedding FROM ${TABLE_PREFIX}embeddings WHERE item_id = ?
        `, [id]);

        results.push({
          itemId: id,
          embedding: this.stringToEmbedding(embeddingStr),
        });
      }
      return results;
    }

    return ids.map((id: number, i: number) => ({
      itemId: id,
      embedding: this.stringToEmbedding(embeddingStrs[i]),
    }));
  }

  /**
   * Convert database row to PaperEmbedding
   */
  private rowToEmbedding(row: any): PaperEmbedding {
    return {
      itemId: row.item_id,
      chunkIndex: row.chunk_index ?? 0,
      itemKey: row.item_key,
      libraryId: row.library_id,
      title: row.title,
      abstract: row.abstract || undefined,
      chunkText: row.chunk_text || undefined,
      textSource: row.text_source as TextSourceType,
      embedding: this.stringToEmbedding(row.embedding),
      modelId: row.model_id,
      indexedAt: row.indexed_at,
      contentHash: row.content_hash,
    };
  }

  /**
   * Check if item is indexed (has at least one chunk)
   * Uses valueQueryAsync for most reliable existence check
   */
  async isIndexed(itemId: number): Promise<boolean> {
    await this.ensureInit();

    try {
      // valueQueryAsync is most reliable for existence checks
      const result = await Zotero.DB.valueQueryAsync(
        `SELECT 1 FROM ${TABLE_PREFIX}embeddings WHERE item_id = ? LIMIT 1`,
        [itemId]
      );
      return result !== null && result !== undefined;
    } catch (e) {
      this.logger.error(`isIndexed(${itemId}): Failed: ${e}`);
      return false;
    }
  }

  /**
   * Get the number of chunks for an item
   */
  async getChunkCount(itemId: number): Promise<number> {
    await this.ensureInit();

    try {
      const rows = await Zotero.DB.queryAsync(`
        SELECT COUNT(*) as count FROM ${TABLE_PREFIX}embeddings WHERE item_id = ?
      `, [itemId]);
      return rows?.[0]?.count || 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Check if item needs re-indexing
   */
  async needsReindex(itemId: number, contentHash: string): Promise<boolean> {
    await this.ensureInit();

    const rows = await Zotero.DB.queryAsync(`
      SELECT content_hash FROM ${TABLE_PREFIX}embeddings WHERE item_id = ?
    `, [itemId]);

    if (!rows || rows.length === 0) return true;
    return rows[0].content_hash !== contentHash;
  }

  /**
   * Delete embedding for an item
   */
  async delete(itemId: number): Promise<void> {
    await this.ensureInit();

    await Zotero.DB.queryAsync(`
      DELETE FROM ${TABLE_PREFIX}embeddings WHERE item_id = ?
    `, [itemId]);

    this.logger.debug(`Deleted embedding for item ${itemId}`);
    this.invalidateCache();
  }

  /**
   * Clear all embeddings
   */
  async clear(): Promise<void> {
    await this.ensureInit();

    await Zotero.DB.queryAsync(`DELETE FROM ${TABLE_PREFIX}embeddings`);
    this.logger.info('Cleared all embeddings');
    this.invalidateCache();
  }

  /**
   * Get count of stored embedding chunks
   */
  async getCount(): Promise<number> {
    if (!this.initialized) return 0;

    try {
      const rows = await Zotero.DB.queryAsync(`
        SELECT COUNT(*) as count FROM ${TABLE_PREFIX}embeddings
      `);

      if (!rows || rows.length === 0) return 0;
      return rows[0]?.count || 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Get count of unique items (papers)
   */
  async getItemCount(): Promise<number> {
    if (!this.initialized) return 0;

    try {
      const rows = await Zotero.DB.queryAsync(`
        SELECT COUNT(DISTINCT item_id) as count FROM ${TABLE_PREFIX}embeddings
      `);

      if (!rows || rows.length === 0) return 0;
      return rows[0]?.count || 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Get store statistics
   * Uses robust fallbacks for Zotero 8 DB wrapper quirks
   */
  async getStats(): Promise<VectorStoreStats> {
    await this.ensureInit();

    this.logger.debug('getStats(): Fetching statistics...');

    // Count total chunks - use valueQueryAsync for reliability
    let chunkCount = 0;
    try {
      const countResult = await Zotero.DB.valueQueryAsync(`
        SELECT COUNT(*) FROM ${TABLE_PREFIX}embeddings
      `);
      chunkCount = Number(countResult) || 0;
      this.logger.debug(`getStats(): Total chunks = ${chunkCount}`);
    } catch (e) {
      this.logger.error(`getStats(): Failed to count chunks: ${e}`);
    }

    // Count unique items (papers) - use valueQueryAsync
    let itemCount = 0;
    try {
      const itemCountResult = await Zotero.DB.valueQueryAsync(`
        SELECT COUNT(DISTINCT item_id) FROM ${TABLE_PREFIX}embeddings
      `);
      itemCount = Number(itemCountResult) || 0;
      this.logger.debug(`getStats(): Unique items = ${itemCount}`);
    } catch (e) {
      this.logger.error(`getStats(): Failed to count items: ${e}`);
    }

    // Get model ID
    let modelId = 'none';
    try {
      const modelResult = await Zotero.DB.valueQueryAsync(`
        SELECT model_id FROM ${TABLE_PREFIX}embeddings LIMIT 1
      `);
      if (modelResult) {
        modelId = String(modelResult);
      }
      this.logger.debug(`getStats(): Model = ${modelId}`);
    } catch (e) {
      this.logger.error(`getStats(): Failed to get model: ${e}`);
    }

    // Get last indexed date
    let lastIndexed: Date | null = null;
    try {
      const lastResult = await Zotero.DB.valueQueryAsync(`
        SELECT MAX(indexed_at) FROM ${TABLE_PREFIX}embeddings
      `);
      if (lastResult) {
        lastIndexed = new Date(String(lastResult));
      }
      this.logger.debug(`getStats(): Last indexed = ${lastIndexed}`);
    } catch (e) {
      this.logger.error(`getStats(): Failed to get last indexed: ${e}`);
    }

    // Estimate storage (based on chunk count)
    const bytesPerEmbedding = 768 * 4 + 200;  // 768 floats (nomic-embed) + metadata
    const storageUsedBytes = chunkCount * bytesPerEmbedding;
    const avgChunksPerPaper = itemCount > 0 ? chunkCount / itemCount : 0;

    const stats = {
      totalPapers: 0,
      indexedPapers: itemCount,
      totalChunks: chunkCount,
      avgChunksPerPaper: Math.round(avgChunksPerPaper * 10) / 10,
      modelId,
      lastIndexed,
      storageUsedBytes,
    };

    this.logger.debug(`getStats(): Returning stats: ${JSON.stringify({...stats, lastIndexed: stats.lastIndexed?.toISOString()})}`);
    return stats;
  }

  /**
   * Get metadata value
   */
  async getMetadata(key: string): Promise<any> {
    await this.ensureInit();

    const rows = await Zotero.DB.queryAsync(`
      SELECT value FROM ${TABLE_PREFIX}metadata WHERE key = ?
    `, [key]);

    if (!rows || rows.length === 0) return undefined;

    try {
      return JSON.parse(rows[0].value);
    } catch {
      return rows[0].value;
    }
  }

  /**
   * Set metadata value
   */
  async setMetadata(key: string, value: any): Promise<void> {
    await this.ensureInit();

    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    await Zotero.DB.queryAsync(`
      INSERT OR REPLACE INTO ${TABLE_PREFIX}metadata (key, value) VALUES (?, ?)
    `, [key, stringValue]);
  }

  /**
   * Ensure store is initialized
   */
  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Check if store is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Close (no-op since we use Zotero's main DB)
   */
  async close(): Promise<void> {
    this.initialized = false;
    this.logger.debug('SQLite store closed');
  }
}

// Export singleton
export const vectorStoreSQLite = new VectorStoreSQLite();
