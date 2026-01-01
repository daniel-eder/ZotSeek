/**
 * LLM Tools for Zotero
 * Provides functions that the LLM can call to interact with the Zotero library
 */

import { Logger } from '../utils/logger';
import { hybridSearchEngine } from './hybrid-search'; // Assuming a singleton will be added or I use searchEngine
import { searchEngine } from './search-engine';
import { HybridSearchEngine } from './hybrid-search';
import { getZotero } from '../utils/zotero-helper';

declare const Zotero: any;

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: any; // JSON Schema
    execute: (args: any) => Promise<string>;
}

export class ZoteroTools {
    private logger: Logger;
    private hybridSearch: HybridSearchEngine;

    constructor() {
        this.logger = new Logger('ZoteroTools');
        this.hybridSearch = new HybridSearchEngine(searchEngine);
    }

    /**
     * Get the tool definitions for the LLM
     */
    public getToolDefinitions(): ToolDefinition[] {
        return [
            {
                name: 'semanticSearch',
                description: 'Search the Zotero library for research papers using semantic similarity and keywords. Returns a list of relevant papers with their titles, keys, and relevance scores.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query or research question'
                        },
                        topK: {
                            type: 'number',
                            description: 'Number of results to return (default 10)',
                            default: 10
                        }
                    },
                    required: ['query']
                },
                execute: async (args) => this.semanticSearch(args.query, args.topK || 10)
            },
            {
                name: 'getMetadata',
                description: 'Get detailed metadata for one or more Zotero items including title, authors, date, abstract, and URL.',
                parameters: {
                    type: 'object',
                    properties: {
                        itemKeys: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'List of Zotero item keys (e.g. ["ABCD1234", "EFGH5678"])'
                        }
                    },
                    required: ['itemKeys']
                },
                execute: async (args) => this.getMetadata(args.itemKeys)
            },
            {
                name: 'getAnnotations',
                description: 'Retrieve PDF annotations, highlights, and notes for specified Zotero items. Use this to see what you or the user found important in a paper.',
                parameters: {
                    type: 'object',
                    properties: {
                        itemKeys: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'List of Zotero item keys'
                        }
                    },
                    required: ['itemKeys']
                },
                execute: async (args) => this.getAnnotations(args.itemKeys)
            }
        ];
    }

    /**
     * Perform semantic search
     */
    private async semanticSearch(query: string, topK: number): Promise<string> {
        this.logger.info(`Tool: semanticSearch for "${query}"`);
        try {
            if (!searchEngine.isReady()) {
                await searchEngine.init();
            }

            const results = await this.hybridSearch.smartSearch(query, {
                finalTopK: topK,
                minSimilarity: 0.2
            });

            if (results.length === 0) {
                return "No relevant items found for this query.";
            }

            return JSON.stringify(results.map(r => ({
                key: r.itemKey,
                title: r.title,
                authors: r.creators,
                year: r.year,
                relevance: r.rrfScore.toFixed(3)
            })), null, 2);
        } catch (error) {
            this.logger.error(`semanticSearch failed: ${error}`);
            return `Error performing search: ${error}`;
        }
    }

    /**
     * Get metadata for items
     */
    private async getMetadata(itemKeys: string[]): Promise<string> {
        this.logger.info(`Tool: getMetadata for ${itemKeys.join(', ')}`);
        try {
            const Z = getZotero();
            const items = itemKeys.map(key => Z.Items.getByLibraryAndKey(Z.Libraries.userLibraryID, key)).filter(i => !!i);

            if (items.length === 0) {
                return "Could not find any of the requested items.";
            }

            const metadata = items.map(item => ({
                key: item.key,
                title: item.getField('title'),
                authors: item.getCreators().map((c: any) => `${c.firstName} ${c.lastName}`).join(', '),
                date: item.getField('date'),
                abstract: item.getField('abstractNote'),
                url: item.getField('url'),
                tags: item.getTags().map((t: any) => t.tag)
            }));

            return JSON.stringify(metadata, null, 2);
        } catch (error) {
            this.logger.error(`getMetadata failed: ${error}`);
            return `Error retrieving metadata: ${error}`;
        }
    }

    /**
     * Get annotations for items
     */
    private async getAnnotations(itemKeys: string[]): Promise<string> {
        this.logger.info(`Tool: getAnnotations for ${itemKeys.join(', ')}`);
        try {
            const Z = getZotero();
            const results: any[] = [];

            for (const key of itemKeys) {
                const item = Z.Items.getByLibraryAndKey(Z.Libraries.userLibraryID, key);
                if (!item) continue;

                const attachmentIDs = item.getAttachments();
                if (attachmentIDs.length === 0) continue;

                // Only PDF attachments usually have annotations we can extract easily this way
                const annotations = await Z.Annotations.getAnnotationsForAttachments(attachmentIDs);

                if (annotations.length > 0) {
                    results.push({
                        itemKey: key,
                        title: item.getField('title'),
                        annotations: annotations.map((a: any) => ({
                            type: a.annotationType,
                            text: a.annotationText,
                            comment: a.annotationComment,
                            page: a.annotationPageLabel
                        }))
                    });
                }
            }

            if (results.length === 0) {
                return "No annotations found for these items.";
            }

            return JSON.stringify(results, null, 2);
        } catch (error) {
            this.logger.error(`getAnnotations failed: ${error}`);
            return `Error retrieving annotations: ${error}`;
        }
    }
}

export const zoteroTools = new ZoteroTools();
