// Cloudflare Pages Function: Ingests client performance & engine telemetry metrics
// POST /api/telemetry

interface AnalyticsEngineDataset {
  writeDataPoint(point: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface Env {
  STIMS_TELEMETRY?: AnalyticsEngineDataset;
}

interface TelemetryPayload {
  event: string;
  renderer?: 'webgpu' | 'webgl2' | 'webgl1' | 'canvas';
  fps?: number;
  audioLatencyMs?: number;
  presetId?: string;
  error?: string;
  userAgent?: string;
}

export async function onRequest(context: { request: Request; env: Env }) {
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
    const data = (await request.json()) as TelemetryPayload;

    if (!data.event) {
      return new Response(JSON.stringify({ error: 'event parameter required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Write to Cloudflare Workers Analytics Engine if configured
    if (env.STIMS_TELEMETRY) {
      env.STIMS_TELEMETRY.writeDataPoint({
        blobs: [
          data.event.slice(0, 64),
          (data.renderer || 'unknown').slice(0, 16),
          (data.presetId || '').slice(0, 64),
          (data.error || '').slice(0, 256),
          request.headers.get('cf-ipcountry') || 'XX',
        ],
        doubles: [
          data.fps || 0,
          data.audioLatencyMs || 0,
          Date.now(),
        ],
        indexes: [data.event.slice(0, 32)],
      });
    }

    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Telemetry logging failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
