export async function onRequest(context) {
    const { request, env } = context;
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    try {
        const { presetId, embedding, description } = (await request.json());
        if (!presetId || !embedding?.length) {
            return new Response('Missing presetId or embedding', { status: 400 });
        }
        await env.DB.prepare(`INSERT OR REPLACE INTO preset_embeddings (preset_id, embedding, description)
       VALUES (?, ?, ?)`)
            .bind(presetId, JSON.stringify(embedding), description)
            .run();
        return new Response(JSON.stringify({ ok: true }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
    catch (error) {
        return new Response(JSON.stringify({
            error: error instanceof Error ? error.message : 'Store failed',
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
