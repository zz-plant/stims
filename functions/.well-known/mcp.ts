// GET /.well-known/mcp — MCP server card discovery for toil.fyi.
//
// The card itself lives at /.well-known/mcp/server-card.json (public/
// .well-known/mcp/server-card.json), because that is the path the discovery
// checkers read directly. This endpoint mirrors it so both spellings answer,
// from the same file — a card that said anything else would be a second,
// drifting copy. It states the truth about hosting: no MCP endpoint runs on
// this origin; the server is stdio from a repo clone, or a self-deployed
// Worker (wrangler.mcp.jsonc).

interface EventContext {
  request: Request;
  env?: {
    ASSETS?: { fetch: (request: Request) => Promise<Response> };
  };
}

export async function onRequest(context: EventContext): Promise<Response> {
  const { request } = context;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  } as const;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const card = await context.env?.ASSETS?.fetch(
    new Request(new URL('/.well-known/mcp/server-card.json', url.origin)),
  );
  if (!card || !card.ok) {
    return new Response(
      JSON.stringify({
        error: 'server card unavailable',
        see: 'https://github.com/zz-plant/stims/blob/main/docs/MCP_SERVER.md',
      }),
      { status: 503, headers: { ...cors, 'content-type': 'application/json' } },
    );
  }

  return new Response(card.body, {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
