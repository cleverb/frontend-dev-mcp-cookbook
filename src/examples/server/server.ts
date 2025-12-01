import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '../../server/mcp.js';
import { StreamableHTTPServerTransport } from '../../server/streamableHttp.js';
import * as z from 'zod/v4';
import { CallToolResult, isInitializeRequest } from '../../types.js';
import cors from 'cors';

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { pipeline, SummarizationOutput } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';

// 1. Setup paths
const dbPath = path.join(process.cwd(), 'src/examples/sqlite/my_docs.db');
const dataDir = path.join(process.cwd(), 'src/data/source');

// 2. Connect to database and load extension
const db = new Database(dbPath);
sqliteVec.load(db);
console.log('Connected to database and loaded sqlite-vec extension.');

const embeddingPipelinePromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const summarizerPipelinePromise = pipeline('summarization', 'Xenova/distilbart-cnn-12-6');
// const summarizerPipelinePromise = pipeline('summarization', 'Xenova/t5-base');
// const summarizerPipelinePromise = pipeline('summarization', 'Xenova/t5-small');


// Create an MCP server with implementation details
const getServer = () => {
    const server = new McpServer(
        {
            name: 'json-response-streamable-http-server',
            version: '1.0.0'
        },
        {
            capabilities: {
                logging: {}
            }
        }
    );

    // Tool that uses LLM sampling to summarize any text
    server.registerTool(
        'summarize',
        {
            description: 'Summarize any text using an LLM',
            inputSchema: {
                text: z.string().describe('Text to summarize')
            }
        },
        async ({ text }) => {
            // Call the LLM through MCP sampling
            const response = await server.server.createMessage({
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Please summarize the following text concisely:\n\n${text}`
                        }
                    }
                ],
                maxTokens: 500
            });

            const contents = Array.isArray(response.content) ? response.content : [response.content];
            return {
                content: contents.map(content => ({
                    type: 'text',
                    text: content.type === 'text' ? content.text : 'Unable to generate summary'
                }))
            };
        }
    );

    // Register a simple tool that returns a greeting
    server.tool(
        'greet',
        'A simple greeting tool',
        {
            name: z.string().describe('Name to greet')
        },
        async ({ name }): Promise<CallToolResult> => {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Hello, ${name}!`
                    }
                ]
            };
        }
    );

    // Register a simple tool that returns a greeting
    server.tool(
        'search',
        'A simple search tool',
        {
            query: z.string().describe('Search query')
        },
        async ({ query }): Promise<CallToolResult> => {

            const extractor = await embeddingPipelinePromise;
            const summarizer = await summarizerPipelinePromise;


            // 6. Query
            console.log(`\nQuerying: "${query}"`);

            const queryOutput = await extractor(query, { pooling: 'mean', normalize: true });
            const queryEmbedding = queryOutput.data;

            const queryResults = db.prepare(`
                SELECT
                file_name,
                content,
                distance
                FROM documents
                WHERE embedding MATCH ?
                ORDER BY distance
                LIMIT 3
            `).all(queryEmbedding) as { file_name: string; content: string; distance: number }[];

            const _content = [];
            console.log('\nTop 3 most similar documents:');
            for (const row of queryResults) {

                const summaryOutput = await summarizer(row.content);
                const summaryText = (summaryOutput[0] as any)?.summary_text || '';

                let textContent = '';
                textContent += `\nFile: ${row.file_name} (Distance: ${row.distance})`;
                textContent += `\nQuestion: ${query}`;
                textContent += `\nSummary: ${JSON.stringify(summaryText)}`;
                textContent += `Content: ${row.content}...`;

                // _content.push(textContent);
                console.log(`\nFile: ${row.file_name} (Distance: ${row.distance})`);
                console.log(`Summary: ${JSON.stringify(summaryText)}`);
                console.log(`Content: ${row.content.substring(0, 150)}...`);
                _content.push({
                    type: 'text',
                    text: textContent
                });
            }

            // const results = await search(query);
            return {
                content:
                    _content as unknown as CallToolResult['content']
            };
        }
    );

    // Register a tool that sends multiple greetings with notifications
    server.tool(
        'multi-greet',
        'A tool that sends different greetings with delays between them',
        {
            name: z.string().describe('Name to greet')
        },
        async ({ name }, extra): Promise<CallToolResult> => {
            const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

            await server.sendLoggingMessage(
                {
                    level: 'debug',
                    data: `Starting multi-greet for ${name}`
                },
                extra.sessionId
            );

            await sleep(1000); // Wait 1 second before first greeting

            await server.sendLoggingMessage(
                {
                    level: 'info',
                    data: `Sending first greeting to ${name}`
                },
                extra.sessionId
            );

            await sleep(1000); // Wait another second before second greeting

            await server.sendLoggingMessage(
                {
                    level: 'info',
                    data: `Sending second greeting to ${name}`
                },
                extra.sessionId
            );

            return {
                content: [
                    {
                        type: 'text',
                        text: `Good morning, ${name}!`
                    }
                ]
            };
        }
    );
    return server;
};

const app = express();
app.use(express.json());

// Configure CORS to expose Mcp-Session-Id header for browser-based clients
app.use(
    cors({
        origin: '*', // Allow all origins - adjust as needed for production
        exposedHeaders: ['Mcp-Session-Id']
    })
);

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

app.post('/mcp', async (req: Request, res: Response) => {
    console.log('Received MCP request:', req.body);
    try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && transports[sessionId]) {
            // Reuse existing transport
            transport = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(req.body)) {
            // New initialization request - use JSON response mode
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true, // Enable JSON response mode
                onsessioninitialized: sessionId => {
                    // Store the transport by session ID when session is initialized
                    // This avoids race conditions where requests might come in before the session is stored
                    console.log(`Session initialized with ID: ${sessionId}`);
                    transports[sessionId] = transport;
                }
            });

            // Connect the transport to the MCP server BEFORE handling the request
            const server = getServer();
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
            return; // Already handled
        } else {
            // Invalid request - no session ID or not initialization request
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided'
                },
                id: null
            });
            return;
        }

        // Handle the request with existing transport - no need to reconnect
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error'
                },
                id: null
            });
        }
    }
});

// Handle GET requests for SSE streams according to spec
app.get('/mcp', async (req: Request, res: Response) => {
    // Since this is a very simple example, we don't support GET requests for this server
    // The spec requires returning 405 Method Not Allowed in this case
    res.status(405).set('Allow', 'POST').send('Method Not Allowed');
});

// Start the server
const PORT = 3000;
app.listen(PORT, error => {
    if (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
    console.log(`MCP Streamable HTTP Server listening on port ${PORT}`);
});

// Handle server shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    process.exit(0);
});
