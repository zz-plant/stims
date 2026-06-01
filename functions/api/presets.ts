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

      let query =
        'SELECT id, title, author, tags, rating, downloads, created_at FROM presets WHERE 1=1';
      const params: unknown[] = [];

      if (search) {
        query += ' AND (title LIKE ?1 OR author LIKE ?1)';
        params.push(`%${search}%`);
      }
      if (tag) {
        query += ' AND tags LIKE ?';
        params.push(`%${tag}%`);
      }

      switch (sort) {
        case 'oldest':
          query += ' ORDER BY created_at ASC';
          break;
        case 'top':
          query += ' ORDER BY rating DESC, downloads DESC';
          break;
        case 'downloads':
          query += ' ORDER BY downloads DESC';
          break;
        default:
          query += ' ORDER BY created_at DESC';
      }

      query += ` LIMIT ${limit} OFFSET ${offset}`;

      const { results } = await env.DB.prepare(query)
        .bind(...params)
        .all<{
          id: string;
          title: string;
          author: string;
          tags: string;
          rating: number;
          downloads: number;
          created_at: string;
        }>();

      const { results: countResult } = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM presets',
      ).all<{ count: number }>();

      return json({
        presets: results.map((r) => ({
          ...r,
          tags: r.tags ? r.tags.split(',') : [],
          id: `community:${r.id}`,
        })),
        total: countResult[0]?.count || 0,
        page,
        limit,
      });
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

      return json({
        ...preset,
        tags: preset.tags ? preset.tags.split(',') : [],
        milkSource,
        id: `community:${id}`,
      });
    }

    return json({ error: 'Not found' }, 404);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Server error' },
      500,
    );
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'preset'
  );
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
