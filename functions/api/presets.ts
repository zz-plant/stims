// Gallery: CRUD for community presets
// POST /api/presets       - Upload a preset
// GET  /api/presets       - List presets (with search, tags, sort)
// GET  /api/presets/:id   - Get single preset
// POST /api/presets/:id/favorite - Toggle favorite

// Cloudflare runtime types — provided by platform at deployment
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
}
interface R2Bucket {
  put(
    key: string,
    value: string | ReadableStream,
    options?: { customMetadata?: Record<string, string> },
  ): Promise<void>;
  get(key: string): Promise<R2Object | null>;
}
interface R2Object {
  text(): Promise<string>;
}

interface Env {
  DB: D1Database; // D1 binding
  GALLERY_R2: R2Bucket; // R2 binding for preset storage
}

export async function onRequest(context: {
  request: Request;
  env: Env;
  params?: { id?: string };
  waitUntil?: (promise: Promise<unknown>) => void;
}) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathParts = url.pathname
    .replace('/api/presets', '')
    .split('/')
    .filter(Boolean);
  const method = request.method;

  // CORS
  if (method === 'OPTIONS') {
    return cors();
  }

  // Cache-Control alone never populates Cloudflare's cache for
  // Worker-generated responses, so GETs go through the Cache API explicitly.
  const cache = edgeCache();
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (method === 'GET' && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const storeInCache = (response: Response): Response => {
    if (cache && response.status === 200) {
      const put = cache.put(cacheKey, response.clone());
      context.waitUntil?.(put);
    }
    return response;
  };

  try {
    // GET /api/presets — list
    if (method === 'GET' && pathParts.length === 0) {
      const search = url.searchParams.get('search') || '';
      const tag = url.searchParams.get('tag') || '';
      const sort = url.searchParams.get('sort') || 'newest';
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = Math.min(
        parseInt(url.searchParams.get('limit') || '20', 10),
        50,
      );
      const offset = (page - 1) * limit;

      let whereClause = ' WHERE 1=1';
      const params: unknown[] = [];

      if (search) {
        whereClause += ' AND (title LIKE ?1 OR author LIKE ?1)';
        params.push(`%${search}%`);
      }
      if (tag) {
        whereClause += ' AND tags LIKE ?';
        params.push(`%${tag}%`);
      }

      let orderBy = ' ORDER BY created_at DESC';
      switch (sort) {
        case 'oldest':
          orderBy = ' ORDER BY created_at ASC';
          break;
        case 'top':
          orderBy = ' ORDER BY rating DESC, downloads DESC';
          break;
        case 'downloads':
          orderBy = ' ORDER BY downloads DESC';
          break;
      }

      const listQuery = `SELECT id, title, author, tags, rating, downloads, created_at FROM presets${whereClause}${orderBy} LIMIT ? OFFSET ?`;
      const listParams = [...params, limit, offset];

      const countQuery = `SELECT COUNT(*) as count FROM presets${whereClause}`;

      const [{ results }, { results: countResult }] = await Promise.all([
        env.DB.prepare(listQuery)
          .bind(...listParams)
          .all<{
            id: string;
            title: string;
            author: string;
            tags: string;
            rating: number;
            downloads: number;
            created_at: string;
          }>(),
        env.DB.prepare(countQuery)
          .bind(...params)
          .all<{ count: number }>(),
      ]);

      return storeInCache(
        json(
          {
            presets: results.map((r) => ({
              ...r,
              tags: r.tags ? r.tags.split(',') : [],
              id: `community:${r.id}`,
            })),
            total: countResult[0]?.count || 0,
            page,
            limit,
          },
          200,
          60,
        ),
      );
    }

    // POST /api/presets — upload
    if (method === 'POST' && pathParts.length === 0) {
      const body = (await request.json()) as {
        title: string;
        author: string;
        milkSource: string;
        tags?: string[];
        email?: string;
      };

      if (!body.title || !body.milkSource) {
        return json({ error: 'title and milkSource are required' }, 400);
      }

      const id = `${slugify(body.title)}-${Date.now().toString(36)}`;

      // Store in R2
      await env.GALLERY_R2.put(`presets/${id}.milk`, body.milkSource, {
        customMetadata: {
          title: body.title,
          author: body.author || 'Anonymous',
          uploaded: new Date().toISOString(),
        },
      });

      // Store metadata in D1
      await env.DB.prepare(
        `INSERT INTO presets (id, title, author, tags, rating, downloads, created_at)
         VALUES (?, ?, ?, ?, 0, 0, datetime('now'))`,
      )
        .bind(
          id,
          body.title,
          body.author || 'Anonymous',
          (body.tags || []).join(','),
        )
        .run();

      return json({ id: `community:${id}`, title: body.title });
    }

    // POST /api/presets/:id/favorite — toggle favorite for this browser session
    if (
      method === 'POST' &&
      pathParts.length === 2 &&
      pathParts[1] === 'favorite'
    ) {
      const id = pathParts[0].replace('community:', '');
      const sessionId = getSessionId(request);

      // The rating is about to change; drop the cached detail response (the
      // favorite URL minus /favorite is exactly the client's detail URL).
      if (cache) {
        const detailUrl = new URL(url.toString());
        detailUrl.pathname = detailUrl.pathname.replace(/\/favorite$/, '');
        context.waitUntil?.(
          cache.delete(new Request(detailUrl.toString(), { method: 'GET' })),
        );
      }

      const existing = await env.DB.prepare(
        'SELECT id FROM favorites WHERE preset_id = ? AND session_id = ?',
      )
        .bind(id, sessionId)
        .first<{ id: number }>();

      if (existing) {
        await env.DB.prepare(
          'DELETE FROM favorites WHERE preset_id = ? AND session_id = ?',
        )
          .bind(id, sessionId)
          .run();
        await env.DB.prepare(
          "UPDATE presets SET rating = MAX(rating - 1, 0), updated_at = datetime('now') WHERE id = ?",
        )
          .bind(id)
          .run();
        return json({ favorited: false });
      }

      await env.DB.prepare(
        'INSERT INTO favorites (preset_id, session_id) VALUES (?, ?)',
      )
        .bind(id, sessionId)
        .run();
      await env.DB.prepare(
        "UPDATE presets SET rating = rating + 1, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(id)
        .run();
      return json({ favorited: true });
    }

    // GET /api/presets/:id — single
    if (method === 'GET' && pathParts.length === 1) {
      const id = pathParts[0].replace('community:', '');

      const preset = await env.DB.prepare(
        'SELECT id, title, author, tags, rating, downloads, created_at FROM presets WHERE id = ?',
      )
        .bind(id)
        .first<{
          id: string;
          title: string;
          author: string;
          tags: string;
          rating: number;
          downloads: number;
          created_at: string;
        }>();

      if (!preset) {
        return json({ error: 'Preset not found' }, 404);
      }

      // Get the .milk source from R2
      const obj = await env.GALLERY_R2.get(`presets/${id}.milk`);
      const milkSource = obj ? await obj.text() : '';

      return storeInCache(
        json(
          {
            ...preset,
            tags: preset.tags ? preset.tags.split(',') : [],
            milkSource,
            id: `community:${id}`,
          },
          200,
          300,
        ),
      );
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Server error' },
      500,
    );
  }
}

function edgeCache(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } & CacheStorage })
    .caches;
  return store?.default ?? null;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'preset'
  );
}

function getSessionId(request: Request): string {
  const raw =
    request.headers.get('x-stims-session-id') ||
    request.headers.get('cf-connecting-ip') ||
    'anonymous';
  return raw.trim().slice(0, 128) || 'anonymous';
}

function cors() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function json(data: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (cacheSeconds > 0) {
    headers['Cache-Control'] =
      `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds * 5}, stale-while-revalidate=86400`;
  } else {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  }

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}
