/**
 * Preferences pane handler
 * Manages the preference window UI and interactions
 */

import { getZotero } from '../utils/zotero-helper';

class PreferencesManager {
  private window: Window | null = null;
  private logger: any;

  constructor() {
    const Z = getZotero();
    this.logger = {
      info: (msg: string) => Z?.debug(`[ZotSeek] [Preferences] ${msg}`),
      error: (msg: string) => Z?.debug(`[ZotSeek] [ERROR] [Preferences] ${msg}`),
      debug: (msg: string) => Z?.debug(`[ZotSeek] [DEBUG] [Preferences] ${msg}`)
    };
  }

  /**
   * Initialize the preference pane
   */
  async init(window: Window): Promise<void> {
    this.window = window;
    this.logger.info('Initializing preference pane');

    try {
      // Initialize preferences
      this.initPreferences();

      // Set up event listeners
      this.initEventListeners();

      // Auto-load stats
      await this.loadStatsAndCheckMismatch();

      this.logger.info('Preference pane initialized successfully');
    } catch (error) {
      this.logger.error(`Failed to initialize preferences: ${error}`);
    }
  }

  /**
   * Initialize preference values in UI elements
   */
  private initPreferences(): void {
    if (!this.window) return;
    const doc = this.window.document;
    const Z = getZotero();
    if (!Z) return;

    // Read current preference values
    const prefs = {
      indexingMode: Z.Prefs.get('zotseek.indexingMode', true) || 'abstract',
      maxTokens: Z.Prefs.get('zotseek.maxTokens', true) ?? 7500,
      maxChunksPerPaper: Z.Prefs.get('zotseek.maxChunksPerPaper', true) ?? 5,
      topK: Z.Prefs.get('zotseek.topK', true) ?? 20,
      minSimilarity: Z.Prefs.get('zotseek.minSimilarityPercent', true) ?? 30,
      excludeBooks: Z.Prefs.get('zotseek.excludeBooks', true) ?? true,
      embeddingProvider: Z.Prefs.get('zotseek.embeddingProvider', true) || 'local',
      embeddingModel: Z.Prefs.get('zotseek.embeddingModel', true) || '',
      apiKey: Z.Prefs.get('zotseek.apiKey', true) || '',
      apiEndpoint: Z.Prefs.get('zotseek.apiEndpoint', true) || '',
    };

    this.logger.debug(`Loaded preferences: ${JSON.stringify(prefs)}`);

    // Set menulist values
    this.setMenulistValue('zotseek-pref-indexingMode', prefs.indexingMode);
    this.setMenulistValue('zotseek-pref-embeddingProvider', prefs.embeddingProvider);

    // Set input values
    this.setInputValue('zotseek-pref-maxTokens', prefs.maxTokens);
    this.setInputValue('zotseek-pref-maxChunksPerPaper', prefs.maxChunksPerPaper);
    this.setInputValue('zotseek-pref-topK', prefs.topK);
    this.setInputValue('zotseek-pref-minSimilarity', prefs.minSimilarity);
    this.setInputValue('zotseek-pref-embeddingModel', prefs.embeddingModel);
    this.setInputValue('zotseek-pref-apiKey', prefs.apiKey);
    this.setInputValue('zotseek-pref-apiEndpoint', prefs.apiEndpoint);

    // Set checkbox values
    this.setCheckboxValue('zotseek-pref-excludeBooks', prefs.excludeBooks);

    // Update visibility of provider fields
    this.updateProviderFieldsVisibility(prefs.embeddingProvider);
  }

