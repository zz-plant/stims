import { corsPreflight, json } from './_http.ts';
// POST /api/patch-preset
// Applies key-value parameter overrides to MilkDrop source code deterministically

export async function onRequest(context: {
  request: Request;
}): Promise<Response> {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return corsPreflight('POST');
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed. Use POST.' }, 405);
  }

  try {
    const body = (await request.json()) as {
      milkSource?: string;
      patch?: Record<string, number | string>;
    };

    if (typeof body.milkSource !== 'string') {
      return json({ error: 'milkSource string is required.' }, 400);
    }
    if (!body.patch || typeof body.patch !== 'object') {
      return json({ error: 'patch object is required.' }, 400);
    }

    const patchedSource = applyPresetPatch(body.milkSource, body.patch);
    return json({ milkSource: patchedSource });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Invalid request body.',
      },
      400,
    );
  }
}

const SHADER_SECTION_HEADER = /^\s*\[\s*(?:warp_shader|comp_shader)\s*\]\s*$/iu;

export function applyPresetPatch(
  source: string,
  patch: Record<string, number | string>,
): string {
  const remainingPatch = { ...patch };
  const lines = source.split(/\r?\n/u);
  const updatedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const equalsIndex = trimmed.indexOf('=');

    if (
      equalsIndex > 0 &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('[')
    ) {
      const key = trimmed.slice(0, equalsIndex).trim();
      if (key in remainingPatch) {
        const val = remainingPatch[key];
        const formattedVal =
          typeof val === 'number'
            ? Number.isInteger(val)
              ? val.toString()
              : val.toFixed(6)
            : String(val);
        updatedLines.push(`${key}=${formattedVal}`);
        delete remainingPatch[key];
        continue;
      }
    }

    updatedLines.push(line);
  }

  // New keys go after the equations, before any [warp_shader]/[comp_shader]
  // section: the parser reads every line after such a header as shader
  // text, so a key added at the end of the file there did nothing.
  const unappliedKeys = Object.keys(remainingPatch);
  if (unappliedKeys.length > 0) {
    const added = ['', '// Agent Parametric Patch'];
    for (const key of unappliedKeys) {
      const val = remainingPatch[key];
      const formattedVal =
        typeof val === 'number'
          ? Number.isInteger(val)
            ? val.toString()
            : val.toFixed(6)
          : String(val);
      added.push(`${key}=${formattedVal}`);
    }
    const shaderStart = updatedLines.findIndex((line) =>
      SHADER_SECTION_HEADER.test(line),
    );
    updatedLines.splice(
      shaderStart < 0 ? updatedLines.length : shaderStart,
      0,
      ...added,
    );
  }

  return updatedLines.join('\n');
}
