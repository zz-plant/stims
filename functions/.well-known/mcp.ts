// GET /.well-known/mcp
// Well-known MCP endpoint discovery for toil.fyi

export async function onRequest(context: {
  request: Request;
}): Promise<Response> {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const url = new URL(request.url);
  const mcpUrl = `${url.origin}/mcp`;

  return new Response(
    JSON.stringify({
      schema_version: '1.0',
      name: 'Stims (toil.fyi) MCP Server',
      description:
        'Model Context Protocol server for MilkDrop preset discovery, catalog metadata, and visualization.',
      mcp_url: mcpUrl,
      transports: ['http-sse', 'websocket'],
      endpoints: {
        sse: mcpUrl,
        websocket: mcpUrl.replace(/^http/i, 'ws'),
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
