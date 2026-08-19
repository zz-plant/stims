import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAudioProfile,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { searchByFrame } from '../core/services/visual-embedding.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import {
  getAudioBands,
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { PresetIdentity } from './PresetIdentity.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

/**
 * Finding a preset in the catalog, by whichever signal you have to hand.
 *
 * "Match my music" and "More like this" were two top-level panels and two
 * menu items, but they are one job: rank the catalog against the current
 * moment and let you play a result. They differed only in the seed — the
 * audio that is playing, or the frame on screen — and in how a row renders.
 * Splitting them meant deciding which door to walk through before you could
 * see either set of results, and neither door mentioned the other.
 *
 * Generating and refining preset *source* is a genuinely different job with a
 * different output, so those stay separate; this is not a merge of everything
 * with "AI" in the name.
 */
export type FinderMode = 'sound' | 'look';

/**
 * Cosine floor below which a result is not worth showing.
 *
 * bge-base does not bottom out at 0 — measured against the production index,
 * a deliberately nonsensical query ("purple accountancy spreadsheet tax
 * return quarterly filing") still scored 0.628 against the old title-based
 * text and 0.585 against the current visual descriptions. Anything under this
 * is indistinguishable from that noise floor.
 */
const MIN_SCORE = 0.62;

const FINDER_MODE_STORAGE_KEY = 'stims:finder-mode';

function readStoredFinderMode(): FinderMode | null {
  try {
    const stored = localStorage.getItem(FINDER_MODE_STORAGE_KEY);
    return stored === 'sound' || stored === 'look' ? stored : null;
  } catch {
    return null;
  }
}

/** Both searches collapse onto this so the results list is written once. */
type FinderResult = {
  id: string;
  title: string;
  entry: PresetCatalogEntry | null;
};

const MODES: Array<{
  id: FinderMode;
  label: string;
  hint: string;
  icon: 'music' | 'eye';
}> = [
  {
    id: 'sound',
    label: 'By sound',
    hint: 'Ranks the catalog against the audio playing right now.',
    icon: 'music',
  },
  {
    id: 'look',
    label: 'By look',
    hint: 'Ranks the catalog against the frame currently on screen.',
    icon: 'eye',
  },
];

