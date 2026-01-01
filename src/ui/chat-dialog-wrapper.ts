/**
 * ZotSeek Chat Dialog Wrapper
 * Manages the lifecycle of the chat dialog window
 */

import { Logger } from '../utils/logger';

declare const Zotero: any;
declare const Components: any;

export class ChatDialogWrapper {
    private logger: Logger;
    private window: any = null;

    constructor() {
        this.logger = new Logger('ChatDialogWrapper');
    }

    /**
     * Open the chat dialog
     */
    public open(): void {
        try {
            if (this.isWindowOpen()) {
                this.window.focus();
                return;
            }

            this.logger.info('Opening chat dialog');

            this.window = Zotero.getMainWindow().openDialog(
                'chrome://zotseek/content/chatDialog.xhtml',
                'zotseek-chat-dialog',
                'chrome,centerscreen,resizable,dialog=no',
                {}
            );
        } catch (error) {
            this.logger.error('Failed to open chat dialog:', error);
        }
    }

    /**
     * Check if the window is open
     */
    private isWindowOpen(): boolean {
        return this.window && !this.window.closed && !Components.utils.isDeadWrapper(this.window);
    }
}

export const chatDialogWrapper = new ChatDialogWrapper();
