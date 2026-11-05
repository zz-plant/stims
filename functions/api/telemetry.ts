// Cloudflare Pages Function: Ingests client performance & engine telemetry metrics
// POST /api/telemetry

import {
  isTelemetryEngineMajor,
  TELEMETRY_ARRIVALS,
  TELEMETRY_AUDIO_SOURCES,
  TELEMETRY_DEVICES,
  TELEMETRY_ENGINES,
  TELEMETRY_FLASH_GUARD_STATES,
  TELEMETRY_FLASH_SAMPLERS,
  TELEMETRY_FOLDS,
  TELEMETRY_ORIENTATIONS,
  TELEMETRY_OS_FAMILIES,
  TELEMETRY_QUALITY_STEPS,
  TELEMETRY_SURFACES,
  type TelemetryEvent,
} from '../../src/js/core/edge-contracts.ts';

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

// Shared with the sender (src/js/core/services/crash-telemetry.ts) so the two
// halves of this endpoint cannot drift apart silently.
type TelemetryPayload = TelemetryEvent;

/** A known value, or '' — an unknown string never becomes a column value. */
function known(values: readonly string[], input: unknown): string {
  return typeof input === 'string' && values.includes(input) ? input : '';
}

/** A measurement, or 0: a bad value must not fail the whole write. */
function measured(input: unknown): number {
  return typeof input === 'number' && Number.isFinite(input) && input > 0
    ? input
    : 0;
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
      return new Response(
        JSON.stringify({ error: 'event parameter is required.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
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
          // Appended, never inserted: queries address blobs by position.
          known(TELEMETRY_ORIENTATIONS, data.orientation),
          known(TELEMETRY_DEVICES, data.device),
          known(TELEMETRY_AUDIO_SOURCES, data.audioSource),
          known(TELEMETRY_ARRIVALS, data.arrival),
          known(TELEMETRY_SURFACES, data.surface),
          known(TELEMETRY_OS_FAMILIES, data.os),
          known(TELEMETRY_ENGINES, data.engine),
          data.androidWebView === true ? 'webview' : '',
          known(TELEMETRY_QUALITY_STEPS, data.qualityStep),
          known(TELEMETRY_FLASH_GUARD_STATES, data.flashGuard),
          known(TELEMETRY_FLASH_SAMPLERS, data.flashSampler),
          known(TELEMETRY_FOLDS, data.fold),
        ],
        doubles: [
          data.fps || 0,
          data.audioLatencyMs || 0,
          Date.now(),
          data.dwellMs || 0,
          // A double so queries can compare and sort it: casting a blob fails
          // the whole query on one value that is not a number.
          isTelemetryEngineMajor(data.engineMajor) ? data.engineMajor : 0,
          measured(data.simulationMs),
          measured(data.renderMs),
          measured(data.gpuMs),
          measured(data.cadenceMs),
          measured(data.renderScale),
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
        error:
          error instanceof Error ? error.message : 'Telemetry logging failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
