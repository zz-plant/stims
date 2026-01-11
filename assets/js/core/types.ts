import type {
  LightConfig,
  AmbientLightConfig,
} from '../lighting/lighting-setup';

/**
 * Shared configuration interface for all toys.
 * Previously duplicated in every toy file.
 */
export interface ToyConfig {
  cameraOptions?: Record<string, unknown>;
  sceneOptions?: { backgroundColor?: number };
  rendererOptions?: {
    antialias?: boolean;
    exposure?: number;
    maxPixelRatio?: number;
    renderScale?: number;
  };
  lightingOptions?: LightConfig;
  ambientLightOptions?: AmbientLightConfig;
  canvas?: HTMLCanvasElement | null;
}
