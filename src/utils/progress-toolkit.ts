/**
 * Progress window using zotero-plugin-toolkit
 * Alternative implementation using the toolkit library
 */

import { ProgressWindowHelper } from 'zotero-plugin-toolkit';
import { Logger } from './logger';

export interface ProgressOptions {
  title: string;
  closeOnClick?: boolean;
  closeTime?: number;
  cancelCallback?: () => void;
}

export class ToolkitProgress {
  private window: any;
  private logger: Logger;
  private cancelled = false;
  private cancelCallback?: () => void;
  private startTime: number;
  private itemCount = 0;
  private totalItems = 0;
  
  constructor(options: ProgressOptions) {
    this.logger = new Logger('ToolkitProgress');
    this.cancelCallback = options.cancelCallback;
    this.startTime = Date.now();
    
    try {
      // Set icon for all progress windows
      ProgressWindowHelper.setIconURI(
        'default',
        'chrome://zotseek/content/icons/favicon.png'
      );
      
      // Create progress window
      this.window = new ProgressWindowHelper(options.title, {
        closeOnClick: options.closeOnClick ?? false,
        closeTime: options.closeTime ?? -1,
      });
      
      // Create initial line
      this.window.createLine({
        text: 'Initializing...',
        type: 'default',
        progress: 0,
      });
      
      // Show the window
      this.window.show();
      
    } catch (error) {
      this.logger.error('Failed to create toolkit progress window:', error);
      throw error;
    }
  }
  
  /**
   * Update progress with ETA calculation
   */
  updateProgress(text: string, current: number, total: number): void {
    if (this.cancelled) return;
    
    this.itemCount = current;
    this.totalItems = total;
    
    const percent = Math.round((current / total) * 100);
    
    // Calculate ETA
    let etaText = '';
    if (current > 0) {
      const elapsed = Date.now() - this.startTime;
      const avgTimePerItem = elapsed / current;
      const remaining = total - current;
      const etaMs = remaining * avgTimePerItem;
      const etaMin = Math.floor(etaMs / 60000);
      const etaSec = Math.floor((etaMs % 60000) / 1000);
      etaText = etaMin > 0 ? ` (ETA: ${etaMin}m ${etaSec}s)` : ` (ETA: ${etaSec}s)`;
    }
    
    try {
      this.window.changeLine({
        text: `${text} - ${current}/${total}${etaText}`,
        progress: percent,
      });
    } catch (error) {
      this.logger.error('Failed to update progress:', error);
    }
  }
  
  /**
   * Show success message
   */
  success(message: string): void {
    if (this.cancelled) return;
    
    try {
      this.window.changeLine({
        text: message,
        type: 'success',
        progress: 100,
      });
      this.window.startCloseTimer(4000);
    } catch (error) {
      this.logger.error('Failed to show success:', error);
    }
  }
  
  /**
   * Show error message
   */
  error(message: string): void {
    try {
      this.window.changeLine({
        text: message,
        type: 'fail',
        progress: 100,
      });
      this.window.startCloseTimer(8000); // Keep error visible longer
    } catch (error) {
      this.logger.error('Failed to show error:', error);
    }
  }
  
  /**
   * Close the window
   */
  close(): void {
    try {
      this.window.close();
    } catch (error) {
      this.logger.error('Failed to close window:', error);
    }
  }
  
  /**
   * Check if cancelled (toolkit doesn't support cancellation natively)
   */
  isCancelled(): boolean {
    return this.cancelled;
  }
  
  /**
   * Simulate cancellation (toolkit doesn't have native support)
   */
  cancel(): void {
    this.cancelled = true;
    if (this.cancelCallback) {
      this.cancelCallback();
    }
    this.close();
  }
}

/**
 * Quick notification using toolkit
 */
export function showQuickProgress(
  title: string,
  message: string,
  type: 'default' | 'success' | 'fail' = 'default',
  duration = 5000
): void {
  try {
    new ProgressWindowHelper(title)
      .createLine({
        text: message,
        type,
        progress: 100,
      })
      .show(duration);
  } catch (error) {
    console.error('Failed to show quick progress:', error);
  }
}
