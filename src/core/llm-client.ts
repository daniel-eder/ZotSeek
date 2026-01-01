/**
 * LLM Client
 * Handles communication with different LLM providers
 */

import { Logger } from '../utils/logger';

export interface LLMMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}

export interface LLMConfig {
    id: string;
    provider: string;
    label: string;
    endpoint: string;
    apiKey: string;
    model: string;
}

export interface LLMResponse {
    content: string;
    tool_calls?: any[];
}

import { ToolDefinition } from './llm-tools';

export class LLMClient {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('LLMClient');
    }

    /**
     * Send a chat request to the configured LLM
     */
    public async chat(config: LLMConfig, messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
        this.logger.info(`Sending chat request to ${config.provider} (${config.model})`);

        try {
            switch (config.provider) {
                case 'openai':
                case 'google':
                case 'generic':
                    return await this.chatOpenAICompatible(config, messages, tools);
                case 'anthropic':
                    return await this.chatAnthropic(config, messages, tools);
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
    private async chatOpenAICompatible(config: LLMConfig, messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
        const url = config.endpoint.endsWith('/') ? `${config.endpoint}chat/completions` : `${config.endpoint}/chat/completions`;

        const body: any = {
            model: config.model,
            messages: messages
        };

        if (tools && tools.length > 0) {
            body.tools = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            }));
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const msg = data.choices?.[0]?.message;

        return {
            content: msg?.content || '',
            tool_calls: msg?.tool_calls
        };
    }

    /**
     * Chat with Anthropic API
     */
    private async chatAnthropic(config: LLMConfig, messages: LLMMessage[], tools?: ToolDefinition[]): Promise<LLMResponse> {
        const url = config.endpoint.endsWith('/') ? `${config.endpoint}messages` : `${config.endpoint}/messages`;

        // Anthropic separates system message
        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages.filter(m => m.role !== 'system').map(m => {
            // Anthropic expects tool results in a specific block format
            if (m.role === 'tool') {
                return {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: m.tool_call_id,
                            content: m.content
                        }
                    ]
                };
            }
            if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
                const content: any[] = [];
                if (m.content) {
                    content.push({ type: 'text', text: m.content });
                }
                for (const tc of m.tool_calls) {
                    content.push({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.function.name,
                        input: JSON.parse(tc.function.arguments)
                    });
                }
                return { role: 'assistant', content };
            }
            return m;
        });

        const body: any = {
            model: config.model,
            messages: chatMessages,
            system: systemMessage,
            max_tokens: 4096
        };

        if (tools && tools.length > 0) {
            body.tools = tools.map(t => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters
            }));
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        let content = '';
        const toolCalls: any[] = [];

        if (Array.isArray(data.content)) {
            for (const item of data.content) {
                if (item.type === 'text') {
                    content += item.text;
                } else if (item.type === 'tool_use') {
                    toolCalls.push({
                        id: item.id,
                        type: 'function',
                        function: {
                            name: item.name,
                            arguments: JSON.stringify(item.input)
                        }
                    });
                }
            }
        }

        return {
            content,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        };
    }
}

export const llmClient = new LLMClient();
