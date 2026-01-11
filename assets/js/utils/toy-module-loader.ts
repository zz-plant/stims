import type { createManifestClient } from './manifest-client.ts';

export type ToyModuleStarter = (args: {
  container: HTMLElement;
  slug: string;
}) => Promise<unknown> | unknown;

export type ToyModuleLoadFailureType = 'resolve' | 'import' | 'missing_start';

export type ToyModuleLoadFailure = {
  ok: false;
  errorType: ToyModuleLoadFailureType;
  error: Error;
  moduleUrl?: string;
};

export type ToyModuleLoadSuccess = {
  ok: true;
  moduleUrl: string;
  starter: ToyModuleStarter;
};

export type ToyModuleLoadResult = ToyModuleLoadSuccess | ToyModuleLoadFailure;

function resolveModuleImportUrl(moduleUrl: string) {
  if (moduleUrl.startsWith('./') || moduleUrl.startsWith('../')) {
    return new URL(moduleUrl, new URL('../', import.meta.url)).toString();
  }

  return moduleUrl;
}

export async function loadToyModuleStarter({
  moduleId,
  manifestClient,
}: {
  moduleId: string;
  manifestClient: ReturnType<typeof createManifestClient>;
}): Promise<ToyModuleLoadResult> {
  let moduleUrl: string;
  try {
    moduleUrl = await manifestClient.resolveModulePath(moduleId);
  } catch (error) {
    return {
      ok: false,
      errorType: 'resolve',
      error: error as Error,
    };
  }

  let moduleExports: unknown;
  try {
    const resolvedUrl = resolveModuleImportUrl(moduleUrl);
    moduleExports = await import(resolvedUrl);
  } catch (error) {
    return {
      ok: false,
      errorType: 'import',
      moduleUrl,
      error: error as Error,
    };
  }

  const startCandidate =
    (moduleExports as { start?: unknown })?.start ??
    (moduleExports as { default?: { start?: unknown } })?.default?.start;
  const starter = typeof startCandidate === 'function' ? startCandidate : null;

  if (!starter) {
    return {
      ok: false,
      errorType: 'missing_start',
      moduleUrl,
      error: new Error('Toy module did not export a start function.'),
    };
  }

  return {
    ok: true,
    moduleUrl,
    starter,
  };
}
