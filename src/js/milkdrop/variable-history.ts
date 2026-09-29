/**
 * Rolling per-variable history behind the editor's Inspect tab.
 *
 * Pure so it can be tested without a DOM: feed it frames, read back rows.
 */
export type VariableRow = {
  name: string;
  value: number;
  min: number;
  max: number;
  /** Oldest → newest, at most `capacity` samples. */
  history: readonly number[];
  /** True once the value has ever moved; constants are usually noise. */
  changing: boolean;
  pinned: boolean;
};

type Track = {
  history: number[];
  min: number;
  max: number;
  first: number;
  changing: boolean;
};

const Q_VAR = /^q(\d+)$/u;

function compareNames(a: string, b: string) {
  const qa = Q_VAR.exec(a);
  const qb = Q_VAR.exec(b);
  if (qa && qb) return Number(qa[1]) - Number(qb[1]);
  if (qa) return -1;
  if (qb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function createVariableHistory(capacity = 120) {
  const tracks = new Map<string, Track>();
  const pins = new Set<string>();

  return {
    push(variables: Readonly<Record<string, number>>) {
      for (const name of Object.keys(variables)) {
        const raw = variables[name];
        const value = Number.isFinite(raw) ? raw : 0;
        let track = tracks.get(name);
        if (!track) {
          track = {
            history: [],
            min: value,
            max: value,
            first: value,
            changing: false,
          };
          tracks.set(name, track);
        }
        track.history.push(value);
        if (track.history.length > capacity) track.history.shift();
        if (value < track.min) track.min = value;
        if (value > track.max) track.max = value;
        if (value !== track.first) track.changing = true;
      }
    },
    togglePin(name: string) {
      if (pins.has(name)) pins.delete(name);
      else pins.add(name);
    },
    isPinned: (name: string) => pins.has(name),
    /** Drop all samples (new preset, or the author pressed reset). Pins stay. */
    reset() {
      tracks.clear();
    },
    /**
     * Pinned first, then q-vars in numeric order, then the rest by name.
     * `onlyChanging` hides variables that have never moved.
     */
    rows(
      options: { onlyChanging?: boolean; filter?: string } = {},
    ): VariableRow[] {
      const needle = options.filter?.trim().toLowerCase() ?? '';
      const rows: VariableRow[] = [];
      for (const [name, track] of tracks) {
        const pinned = pins.has(name);
        if (!pinned) {
          if (options.onlyChanging && !track.changing) continue;
          if (needle && !name.toLowerCase().includes(needle)) continue;
        }
        rows.push({
          name,
          value: track.history[track.history.length - 1] ?? 0,
          min: track.min,
          max: track.max,
          history: track.history,
          changing: track.changing,
          pinned,
        });
      }
      return rows.sort((a, b) =>
        a.pinned !== b.pinned
          ? a.pinned
            ? -1
            : 1
          : compareNames(a.name, b.name),
      );
    },
  };
}
