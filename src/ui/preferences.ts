/**
 * Preferences pane handler
 * Manages the preference window UI and interactions
 */

import { getZotero } from '../utils/zotero-helper';

class PreferencesManager {
  private window: Window | null = null;
  private logger: any;
  private currentModels: any[] = [];
  private editingModelId: string | null = null;

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
  async init(window: Window, paneId: string): Promise<void> {
    this.window = window;
    this.logger.info(`Initializing preference pane: ${paneId}`);

    try {
      // Initialize preferences
      this.initPreferences(paneId);

      // Set up event listeners
      this.initEventListeners(paneId);

      // Auto-load stats only for general pane
      if (paneId === 'general') {
        await this.loadStatsAndCheckMismatch();
      }

      this.logger.info(`Preference pane ${paneId} initialized successfully`);
    } catch (error) {
      this.logger.error(`Failed to initialize preference pane ${paneId}: ${error}`);
    }
  }

  /**
   * Initialize preference values in UI elements
   */
  private initPreferences(paneId: string): void {
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
      llmModels: Z.Prefs.get('zotseek.llmModels', true) || '[]',
      defaultLLM: Z.Prefs.get('zotseek.defaultLLM', true) || '',
      llmSystemPrompt: Z.Prefs.get('zotseek.llmSystemPrompt', true) || '',
    };

    try {
      this.currentModels = JSON.parse(prefs.llmModels);
    } catch (e) {
      this.currentModels = [];
    }

    this.logger.debug(`Loaded preferences for ${paneId}`);

    if (paneId === 'general') {
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

    if (paneId === 'llm-chat') {
      // Update LLM UI
      this.refreshLLMList();
      this.updateDefaultLLMDropdown(prefs.defaultLLM);
      this.setInputValue('zotseek-pref-llmSystemPrompt', prefs.llmSystemPrompt);
    }
  }

  /**
   * Set up event listeners for UI elements
   */
  private initEventListeners(paneId: string): void {
    if (!this.window) return;
    const doc = this.window.document;
    const Z = getZotero();
    if (!Z) return;

    if (paneId === 'general') {
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

    if (paneId === 'llm-chat') {
      // LLM Event Listeners
      const addLLMBtn = doc.getElementById('zotseek-add-llm');
      if (addLLMBtn) {
        addLLMBtn.addEventListener('command', () => this.openLLMEditPane(null));
      }

      const saveLLMBtn = doc.getElementById('zotseek-llm-save');
      if (saveLLMBtn) {
        saveLLMBtn.addEventListener('command', () => this.saveLLMModel());
      }

      const cancelLLMBtn = doc.getElementById('zotseek-llm-cancel');
      if (cancelLLMBtn) {
        cancelLLMBtn.addEventListener('command', () => this.closeLLMEditPane());
      }

      const deleteLLMBtn = doc.getElementById('zotseek-llm-delete');
      if (deleteLLMBtn) {
        deleteLLMBtn.addEventListener('command', () => this.deleteLLMModel());
      }

      const discoverLLMBtn = doc.getElementById('zotseek-llm-discover');
      if (discoverLLMBtn) {
        discoverLLMBtn.addEventListener('command', () => this.discoverLLMModels());
      }

      const defaultLLMMenu = doc.getElementById('zotseek-pref-defaultLLM') as any;
      if (defaultLLMMenu) {
        defaultLLMMenu.addEventListener('command', () => {
          const value = defaultLLMMenu.selectedItem?.value;
          if (value !== undefined) {
            Z.Prefs.set('zotseek.defaultLLM', value, true);
            this.logger.info(`Default LLM changed to: ${value}`);
          }
        });
      }

      const llmSystemPromptInput = doc.getElementById('zotseek-pref-llmSystemPrompt') as any;
      if (llmSystemPromptInput) {
        llmSystemPromptInput.addEventListener('change', () => {
          const value = llmSystemPromptInput.value.trim();
          Z.Prefs.set('zotseek.llmSystemPrompt', value, true);
          this.logger.info('LLM System Prompt updated');
        });
      }

      const restoreDefaultPromptBtn = doc.getElementById('zotseek-restore-default-prompt');
      if (restoreDefaultPromptBtn) {
        restoreDefaultPromptBtn.addEventListener('command', () => this.restoreDefaultSystemPrompt());
      }

      const editProviderMenu = doc.getElementById('zotseek-llm-edit-provider') as any;
      if (editProviderMenu) {
        editProviderMenu.addEventListener('command', () => {
          this.updateLLMEditFieldsVisibility();
        });
      }
    }
  }

  /**
   * LLM Management Methods
   */

  private refreshLLMList(): void {
    if (!this.window) return;
    const container = this.window.document.getElementById('zotseek-llm-models-container');
    if (!container) return;

    // Clear container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (this.currentModels.length === 0) {
      const emptyLabel = this.window.document.createElementNS('http://www.w3.org/1999/xhtml', 'span');
      emptyLabel.textContent = 'No LLM models configured.';
      emptyLabel.style.color = '#666';
      emptyLabel.style.fontStyle = 'italic';
      container.appendChild(emptyLabel);
      return;
    }

    this.currentModels.forEach(model => {
      const row = this.window!.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'hbox') as any;
      row.setAttribute('align', 'center');
      row.style.background = '#fff';
      row.style.border = '1px solid #ddd';
      row.style.borderRadius = '4px';
      row.style.padding = '4px 8px';
      row.style.marginBottom = '4px';

      const label = this.window!.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'label');
      label.setAttribute('value', `${model.label} (${model.provider})`);
      label.setAttribute('flex', '1');
      row.appendChild(label);

      const editBtn = this.window!.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'button');
      editBtn.setAttribute('label', 'Edit');
      editBtn.addEventListener('command', () => this.openLLMEditPane(model.id));
      row.appendChild(editBtn);

