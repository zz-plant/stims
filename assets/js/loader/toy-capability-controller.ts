import { setCompatibilityMode } from '../core/render-preferences.ts';
import { shouldPreferWebGLForKnownCompatibilityGaps } from '../core/renderer-query-override.ts';
import type { getRendererCapabilities } from '../core/renderer-capabilities.ts';
import { assessToyCapabilities } from '../core/toy-capabilities.ts';
import { ensureWebGL } from '../core/webgl-check.ts';
import type { ToyEntry } from '../data/toy-schema.ts';

type RendererCapabilities = Awaited<ReturnType<typeof getRendererCapabilities>>;

export function createToyCapabilityController({
  ensureWebGLCheck = ensureWebGL,
  rendererCapabilities,
}: {
  ensureWebGLCheck?: typeof ensureWebGL;
  rendererCapabilities: typeof getRendererCapabilities;
}) {
  const browseCompatibleToys = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('toy');
    url.searchParams.delete('filters');
    url.pathname = '/';
    url.hash = 'experience';
    try {
      window.sessionStorage.setItem('stims-compatibility-mode', 'true');
    } catch (_error) {
      // Ignore storage access issues.
    }
    window.location.href = url.toString();
  };

  const assess = async ({
    toy,
    initialCapabilities,
    forceRendererRetry = false,
  }: {
    toy: ToyEntry;
    initialCapabilities?: RendererCapabilities;
    forceRendererRetry?: boolean;
  }) =>
    assessToyCapabilities({
      toy,
      rendererCapabilities: () =>
        rendererCapabilities({
          forceRetry: forceRendererRetry,
          preferWebGLForKnownCompatibilityGaps:
            shouldPreferWebGLForKnownCompatibilityGaps(),
        }),
      ensureWebGLCheck,
      initialCapabilities,
    });

  const createPreferredRendererRetry =
    ({
      toy,
      pushState,
      preferDemoAudio,
      startFlow,
      startPartyMode,
      loadToy,
      view,
    }: {
      toy: ToyEntry;
      pushState: boolean;
      preferDemoAudio: boolean;
      startFlow: boolean;
      startPartyMode: boolean;
      loadToy: (
        slug: string,
        options?: {
          pushState?: boolean;
          preferDemoAudio?: boolean;
          startFlow?: boolean;
          startPartyMode?: boolean;
          forceRendererRetry?: boolean;
        },
      ) => Promise<void>;
      view: {
        clearActiveToyContainer: () => void;
      };
    }) =>
    () => {
      view.clearActiveToyContainer();
      void loadToy(toy.slug, {
        pushState,
        preferDemoAudio,
        startFlow,
        startPartyMode,
        forceRendererRetry: true,
      });
    };

  const createPreferredRendererAction = ({
    capabilities,
    retry,
  }: {
    capabilities: RendererCapabilities;
    retry: () => void;
  }) => {
    if (capabilities.preferredBackend === 'webgpu') {
      return undefined;
    }

    const label = capabilities.forceWebGL
      ? 'Use WebGPU'
      : capabilities.shouldRetryWebGPU
        ? 'Try WebGPU'
        : null;
    if (!label) {
      return undefined;
    }

    return {
      label,
      onClick: () => {
        if (capabilities.forceWebGL) {
          setCompatibilityMode(false);
        }
        retry();
      },
    };
  };

  return {
    assess,
    browseCompatibleToys,
    createPreferredRendererRetry,
    createPreferredRendererAction,
  };
}
