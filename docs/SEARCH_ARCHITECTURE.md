# Search Architecture

A comprehensive guide to how semantic and hybrid search works in ZotSeek.

---

## Table of Contents

1. [Overview](#overview)
2. [Search Modes](#search-modes)
3. [Hybrid Search with RRF](#hybrid-search-with-rrf)
4. [Semantic Search Pipeline](#semantic-search-pipeline)
5. [Section-Aware Chunking](#section-aware-chunking)
6. [Performance Optimizations](#performance-optimizations)
7. [Query Analysis](#query-analysis)

---

## Overview

The plugin offers three search modes, each optimized for different use cases:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SEARCH ARCHITECTURE OVERVIEW                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                              USER QUERY                                      │
│                                  │                                           │
│                                  ▼                                           │
│                       ┌───────────────────┐                                  │
│                       │   Query Analyzer  │                                  │
│                       │   (Auto-weights)  │                                  │
│                       └─────────┬─────────┘                                  │
│                                 │                                            │
│              ┌──────────────────┼──────────────────┐                         │
│              │                  │                  │                         │
│              ▼                  ▼                  ▼                         │
│    ┌─────────────────┐ ┌───────────────┐ ┌─────────────────┐                │
│    │ 🧠 Semantic      │ │ 🔗 Hybrid     │ │ 🔤 Keyword      │                │
│    │ (Embeddings)    │ │ (RRF Fusion)  │ │ (Zotero Search) │                │
│    └────────┬────────┘ └───────┬───────┘ └────────┬────────┘                │
│             │                  │                  │                          │
│             │         ┌───────┴───────┐          │                          │
│             │         │               │          │                          │
│             ▼         ▼               ▼          ▼                          │
│    ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│    │ Cosine     │ │ Semantic   │ │ Keyword    │ │ Title/     │             │
│    │ Similarity │ │ Results    │ │ Results    │ │ Author/    │             │
│    └────────────┘ └─────┬──────┘ └─────┬──────┘ │ Year Match │             │
│                         │              │        └────────────┘             │
│                         └──────┬───────┘                                    │
│                                │                                            │
│                                ▼                                            │
│                    ┌───────────────────────┐                                │
│                    │  Reciprocal Rank      │                                │
│                    │  Fusion (RRF)         │                                │
│                    │                       │                                │
│                    │  score = Σ 1/(k+rank) │                                │
│                    └───────────┬───────────┘                                │
│                                │                                            │
│                                ▼                                            │
│                    ┌───────────────────────┐                                │
│                    │   RANKED RESULTS      │                                │
│                    │   with indicators:    │                                │
│                    │   🔗 Both sources     │                                │
│                    │   🧠 Semantic only    │                                │
│                    │   🔤 Keyword only     │                                │
│                    └───────────────────────┘                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Search Modes

### 🔗 Hybrid (Recommended)

Combines semantic understanding with exact keyword matching for best results.

| Query Type | Pure Semantic | Pure Keyword | Hybrid |
|------------|---------------|--------------|--------|
| "trust in AI" | ✅ Great | ❌ Poor | ✅ Great |
| "Smith 2023" | ❌ Poor | ✅ Great | ✅ Great |
| "RLHF" | ⚠️ Maybe | ✅ Exact only | ✅ Both |
| "automation bias healthcare" | ✅ Good | ⚠️ Partial | ✅ Best |

### 🧠 Semantic Only

Uses AI embeddings to find conceptually related papers, even with different wording.

**Best for:**
- Conceptual queries: "how does automation affect human decision making"
- Finding related work with different terminology
- Exploratory research

**Limitations:**
- Doesn't understand author names or years
- May miss exact technical terms

### 🔤 Keyword Only

Uses Zotero's built-in quick search on titles, authors, years, tags.

**Best for:**
- Author searches: "Smith 2023"
- Exact terms: "PRISMA 2020"
- Tag-based filtering

**Limitations:**
- No semantic understanding
- Won't find synonyms or related concepts

---

## Hybrid Search with RRF

### What is Reciprocal Rank Fusion?

RRF is a technique for combining ranked lists from different search systems without requiring score normalization or tuning.

```
                    RECIPROCAL RANK FUSION (RRF)
                    ════════════════════════════

    Formula:  RRF_score(doc) = Σ 1/(k + rank_i)

    Where:
    • k = constant (default: 60, from original RRF paper)
    • rank_i = document's rank in each result list

    ┌─────────────────────────────────────────────────────────────────┐
    │ EXAMPLE: Query "Smith automation bias healthcare"               │
    ├─────────────────────────────────────────────────────────────────┤
    │                                                                 │
    │ SEMANTIC SEARCH (by similarity):                                │
    │ ┌────┬──────────────────────────────────────────┬─────────┐    │
    │ │Rank│ Paper                                    │ Score   │    │
    │ ├────┼──────────────────────────────────────────┼─────────┤    │
    │ │ 1  │ Automation bias in clinical AI systems   │ 89%     │    │
    │ │ 2  │ Human-AI decision making in medicine     │ 85%     │    │
    │ │ 3  │ Trust calibration for automated systems  │ 82%     │    │
    │ └────┴──────────────────────────────────────────┴─────────┘    │
    │                                                                 │
    │ KEYWORD SEARCH (by relevance):                                  │
    │ ┌────┬──────────────────────────────────────────┬─────────┐    │
    │ │Rank│ Paper                                    │ Score   │    │
    │ ├────┼──────────────────────────────────────────┼─────────┤    │
    │ │ 1  │ Smith, J. - "Bias in ML systems"         │ 95%     │    │
    │ │ 2  │ Automation bias in clinical AI systems   │ 90%     │    │
    │ │ 3  │ Healthcare AI ethics review              │ 85%     │    │
    │ └────┴──────────────────────────────────────────┴─────────┘    │
    │                                                                 │
    │ RRF FUSION (k=60):                                              │
    │ ┌────────────────────────────────────────────────────────────┐ │
    │ │                                                            │ │
    │ │ "Automation bias in clinical AI systems"                   │ │
    │ │   Semantic: rank 1 → 1/(60+1) = 0.0164                    │ │
    │ │   Keyword:  rank 2 → 1/(60+2) = 0.0161                    │ │
    │ │   TOTAL: 0.0325  ← HIGHEST (appears in BOTH!)             │ │
    │ │                                                            │ │
    │ │ "Smith, J. - Bias in ML systems"                          │ │
    │ │   Semantic: not found → 0                                  │ │
    │ │   Keyword:  rank 1 → 1/(60+1) = 0.0164                    │ │
    │ │   TOTAL: 0.0164                                           │ │
    │ │                                                            │ │
    │ │ "Human-AI decision making in medicine"                     │ │
    │ │   Semantic: rank 2 → 1/(60+2) = 0.0161                    │ │
    │ │   Keyword:  not found → 0                                  │ │
    │ │   TOTAL: 0.0161                                           │ │
    │ │                                                            │ │
    │ └────────────────────────────────────────────────────────────┘ │
    │                                                                 │
    │ FINAL RANKING:                                                  │
    │ 1. 🔗 Automation bias in clinical AI   (0.0325) - BOTH        │
    │ 2. 🔤 Smith, J. - Bias in ML systems   (0.0164) - Keyword     │
    │ 3. 🧠 Human-AI decision making         (0.0161) - Semantic    │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘
```

### Why RRF?

| Property | Benefit |
|----------|---------|
| **No score normalization** | Works on ranks, not raw scores |
| **No tuning required** | k=60 works well across domains |
| **Robust** | Top results from ANY source get boosted |
| **Production-proven** | Used by Elasticsearch, Vespa, Pinecone |

### Result Indicators

| Icon | Meaning | Interpretation |
|------|---------|----------------|
| 🔗 | Found by BOTH | High confidence - matches semantically AND by keywords |
| 🧠 | Semantic only | Conceptually related but may use different terminology |
| 🔤 | Keyword only | Exact match but not indexed for semantic search |

---

## Semantic Search Pipeline

### Embedding Generation

```
┌─────────────────────────────────────────────────────────────────────┐
│                     EMBEDDING PIPELINE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  INPUT TEXT                           EMBEDDING VECTOR               │
│  ┌─────────────────────────┐         ┌─────────────────────┐        │
│  │ "Machine learning for   │         │ [0.023, -0.045,     │        │
│  │  medical diagnosis      │   →     │  0.012, 0.089,      │        │
│  │  using deep neural      │         │  -0.034, 0.056,     │        │
│  │  networks..."           │         │  ... 768 values]    │        │
│  └─────────────────────────┘         └─────────────────────┘        │
│                                                                      │
│  MODEL: nomic-embed-text-v1.5                                       │
│  ├── Context: 8192 tokens                                           │
│  ├── Dimensions: 768                                                │
│  ├── Size: 131MB (quantized)                                        │
│  └── Quality: Outperforms OpenAI text-embedding-3-small             │
│                                                                      │
│  INSTRUCTION PREFIXES (improve retrieval quality):                   │
│  ├── Documents: "search_document: <text>"                           │
│  └── Queries:   "search_query: <text>"                              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Cosine Similarity

```
                         COSINE SIMILARITY
                         ═════════════════

                              A · B
    similarity(A, B) = ─────────────────
                        ||A|| × ||B||

    Where:
    • A · B = dot product = Σ(a[i] × b[i])
    • ||A|| = magnitude = √(Σ a[i]²)

    ┌─────────────────────────────────────────────────────────────┐
    │ INTERPRETATION:                                             │
    ├─────────────────────────────────────────────────────────────┤
    │                                                             │
    │  1.0 ████████████████████████████████████ Identical        │
    │  0.9 ███████████████████████████████████  Very similar     │
    │  0.7 █████████████████████████████        Related topics   │
    │  0.5 ███████████████████                  Loosely related  │
    │  0.3 ███████████                          Different topics │
    │  0.0                                       Completely different│
    │                                                             │
    └─────────────────────────────────────────────────────────────┘
```

### MaxSim Aggregation

When a paper has multiple chunks, we use **MaxSim** (Maximum Similarity):

```
    Paper A has 4 chunks: [summary, methods, findings, content]

    Query: "statistical analysis techniques"

    Similarities:
    ├── summary:  0.45  (abstract mentions statistics)
    ├── methods:  0.89  ← HIGHEST (detailed methods section)
    ├── findings: 0.52  (results discuss significance)
    └── content:  0.32  (background section)

    MaxSim Result: 0.89 (methods chunk matched best)
    Source Display: "Methods" ← Shows WHERE the match was found
```

This ensures that if *any* part of a paper matches your query, the paper ranks highly.

---

## Section-Aware Chunking

### Academic Paper Structure

Unlike generic chunkers that split at arbitrary character boundaries, our chunker respects academic paper structure:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SECTION-AWARE CHUNKING                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  INPUT: Full PDF Text                                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Title: Deep Learning for Medical Diagnosis                   │   │
│  │                                                              │   │
│  │ Abstract: We propose a novel approach to medical...          │   │
│  │                                                              │   │
│  │ 1. Introduction                                              │   │
│  │ Machine learning has revolutionized healthcare...            │   │
│  │                                                              │   │
│  │ 2. Related Work                                              │   │
│  │ Prior studies by Smith et al. (2020) showed...              │   │
│  │                                                              │   │
│  │ 3. Methods                                                   │   │
│  │ We collected data from 500 patients...                       │   │
│  │                                                              │   │
│  │ 4. Results                                                   │   │
│  │ Our analysis shows 95% accuracy...                          │   │
│  │                                                              │   │
│  │ 5. Discussion                                                │   │
│  │ These findings suggest that AI can assist...                │   │
│  │                                                              │   │
│  │ 6. Conclusion                                                │   │
│  │ In summary, we demonstrated...                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  OUTPUT: Semantic Chunks                                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │  CHUNK 1: summary                                            │  │
│  │  ├── Title + Abstract                                        │  │
│  │  └── "What is this paper about?"                             │  │
│  │                                                              │  │
│  │  CHUNK 2-3: methods                                          │  │
│  │  ├── Introduction + Related Work + Methods                   │  │
│  │  └── "How did they do it?"                                   │  │
│  │                                                              │  │
│  │  CHUNK 4-5: findings                                         │  │
│  │  ├── Results + Discussion + Conclusion                       │  │
│  │  └── "What did they find?"                                   │  │
│  │                                                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  SECTION PATTERNS DETECTED:                                         │
│  ├── Methods-like: Introduction, Background, Literature Review,     │
│  │                 Methods, Methodology, Materials, Data Collection │
│  │                                                                  │
│  └── Findings-like: Results, Findings, Evaluation, Discussion,     │
│                     Conclusions, Implications, Limitations         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Chunk Types and Display

| Chunk Type | Contains | Source Display | Purpose |
|------------|----------|----------------|---------|
| `summary` | Title + Abstract | "Abstract" | What is this paper about? |
| `methods` | Intro, Background, Methods | "Methods" | How did they do it? |
| `findings` | Results, Discussion, Conclusions | "Results" | What did they find? |
| `content` | Fallback (no sections detected) | "Content" | Generic content |

### Fallback Behavior

When a PDF doesn't have recognizable section headers (e.g., book chapters, reports, non-standard formats):

1. **Section detection fails** - No "Results", "Methods", etc. found
2. **Fallback triggered** - Entire text split at paragraph boundaries
3. **Chunks labeled `content`** - Displays as "Content" in Source column

| Document Type | Chunks Created | Source Column Shows |
|---------------|----------------|---------------------|
| Standard academic paper | summary + methods + findings | Abstract, Methods, Results |
| Book chapter / Report | summary + content chunks | Abstract, Content, Content... |
| Abstract-only mode | summary only | Abstract |
| No PDF, no abstract | title only | Abstract |

The search still works perfectly with `content` chunks - you just won't know which *part* of the document matched.

### Performance-Optimized Chunking

Embedding time scales **O(n²)** with sequence length due to attention computation:

| Chunk Size | Time per Chunk | Total for Paper |
|------------|----------------|-----------------|
| 7000 tokens (~24K chars) | ~45 seconds | ~45 seconds |
| 2000 tokens (~6K chars) | ~3 seconds | ~12 seconds (4 chunks) |

**Current settings:**
- `maxTokens: 2000` (~6000 characters)
- `maxChunks: 8` per paper
- Paragaph-aware splitting within sections

---

## Performance Optimizations

### Embedding Cache

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CACHING ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  FIRST SEARCH (cache miss):                                         │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                    │
│  │  Query   │ ──► │  SQLite  │ ──► │  Cache   │                    │
│  │          │     │  (disk)  │     │  (RAM)   │                    │
│  └──────────┘     └──────────┘     └──────────┘                    │
│       │                                  │                          │
│       │         ~200ms load              │                          │
│       └──────────────────────────────────┘                          │
│                                                                      │
│  SUBSEQUENT SEARCHES (cache hit):                                   │
│  ┌──────────┐     ┌──────────┐                                     │
│  │  Query   │ ──► │  Cache   │  ──► Results in <50ms               │
│  │          │     │  (RAM)   │                                      │
│  └──────────┘     └──────────┘                                     │
│                                                                      │
│  CACHE CONTENTS:                                                    │
│  • Pre-normalized Float32Arrays (ready for dot product)            │
│  • Item metadata (title, authors, year)                            │
│  • ~75MB for 1000 papers                                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Performance Benchmarks

Tested on MacBook Pro M3:

| Operation | Time |
|-----------|------|
| Model loading | ~1.5 seconds |
| Index 1 chunk | ~3 seconds |
| Index 10 papers (40 chunks) | ~2 minutes |
| First search | ~200ms |
| Subsequent searches | <50ms |
| Hybrid search | ~150ms |

---

## Query Analysis

The plugin automatically adjusts semantic vs keyword weights based on query characteristics:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      QUERY ANALYSIS                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  KEYWORD BOOSTERS (favor exact matching):                           │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Pattern              │ Example              │ Boost            ││
│  ├──────────────────────┼──────────────────────┼──────────────────┤│
│  │ Year present         │ "Smith 2023"         │ +15% keyword     ││
│  │ Author pattern       │ "Jones et al."       │ +20% keyword     ││
│  │ Acronym              │ "RLHF models"        │ +10% keyword     ││
│  │ Quoted phrase        │ "machine learning"   │ +15% keyword     ││
│  │ Special characters   │ "p < 0.05"           │ +10% keyword     ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  SEMANTIC BOOSTERS (favor meaning matching):                        │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Pattern              │ Example                      │ Boost    ││
│  ├──────────────────────┼──────────────────────────────┼──────────┤│
│  │ Question format      │ "how does AI affect..."      │ +15% sem ││
│  │ Conceptual (4+ words)│ "trust in automated systems" │ +10% sem ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
│  EXAMPLES:                                                          │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Query                        │ Weight │ Reasoning              ││
│  ├──────────────────────────────┼────────┼────────────────────────┤│
│  │ "Smith 2023"                 │ 35%/65%│ Year + author pattern  ││
│  │ "how does AI affect trust"   │ 65%/35%│ Question + conceptual  ││
│  │ "machine learning"           │ 50%/50%│ Balanced query         ││
│  │ "PRISMA 2020 guidelines"     │ 25%/75%│ Acronym + year         ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Keyword Scoring

For keyword-only results, we calculate relevance scores based on:

```
Base score: 0.50 (any match)

Bonuses:
├── Title match:     +0.30 × (matched_terms / total_terms)
├── All in title:    +0.15 (if ALL query terms appear in title)
├── Year match:      +0.15 (if query contains the paper's year)
└── Author match:    +0.10 (if query matches author last name, 3+ chars)

Maximum: 1.00 (100%)
```

---

## Configuration

### Search Settings

| Preference | Default | Description |
|------------|---------|-------------|
| `hybridSearch.mode` | `"hybrid"` | `"hybrid"`, `"semantic"`, or `"keyword"` |
| `hybridSearch.semanticWeightPercent` | `50` | Balance (0=keyword, 100=semantic) |
| `hybridSearch.rrfK` | `60` | RRF constant (higher = more weight to top ranks) |
| `hybridSearch.autoAdjustWeights` | `true` | Auto-adjust based on query analysis |

### Chunking Settings

| Preference | Default | Description |
|------------|---------|-------------|
| `indexingMode` | `"abstract"` | `"abstract"` or `"full"` |
| `maxTokens` | `2000` | Max tokens per chunk |
| `maxChunksPerPaper` | `8` | Max chunks per paper |

---

## Summary

ZotSeek combines:

1. **Semantic Understanding** - AI embeddings capture meaning, not just keywords
2. **Keyword Precision** - Zotero's search finds exact author/year/term matches
3. **Intelligent Fusion** - RRF combines both without score normalization
4. **Section Awareness** - Chunks respect academic paper structure
5. **Performance** - Optimized chunking and caching for fast searches

This hybrid approach gives you the best of both worlds: finding conceptually related papers while still being able to search for specific authors, years, and technical terms.

