/**
 * ZotSeek Search Dialog with VirtualizedTable
 *
 * This dialog provides a native Zotero-style interface for semantic search
 * using the VirtualizedTableHelper from zotero-plugin-toolkit.
 */

import { SearchResultsTable } from './results-table';
import { SearchEngine, searchEngine, SearchResult } from '../core/search-engine';
import { HybridSearchEngine, HybridSearchResult, SearchMode } from '../core/hybrid-search';
import { ZoteroAPI } from '../utils/zotero-api';
import { Logger } from '../utils/logger';
import { getZotero } from '../utils/zotero-helper';

declare const Zotero: any;

export class ZotSeekDialogVTable {
  private logger: Logger;
  private zoteroAPI: ZoteroAPI;
  private resultsTable: SearchResultsTable | null = null;
  private window: Window | null = null;
  private results: HybridSearchResult[] = [];
  private enrichedData: Map<number, any> = new Map();
  private isSearching: boolean = false;
  private searchTimeout: number | null = null;
  private lastQuery: string = '';
  private autoSearchDelay: number = 500; // milliseconds to wait after typing stops
  private minQueryLength: number = 3; // minimum characters before auto-search triggers
  
  // Hybrid search
  private hybridSearch: HybridSearchEngine;
  private searchMode: SearchMode = 'hybrid';
  private autoAdjustWeights: boolean = true;

  constructor() {
    this.logger = new Logger('ZotSeekDialogVTable');
    this.zoteroAPI = new ZoteroAPI();
    this.hybridSearch = new HybridSearchEngine(searchEngine);
    
    // Load preferences
    this.loadPreferences();
  }
  
  /**
   * Load hybrid search preferences from Zotero prefs
   */
  private loadPreferences(): void {
    try {
      const Z = getZotero();
      if (Z && Z.Prefs) {
        const mode = Z.Prefs.get('extensions.zotero.zotseek.hybridSearch.mode', true);
        if (mode === 'hybrid' || mode === 'semantic' || mode === 'keyword') {
          this.searchMode = mode;
        }
        
        this.autoAdjustWeights = Z.Prefs.get('extensions.zotero.zotseek.hybridSearch.autoAdjustWeights', true) !== false;
      }
    } catch (e) {
      this.logger.warn('Failed to load preferences, using defaults:', e);
    }
  }

  /**
   * Initialize the dialog (called from XHTML onload)
   */
  async init(win: Window): Promise<void> {
    this.window = win;
    const doc = win.document;

    try {
      // Initialize results table
      this.resultsTable = new SearchResultsTable({
        containerId: 'zotseek-results-container',
        onSelectionChange: (indices) => this.onSelectionChange(indices),
        onActivate: (index) => this.onActivate(index),
      });

      await this.resultsTable.init(win);

      // Bind event handlers
      const searchBtn = doc.getElementById('zotseek-btn');
      const queryInput = doc.getElementById('zotseek-query') as HTMLInputElement;
      const openBtn = doc.getElementById('zotseek-open-btn');
      const closeBtn = doc.getElementById('zotseek-close-btn');

      searchBtn?.addEventListener('click', () => this.performSearch());

      // Add auto-search on input with debouncing
      queryInput?.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value.trim();

        // Clear existing timeout
        if (this.searchTimeout) {
          win.clearTimeout(this.searchTimeout);
          this.searchTimeout = null;
        }

        // Don't search if query is empty
        if (!query) {
          this.setStatus(''); // Clear status when no query
          // Clear results if query is cleared
          this.results = [];
          this.enrichedData.clear();
          this.resultsTable?.setResults([]);
          this.lastQuery = '';
          return;
        }

        // Check minimum query length
        if (query.length < this.minQueryLength) {
          this.setStatus(`Type at least ${this.minQueryLength} characters...`);
          return;
        }

        // Skip if same query and we have results
        if (query === this.lastQuery && this.results.length > 0) {
          return;
        }

        // Set status to indicate we're waiting
        this.setStatus('Searching in a moment...');

        // Set new timeout for auto-search
        this.searchTimeout = win.setTimeout(() => {
          this.performSearch();
        }, this.autoSearchDelay);
      });

