/**
 * Progress window utility for Zotero
 * Provides a native progress bar with cancellation support
 */

declare const Zotero: any;

import { Logger } from './logger';
import { simpleProgress } from './simple-progress';

export interface ProgressWindowOptions {
  title?: string;
  text?: string;
  closeOnComplete?: boolean;
  cancelCallback?: () => void;
}

/**
 * Wrapper for Zotero's progress window
 */
export class ProgressWindow {
  private window: any;
  private logger: Logger;
  private cancelled = false;
  private cancelCallback?: () => void;
  private useFallback = false;
  private title?: string;

  constructor(options: ProgressWindowOptions = {}) {
    this.logger = new Logger('ProgressWindow');
    const Z = this.getZotero();
    
    if (!Z) {
      throw new Error('Zotero not available');
    }
    
    try {
      // Create the progress window
      // Check if ProgressWindow is available (Zotero 7+)
      if (Z.ProgressWindow) {
        this.window = new Z.ProgressWindow({
          closeOnClick: false,
        });
      } else {
        // Fallback: try alternative approach
        this.logger.warn('Zotero.ProgressWindow not available, using fallback');
        this.window = Z.ProgressWindowSet ? new Z.ProgressWindowSet() : null;
      }
      
      if (!this.window) {
        throw new Error('Could not create progress window');
      }
      
      // Set title if provided
      if (options.title && this.window.changeHeadline) {
        this.window.changeHeadline(options.title);
      }
      
      // Store cancel callback
      this.cancelCallback = options.cancelCallback;
      
      // Show the window
      if (this.window.show) {
        this.window.show();
      }
      
      this.title = options.title;
      this.logger.debug(`Progress window created: ${options.title}`);
    } catch (error) {
      this.logger.error('Failed to create progress window, using fallback:', error);
      // Use simple progress as fallback
      this.useFallback = true;
      this.title = options.title;
      this.window = this.createFallbackWindow();
    }
  }

  /**
   * Create a fallback window object for when ProgressWindow is not available
   */
  private createFallbackWindow(): any {
    this.logger.warn('Using fallback progress window (console logging only)');
    return {
      changeHeadline: (text: string) => this.logger.info(`Progress: ${text}`),
      addDescription: (text: string) => this.logger.info(`Progress: ${text}`),
      updateProgress: (percent: number) => this.logger.info(`Progress: ${percent}%`),
      addLines: (texts: string[], icons?: string[]) => texts.forEach(t => this.logger.info(`Progress: ${t}`)),
      startCloseTimer: (ms: number) => {},
      show: () => {},
      close: () => {},
    };
  }
  
  /**
   * Update progress
   * @param text - Progress text to display
   * @param percent - Progress percentage (0-100), or null for indeterminate
   * @param lines - Additional lines of text to display
   */
  updateProgress(text: string, percent?: number | null, lines?: string[]): void {
    if (this.cancelled) return;
    
    // Use simple progress if in fallback mode
    if (this.useFallback) {
      const message = lines && lines.length > 0 ? `${text} - ${lines.join(', ')}` : text;
      simpleProgress.show(this.title || 'Progress', message, percent ?? undefined);
      return;
    }
    
    try {
      if (!this.window) {
        this.logger.warn('No progress window available');
        return;
      }
      
      // Update main text
      if (this.window.addDescription) {
        this.window.addDescription(text);
      }
      
      // Update percentage if provided
      if (percent !== null && percent !== undefined && this.window.updateProgress) {
        this.window.updateProgress(percent);
      }
      
      // Add additional lines if provided
      if (lines && lines.length > 0 && this.window.addDescription) {
        lines.forEach(line => {
          this.window.addDescription(line);
        });
      }
    } catch (error) {
      this.logger.error('Failed to update progress:', error);
      // Switch to fallback mode
      this.useFallback = true;
      this.updateProgress(text, percent, lines);
    }
  }

