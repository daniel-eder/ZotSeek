/**
 * Alternative Semantic Search Dialog using Zotero Plugin Toolkit
 * This provides an alternative implementation using the toolkit's DialogHelper
 */

import { Logger } from '../utils/logger';
import { searchEngine, SearchResult } from '../core/search-engine';
import { ZoteroAPI } from '../utils/zotero-api';
import { DialogHelper } from 'zotero-plugin-toolkit';

declare const Zotero: any;

export class ToolkitSearchDialog {
  private logger: Logger;
  private zoteroAPI: ZoteroAPI;

  constructor() {
    this.logger = new Logger('ToolkitSearchDialog');
    this.zoteroAPI = new ZoteroAPI();
  }

  /**
   * Open the search dialog using toolkit's DialogHelper
   */
  public async openWithToolkit(): Promise<void> {

    try {
      const dialog = new DialogHelper(2, 'Semantic Search');

      // Add search input row
      const queryRow = dialog.addRowGroup('Search Query', [
        {
          tag: 'input',
          id: 'search-query',
          attributes: {
            type: 'text',
            placeholder: 'Enter your semantic search query...',
            style: 'width: 400px;',
          },
        },
      ]);

      // Add search button
      dialog.addButton('Search', 'search-btn');
      dialog.addButton('Cancel', 'cancel-btn');

      // Set up button handlers
      dialog.addEventListener('search-btn', async () => {
        const queryInput = dialog.window.document.getElementById('search-query') as HTMLInputElement;
        const query = queryInput?.value?.trim();

        if (!query) {
          dialog.window.alert('Please enter a search query');
          return;
        }

        try {
          // Perform search
          const results = await searchEngine.search(query);

          // Show results in a new dialog or panel
          this.showResults(results, query);

          // Close the search dialog
          dialog.window.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          dialog.window.alert('Search failed: ' + errorMessage);
        }
      });

      dialog.addEventListener('cancel-btn', () => {
        dialog.window.close();
      });

      // Open the dialog
      await dialog.open('Semantic Search');

    } catch (error) {
      this.logger.error('Failed to open toolkit dialog:', error);
    }
  }

  /**
   * Show search results in a simple list dialog
   */
  private async showResults(results: SearchResult[], query: string): Promise<void> {

    try {
      const dialog = new DialogHelper(3, `Search Results: ${query}`);

      // Create results table
      const tableData = results.map(r => ({
        similarity: `${Math.round(r.similarity * 100)}%`,
        title: r.title || 'Untitled',
        itemId: r.itemId,
      }));

      // Add a simple HTML table for results
      const tableHtml = `
        <style>
          .results-table { width: 100%; border-collapse: collapse; }
          .results-table th { background: #f0f0f0; padding: 8px; text-align: left; }
          .results-table td { padding: 8px; border-bottom: 1px solid #ddd; }
          .results-table tr:hover { background: #f5f5f5; cursor: pointer; }
        </style>
        <table class="results-table">
          <thead>
            <tr>
              <th width="80">Similarity</th>
              <th>Title</th>
            </tr>
          </thead>
          <tbody>
            ${tableData.map((r, i) => `
              <tr data-item-id="${r.itemId}" data-index="${i}">
                <td style="color: ${this.getSimilarityColor(parseFloat(r.similarity) / 100)}">${r.similarity}</td>
                <td>${r.title}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      dialog.addRowGroup('Results', [
        {
          tag: 'div',
          namespace: 'html',
          attributes: {
            style: 'height: 400px; overflow-y: auto; width: 600px;',
          },
          properties: {
            innerHTML: tableHtml,
          },
        },
      ]);

      // Add buttons
      dialog.addButton('Open Selected', 'open-btn');
      dialog.addButton('Close', 'close-btn');

      // Handle row clicks
      dialog.window.document.addEventListener('click', (event: any) => {
        const row = event.target.closest('tr[data-item-id]');
        if (row) {
          const itemId = parseInt(row.dataset.itemId);
          this.zoteroAPI.selectItem(itemId);
          dialog.window.close();
        }
      });

      dialog.addEventListener('close-btn', () => {
        dialog.window.close();
      });

      await dialog.open('Search Results');

    } catch (error) {
      this.logger.error('Failed to show results:', error);
    }
  }

  private getSimilarityColor(similarity: number): string {
    if (similarity >= 0.8) return '#10b981'; // green
    if (similarity >= 0.6) return '#f59e0b'; // amber
    return '#6b7280'; // gray
  }
}

// Export singleton instance
export const toolkitSearchDialog = new ToolkitSearchDialog();
