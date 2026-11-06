// POST /api/validate-preset
// Compiles MilkDrop .milk source with the real preset compiler and returns
// its diagnostics. `valid` reflects the compile result — errors are only
// what the compiler rejects (EEL compile failures, parse failures), never a
// heuristic line check.

import type { MilkdropDiagnostic as ToolchainDiagnostic } from 'milkdrop-toolchain/src/common-types.ts';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { corsPreflight, json } from './_http.ts';

interface MilkdropDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  line?: number;
  message: string;
}

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
    const body = (await request.json()) as { milkSource?: string };
    const milkSource = body.milkSource;

    if (typeof milkSource !== 'string') {
      return json(
        { error: 'milkSource string is required in the request body.' },
        400,
      );
    }

    const result = validatePresetSource(milkSource);
    return json(result);
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Invalid request body.',
      },
      400,
    );
  }
}

/** Map a toolchain diagnostic onto the route's wire shape. Toolchain `info`
 * diagnostics stay visible but never affect `valid`. */
function toRouteDiagnostic(
  diagnostic: ToolchainDiagnostic,
): MilkdropDiagnostic {
  return {
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    code: diagnostic.code,
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    message: diagnostic.message,
  };
}

export function validatePresetSource(source: string) {
  const compiled = compileMilkdropPresetSource(source, {
    id: 'validate-preset',
    title: 'validation',
    origin: 'imported',
  });

  const errors: MilkdropDiagnostic[] = [];
  const warnings: MilkdropDiagnostic[] = [];
  for (const diagnostic of compiled.diagnostics) {
    const mapped = toRouteDiagnostic(diagnostic);
    if (mapped.severity === 'error') {
      errors.push(mapped);
    } else {
      warnings.push(mapped);
    }
  }

  return {
    valid: errors.length === 0,
    fieldCount: compiled.ast.fields.length,
    sections: compiled.ast.sections,
    errors,
    warnings,
  };
}