  /**
   * Set up event listeners for UI elements
   */
  private initEventListeners(): void {
    if (!this.window) return;
    const doc = this.window.document;
    const Z = getZotero();
    if (!Z) return;

    // Indexing mode change
    const indexingModeMenu = doc.getElementById('zotseek-pref-indexingMode') as any;
    if (indexingModeMenu) {
      indexingModeMenu.addEventListener('command', () => {
        const value = indexingModeMenu.selectedItem?.value;
        if (value) {
          Z.Prefs.set('zotseek.indexingMode', value, true);
          this.logger.info(`Indexing mode changed to: ${value}`);
          this.loadStatsAndCheckMismatch();
        }
      });
    }

    // Embedding provider change
    const providerMenu = doc.getElementById('zotseek-pref-embeddingProvider') as any;
    if (providerMenu) {
      providerMenu.addEventListener('command', () => {
        const value = providerMenu.selectedItem?.value;
        if (value) {
          Z.Prefs.set('zotseek.embeddingProvider', value, true);
          this.logger.info(`Embedding provider changed to: ${value}`);
          this.updateProviderFieldsVisibility(value);
          this.showEmbeddingWarning();
        }
      });
    }

    // Number inputs
    const numberInputs = [
      { id: 'zotseek-pref-maxTokens', pref: 'zotseek.maxTokens' },
      { id: 'zotseek-pref-maxChunksPerPaper', pref: 'zotseek.maxChunksPerPaper' },
      { id: 'zotseek-pref-topK', pref: 'zotseek.topK' },
      { id: 'zotseek-pref-minSimilarity', pref: 'zotseek.minSimilarityPercent' }
    ];

    for (const { id, pref } of numberInputs) {
      const input = doc.getElementById(id) as HTMLInputElement;
      if (input) {
        input.addEventListener('change', () => {
          const value = parseInt(input.value, 10);
          if (!isNaN(value)) {
            Z.Prefs.set(pref, value, true);
            this.logger.debug(`${pref} changed to: ${value}`);
          }
        });
      }
    }

    // Text/Password inputs
    const textInputs = [
      { id: 'zotseek-pref-embeddingModel', pref: 'zotseek.embeddingModel', warn: true },
      { id: 'zotseek-pref-apiKey', pref: 'zotseek.apiKey', warn: false },
      { id: 'zotseek-pref-apiEndpoint', pref: 'zotseek.apiEndpoint', warn: true }
    ];

    for (const { id, pref, warn } of textInputs) {
      const input = doc.getElementById(id) as HTMLInputElement;
      if (input) {
        input.addEventListener('change', () => {
          const value = input.value.trim();
          Z.Prefs.set(pref, value, true);
          this.logger.debug(`${pref} changed`);
          if (warn) this.showEmbeddingWarning();
        });
      }
    }

    // Checkbox inputs
    const excludeBooksCheckbox = doc.getElementById('zotseek-pref-excludeBooks') as any;
    if (excludeBooksCheckbox) {
      excludeBooksCheckbox.addEventListener('command', () => {
        const checked = excludeBooksCheckbox.checked;
        Z.Prefs.set('zotseek.excludeBooks', checked, true);
        this.logger.info(`Exclude books changed to: ${checked}`);
      });
    }

    // Button event listeners
    const refreshBtn = doc.getElementById('zotseek-refresh-stats');
    if (refreshBtn) {
      refreshBtn.addEventListener('command', () => this.loadStatsAndCheckMismatch());
    }

    const clearBtn = doc.getElementById('zotseek-clear-index');
    if (clearBtn) {
      clearBtn.addEventListener('command', () => this.clearIndex());
    }

    const rebuildBtn = doc.getElementById('zotseek-rebuild-index');
    if (rebuildBtn) {
      rebuildBtn.addEventListener('command', () => this.rebuildIndex());
    }

    const updateBtn = doc.getElementById('zotseek-update-index');
    if (updateBtn) {
      updateBtn.addEventListener('command', () => this.updateIndex());
    }
  }

  /**
   * Load statistics and check for indexing mode mismatch
   */
  async loadStatsAndCheckMismatch(): Promise<void> {
    if (!this.window) return;
    const doc = this.window.document;
    const Z = getZotero();
    if (!Z?.ZotSeek) return;

    const setText = (id: string, value: string) => {
      const el = doc.getElementById(id);
      if (el) el.textContent = value;
    };

    setText('zotseek-stat-papers', '...');

    try {
      const stats = await Z.ZotSeek.getStats();

      // Update all statistics
      setText('zotseek-stat-papers', stats.indexedPapers.toLocaleString());
      setText('zotseek-stat-chunks', stats.totalChunks.toLocaleString());
      setText('zotseek-stat-avgchunks', stats.avgChunksPerPaper.toString());
      setText('zotseek-stat-storage', stats.storageSize);
      setText('zotseek-stat-dbpath', stats.databasePath || '-');
      setText('zotseek-stat-model', stats.modelId);
      setText('zotseek-stat-lastindexed', stats.lastIndexed);

      // Handle index duration display
      const durationLabel = doc.getElementById('zotseek-stat-duration-label');
      const durationValue = doc.getElementById('zotseek-stat-duration');
      if (stats.lastIndexDuration) {
        setText('zotseek-stat-duration', stats.lastIndexDuration);
        if (durationLabel) durationLabel.style.display = 'block';
        if (durationValue) durationValue.style.display = 'block';
      } else {
        if (durationLabel) durationLabel.style.display = 'none';
        if (durationValue) durationValue.style.display = 'none';
      }

      // Handle indexed mode display and mismatch warning
      const indexedModeLabel = doc.getElementById('zotseek-stat-indexedmode-label');
      const indexedModeValue = doc.getElementById('zotseek-stat-indexedmode');
      const warningBox = doc.getElementById('zotseek-indexmode-warning');

      if (stats.indexedWithMode) {
        setText('zotseek-stat-indexedmode', stats.indexedWithMode);
        if (indexedModeLabel) indexedModeLabel.style.display = 'block';
        if (indexedModeValue) indexedModeValue.style.display = 'block';

        // Check for mismatch
        const currentMode = Z.Prefs.get('zotseek.indexingMode', true) || 'abstract';
        const currentModeLabel = {
          'abstract': 'Abstract Only',
          'full': 'Full Paper'
        }[currentMode] || currentMode;

        if (warningBox) {
          if (stats.indexedWithMode !== currentModeLabel && stats.indexedPapers > 0) {
            // Show warning - there's a mismatch
            warningBox.style.display = 'block';
            const indexedModeEl = doc.getElementById('zotseek-warning-indexed-mode');
            const currentModeEl = doc.getElementById('zotseek-warning-current-mode');
            if (indexedModeEl) indexedModeEl.textContent = stats.indexedWithMode;
            if (currentModeEl) currentModeEl.textContent = currentModeLabel;
          } else {
            // Hide warning - modes match or no papers indexed
            warningBox.style.display = 'none';
          }
        }
      } else {
        // No indexed mode stored (old index)
        if (indexedModeLabel) indexedModeLabel.style.display = 'none';
        if (indexedModeValue) indexedModeValue.style.display = 'none';
        if (warningBox) warningBox.style.display = 'none';
      }

      this.logger.debug('Stats loaded successfully');
    } catch (error) {
      setText('zotseek-stat-papers', 'Error');
      this.logger.error(`Failed to load stats: ${error}`);
    }
  }

