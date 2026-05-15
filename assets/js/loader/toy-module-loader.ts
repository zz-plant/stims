import type { createManifestClient } from '../utils/manifest-client.ts';

export type ToyModuleStarter = (args: {
  container: HTMLElement;
  slug: string;
  preferDemoAudio?: boolean;
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

type ToyModuleExports = {
  default?: { start?: unknown };
  start?: unknown;
};

type ToyModuleImporter = () => Promise<ToyModuleExports>;

const bundledToyImporters: Record<string, ToyModuleImporter> = {
  'assets/js/toys/milkdrop-toy.ts': () => import('../toys/milkdrop-toy.ts'),
};

function resolveModuleImportUrl(moduleUrl: string) {
  if (moduleUrl.startsWith('./') || moduleUrl.startsWith('../')) {
    const moduleRootUrl = new URL(/* @vite-ignore */ '../', import.meta.url);
    return new URL(moduleUrl, moduleRootUrl).toString();
  }

  return moduleUrl;
}

function getStarter(moduleExports: unknown) {
  const startCandidate =
    (moduleExports as { start?: unknown })?.start ??
    (moduleExports as { default?: { start?: unknown } })?.default?.start;

  return typeof startCandidate === 'function'
    ? (startCandidate as ToyModuleStarter)
    : null;
}

export function getBundledToyModuleImporter(
  moduleId: string,
): ToyModuleImporter | null {
  if (!moduleId.startsWith('assets/js/')) {
    return null;
  }

  return bundledToyImporters[moduleId] ?? null;
}

async function loadBundledToyModuleStarter(
  moduleId: string,
): Promise<ToyModuleLoadResult | null> {
  const importer = getBundledToyModuleImporter(moduleId);
  if (!importer) {
    return null;
  }

  try {
    const moduleExports = await importer();
    const starter = getStarter(moduleExports);
    if (!starter) {
      return {
        ok: false,
        errorType: 'missing_start',
        moduleUrl: moduleId,
        error: new Error('Toy module did not export a start function.'),
      };
    }

    return {
      ok: true,
      moduleUrl: moduleId,
      starter,
    };
  } catch (error) {
    return {
      ok: false,
      errorType: 'import',
      moduleUrl: moduleId,
      error: error as Error,
    };
  }
}

export async function loadToyModuleStarter({
  moduleId,
  manifestClient,
}: {
  moduleId: string;
  manifestClient: ReturnType<typeof createManifestClient>;
}): Promise<ToyModuleLoadResult> {
  const bundledResult = await loadBundledToyModuleStarter(moduleId);
  if (bundledResult) {
    return bundledResult;
  }

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

  const starter = getStarter(moduleExports);

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