  /**
   * Set progress headline
   */
  setHeadline(text: string): void {
    if (this.cancelled || !this.window) return;
    
    try {
      if (this.window.changeHeadline) {
        this.window.changeHeadline(text);
      }
    } catch (error) {
      this.logger.error('Failed to set headline:', error);
    }
  }
  
  /**
   * Add a description line
   */
  addLine(text: string, icon?: 'chrome://zotero/skin/tick.png' | 'chrome://zotero/skin/cross.png'): void {
    if (this.cancelled || !this.window) return;
    
    try {
      if (icon && this.window.addLines) {
        this.window.addLines([text], [icon]);
      } else if (this.window.addDescription) {
        this.window.addDescription(text);
      }
    } catch (error) {
      this.logger.error('Failed to add line:', error);
    }
  }

  /**
   * Start progress (shows indeterminate progress)
   */
  startProgress(text?: string): void {
    if (this.cancelled || !this.window) return;
    
    try {
      if (this.window.startCloseTimer) {
        this.window.startCloseTimer(8000); // Auto-close after 8 seconds of inactivity
      }
      if (text && this.window.addDescription) {
        this.window.addDescription(text);
      }
    } catch (error) {
      this.logger.error('Failed to start progress:', error);
    }
  }
  
  /**
   * Close the progress window
   */
  close(): void {
    try {
      if (this.window && this.window.close) {
        this.window.close();
        this.logger.debug('Progress window closed');
      }
    } catch (error) {
      this.logger.error('Failed to close progress window:', error);
    }
  }
  
  /**
   * Mark as complete with optional message
   */
  complete(message?: string, autoClose = true): void {
    if (this.cancelled) return;
    
    // Use simple progress if in fallback mode
    if (this.useFallback) {
      simpleProgress.complete(this.title || 'Complete', message || 'Operation completed successfully');
      return;
    }
    
    if (!this.window) return;
    
    try {
      if (message) {
        this.addLine(message, 'chrome://zotero/skin/tick.png');
      }
      
      if (this.window.updateProgress) {
        this.window.updateProgress(100);
      }
      
      if (autoClose && this.window.startCloseTimer) {
        this.window.startCloseTimer(15000); // Close after 15 seconds to allow reading stats
      }
    } catch (error) {
      this.logger.error('Failed to complete progress:', error);
      // Switch to fallback
      this.useFallback = true;
      this.complete(message, autoClose);
    }
  }
  
  /**
   * Show error and optionally close
   */
  error(message: string, autoClose = false): void {
    // Use simple progress if in fallback mode
    if (this.useFallback) {
      simpleProgress.error(this.title || 'Error', message);
      return;
    }
    
    try {
      this.addLine(message, 'chrome://zotero/skin/cross.png');
      
      if (autoClose && this.window && this.window.startCloseTimer) {
        this.window.startCloseTimer(5000);
      }
    } catch (error) {
      this.logger.error('Failed to show error:', error);
      // Switch to fallback
      this.useFallback = true;
      this.error(message, autoClose);
    }
  }

  /**
   * Check if cancelled
   */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Handle cancellation
   */
  cancel(): void {
    this.cancelled = true;
    this.logger.info('Progress cancelled by user');

    if (this.cancelCallback) {
      this.cancelCallback();
    }

    this.close();
  }

  /**
   * Get Zotero object
   */
  private getZotero(): any {
    if (typeof Zotero !== 'undefined') {
      return Zotero;
    }
    return null;
  }
}

/**
 * Create a simple progress dialog for quick operations
 */
export function showSimpleProgress(
  title: string,
  text: string,
  callback: (progress: ProgressWindow) => Promise<void>
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const progress = new ProgressWindow({ title });
    progress.startProgress(text);

    try {
      await callback(progress);
      progress.complete('Complete!');
      resolve();
    } catch (error) {
      progress.error(`Error: ${error}`);
      reject(error);
    }
  });
}
