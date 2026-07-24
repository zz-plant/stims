import { useSyncExternalStore } from 'react';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from '../engine-audio-energy-store.ts';

export function useAudioEnergy(): number {
  return useSyncExternalStore(
    subscribeAudioEnergy,
    getAudioEnergy,
    getAudioEnergy,
  );
}
