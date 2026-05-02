import {
  loadMeasuredVisualResultsManifest,
  type MeasuredVisualPresetResult,
  saveMeasuredVisualResultsManifest,
} from './measured-visual-results.ts';

const DEFAULT_PORT = 5174;
const REPO_ROOT = process.cwd();
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type CertifyPayload = {
  presets: Array<{
    id: string;
    title: string;
    fidelityClass: string;
    visualEvidenceTier: string;
    suiteStatus: 'pass' | 'fail';
    certificationStatus: 'certified' | 'uncertified';
    certificationReason: string;
    requiredBackend: string;
    actualBackend: string;
    sourceFamily: string;
    strata: string[];
    toleranceProfile: string;
    mismatchRatio: number;
    threshold: number;
    failThreshold: number;
    capturedAt: string;
  }>;
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function handleCertifyPost(request: Request) {
  return request
    .json()
    .then((payload: CertifyPayload) => {
      if (!payload.presets || !Array.isArray(payload.presets)) {
        return jsonResponse({ error: 'Expected { presets: [...] }' }, 400);
      }

      const manifest = loadMeasuredVisualResultsManifest(REPO_ROOT);
      const now = new Date().toISOString();

      payload.presets.forEach((preset) => {
        const entry: MeasuredVisualPresetResult = {
          id: preset.id,
          title: preset.title,
          fidelityClass:
            preset.fidelityClass as MeasuredVisualPresetResult['fidelityClass'],
          visualEvidenceTier: 'visual',
          suiteStatus: preset.suiteStatus,
          certificationStatus: preset.certificationStatus,
          certificationReason: preset.certificationReason,
          requiredBackend:
            preset.requiredBackend as MeasuredVisualPresetResult['requiredBackend'],
          actualBackend:
            preset.actualBackend as MeasuredVisualPresetResult['actualBackend'],
          sourceFamily:
            preset.sourceFamily as MeasuredVisualPresetResult['sourceFamily'],
          strata: preset.strata,
          toleranceProfile:
            preset.toleranceProfile as MeasuredVisualPresetResult['toleranceProfile'],
          mismatchRatio: preset.mismatchRatio,
          threshold: preset.threshold,
          failThreshold: preset.failThreshold,
          updatedAt: preset.capturedAt || now,
          sourceReport: null,
        };

        const existingIndex = manifest.presets.findIndex(
          (p) => p.id === entry.id,
        );
        if (existingIndex >= 0) {
          manifest.presets[existingIndex] = entry;
        } else {
          manifest.presets.push(entry);
        }
      });

      manifest.updatedAt = now;
      saveMeasuredVisualResultsManifest(REPO_ROOT, manifest);

      return jsonResponse({
        ok: true,
        count: payload.presets.length,
        updatedAt: now,
      });
    })
    .catch((error) => {
      return jsonResponse(
        {
          error:
            error instanceof Error ? error.message : 'Invalid request body',
        },
        400,
      );
    });
}

async function handleRequest(request: Request) {
  const url = new URL(request.url);

  if (url.pathname !== '/api/certify') {
    return new Response('Not Found', { status: 404 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === 'POST') {
    return handleCertifyPost(request);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

function parseArgs(argv: string[]) {
  const portIndex = argv.indexOf('--port');
  const port =
    portIndex >= 0 && portIndex + 1 < argv.length
      ? parseInt(argv[portIndex + 1], 10)
      : DEFAULT_PORT;
  return { port };
}

if (import.meta.main) {
  const { port } = parseArgs(process.argv.slice(2));

  const server = Bun.serve({
    port,
    fetch: handleRequest,
  });

  console.log(
    `Certification API running at http://localhost:${server.port}/api/certify`,
  );
  console.log('Press Ctrl+C to stop.');
}
