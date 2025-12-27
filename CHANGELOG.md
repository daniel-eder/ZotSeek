# Changelog

All notable changes to ZotSeek - Semantic Search for Zotero will be documented in this file.

## [1.1.0] - 2025-12-27

### Changed
- **Database Storage** - Moved from tables in Zotero's main database to separate `zotseek.sqlite` file
  - Uses SQLite ATTACH DATABASE pattern (inspired by Better BibTeX)
  - Keeps Zotero's main database clean and unbloated
  - Automatic migration from old schema (no user action required)
- **Menu Label** - Renamed "Index for ZotSeek" to "Index Selected for ZotSeek" for clarity

### Added
- **Database Path Display** - Settings panel now shows the database file location
- **Uninstall Cleanup** - Automatically removes database file and preferences on plugin uninstall

### Technical
- Database file stored at: `<Zotero Data Directory>/zotseek.sqlite`
- Migration copies data from old `zs_` tables, then drops them and runs VACUUM
- Added `getDatabasePath()` and `deleteDatabase()` methods to vector store

---

## [1.0.0] - 2025-12-26

### Initial Release 🎉

#### Core Features
- 🔍 **Semantic Search** - Find papers by meaning using local AI embeddings (nomic-embed-text-v1.5)
- 📚 **Find Similar Papers** - Right-click any paper to discover semantically related papers
- 🔎 **ZotSeek Search Dialog** - Search your library with natural language queries
- 🔗 **Hybrid Search** - Combines AI embeddings with Zotero's keyword search using RRF
  - Three search modes: Hybrid (recommended), Semantic Only, Keyword Only
  - Result indicators: 🔗 (both sources), 🧠 (semantic only), 🔤 (keyword only)
- 🗂️ **Flexible Indexing** - Index individual collections or entire library
  - Abstract mode: Fast, uses title + abstract only
  - Fulltext mode: Complete document analysis with section-aware chunking
- 🔒 **100% Local** - No data sent to cloud, works offline after model loads

#### Smart Features
- 📑 **Section-Aware Results** - Shows which section matched (Abstract, Methods, Results)
- 🎯 **Query Analysis** - Automatically adjusts weights based on query type
- ⚡ **Lightning Fast** - First search ~200ms, subsequent searches <50ms with caching
- 💾 **Smart Caching** - Pre-normalized Float32Arrays for instant searches
- 📊 **Stable Progress Tracking** - Reliable progress bars with ETA

#### Technical
- 🧠 **ChromeWorker Implementation** - Transformers.js runs in background thread
- 🛡️ **Rock-Solid SQLite** - Reliable parallel queries for Zotero 8
- ⚙️ **Settings Panel** - Easy configuration in Zotero preferences
- ❌ **Cancellation Support** - Cancel long-running operations anytime