      // Keep Enter key for immediate search
      queryInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !this.isSearching) {
          // Clear any pending auto-search
          if (this.searchTimeout) {
            win.clearTimeout(this.searchTimeout);
            this.searchTimeout = null;
          }
          this.performSearch();
        }
      });

      openBtn?.addEventListener('click', () => this.openSelected());
      closeBtn?.addEventListener('click', () => this.close());

      // Add keyboard shortcuts
      win.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.close();
        }
      });
      
      // Initialize search mode dropdown
      const modeSelect = doc.getElementById('search-mode-select') as HTMLSelectElement;
      if (modeSelect) {
        // Set current value from preference
        modeSelect.value = this.searchMode;
        
        // Handle mode changes
        modeSelect.addEventListener('command', (e) => {
          const newMode = (e.target as HTMLSelectElement).value as SearchMode;
          this.setSearchMode(newMode);
        });
        
        // Also handle 'change' event for HTML select elements
        modeSelect.addEventListener('change', (e) => {
          const newMode = (e.target as HTMLSelectElement).value as SearchMode;
          this.setSearchMode(newMode);
        });
      }
      
      // Expose setSearchMode globally for XUL command attribute
      (win as any).searchDialogVTable = {
        setSearchMode: (mode: SearchMode) => this.setSearchMode(mode),
        getSearchMode: () => this.getSearchMode(),
      };

      // Focus the input
      queryInput?.focus();

      this.logger.info(`Search dialog initialized (mode: ${this.searchMode})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      this.logger.error('Failed to initialize dialog:', errorMessage);
      this.logger.error('Stack trace:', errorStack);
      this.setStatus(`Failed to initialize dialog: ${errorMessage}`);
    }
  }

  /**
   * Perform the search using hybrid search
   */
  private async performSearch(): Promise<void> {
    if (!this.window || this.isSearching) return;
    const doc = this.window.document;

    const queryInput = doc.getElementById('zotseek-query') as HTMLInputElement;
    const query = queryInput?.value?.trim();

    if (!query) {
      this.setStatus(''); // Don't show error, user knows to enter query
      return;
    }

    // Skip if same query as last search
    if (query === this.lastQuery && this.results.length > 0) {
      return;
    }

    this.isSearching = true;
    this.lastQuery = query;
    const searchBtn = doc.getElementById('zotseek-btn') as HTMLButtonElement;
    if (searchBtn) {
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching...';
    }

    try {
      this.setStatus('Initializing search...');
      this.setOpenButtonEnabled(false);

      // Show search mode in status
      const modeLabel = this.searchMode === 'hybrid' ? 'Hybrid' : 
                        this.searchMode === 'semantic' ? 'Semantic' : 'Keyword';
      this.setStatus(`${modeLabel} search: Initializing...`);

      // Initialize search engine if needed (hybrid search will init as needed)
      if (this.searchMode !== 'keyword' && !searchEngine.isReady()) {
        this.setStatus('Loading AI model (first time may take a moment)...');
        await searchEngine.init();
      }

      // Perform hybrid search
      this.setStatus(`${modeLabel} search: Finding items...`);
      
      // Use smart search (auto-adjusts weights) or regular search based on preference
      if (this.searchMode === 'hybrid' && this.autoAdjustWeights) {
        this.results = await this.hybridSearch.smartSearch(query, {
          finalTopK: 50,
          minSimilarity: 0.2,
          mode: this.searchMode,
        });
      } else {
        this.results = await this.hybridSearch.search(query, {
          finalTopK: 50,
          minSimilarity: 0.2,
          mode: this.searchMode,
        });
      }

      // Update table with results (metadata is already populated by hybrid search)
      await this.resultsTable?.setHybridResults(this.results);

      // Force a re-render
      if (this.resultsTable) {
        await this.resultsTable.render();
      }

      // Update status with detailed info
      const statusMsg = this.buildStatusMessage();
      this.setStatus(statusMsg);

      // Keep focus on the search input
      const searchInput = this.window?.document.getElementById('zotseek-query') as HTMLInputElement;
      searchInput?.focus();

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(`Search failed: ${message}`);
      this.logger.error('Search failed:', error);
    } finally {
      this.isSearching = false;
      if (searchBtn) {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
      }
    }
  }
  
  /**
   * Build status message with search result summary
   */
  private buildStatusMessage(): string {
    if (this.results.length === 0) {
      return 'No items found';
    }
    
    // Count results by source
    let bothCount = 0;
    let semanticOnlyCount = 0;
    let keywordOnlyCount = 0;
    
    for (const r of this.results) {
      if (r.source === 'both') bothCount++;
      else if (r.source === 'semantic') semanticOnlyCount++;
      else if (r.source === 'keyword') keywordOnlyCount++;
    }
    
    let statusParts: string[] = [`Found ${this.results.length} items`];
    
    if (this.searchMode === 'hybrid' && bothCount > 0) {
      statusParts.push(`(🔗 ${bothCount} · 🧠 ${semanticOnlyCount} · 🔤 ${keywordOnlyCount})`);
    }
    
    return statusParts.join(' ');
  }
  
  /**
   * Set the search mode
   */
  setSearchMode(mode: SearchMode): void {
    this.searchMode = mode;
    this.logger.info(`Search mode changed to: ${mode}`);
    
    // Save preference
    try {
      const Z = getZotero();
      if (Z && Z.Prefs) {
        Z.Prefs.set('extensions.zotero.zotseek.hybridSearch.mode', mode, true);
      }
    } catch (e) {
      this.logger.warn('Failed to save search mode preference:', e);
    }
    
    // Clear results and re-search if there's a query
    this.lastQuery = '';
    this.results = [];
    this.resultsTable?.setHybridResults([]);
    
    // Trigger new search if there's a query
    const queryInput = this.window?.document.getElementById('zotseek-query') as HTMLInputElement;
    if (queryInput?.value?.trim()) {
      this.performSearch();
    }
  }
  
  /**
   * Get current search mode
   */
  getSearchMode(): SearchMode {
    return this.searchMode;
  }

  /**
   * Handle selection change in table
   */
  private onSelectionChange(indices: number[]): void {
    this.setOpenButtonEnabled(indices.length > 0);

    // Don't update status with selection - the table highlight is enough
  }

  /**
   * Handle double-click / Enter on row
   */
  private onActivate(index: number): void {
    const result = this.resultsTable?.getResultAt(index);
    if (result) {
      this.openItem(result.itemId);
    }
  }

  /**
   * Open the selected item(s)
   */
  private openSelected(): void {
    const result = this.resultsTable?.getSelectedResult();
    if (result) {
      this.openItem(result.itemId);
    }
  }

  /**
   * Open an item in Zotero
   */
  private openItem(itemId: number): void {
    try {
      this.zoteroAPI.selectItem(itemId);
      this.close();
    } catch (error) {
      this.logger.error('Failed to open item:', error);
      this.setStatus('Failed to open item in Zotero');
    }
  }

  /**
   * Update status text
   */
  private setStatus(message: string): void {
    const statusEl = this.window?.document.getElementById('zotseek-status-text');
    if (statusEl) {
      statusEl.textContent = message;
    }
  }

  /**
   * Enable/disable open button
   */
  private setOpenButtonEnabled(enabled: boolean): void {
    const btn = this.window?.document.getElementById('zotseek-open-btn') as HTMLButtonElement;
    if (btn) {
      btn.disabled = !enabled;
    }
  }

  /**
   * Close the dialog
   */
  private close(): void {
    this.window?.close();
  }

  /**
   * Cleanup (called from XHTML onunload)
   */
  cleanup(): void {
    // Clear any pending search timeout
    if (this.searchTimeout && this.window) {
      this.window.clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    this.resultsTable?.destroy();
    this.resultsTable = null;
    this.results = [];
    this.enrichedData.clear();
    this.window = null;
    this.lastQuery = '';
    this.logger.info('Search dialog cleaned up');
  }
}

// Export singleton for XHTML binding
export const zotseekDialogVTable = new ZotSeekDialogVTable();

// Set up for standalone dialog bundle - like BetterNotes does
// (Zotero is already declared at the top of the file)

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  init();
});

async function init() {
  try {
    await zotseekDialogVTable.init(window);
  } catch (error) {
    console.error('Failed to initialize dialog:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  }
}

// Cleanup on window unload
window.addEventListener("unload", () => {
  zotseekDialogVTable.cleanup();
});
