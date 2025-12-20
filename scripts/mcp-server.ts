import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-shared.ts';

const server = createMcpServer();
const transport = new StdioServerTransport();

async function startServer() {
  await server.connect(transport);
  console.error('Stim Webtoys MCP server is running on stdio.');
}

if (import.meta.main) {
  await startServer();
}

export { startServer };
export * from './mcp-shared.ts';