  /**
   * Clear the index
   */
  private async clearIndex(): Promise<void> {
    const Z = getZotero();
    if (Z?.ZotSeek) {
      await Z.ZotSeek.clearIndex();
      // Refresh stats after clearing
      await this.loadStatsAndCheckMismatch();
    }
  }

  /**
   * Rebuild the index
   */
  private async rebuildIndex(): Promise<void> {
    const Z = getZotero();
    if (Z?.ZotSeek) {
      await Z.ZotSeek.rebuildIndex();
      // Stats will be refreshed after rebuild completes
    }
  }

  /**
   * Update the index
   */
  private updateIndex(): void {
    const Z = getZotero();
    if (Z?.ZotSeek) {
      Z.ZotSeek.indexLibrary();
      // Stats will be refreshed after indexing completes
    }
  }

  /**
   * Helper to set menulist value
   */
  private setMenulistValue(menulistId: string, value: any): void {
    if (!this.window) return;
    const menulist = this.window.document.getElementById(menulistId) as any;
    if (!menulist) return;

    const strValue = String(value);
    const menupopup = menulist.querySelector('menupopup');
    if (menupopup) {
      const items = menupopup.querySelectorAll('menuitem');
      for (let i = 0; i < items.length; i++) {
        if (items[i].getAttribute('value') === strValue) {
          menulist.selectedIndex = i;
          break;
        }
      }
    }
  }

  /**
   * Helper to set input value
   */
  private setInputValue(inputId: string, value: any): void {
    if (!this.window) return;
    const input = this.window.document.getElementById(inputId) as HTMLInputElement;
    if (input && value !== undefined) {
      input.value = String(value);
    }
  }

  /**
   * Helper to set checkbox value
   */
  private setCheckboxValue(checkboxId: string, checked: boolean): void {
    if (!this.window) return;
    const checkbox = this.window.document.getElementById(checkboxId) as any;
    if (checkbox) {
      checkbox.checked = checked;
    }
  }

  /**
   * Update visibility of provider-specific fields
   */
  private updateProviderFieldsVisibility(provider: string): void {
    if (!this.window) return;
    const doc = this.window.document;

    const show = (id: string, isVisible: boolean) => {
      const el = doc.getElementById(id);
      if (el) el.style.display = isVisible ? 'flex' : 'none';
    };

    // Model field is shown for all except local (which is fixed)
    show('zotseek-pref-box-embeddingModel', provider !== 'local');

    // API endpoint is shown for generic
    show('zotseek-pref-box-apiEndpoint', provider === 'generic');

    // API key is shown for all except local
    show('zotseek-pref-box-apiKey', provider !== 'local');
  }

  /**
   * Show warning that embedding settings change requires re-indexing
   */
  private showEmbeddingWarning(): void {
    if (!this.window) return;
    const warning = this.window.document.getElementById('zotseek-embedding-warning');
    if (warning) warning.style.display = 'block';
  }

  /**
   * Clean up when preference pane is closed
   */
  destroy(): void {
    this.window = null;
    this.logger.info('Preference pane destroyed');
  }
}

// Create singleton instance
export const preferencesManager = new PreferencesManager();
