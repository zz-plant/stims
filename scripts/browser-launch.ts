/**
 * Shared headless-Chromium launch args for agent-facing browser tools
 * (`stims-ctl.ts`, `mcp-server.ts`). Playwright's default headless mode
 * launches the real Chrome binary, which needs a real GPU for WebGL/WebGPU —
 * on a GPU-less host (most cloud agent sandboxes) that produces a black
 * canvas with no error, not a loud failure.
 *
 * Default here is the opposite of `run-milkdrop-loop-visual-sweep.ts`:
 * these tools default to SwiftShader (deterministic, works everywhere) and
 * opt into real-GPU rendering only when explicitly requested, because a
 * silent black-canvas capture is worse for an interactive agent than a
 * slightly slower software-rendered one. Set STIMS_GPU_RENDER=1 to use the
 * host GPU when you know one is available and want the speed/fidelity.
 */

export function agentGpuRenderRequested(): boolean {
  return process.env.STIMS_GPU_RENDER === '1';
}

const SWIFTSHADER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

const GPU_ARGS = ['--ignore-gpu-blocklist'];

export function resolveAgentChromiumArgs(): string[] {
  return agentGpuRenderRequested() ? GPU_ARGS : SWIFTSHADER_ARGS;
}

/** Reads the active WebGL renderer string so callers can report/verify which pipeline captured a frame. */
export async function probeChromiumRendererString(
  context: import('playwright').BrowserContext,
): Promise<string | null> {
  const page = await context.newPage();
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      return String(gl.getParameter(param));
    });
  } finally {
    await page.close();
  }
}
