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

/**
 * True when the WebGL renderer string names a CPU rasterizer. Frame times
 * measured on one describe the host's CPU, not the visualizer, so timing
 * instruments must not treat them as evidence about real hardware.
 */
export function isSoftwareRenderer(renderer: string | null): boolean {
  return renderer !== null && /swiftshader|llvmpipe|software/i.test(renderer);
}

/** The one-line caveat printed wherever a timing number could be misread. */
export function softwareTimingWarning(renderer: string): string {
  return (
    `⚠️  Software rendering detected (${renderer}). Frame times below measure ` +
    "this host's CPU rasterizer, not a real GPU — do not use them to judge " +
    'performance. Correctness tools (lab:visual, lab:replay, lab:nan-sweep) are ' +
    'unaffected; for timing, run on a machine with a GPU or `bun run preview:deploy`.'
  );
}

let warnedSoftwareTiming = false;

/**
 * Probes the renderer and prints the software-rendering caveat once per
 * process, so a per-preset loop does not repeat it. Never throws: a failed
 * probe must not break the measurement it is annotating.
 */
export async function warnIfSoftwareRendering(
  context: import('playwright').BrowserContext,
): Promise<string | null> {
  try {
    const renderer = await probeChromiumRendererString(context);
    if (renderer && isSoftwareRenderer(renderer) && !warnedSoftwareTiming) {
      warnedSoftwareTiming = true;
      console.warn(`\n${softwareTimingWarning(renderer)}\n`);
    }
    return renderer;
  } catch {
    return null;
  }
}

/**
 * Chromium flags for measuring on real hardware. `--use-angle=metal` exists
 * only on macOS; passing it elsewhere is silently ignored and leaves a Linux
 * run on whatever Chromium falls back to, so it is scoped to darwin and other
 * platforms keep the default ANGLE backend.
 */
export function hardwareAngleArgs(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === 'darwin'
    ? ['--use-gl=angle', '--use-angle=metal']
    : ['--use-gl=angle'];
}
