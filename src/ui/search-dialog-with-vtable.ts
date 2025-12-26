/**
 * ZotSeek Search Dialog with VirtualizedTable
 * Provides a UI for semantic search queries using native Zotero table
 */

import { Logger } from '../utils/logger';
import { searchEngine, SearchResult } from '../core/search-engine';
import { ZoteroAPI } from '../utils/zotero-api';
import { getZotero } from '../utils/zotero-helper';

declare const Zotero: any;
declare const Services: any;
declare const Components: any;

export class ZotSeekDialogWithVTable {
  private logger: Logger;
  private zoteroAPI: ZoteroAPI;
  private window: any = null;
  private searchResults: SearchResult[] = [];
  
  constructor() {
    this.logger = new Logger('ZotSeekDialogVTable');
    this.zoteroAPI = new ZoteroAPI();
  }

  /**
   * Open the semantic search dialog with VirtualizedTable
   */
  public open(): void {
    try {
      if (this.isWindowOpen()) {
        // Bring existing window to front
        this.window.focus();
        return;
      }

      const Z = getZotero();
      if (!Z) {
        this.logger.error('Zotero not available');
        return;
      }

      // Open dialog window with VirtualizedTable version
      this.window = Z.getMainWindow().openDialog(
        'chrome://zotseek/content/searchDialogVTable.xhtml',
        'zotseek-dialog-vtable',
        'chrome,centerscreen,resizable,dialog=no',
        {}
      );

      this.logger.info('Search dialog with VirtualizedTable opened');
    } catch (error) {
      this.logger.error('Failed to open search dialog:', error);
      this.showError('Failed to open search dialog');
    }
  }

  /**
   * Check if the search window is open
   */
  private isWindowOpen(): boolean {
    return this.window && !this.window.closed && !Components.utils.isDeadWrapper(this.window);
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    const Z = getZotero();
    if (!Z) return;

    const ps = Services.prompt || Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
      .getService(Components.interfaces.nsIPromptService);
    
    ps.alert(
      Z.getMainWindow(),
      'ZotSeek Error',
      message
    );
  }
}

// Export singleton instance
export const searchDialogWithVTable = new ZotSeekDialogWithVTable();
