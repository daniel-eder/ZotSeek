/**
 * Zotero API wrapper
 * Provides type-safe access to Zotero's internal APIs
 *
 * Reference: https://windingwind.github.io/doc-for-zotero-plugin-dev/main/item-operations.html
 */

import { TextSourceType } from '../core/vector-store-sqlite';

declare const Zotero: any;

export interface ZoteroItem {
  id: number;
  key: string;
  libraryID: number;
  itemType: string;
  getField(field: string): string;
  setField(field: string, value: string): void;
  getCreators(): ZoteroCreator[];
  getCreatorJSON(index: number): { firstName: string; lastName: string; creatorType: string };
  getBestAttachment(): Promise<ZoteroAttachment | null>;
  getAttachments(): number[];  // Returns attachment IDs
  getNotes(): number[];        // Returns note IDs
  isRegularItem(): boolean;
  isAttachment(): boolean;
  isNote(): boolean;
  relatedItems: string[];      // Related item keys
  addRelatedItem(item: ZoteroItem): void;
  saveTx(): Promise<number>;
}

export interface ZoteroCreator {
  firstName: string;
  lastName: string;
  creatorType: string;
}

export interface ZoteroAttachment {
  id: number;
  key: string;
  attachmentContentType: string;
  attachmentText: Promise<string>;  // Full text from PDF/HTML
  isPDFAttachment(): boolean;
  isSnapshotAttachment(): boolean;
  getFilePath(): Promise<string>;
}

export interface ZoteroCollection {
  id: number;
  key: string;
  name: string;
  libraryID: number;
  getChildItems(includeDeleted?: boolean): ZoteroItem[];
}

// Helper to log with Zotero.debug
function debug(msg: string): void {
  if (typeof Zotero !== 'undefined' && Zotero.debug) {
    Zotero.debug(`[ZoteroAPI] ${msg}`);
  }
}

/**
 * Wrapper for Zotero API access
 */
export class ZoteroAPI {
  /**
   * Get currently selected items in Zotero
   */
  getSelectedItems(): ZoteroItem[] {
    try {
      const pane = Zotero.getActiveZoteroPane();
      if (!pane) return [];
      return pane.getSelectedItems() || [];
    } catch (error) {
      debug(`Failed to get selected items: ${error}`);
      return [];
    }
  }

  /**
   * Get all items in a collection using Search API
   * Reference: https://windingwind.github.io/doc-for-zotero-plugin-dev/main/search-operations.html
   */
  async getCollectionItems(collectionId: number): Promise<ZoteroItem[]> {
    try {
      const s = new Zotero.Search();
      s.libraryID = Zotero.Libraries.userLibraryID;
      s.addCondition('collectionID', 'is', collectionId);
      s.addCondition('recursive', 'true');  // Include subcollections
      s.addCondition('itemType', 'isNot', 'attachment');
      s.addCondition('itemType', 'isNot', 'note');

      // Exclude books if preference is set
      const excludeBooks = Zotero.Prefs.get('zotseek.excludeBooks', true) ?? true;
      if (excludeBooks) {
        s.addCondition('itemType', 'isNot', 'book');
      }

      const itemIDs = await s.search();
      return Zotero.Items.getAsync(itemIDs);
    } catch (error) {
      debug(`Failed to get collection items: ${error}`);
      return [];
    }
  }

  /**
   * Get all regular items in user's library using Search API
   */
  async getLibraryItems(libraryId?: number): Promise<ZoteroItem[]> {
    try {
      const s = new Zotero.Search();
      s.libraryID = libraryId || Zotero.Libraries.userLibraryID;
      s.addCondition('itemType', 'isNot', 'attachment');
      s.addCondition('itemType', 'isNot', 'note');

      // Exclude books if preference is set
      const excludeBooks = Zotero.Prefs.get('zotseek.excludeBooks', true) ?? true;
      if (excludeBooks) {
        s.addCondition('itemType', 'isNot', 'book');
      }

      const itemIDs = await s.search();
      return Zotero.Items.getAsync(itemIDs);
    } catch (error) {
      debug(`Failed to get library items: ${error}`);
      return [];
    }
  }