      container.appendChild(row);
    });
  }

  private updateDefaultLLMDropdown(currentValue: string): void {
    if (!this.window) return;
    const popup = this.window.document.getElementById('zotseek-pref-defaultLLM-popup');
    if (!popup) return;

    // Clear except first
    while (popup.children.length > 1) {
      popup.removeChild(popup.lastChild!);
    }

    this.currentModels.forEach(model => {
      const item = this.window!.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem');
      item.setAttribute('label', model.label);
      item.setAttribute('value', model.id);
      popup.appendChild(item);
    });

    this.setMenulistValue('zotseek-pref-defaultLLM', currentValue);
  }

  private openLLMEditPane(modelId: string | null): void {
    if (!this.window) return;
    const pane = this.window.document.getElementById('zotseek-llm-edit-pane');
    if (!pane) return;

    this.editingModelId = modelId;
    pane.style.display = 'block';

    const model = modelId ? this.currentModels.find(m => m.id === modelId) : null;

    if (model) {
      this.setMenulistValue('zotseek-llm-edit-provider', model.provider);
      this.setInputValue('zotseek-llm-edit-label', model.label);
      this.setInputValue('zotseek-llm-edit-endpoint', model.endpoint || '');
      this.setInputValue('zotseek-llm-edit-apiKey', model.apiKey || '');
      this.setInputValue('zotseek-llm-edit-model', model.model || '');
      this.window.document.getElementById('zotseek-llm-delete')!.style.display = 'block';
    } else {
      this.setMenulistValue('zotseek-llm-edit-provider', 'openai');
      this.setInputValue('zotseek-llm-edit-label', '');
      this.setInputValue('zotseek-llm-edit-endpoint', '');
      this.setInputValue('zotseek-llm-edit-apiKey', '');
      this.setInputValue('zotseek-llm-edit-model', '');
      this.window.document.getElementById('zotseek-llm-delete')!.style.display = 'none';
    }

    this.updateLLMEditFieldsVisibility();
    pane.scrollIntoView();
  }

  private closeLLMEditPane(): void {
    if (!this.window) return;
    const pane = this.window.document.getElementById('zotseek-llm-edit-pane');
    if (pane) pane.style.display = 'none';
    this.editingModelId = null;
  }

  private updateLLMEditFieldsVisibility(): void {
    if (!this.window) return;
    const provider = (this.window.document.getElementById('zotseek-llm-edit-provider') as any).selectedItem?.value;

    const show = (id: string, isVisible: boolean) => {
      const el = this.window!.document.getElementById(id);
      if (el) (el as HTMLElement).style.display = isVisible ? 'flex' : 'none';
    };

    show('zotseek-llm-edit-box-endpoint', provider === 'generic');

    // Pre-fill endpoints for well-known
    if (provider === 'openai') {
      this.setInputValue('zotseek-llm-edit-endpoint', 'https://api.openai.com/v1');
    } else if (provider === 'google') {
      this.setInputValue('zotseek-llm-edit-endpoint', 'https://generativelanguage.googleapis.com/v1beta/openai');
    } else if (provider === 'anthropic') {
      this.setInputValue('zotseek-llm-edit-endpoint', 'https://api.anthropic.com/v1');
    }
  }

  private getInputValue(id: string): string {
    return (this.window?.document.getElementById(id) as HTMLInputElement)?.value || '';
  }

  private async saveLLMModel(): Promise<void> {
    const provider = (this.window?.document.getElementById('zotseek-llm-edit-provider') as any).selectedItem?.value;
    const label = this.getInputValue('zotseek-llm-edit-label').trim();
    const endpoint = this.getInputValue('zotseek-llm-edit-endpoint').trim();
    const apiKey = this.getInputValue('zotseek-llm-edit-apiKey').trim();
    const model = this.getInputValue('zotseek-llm-edit-model').trim();

    if (!label || !model) {
      if (this.window) this.window.alert('Label and Model ID are required.');
      return;
    }

    const modelObj = {
      id: this.editingModelId || `llm-${Date.now()}`,
      provider,
      label,
      endpoint,
      apiKey,
      model
    };

    if (this.editingModelId) {
      const index = this.currentModels.findIndex(m => m.id === this.editingModelId);
      if (index !== -1) this.currentModels[index] = modelObj;
    } else {
      this.currentModels.push(modelObj);
    }

    this.saveModelsToPrefs();
    this.refreshLLMList();

    const Z = getZotero();
    const currentDefault = Z.Prefs.get('zotseek.defaultLLM', true);
    this.updateDefaultLLMDropdown(currentDefault);

    this.closeLLMEditPane();
  }

  private deleteLLMModel(): void {
    if (!this.editingModelId) return;
    if (this.window && !this.window.confirm('Are you sure you want to delete this model?')) return;

    this.currentModels = this.currentModels.filter(m => m.id !== this.editingModelId);
    this.saveModelsToPrefs();
    this.refreshLLMList();

    const Z = getZotero();
    let currentDefault = Z.Prefs.get('zotseek.defaultLLM', true);
    if (currentDefault === this.editingModelId) {
      Z.Prefs.set('zotseek.defaultLLM', '', true);
      currentDefault = '';
    }
    this.updateDefaultLLMDropdown(currentDefault);

    this.closeLLMEditPane();
  }

  private saveModelsToPrefs(): void {
    const Z = getZotero();
    Z.Prefs.set('zotseek.llmModels', JSON.stringify(this.currentModels), true);
  }

  private async discoverLLMModels(): Promise<void> {
    const endpoint = this.getInputValue('zotseek-llm-edit-endpoint').trim();
    const apiKey = this.getInputValue('zotseek-llm-edit-apiKey').trim();
    const provider = (this.window?.document.getElementById('zotseek-llm-edit-provider') as any).selectedItem?.value;

    if (!endpoint) {
      if (this.window) this.window.alert('API Endpoint is required for discovery.');
      return;
    }

    try {
      this.logger.info(`Discovering models at ${endpoint}`);
      const url = endpoint.endsWith('/') ? `${endpoint}models` : `${endpoint}/models`;

      const headers: any = {
        'Accept': 'application/json'
      };

      if (apiKey) {
        if (provider === 'anthropic') {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
        } else {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const models = data.data || data.models || [];

      if (Array.isArray(models)) {
        const popup = this.window!.document.getElementById('zotseek-llm-edit-model-popup');
        if (popup) {
          while (popup.firstChild) popup.removeChild(popup.firstChild);

          models.forEach((m: any) => {
            const id = m.id || m.name || m;
            if (typeof id === 'string') {
              const item = this.window!.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem');
              item.setAttribute('label', id);
              item.setAttribute('value', id);
              popup.appendChild(item);
            }
          });

          if (this.window) this.window.alert(`Found ${models.length} models.`);
        }
      } else {
        if (this.window) this.window.alert('Could not find models in response.');
      }
    } catch (e) {
      this.logger.error(`Discovery failed: ${e}`);
      if (this.window) this.window.alert(`Discovery failed: ${e}`);
    }
  }

  private restoreDefaultSystemPrompt(): void {
    const defaultPrompt = `You are ZotSeek, an AI research assistant integrated with Zotero.

## Your Role
You ONLY help users with their Zotero library. ALL user queries should be interpreted as questions about items in their Zotero library, even if they don't explicitly mention Zotero. Users expect you to search and retrieve information from their library automatically.

## Tools Available
1. **semanticSearch(query)**: Search the library for papers matching a topic or question.
2. **getMetadata(itemKeys)**: Get detailed metadata (title, authors, date, abstract, URL, tags) for items.
3. **getAnnotations(itemKeys)**: Get PDF highlights, comments, and notes for items.

## Guidelines
- ALWAYS use your tools to answer questions. Never guess paper titles, authors, or content.
- When a user asks about a topic, paper, or author, immediately use semanticSearch to find relevant items.
- If your search returns no results, tell the user: "I could not find that in your Zotero library."
- NEVER answer from your own knowledge about papers. Only use information from tool results.
- Be concise and precise. Academic users value accuracy.`;

    const Z = getZotero();
    Z.Prefs.set('zotseek.llmSystemPrompt', defaultPrompt, true);

    const input = this.window?.document.getElementById('zotseek-pref-llmSystemPrompt') as HTMLTextAreaElement;
    if (input) {
      input.value = defaultPrompt;
    }

    this.logger.info('Default system prompt restored');
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
        const modeMap: Record<string, string> = {
          'abstract': 'Abstract Only',
          'full': 'Full Paper'
        };
        const currentModeLabel = modeMap[currentMode] || currentMode;

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
      if (el) (el as HTMLElement).style.display = isVisible ? 'flex' : 'none';
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
  destroy(paneId: string): void {
    this.window = null;
    this.logger.info(`Preference pane ${paneId} destroyed`);
  }
}

// Create singleton instance
export const preferencesManager = new PreferencesManager();
