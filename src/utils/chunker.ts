/**
 * Chunker - Semantic section-based chunking for nomic-embed-text-v1.5
 * 
 * Philosophy: With 8K context, chunk by SEMANTIC PURPOSE, not token limits.
 * This improves retrieval quality by creating focused embeddings.
 * 
 * Two clear indexing modes:
 * - abstract: Title + Abstract only (fast, good for most uses)
 * - full: Title + Abstract + PDF sections (thorough, for deep research)
 */

export interface Chunk {
  index: number;
  text: string;
  type: 'summary' | 'methods' | 'findings' | 'content';
  tokenCount?: number;
}

export interface ChunkOptions {
  maxTokens?: number;      // Safety limit (default: 7000)
  maxChunks?: number;      // Max chunks per paper (default: 5)
}

// Two clear modes
export type IndexingMode = 'abstract' | 'full';

// Default options for nomic-embed-v1.5 (8192 token limit)
// PERFORMANCE: Smaller chunks embed MUCH faster due to O(n²) attention
// - 7000 tokens: ~45 seconds per chunk (too slow!)
// - 2000 tokens: ~3-5 seconds per chunk (acceptable)
// With maxChunks=8 and maxTokens=2000, we can still cover full papers
const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  maxTokens: 2000,    // ~6000 chars - fast embedding (~3-5 sec)
  maxChunks: 8,       // More smaller chunks for better coverage
};

// Patterns to identify section boundaries
const SECTION_PATTERNS = {
  // Methods-like sections (how the research was done)
  methods: /\n(?=(?:\d+\.?\s*)?(?:Introduction|Background|Literature\s*Review|Related\s*Work|Theoretical\s*Framework|Methods?|Methodology|Materials?\s*(?:and\s*Methods)?|Experimental\s*(?:Setup|Design)?|Study\s*Design|Data\s*(?:Collection|Sources)|Approach|Framework|Model|System|Implementation)\b)/i,
  
  // Findings-like sections (what was discovered)
  findings: /\n(?=(?:\d+\.?\s*)?(?:Results?|Findings|Evaluation|Experiments?|Analysis|Discussion|Implications|Conclusion|Conclusions|Summary|Limitations|Future\s*Work|Recommendations)\b)/i,
};

/**
 * Estimate token count for nomic tokenizer
 * Conservative estimate: ~1.3 tokens per word for English academic text
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(w => w.length > 0);
  return Math.ceil(words.length * 1.3);
}

/**
 * Truncate text to approximately maxTokens, ending at sentence boundary
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;
  
  // Estimate character position
  const ratio = maxTokens / currentTokens;
  const targetLength = Math.floor(text.length * ratio * 0.95); // 5% safety margin
  
  // Find sentence boundary
  const truncated = text.substring(0, targetLength);
  const lastSentence = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('.\n'),
    truncated.lastIndexOf('? '),
    truncated.lastIndexOf('! ')
  );
  
  if (lastSentence > targetLength * 0.5) {
    return truncated.substring(0, lastSentence + 1).trim();
  }
  
  return truncated.trim() + '...';
}

/**
 * Split a large text into multiple chunks at paragraph boundaries
 * Returns array of chunks, each within maxTokens limit
 */
function splitTextIntoChunks(
  text: string,
  titlePrefix: string,
  maxTokens: number,
  type: 'methods' | 'findings' | 'content'
): Chunk[] {
  const chunks: Chunk[] = [];
  const titleTokens = estimateTokens(titlePrefix) + 10; // Buffer for newlines
  const availableTokens = maxTokens - titleTokens;
  
  // If text fits in one chunk, return it
  const textTokens = estimateTokens(text);
  if (textTokens <= availableTokens) {
    chunks.push({
      index: 0,
      text: `${titlePrefix}\n\n${text}`,
      type,
      tokenCount: textTokens + titleTokens,
    });
    return chunks;
  }
  
  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 50);
  
  let currentChunk = '';
  let currentTokens = 0;
  
  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    
    // If single paragraph is too large, split it by sentences
    if (paraTokens > availableTokens) {
      // Flush current chunk first
      if (currentChunk.trim()) {
        chunks.push({
          index: chunks.length,
          text: `${titlePrefix}\n\n${currentChunk.trim()}`,
          type,
          tokenCount: currentTokens + titleTokens,
        });
        currentChunk = '';
        currentTokens = 0;
      }
      
      // Split paragraph by sentences
      const sentences = para.match(/[^.!?]+[.!?]+/g) || [para];
      for (const sentence of sentences) {
        const sentTokens = estimateTokens(sentence);
        if (currentTokens + sentTokens > availableTokens && currentChunk.trim()) {
          chunks.push({
            index: chunks.length,
            text: `${titlePrefix}\n\n${currentChunk.trim()}`,
            type,
            tokenCount: currentTokens + titleTokens,
          });
          currentChunk = sentence;
          currentTokens = sentTokens;
        } else {
          currentChunk += sentence;
          currentTokens += sentTokens;
        }
      }
    }
    // Check if adding this paragraph would exceed limit
    else if (currentTokens + paraTokens > availableTokens) {
      // Save current chunk and start new one
      if (currentChunk.trim()) {
        chunks.push({
          index: chunks.length,
          text: `${titlePrefix}\n\n${currentChunk.trim()}`,
          type,
          tokenCount: currentTokens + titleTokens,
        });
      }
      currentChunk = para + '\n\n';
      currentTokens = paraTokens;
    } else {
      currentChunk += para + '\n\n';
      currentTokens += paraTokens;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push({
      index: chunks.length,
      text: `${titlePrefix}\n\n${currentChunk.trim()}`,
      type,
      tokenCount: currentTokens + titleTokens,
    });
  }
  
  return chunks;
}

