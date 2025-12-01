// Run with: npx tsx src/examples/server/toolWithSampleServer.ts

import { McpServer } from '../../server/mcp.js';
import { StdioServerTransport } from '../../server/stdio.js';
import * as z from 'zod/v4';

import { ErrorCode, McpError } from '../../types.js';

const mcpServer = new McpServer({
    name: 'tools-with-sample-server',
    version: '1.0.0'
});

// Tool that uses LLM sampling to summarize any text
mcpServer.registerTool(
    'summarize',
    {
        description: 'Summarize any text using an LLM',
        inputSchema: {
            text: z.string().describe('Text to summarize')
        }
    },
    async ({ text }) => {
        if (!mcpServer.server.getClientCapabilities()?.sampling) {
            throw new McpError(ErrorCode.InvalidParams, 'Client does not support sampling');
        }

        // Call the LLM through MCP sampling
        const response = await mcpServer.server.createMessage({
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

async function main() {
    const transport = new StdioServerTransport();
    const res = await mcpServer.connect(transport);
    console.log('MCP server is running...', JSON.stringify(res));
}

main().catch(error => {
    console.error('Server error:', error);
    process.exit(1);
});
