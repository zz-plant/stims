import { describe, expect, test } from 'bun:test';
import {
  hardwareAngleArgs,
  isSoftwareRenderer,
  softwareTimingWarning,
} from '../../scripts/browser-launch.ts';

describe('software-rendering detection for timing tools', () => {
  test('names the CPU rasterizers this repo actually meets', () => {
    expect(
      isSoftwareRenderer(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      ),
    ).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('Software Rasterizer')).toBe(true);
  });

  test('does not flag real GPUs, and treats an unknown renderer as unknown', () => {
    expect(
      isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, ...)'),
    ).toBe(false);
    expect(isSoftwareRenderer('NVIDIA GeForce RTX 4070/PCIe/SSE2')).toBe(false);
    // A failed probe must not be reported as software rendering.
    expect(isSoftwareRenderer(null)).toBe(false);
  });

  test('the warning names the renderer and says what is still trustworthy', () => {
    const text = softwareTimingWarning('SwiftShader');
    expect(text).toContain('SwiftShader');
    expect(text).toContain('do not use them to judge performance');
    expect(text).toContain('lab:replay');
    expect(text).toContain('preview:deploy');
  });
});

describe('hardware ANGLE flags', () => {
  test('uses metal only on macOS', () => {
    expect(hardwareAngleArgs('darwin')).toContain('--use-angle=metal');
    expect(hardwareAngleArgs('linux')).not.toContain('--use-angle=metal');
    expect(hardwareAngleArgs('win32')).not.toContain('--use-angle=metal');
  });

  test('always asks for ANGLE', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(hardwareAngleArgs(platform)).toContain('--use-gl=angle');
    }
  });
});