/**
 * Split fulltext into semantic sections (methods vs findings)
 */
function splitIntoSemanticSections(fulltext: string): {
  methods: string | null;
  findings: string | null;
} {
  // Try to find the boundary between methods and findings
  const findingsMatch = SECTION_PATTERNS.findings.exec(fulltext);
  
  if (findingsMatch && findingsMatch.index && findingsMatch.index > 500) {
    const methodsPart = fulltext.substring(0, findingsMatch.index).trim();
    const findingsPart = fulltext.substring(findingsMatch.index).trim();
    
    return {
      methods: methodsPart.length > 300 ? methodsPart : null,
      findings: findingsPart.length > 300 ? findingsPart : null,
    };
  }
  
  // No clear boundary found - return null to trigger fallback
  return { methods: null, findings: null };
}

/**
 * Main chunking function - simplified for nomic-embed-v1.5
 * 
 * @param title - Paper title (prepended to each chunk for context)
 * @param abstract - Paper abstract
 * @param fulltext - Full text from PDF
 * @param mode - 'abstract' or 'full'
 * @param options - Chunking options
 */
export function chunkDocument(
  title: string,
  abstract: string | null,
  fulltext: string | null,
  mode: IndexingMode,
  options: ChunkOptions = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: Chunk[] = [];
  
  // Prepare title prefix (truncate if extremely long)
  const titlePrefix = title.length > 300 
    ? title.substring(0, 300) + '...' 
    : title;
  
  // ═══════════════════════════════════════════════════════════════════════
  // CHUNK 1: Summary (always included in both modes)
  // Purpose: "What is this paper about?"
  // ═══════════════════════════════════════════════════════════════════════
  const summaryText = abstract && abstract.length > 50
    ? `${titlePrefix}\n\n${abstract}`
    : titlePrefix;
  
  chunks.push({
    index: 0,
    text: summaryText,
    type: 'summary',
    tokenCount: estimateTokens(summaryText),
  });
  
  // For abstract mode, we're done
  if (mode === 'abstract') {
    return chunks;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // FULL MODE: Add section-based chunks from PDF
  // ═══════════════════════════════════════════════════════════════════════
  if (!fulltext || fulltext.length < 500) {
    // No meaningful fulltext available
    return chunks;
  }
  
  // Try to split into semantic sections
  const sections = splitIntoSemanticSections(fulltext);
  
  if (sections.methods || sections.findings) {
    // ─────────────────────────────────────────────────────────────────────
    // CHUNK 2+: Methods section(s)
    // Purpose: "How did they do it?"
    // Split into multiple chunks if too large for fast embedding
    // ─────────────────────────────────────────────────────────────────────
    if (sections.methods) {
      const methodChunks = splitTextIntoChunks(sections.methods, titlePrefix, opts.maxTokens, 'methods');
      for (const chunk of methodChunks) {
        if (chunks.length >= opts.maxChunks) break;
        chunks.push({
          ...chunk,
          index: chunks.length,
        });
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // CHUNK N+: Findings section(s)
    // Purpose: "What did they find?"
    // ─────────────────────────────────────────────────────────────────────
    if (sections.findings) {
      const findingsChunks = splitTextIntoChunks(sections.findings, titlePrefix, opts.maxTokens, 'findings');
      for (const chunk of findingsChunks) {
        if (chunks.length >= opts.maxChunks) break;
        chunks.push({
          ...chunk,
          index: chunks.length,
        });
      }
    }
  } else {
    // ─────────────────────────────────────────────────────────────────────
    // FALLBACK: No clear sections found, split content into chunks
    // ─────────────────────────────────────────────────────────────────────
    const contentChunks = splitTextIntoChunks(fulltext, titlePrefix, opts.maxTokens, 'content');
    for (const chunk of contentChunks) {
      if (chunks.length >= opts.maxChunks) break;
      chunks.push({
        ...chunk,
        index: chunks.length,
      });
    }
  }
  
  // Limit to maxChunks
  return chunks.slice(0, opts.maxChunks);
}

/**
 * Get chunk options from Zotero preferences
 */
export function getChunkOptionsFromPrefs(Zotero: any): ChunkOptions {
  const maxTokens = Zotero?.Prefs?.get('zotseek.maxTokens', true);
  const maxChunks = Zotero?.Prefs?.get('zotseek.maxChunksPerPaper', true);
  
  return {
    maxTokens: typeof maxTokens === 'number' ? maxTokens : DEFAULT_OPTIONS.maxTokens,
    maxChunks: typeof maxChunks === 'number' ? maxChunks : DEFAULT_OPTIONS.maxChunks,
  };
}

/**
 * Get indexing mode from Zotero preferences
 */
export function getIndexingMode(Zotero: any): IndexingMode {
  const mode = Zotero?.Prefs?.get('zotseek.indexingMode', true);
  return mode === 'full' ? 'full' : 'abstract';
}
