/**
 * Wrapper for opening the Similar Documents dialog
 */

import { Logger } from '../utils/logger';
import { getZotero } from '../utils/zotero-helper';

class SimilarDocumentsWrapper {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('SimilarDocumentsWrapper');
  }

  /**
   * Open the similar documents dialog for a given item
   */
  open(sourceItem: any): void {
    const Z = getZotero();
    if (!Z) {
      this.logger.error('Zotero not available');
      return;
    }

    try {
      const windowArgs = {
        sourceItem: sourceItem
      };

      const win = Z.getMainWindow().openDialog(
        'chrome://zotseek/content/similarDocumentsDialog.xhtml',
        'zotseek-similar-documents',
        'chrome,centerscreen,resizable,dialog=no,width=900,height=600',
        windowArgs
      );

      if (win) {
        this.logger.info('Similar documents dialog opened');
      } else {
        this.logger.error('Failed to open similar documents dialog');
      }
    } catch (error) {
      this.logger.error('Error opening similar documents dialog:', error);
    }
  }
}

export const similarDocumentsWrapper = new SimilarDocumentsWrapper();
