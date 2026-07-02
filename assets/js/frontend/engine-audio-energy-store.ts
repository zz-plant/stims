let currentEnergy = 0;
const subscribers = new Set<() => void>();

export function getAudioEnergy(): number {
  return currentEnergy;
}

export function setAudioEnergy(value: number): void {
  if (Math.abs(value - currentEnergy) < 0.001) return;
  currentEnergy = value;
  for (const sub of subscribers) sub();
}

export function subscribeAudioEnergy(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}
