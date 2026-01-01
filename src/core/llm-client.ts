/**
 * LLM Client
 * Handles communication with different LLM providers
 */

import { Logger } from '../utils/logger';

export interface LLMMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface LLMConfig {
    id: string;
    provider: string;
    label: string;
    endpoint: string;
    apiKey: string;
    model: string;
}

export class LLMClient {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('LLMClient');
    }

    /**
     * Send a chat request to the configured LLM
     */
    public async chat(config: LLMConfig, messages: LLMMessage[]): Promise<string> {
        this.logger.info(`Sending chat request to ${config.provider} (${config.model})`);

        try {
            switch (config.provider) {
                case 'openai':
                case 'google':
                case 'generic':
                    return await this.chatOpenAICompatible(config, messages);
                case 'anthropic':
                    return await this.chatAnthropic(config, messages);
                default:
                    throw new Error(`Unsupported provider: ${config.provider}`);
            }
        } catch (error) {
            this.logger.error(`Chat request failed: ${error}`);
            throw error;
        }
    }

    /**
     * Chat with OpenAI-compatible endpoints (including Google Gemini OpenAI adapter)
     */
    private async chatOpenAICompatible(config: LLMConfig, messages: LLMMessage[]): Promise<string> {
        const url = config.endpoint.endsWith('/') ? `${config.endpoint}chat/completions` : `${config.endpoint}/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify({
                model: config.model,
                messages: messages
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    /**
     * Chat with Anthropic API
     */
    private async chatAnthropic(config: LLMConfig, messages: LLMMessage[]): Promise<string> {
        const url = config.endpoint.endsWith('/') ? `${config.endpoint}messages` : `${config.endpoint}/messages`;

        // Anthropic separates system message
        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages.filter(m => m.role !== 'system');

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: config.model,
                messages: chatMessages,
                system: systemMessage,
                max_tokens: 4096
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.content?.[0]?.text || '';
    }
}

export const llmClient = new LLMClient();
