/**
 * Simple progress indicator using Zotero's notification system
 * Fallback for when ProgressWindow is not available
 */

declare const Zotero: any;

import { Logger } from './logger';

export class SimpleProgress {
  private logger: Logger;
  private lastUpdate = 0;
  private updateInterval = 1000; // Update at most once per second
  
  constructor() {
    this.logger = new Logger('SimpleProgress');
  }
  
  /**
   * Show a simple progress notification
   */
  show(title: string, message: string, percent?: number): void {
    const now = Date.now();
    
    // Throttle updates to avoid flooding
    if (now - this.lastUpdate < this.updateInterval) {
      return;
    }
    
    this.lastUpdate = now;
    
    try {
      const Z = this.getZotero();
      if (!Z) return;
      
      // Build the message
      let fullMessage = message;
      if (percent !== undefined && percent !== null) {
        fullMessage += ` (${Math.round(percent)}%)`;
      }
      
      // Try to use Zotero's progress notification if available
      if (Z.ProgressWindowSet) {
        // This is available in some Zotero versions
        const progressWin = new Z.ProgressWindowSet();
        progressWin.show();
        progressWin.setText(title, fullMessage);
        
        // Auto-close after a moment
        setTimeout(() => {
          try {
            progressWin.close();
          } catch (e) {
            // Window might already be closed
          }
        }, 2000);
      } else {
        // Fallback to console logging
        this.logger.info(`${title}: ${fullMessage}`);
      }
    } catch (error) {
      this.logger.error('Failed to show progress:', error);
    }
  }
  
  /**
   * Show completion message
   */
  complete(title: string, message: string): void {
    try {
      const Z = this.getZotero();
      if (Z && Z.alert) {
        Z.alert(null, title, message);
      } else {
        this.logger.info(`✓ ${title}: ${message}`);
      }
    } catch (error) {
      this.logger.error('Failed to show completion:', error);
    }
  }
  
  /**
   * Show error message
   */
  error(title: string, message: string): void {
    try {
      const Z = this.getZotero();
      if (Z && Z.alert) {
        Z.alert(null, title, `Error: ${message}`);
      } else {
        this.logger.error(`✗ ${title}: ${message}`);
      }
    } catch (error) {
      this.logger.error('Failed to show error:', error);
    }
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

// Export singleton instance
export const simpleProgress = new SimpleProgress();