  /**
   * Get item by ID
   */
  getItem(itemId: number): ZoteroItem | null {
    try {
      return Zotero.Items.get(itemId);
    } catch (error) {
      debug(`Failed to get item ${itemId}: ${error}`);
      return null;
    }
  }

  /**
   * Get items by IDs
   */
  async getItems(itemIds: number[]): Promise<ZoteroItem[]> {
    try {
      return Zotero.Items.getAsync(itemIds);
    } catch (error) {
      debug(`Failed to get items: ${error}`);
      return [];
    }
  }

  /**
   * Get full text content for an item using attachment.attachmentText
   * Reference: https://windingwind.github.io/doc-for-zotero-plugin-dev/main/item-operations.html
   */
  async getFullText(itemId: number): Promise<string | null> {
    try {
      const item = this.getItem(itemId);
      if (!item || !item.isRegularItem()) return null;

      const attachmentIDs = item.getAttachments();
      const fulltext: string[] = [];

      for (const id of attachmentIDs) {
        const attachment = Zotero.Items.get(id) as ZoteroAttachment;
        if (attachment.isPDFAttachment() || attachment.isSnapshotAttachment()) {
          try {
            const text = await attachment.attachmentText;
            if (text) fulltext.push(text);
          } catch (e) {
            // Some attachments may not have text
          }
        }
      }

      return fulltext.join('\n\n') || null;
    } catch (error) {
      debug(`Failed to get full text for item ${itemId}: ${error}`);
      return null;
    }
  }

  /**
   * Extract text from item (title + abstract, with fulltext fallback)
   */
  async extractText(item: ZoteroItem): Promise<{ text: string; source: TextSourceType }> {
    const title = item.getField('title') || '';
    const abstract = item.getField('abstractNote') || '';

    // Prefer title + abstract
    if (abstract.length > 50) {
      return {
        text: `${title}\n\n${abstract}`,
        source: 'abstract'
      };
    }

    // Try full text from attachments
    const fullText = await this.getFullText(item.id);
    if (fullText && fullText.length > 100) {
      // Use first 500 words of full text
      const words = fullText.split(/\s+/).slice(0, 500);
      return {
        text: `${title}\n\n${words.join(' ')}`,
        source: 'fulltext'
      };
    }

    // Fall back to title only
    return {
      text: title,
      source: 'title_only'
    };
  }

  /**
   * Set two items as related to each other
   */
  async setRelated(itemA: ZoteroItem, itemB: ZoteroItem): Promise<void> {
    itemA.addRelatedItem(itemB);
    await itemA.saveTx();
    itemB.addRelatedItem(itemA);
    await itemB.saveTx();
    debug(`Set items ${itemA.id} and ${itemB.id} as related`);
  }

  /**
   * Format authors for display
   */
  formatAuthors(item: ZoteroItem): string {
    const creators = item.getCreators();
    const authors = creators.filter(c => c.creatorType === 'author');

    if (authors.length === 0) return '';
    if (authors.length === 1) return authors[0].lastName;
    if (authors.length === 2) return `${authors[0].lastName} & ${authors[1].lastName}`;
    return `${authors[0].lastName} et al.`;
  }

  /**
   * Get year from item
   */
  getYear(item: ZoteroItem): number | null {
    const date = item.getField('date');
    if (!date) return null;
    const year = parseInt(date.substring(0, 4), 10);
    return isNaN(year) ? null : year;
  }

  /**
   * Select an item in Zotero
   */
  selectItem(itemId: number): void {
    try {
      const pane = Zotero.getActiveZoteroPane();
      if (pane) {
        pane.selectItem(itemId);
      }
    } catch (error) {
      debug(`Failed to select item ${itemId}: ${error}`);
    }
  }

  /**
   * Open PDF attachment for an item
   */
  async openPDF(itemId: number): Promise<void> {
    try {
      const item = this.getItem(itemId);
      if (!item) return;

      const attachment = await item.getBestAttachment();
      if (!attachment) return;

      Zotero.OpenPDF.openToPage(attachment);
    } catch (error) {
      debug(`Failed to open PDF for item ${itemId}: ${error}`);
    }
  }

  /**
   * Get user library ID
   */
  getUserLibraryID(): number {
    return Zotero.Libraries.userLibraryID;
  }
}

