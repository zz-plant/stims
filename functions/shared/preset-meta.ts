// Shared per-isolate loader for /preset-meta.json — the canonical
// id -> [title, author] table. Three functions carried three drifting
// copies of this memoized fetch (the OG middleware, the dynamic OG card
// renderer, and the oEmbed provider), so one cold isolate could fetch the
// same JSON up to three times and the copies could drift in failure
// semantics. Success is memoized per isolate; any failure or miss resets
// the memo so a transient error cannot poison it.

export type PresetMetaTable = Record<string, [title: string, author: string]>;

type AssetsBinding = { fetch: (input: Request) => Promise<Response> };

let presetMetaPromise: Promise<PresetMetaTable | null> | null = null;

export function loadPresetMeta(
  assets: AssetsBinding | undefined,
  origin: string,
): Promise<PresetMetaTable | null> {
  presetMetaPromise ??= (async () => {
    if (!assets) return null;
    try {
      const response = await assets.fetch(
        new Request(new URL('/preset-meta.json', origin).toString()),
      );
      if (!response.ok) return null;
      return (await response.json()) as PresetMetaTable;
    } catch {
      return null;
    }
  })().then(
    (value) => {
      if (value === null) presetMetaPromise = null;
      return value;
    },
    () => {
      presetMetaPromise = null;
      return null;
    },
  );

  return presetMetaPromise;
}

// Test seam: the memo is per-isolate by design, but bun runs every test
// file in one process, so suites that mock the ASSETS binding must reset
// between tests or inherit an earlier file's cached table.
export function __resetPresetMetaForTest(): void {
  presetMetaPromise = null;
}
