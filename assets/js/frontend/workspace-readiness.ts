import { useEffect, useState } from 'react';
import { getRenderingSupport } from '../core/renderer-capabilities.ts';
import { probeMicrophoneCapability } from '../core/services/microphone-permission-service.ts';
import type { ReadinessItem } from './workspace-helpers.ts';

function buildReadinessSummary(
  micState: Awaited<ReturnType<typeof probeMicrophoneCapability>>,
) {
  const rendering = getRenderingSupport();

  const renderItem: ReadinessItem = rendering.hasWebGPU
    ? {
        id: 'rendering',
        label: 'Runs at full detail',
        state: 'ready',
        summary: 'Your browser supports the richest visuals.',
      }
    : rendering.hasWebGL
      ? {
          id: 'rendering',
          label: 'Runs in compatible mode',
          state: 'warn',
          summary: 'Visuals will use a lighter, more compatible setup here.',
        }
      : {
          id: 'rendering',
          label: 'Graphics unavailable',
          state: 'blocked',
          summary: 'This browser cannot start 3D visuals.',
        };

  const micItem: ReadinessItem =
    micState.state === 'denied'
      ? {
          id: 'microphone',
          label: 'Mic access is off',
          state: 'warn',
          summary: micState.reason ?? 'Microphone access is blocked.',
        }
      : micState.supported
        ? {
            id: 'microphone',
            label: 'Mic input available',
            state: 'ready',
            summary:
              micState.state === 'granted'
                ? 'You can use live microphone input right away.'
                : 'The browser can ask for mic access when you want it.',
          }
        : {
            id: 'microphone',
            label: 'Mic not supported',
            state: 'blocked',
            summary:
              micState.reason ?? 'Microphone capture is not available here.',
          };

  const motionSupported =
    typeof window !== 'undefined' &&
    ('DeviceMotionEvent' in window || 'LinearAccelerationSensor' in window);
  const motionItem: ReadinessItem = motionSupported
    ? {
        id: 'motion',
        label: 'Motion controls supported',
        state: 'ready',
        summary: 'Tilt and motion-reactive presets can run on your device.',
      }
    : {
        id: 'motion',
        label: 'Motion controls unavailable',
        state: 'warn',
        summary: 'Tilt reactive effects are not available here.',
      };

  return [renderItem, micItem, motionItem];
}

export function useWorkspaceReadiness() {
  const [readinessItems, setReadinessItems] = useState<ReadinessItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    void probeMicrophoneCapability().then((microphoneCapability) => {
      if (cancelled) {
        return;
      }
      setReadinessItems(buildReadinessSummary(microphoneCapability));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return readinessItems;
}
