/**
 * ZotSeek Chat Dialog
 * Logic for the chat interface
 */

import { Logger } from '../utils/logger';
import { LLMConfig, LLMMessage, llmClient } from '../core/llm-client';
import { getZotero } from '../utils/zotero-helper';
import { zoteroTools } from '../core/llm-tools';

declare const Zotero: any;
declare const Services: any;

export class ChatDialog {
    private logger: Logger;
    private window: Window;
    private currentMessages: LLMMessage[] = [];
    private llmModels: LLMConfig[] = [];
    private selectedModelId: string = '';

    constructor(window: Window) {
        this.logger = new Logger('ChatDialog');
        this.window = window;
        this.init();
    }

    private init(): void {
        this.logger.info('Initializing chat dialog');

        // Load models from preferences
        this.loadModels();

        // Set up event listeners
        const sendBtn = this.window.document.getElementById('zotseek-chat-send');
        const input = this.window.document.getElementById('zotseek-chat-input') as HTMLTextAreaElement;
        const clearBtn = this.window.document.getElementById('zotseek-chat-clear');
        const modelSelector = this.window.document.getElementById('zotseek-chat-model-selector') as any;

        if (sendBtn) sendBtn.addEventListener('command', () => this.handleSendMessage());
        if (clearBtn) clearBtn.addEventListener('command', () => this.clearChat());
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleSendMessage();
                }
            });
        }

        if (modelSelector) {
            modelSelector.addEventListener('command', () => {
                this.selectedModelId = modelSelector.selectedItem?.value;
                this.logger.info(`Model selected: ${this.selectedModelId}`);
            });
        }

        // Populate model selector
        this.updateModelSelector();

        // Auto-focus input
        if (input) input.focus();
    }

    private loadModels(): void {
        try {
            const Z = getZotero();
            const modelsStr = Z.Prefs.get('zotseek.llmModels', true) || '[]';
            this.llmModels = JSON.parse(modelsStr);
            this.selectedModelId = Z.Prefs.get('zotseek.defaultLLM', true) || (this.llmModels[0]?.id || '');
        } catch (e) {
            this.logger.error(`Failed to load models: ${e}`);
        }
    }

    private updateModelSelector(): void {
        const popup = this.window.document.getElementById('zotseek-chat-model-popup');
        const selector = this.window.document.getElementById('zotseek-chat-model-selector') as any;
        if (!popup || !selector) return;

        while (popup.firstChild) popup.removeChild(popup.firstChild);

        if (this.llmModels.length === 0) {
            const item = this.createMenuItem('No models configured', '');
            item.setAttribute('disabled', 'true');
            popup.appendChild(item);
            return;
        }

        this.llmModels.forEach(model => {
            const item = this.createMenuItem(model.label, model.id);
            popup.appendChild(item);
        });

        // Set selected index
        const index = this.llmModels.findIndex(m => m.id === this.selectedModelId);
        if (index !== -1) {
            selector.selectedIndex = index;
        } else if (this.llmModels.length > 0) {
            selector.selectedIndex = 0;
            this.selectedModelId = this.llmModels[0].id;
        }
    }

    private createMenuItem(label: string, value: string): Element {
        const item = this.window.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem');
        item.setAttribute('label', label);
        item.setAttribute('value', value);
        return item;
    }

    private async handleSendMessage(): Promise<void> {
        const input = this.window.document.getElementById('zotseek-chat-input') as HTMLTextAreaElement;
        if (!input) return;

        const content = input.value.trim();
        if (!content) return;

        if (!this.selectedModelId) {
            this.addMessage('error', 'Please select a model first.');
            return;
        }

        const config = this.llmModels.find(m => m.id === this.selectedModelId);
        if (!config) {
            this.addMessage('error', 'Selected model configuration not found.');
            return;
        }

        // Add user message
        this.addMessage('user', content);
        input.value = '';

        // Prepare messages for LLM
        const Z = getZotero();
        const systemPrompt = Z.Prefs.get('zotseek.llmSystemPrompt', true) || '';

        const messagesToSend: LLMMessage[] = [];
        if (systemPrompt) {
            messagesToSend.push({ role: 'system', content: systemPrompt });
        }
        messagesToSend.push(...this.currentMessages);

        try {
            let turns = 0;
            const maxTurns = 5;

            while (turns < maxTurns) {
                turns++;

                this.addMessage('system', 'Thinking...');
                const response = await llmClient.chat(config, messagesToSend, zoteroTools.getToolDefinitions());
                this.removeLastMessage(); // Remove "Thinking..."

                const assistantMsg: LLMMessage = {
                    role: 'assistant',
                    content: response.content || '',
                    tool_calls: response.tool_calls
                };

                // Add to history and UI
                if (assistantMsg.content) {
                    this.addMessage('assistant', assistantMsg.content, assistantMsg);
                } else if (assistantMsg.tool_calls) {
                    // Even if no content, we need to push it to history for context
                    this.currentMessages.push(assistantMsg);
                }
                messagesToSend.push(assistantMsg);

                // If there are tool calls, handle them
                if (response.tool_calls && response.tool_calls.length > 0) {
                    for (const toolCall of response.tool_calls) {
                        const toolName = toolCall.function.name;
                        const toolArgs = JSON.parse(toolCall.function.arguments);

                        this.addMessage('system', `Calling tool: ${toolName}...`);

                        const toolDef = zoteroTools.getToolDefinitions().find(t => t.name === toolName);
                        let result = '';
                        if (toolDef) {
                            try {
                                result = await toolDef.execute(toolArgs);
                            } catch (err) {
                                result = `Error executing tool ${toolName}: ${err}`;
                            }
                        } else {
                            result = `Error: Tool ${toolName} not found.`;
                        }

                        this.removeLastMessage(); // Remove "Calling tool..."

                        const toolMsg: LLMMessage = {
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: result
                        };

                        this.currentMessages.push(toolMsg);
                        messagesToSend.push(toolMsg);
                    }

                    // Continue the loop to get the next response from LLM
                    continue;
                }

                // No more tool calls, finish
                break;
            }

            if (turns >= maxTurns) {
                this.addMessage('error', 'Reached maximum number of tool execution turns.');
            }
        } catch (e) {
            this.removeLastMessage();
            this.addMessage('error', `Error: ${e}`);
        }
    }

    private addMessage(role: 'user' | 'assistant' | 'system' | 'error', content: string, fullMsg?: LLMMessage): void {
        const history = this.window.document.getElementById('zotseek-chat-history');
        if (!history) return;

        if (role === 'user' || role === 'assistant') {
            if (fullMsg) {
                this.currentMessages.push(fullMsg);
            } else {
                this.currentMessages.push({ role: role as any, content });
            }
        }

        const msgDiv = this.window.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        msgDiv.setAttribute('class', `message-${role}`);
        msgDiv.textContent = content;

        // Simple line break handling
        msgDiv.style.whiteSpace = 'pre-wrap';

        history.appendChild(msgDiv);
        history.scrollTop = history.scrollHeight;
    }

    private removeLastMessage(): void {
        const history = this.window.document.getElementById('zotseek-chat-history');
        if (history && history.lastChild) {
            history.removeChild(history.lastChild);
        }
    }

    private clearChat(): void {
        this.currentMessages = [];
        const history = this.window.document.getElementById('zotseek-chat-history');
        if (history) {
            while (history.firstChild) history.removeChild(history.firstChild);
            this.addMessage('system', 'Conversation cleared.');
        }
    }
}

// Initialization
window.addEventListener('load', () => {
    (window as any).chatDialog = new ChatDialog(window);
});
