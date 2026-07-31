interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

interface VectorizeIndex {
  query(
    vector: number[],
    options?: { topK?: number; returnVectors?: boolean; returnMetadata?: boolean },
  ): Promise<{ matches: Array<{ id: string; score: number }> }>;
}

interface Env {
  AI: {
    run: (
      model: string,
      opts: {
        messages?: Array<{ role: string; content: string }>;
        text?: string[];
      },
    ) => Promise<{ response?: string; data?: number[][] }>;
  };
  DB: D1Database;
  VECTOR_INDEX?: VectorizeIndex;
}

interface AudioFeatures {
  bpm?: number;
  energy?: number;
  rms?: number;
  spectralCentroid?: number;
  spectralFlatness?: number;
  zcr?: number;
  bassEnergy?: number;
  midEnergy?: number;
  trebleEnergy?: number;
  genre?: string;
  mood?: string;
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
    const features = (await request.json()) as AudioFeatures;

    let searchPrompt = 'audio reactive visualizer preset';

    if (env.AI) {
      try {
        const featureSummary = [
          features.bpm ? `BPM: ${features.bpm}` : null,
          features.energy !== undefined ? `Energy: ${features.energy.toFixed(2)}` : null,
          features.bassEnergy !== undefined ? `Bass Level: ${features.bassEnergy.toFixed(2)}` : null,
          features.trebleEnergy !== undefined ? `Treble Level: ${features.trebleEnergy.toFixed(2)}` : null,
          features.genre ? `Genre: ${features.genre}` : null,
          features.mood ? `Mood: ${features.mood}` : null,
        ]
          .filter(Boolean)
          .join(', ');

        const aiResult = await env.AI.run('@cf/ibm-granite/granite-4.0-h-micro', {
          messages: [
            {
              role: 'system',
              content:
                'Convert these audio features into a 4-8 word visual style query for MilkDrop visualizers (e.g. "intense pounding bass neon warp", "ethereal slow ambient geometric bloom"). Output ONLY the query string.',
            },
            { role: 'user', content: featureSummary || 'high energy bass heavy synthwave' },
          ],
        });

        if (aiResult.response) {
          searchPrompt = aiResult.response.trim();
        }
      } catch {
        // Fallback search prompt based on basic energy heuristic
        if ((features.bassEnergy || 0) > 0.7) {
          searchPrompt = 'intense bass pulsing neon tunnel';
        } else if ((features.trebleEnergy || 0) > 0.7) {
          searchPrompt = 'high frequency laser stroboscopic particles';
        } else {
          searchPrompt = 'smooth liquid ambient color flow';
        }
      }
    }

    let results: Array<{ presetId: string; score?: number }> = [];

    if (env.AI && env.VECTOR_INDEX) {
      try {
        const embResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [searchPrompt],
        });
        const queryEmbedding = embResult.data?.[0];
        if (queryEmbedding) {
          const vResult = await env.VECTOR_INDEX.query(queryEmbedding, { topK: 6 });
          results = vResult.matches.map((m) => ({ presetId: m.id, score: m.score }));
        }
      } catch {
        // Fall through to default recommendations
      }
    }

    if (results.length === 0) {
      results = [
        { presetId: 'builtin-neon-grid' },
        { presetId: 'builtin-cosmic-tunnel' },
        { presetId: 'builtin-liquid-spectrum' },
      ];
    }

    return new Response(
      JSON.stringify({
        searchPrompt,
        recommendedPresets: results,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Audio selection failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