export function PresetFinderPanel({
  initialMode = 'sound',
  onClose,
}: {
  initialMode?: FinderMode;
  onClose: () => void;
}) {
  const { engine, ui } = useWorkspace();
  const [mode, setMode] = useState<FinderMode>(() => {
    // The remembered mode wins over the route's default, but availability
    // stays authoritative: searching by sound needs live audio, so a
    // remembered 'sound' falls back to 'look' when nothing is playing.
    const candidate = readStoredFinderMode() ?? initialMode;
    return candidate === 'sound' && !(getAudioEnergy() > 0.02)
      ? 'look'
      : candidate;
  });
  const [results, setResults] = useState<FinderResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(() => getAudioEnergy() > 0.02);

  useEffect(() => {
    return subscribeAudioEnergy(() => {
      const active = getAudioEnergy() > 0.02;
      setHasAudio((prev) => (prev === active ? prev : active));
    });
  }, []);

  const catalogEntryById = useMemo(() => {
    const map = new Map<string, PresetCatalogEntry>();
    for (const entry of engine.catalog) {
      map.set(entry.id, entry);
    }
    return map;
  }, [engine.catalog]);

  const search = useCallback(async () => {
    setLoading(true);
    setResults(null);
    setError(null);
    try {
      // Both services return the same {presetId, score} ranking, so the only
      // real difference between the two modes is what gets embedded.
      let matches: Array<{ presetId: string; score: number }>;
      if (mode === 'sound') {
        // Real bands, not the fabricated 0.6/0.3/0.1 split of a single scalar
        // that buildAudioProfile falls back to, so the query reflects how the
        // music is voiced and not only how loud it is.
        // No slice: the endpoint already returns topK=5.
        const bands = getAudioBands();
        matches = await searchByAudioProfile(
          buildAudioProfile({
            audioEnergy: getAudioEnergy(),
            fftBands: [bands.bass, bands.mid, bands.treble],
          }),
        );
      } else {
        const canvas = ui.stageRef.current?.querySelector(
          'canvas',
        ) as HTMLCanvasElement | null;
        if (!canvas) throw new Error('No canvas found');
        matches = await searchByFrame(canvas);
      }

      // A nearest-neighbour index always returns its topK, so without a floor
      // "No matches found" is unreachable and every query looks successful.
      const relevant = matches.filter((match) => match.score >= MIN_SCORE);

      setResults(
        relevant.map((match) => {
          const entry = catalogEntryById.get(match.presetId) ?? null;
          return {
            id: match.presetId,
            title: entry?.title ?? match.presetId,
            entry,
          };
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [catalogEntryById, mode, ui]);

  // Each mode runs itself once when it becomes visible, matching what the two
  // separate panels did on mount. Keyed by mode so switching tabs searches
  // the new way without the user asking twice.
  const autoRunRef = useRef<FinderMode | null>(null);
  useEffect(() => {
    if (autoRunRef.current === mode) return;
    // The audio search needs something audible to profile; without it the
    // old panel sat waiting rather than returning an empty result.
    if (mode === 'sound' && !hasAudio) return;
    autoRunRef.current = mode;
    void search();
  }, [mode, hasAudio, search]);

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];
  const soundUnavailable = mode === 'sound' && !hasAudio;

  return (
    <div className="stims-finder">
      <div className="stims-finder__head">
        <UiIcon
          name={activeMode.icon}
          className="stims-finder__icon"
          aria-hidden="true"
        />
        <h3 className="stims-finder__title">Find a preset</h3>
      </div>

      <div
        className="stims-finder__modes"
        role="radiogroup"
        aria-label="Search by"
      >
        {MODES.map((candidate) => (
          <label
            key={candidate.id}
            className="stims-finder__mode"
            data-on={candidate.id === mode ? 'true' : 'false'}
            title={candidate.hint}
          >
            <input
              type="radio"
              name="finder-mode"
              className="stims-finder__mode-input"
              value={candidate.id}
              checked={candidate.id === mode}
              onChange={() => {
                setMode(candidate.id);
                try {
                  localStorage.setItem(FINDER_MODE_STORAGE_KEY, candidate.id);
                } catch {}
              }}
            />
            {candidate.label}
          </label>
        ))}
      </div>

      <p className="stims-finder__hint">{activeMode.hint}</p>

      {loading ? (
        <div className="stims-finder__status" role="status">
          {mode === 'sound' ? 'Analysing audio…' : 'Analysing frame…'}
        </div>
      ) : error ? (
        <div className="stims-finder__status stims-finder__status--error">
          {error}
        </div>
      ) : results ? (
        <ul className="stims-finder__results">
          {results.length === 0 ? (
            <li className="stims-finder__empty">No matches found</li>
          ) : (
            results.map((result, index) => (
              <li key={result.id} className="stims-finder__item">
                <button
                  type="button"
                  className="stims-finder__result"
                  onClick={() => {
                    engine.handlePlayPreset(result.id);
                    onClose();
                  }}
                >
                  <PresetIdentity
                    entry={result.entry}
                    title={result.title}
                    subtitle={
                      result.entry?.author
                        ? `by ${result.entry.author}`
                        : 'Unknown author'
                    }
                    compact
                    artFallback={
                      <span className="stims-finder__rank">{index + 1}</span>
                    }
                  />
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      <button
        type="button"
        className="stims-finder__run"
        onClick={() => void search()}
        disabled={loading || soundUnavailable}
      >
        <UiIcon
          name="refresh"
          className="stims-icon-slot stims-icon-slot--sm"
          aria-hidden="true"
        />
        {mode === 'sound' ? 'Analyse audio' : 'Analyse frame'}
      </button>

      {soundUnavailable ? (
        <p className="stims-finder__hint">
          Start audio to search by sound, or switch to By look.
        </p>
      ) : null}
    </div>
  );
}
