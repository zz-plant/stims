/**
 * Whether this machine can run a *headed* browser at all.
 *
 * The e2e suites used to key that decision on `process.env.CI`, on the
 * assumption that CI is the only place without a display or a GPU. Cloud agent
 * containers (Claude Code on the web, Codex sandboxes) break the assumption:
 * CI is unset, so every suite chose the headed, real-GPU path and Chromium died
 * with "Missing X server or $DISPLAY" before the first assertion — a launch
 * fault that reads like a broken test, not a missing display.
 *
 * Asking about the display directly covers both. Linux is the only platform
 * where a headed browser needs one: macOS and Windows have no X server and
 * launch headed fine, so the display check must not apply there.
 */
const linuxWithoutDisplay =
  process.platform === 'linux' &&
  !process.env.DISPLAY &&
  !process.env.WAYLAND_DISPLAY;

/**
 * True where only headless, software-rendered browsers can run: CI, and any
 * container with no display server. Suites that need a real GPU or a headed
 * window should skip here, exactly as they already do in CI.
 */
export const HEADLESS_ENVIRONMENT =
  Boolean(process.env.CI) || linuxWithoutDisplay;
