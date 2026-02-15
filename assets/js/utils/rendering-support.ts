import {
  getRenderingSupport as getCoreRenderingSupport,
  type RenderingSupport,
} from '../core/renderer-capabilities.ts';

export type { RenderingSupport };

export const getRenderingSupport = (): RenderingSupport =>
  getCoreRenderingSupport();
