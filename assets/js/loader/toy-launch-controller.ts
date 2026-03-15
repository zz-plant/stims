import {
  normalizeToyLaunchResult,
  type ToyLaunchRequest,
  type ToyLaunchResult,
} from '../core/toy-launch.ts';
import type { ToyLifecycle } from '../core/toy-lifecycle.ts';
import type { ToyEntry } from '../data/toy-schema.ts';
import { createManifestClient } from '../utils/manifest-client.ts';
import { loadToyModuleStarter } from '../utils/toy-module-loader.ts';

const TOY_SLUG_ALIASES: Record<string, string> = {
  'three-d-toy': '3dtoy',
};

export function resolveToySlug(slug: string) {
  const normalized = slug.trim().toLowerCase();
  return TOY_SLUG_ALIASES[normalized] ?? normalized;
}

export function createToyLaunchController({
  manifestClient = createManifestClient(),
  lifecycle,
  toys,
}: {
  manifestClient?: ReturnType<typeof createManifestClient>;
  lifecycle: ToyLifecycle;
  toys: ToyEntry[];
}) {
  const findToy = (slug: string) => {
    const resolvedSlug = resolveToySlug(slug);
    return toys.find((toy) => toy.slug === resolvedSlug) ?? null;
  };

  const launchToy = async ({
    toy,
    request,
  }: {
    toy: ToyEntry;
    request: ToyLaunchRequest;
  }): Promise<
    | { ok: true; moduleUrl: string; launchResult: ToyLaunchResult }
    | { ok: false; moduleUrl?: string; error: Error }
  > => {
    const moduleResult = await loadToyModuleStarter({
      moduleId: toy.module,
      manifestClient,
    });
    if (!moduleResult.ok) {
      return {
        ok: false,
        moduleUrl: moduleResult.moduleUrl,
        error: moduleResult.error,
      };
    }

    try {
      const instance = await moduleResult.starter({
        container: request.container,
        slug: request.slug,
        preferDemoAudio: request.audioPreference === 'demo',
      });
      const adoptedInstance = instance ?? lifecycle.getActiveToy()?.ref ?? null;
      const launchResult = await normalizeToyLaunchResult(adoptedInstance, {
        windowRef: (request.container.ownerDocument.defaultView ??
          window) as Window & typeof globalThis,
      });
      return {
        ok: true,
        moduleUrl: moduleResult.moduleUrl,
        launchResult,
      };
    } catch (error) {
      return {
        ok: false,
        moduleUrl: moduleResult.moduleUrl,
        error: error as Error,
      };
    }
  };

  return {
    findToy,
    launchToy,
  };
}
