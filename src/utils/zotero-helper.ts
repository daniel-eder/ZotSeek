/**
 * Helper functions for accessing Zotero APIs
 */

// Access Zotero through various methods
declare const _globalThis: any;
declare const Zotero: any;
declare const ChromeUtils: any;

/**
 * Get the Zotero object from various possible sources
 */
export function getZotero(): any {
  // First try _globalThis (set by bootstrap context)
  if (typeof _globalThis !== 'undefined' && _globalThis.Zotero) {
    return _globalThis.Zotero;
  }
  // Fallback: try global Zotero
  if (typeof Zotero !== 'undefined') {
    return Zotero;
  }
  // Last resort: import via ChromeUtils (Zotero 8)
  try {
    const { Zotero: _Zotero } = (ChromeUtils as any).importESModule(
      'chrome://zotero/content/zotero.mjs'
    );
    return _Zotero;
  } catch (e) {
    return null;
  }
}
