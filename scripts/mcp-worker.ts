/* global WebSocketPair, crypto */

import {
  createMcpHandler,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { createMcpServer } from './mcp-shared.ts';

const MCP_PATH = '/mcp';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  // Mcp-Method / Mcp-Name are the 2026-07-28 routing headers; the session
  // headers stay for 2025-era clients served by the stateless legacy leg.
  'Access-Control-Allow-Headers':
    'Content-Type,mcp-session-id,Last-Event-ID,mcp-protocol-version,Mcp-Method,Mcp-Name',
  'Access-Control-Expose-Headers': 'mcp-session-id,mcp-protocol-version',
};

const validator = new CfWorkerJsonSchemaValidator();

// One fresh McpServer per HTTP request: the 2026-07-28 transport is
// stateless by design (no session affinity, so any isolate can answer), and
// 2025-era clients fall through to the SDK's stateless legacy leg with the
// same factory. Every tool here is a pure read over bundled docs/metadata,
// so nothing was ever stored on the old sessionful transport.
const httpHandler = createMcpHandler(() =>
  createMcpServer({
    jsonSchemaValidator: validator,
    instructions:
      'Use the HTTP or WebSocket endpoint to access documentation, toy metadata, loader behavior, and development commands for the Stim Webtoys library.',
  }),
);

class WorkerWebSocketTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;
  private socket: WebSocket;
  private started = false;

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  async start() {
    if (this.started) return;
    this.started = true;

    if (this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const handleOpen = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error('WebSocket connection failed'));
        };
        const cleanup = () => {
          this.socket.removeEventListener('open', handleOpen);
          this.socket.removeEventListener('error', handleError);
        };

        this.socket.addEventListener('open', handleOpen);
        this.socket.addEventListener('error', handleError);
      });
    }

    this.socket.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string' ? event.data : null;

      if (!payload) return;

      try {
        const parsed = JSON.parse(payload) as JSONRPCMessage;
        this.onmessage?.(parsed);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.onerror?.(new Error(`Invalid JSON message: ${message}`));
      }
    });

    this.socket.addEventListener('close', () => {
      this.onclose?.();
    });

    this.socket.addEventListener('error', () => {
      this.onerror?.(new Error('WebSocket reported an error.'));
    });
  }

  async send(message: JSONRPCMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }

    this.socket.send(JSON.stringify(message));
  }

  async close() {
    if (
      this.socket.readyState === WebSocket.CLOSED ||
      this.socket.readyState === WebSocket.CLOSING
    ) {
      return;
    }

    this.socket.close();
    this.onclose?.();
  }
}

async function handleHttp(request: Request) {
  const response = await httpHandler.fetch(request);

  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleWebSocket(request: Request) {
  const upgradeHeader = request.headers.get('upgrade');

  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade request.', {
      status: 400,
    });
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

  server.accept();

  createWebSocketSession(server).catch((error) => {
    server.close(
      1011,
      error instanceof Error ? error.message : 'Unexpected error',
    );
  });

  return new Response(null, { status: 101, webSocket: client });
}

async function createWebSocketSession(socket: WebSocket) {
  const transport = new WorkerWebSocketTransport(socket);
  const server = createMcpServer({
    jsonSchemaValidator: validator,
    instructions: defaultWebSocketInstructions(),
  });

  socket.addEventListener('close', () => {
    server.close();
  });

  socket.addEventListener('error', () => {
    server.close();
  });

  await server.connect(transport);
}

function defaultWebSocketInstructions() {
  return 'Connect over WebSocket to access documentation, toy metadata, loader behavior, and development commands for Stim Webtoys.';
}

export default {
  async fetch(request: Request) {
    const { pathname } = new URL(request.url);

    if (pathname !== MCP_PATH) {
      return new Response('Not Found', { status: 404 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.headers.get('upgrade')) {
      return handleWebSocket(request);
    }

    return handleHttp(request);
  },
};
