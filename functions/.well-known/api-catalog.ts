// GET /.well-known/api-catalog — RFC 9727 organisation API information.
//
// A Linkset (RFC 9264) naming every machine-readable resource this origin
// publishes, so an agent can find them in one fetch instead of guessing
// paths. Advertised in the worker's Link header as rel="api-catalog". Only
// IANA-registered relations go in the body; relations defined by the MCP and
// Agent Skills drafts stay in the Link header, which is where those specs
// instruct publishers to advertise them.
//
// Every href must resolve; check-seo fails when one of these files goes away.

interface EventContext {
  request: Request;
}

const href = (path: string, origin: string) => new URL(path, origin).toString();

export async function onRequest(context: EventContext): Promise<Response> {
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

  const origin = new URL(request.url).origin;
  const catalog = {
    linkset: [
      {
        anchor: `${origin}/`,
        describedby: [
          { href: href('/llms.txt', origin), type: 'text/plain' },
          { href: href('/llms-full.txt', origin), type: 'text/plain' },
        ],
        'service-desc': [
          { href: href('/openapi.json', origin), type: 'application/json' },
        ],
        'service-doc': [
          {
            href: 'https://github.com/zz-plant/stims/blob/main/docs/api.md',
            type: 'text/markdown',
          },
        ],
        sitemap: [
          { href: href('/sitemap.xml', origin), type: 'application/xml' },
        ],
        license: [
          {
            href: 'https://github.com/zz-plant/stims/blob/main/LICENSE',
            type: 'text/markdown',
          },
        ],
      },
    ],
  };

  return new Response(JSON.stringify(catalog, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/linkset+json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
