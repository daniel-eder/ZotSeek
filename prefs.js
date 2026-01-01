// Default preferences for ZotSeek
// Note: Zotero prefs only support string, int, bool - not float
// minSimilarityPercent is stored as integer (30 = 30% = 0.3)

pref("extensions.zotero.zotseek.minSimilarityPercent", 30);
pref("extensions.zotero.zotseek.topK", 20);
pref("extensions.zotero.zotseek.autoIndex", false);

// Indexing mode: "abstract" (title+abstract) or "full" (abstract + PDF sections)
pref("extensions.zotero.zotseek.indexingMode", "abstract");

// Chunking options for nomic-embed-text-v1.5 (8192 token context)
// PERFORMANCE: Smaller chunks = faster embedding (~O(n²) attention cost)
// - 7000 tokens: ~45 sec/chunk (too slow!)
// - 2000 tokens: ~3-5 sec/chunk (acceptable)
// Use more smaller chunks instead of fewer large chunks
pref("extensions.zotero.zotseek.maxTokens", 2000);
pref("extensions.zotero.zotseek.maxChunksPerPaper", 8);

// Item type filtering
// Exclude books from search results (books lack paper sections and are too long to index well)
pref("extensions.zotero.zotseek.excludeBooks", true);

// Hybrid search settings
// Combines semantic search with Zotero's keyword search using Reciprocal Rank Fusion
pref("extensions.zotero.zotseek.hybridSearch.enabled", true);
// Search mode: "hybrid", "semantic", or "keyword"
pref("extensions.zotero.zotseek.hybridSearch.mode", "hybrid");
// Semantic weight (0-100): 50 = equal weight, higher = more semantic, lower = more keyword
// Stored as integer percentage since Zotero prefs don't support floats
pref("extensions.zotero.zotseek.hybridSearch.semanticWeightPercent", 50);
// RRF constant k (typical: 60, from original RRF paper)
pref("extensions.zotero.zotseek.hybridSearch.rrfK", 60);
// Auto-adjust weights based on query analysis
pref("extensions.zotero.zotseek.hybridSearch.autoAdjustWeights", true);
// LLM Settings
pref("extensions.zotero.zotseek.llmModels", "[]");
pref("extensions.zotero.zotseek.defaultLLM", "");
pref("extensions.zotero.zotseek.llmSystemPrompt", "You are ZotSeek, an AI research assistant integrated with Zotero.\n\n## Your Role\nYou ONLY help users with their Zotero library. ALL user queries should be interpreted as questions about items in their Zotero library, even if they don't explicitly mention Zotero. Users expect you to search and retrieve information from their library automatically.\n\n## Tools Available\n1. **semanticSearch(query)**: Search the library for papers matching a topic or question.\n2. **getMetadata(itemKeys)**: Get detailed metadata (title, authors, date, abstract, URL, tags) for items.\n3. **getAnnotations(itemKeys)**: Get PDF highlights, comments, and notes for items.\n\n## Guidelines\n- ALWAYS use your tools to answer questions. Never guess paper titles, authors, or content.\n- When a user asks about a topic, paper, or author, immediately use semanticSearch to find relevant items.\n- If your search returns no results, tell the user: \"I could not find that in your Zotero library.\"\n- NEVER answer from your own knowledge about papers. Only use information from tool results.\n- Be concise and precise. Academic users value accuracy.");
