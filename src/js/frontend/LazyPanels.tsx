import { useCallback, useEffect, useState } from 'react';
import {
  buildAudioProfile,
  searchByAudioProfile,
} from '../core/services/audio-matcher.ts';
import { searchByFrame } from '../core/services/visual-embedding.ts';
import { useEngineSnapshot } from './engine-context.tsx';
import { PresetArtwork } from './PresetArtwork.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';

export function RefinePanel() {
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState<'idle' | 'refining' | 'explaining'>(
    'idle',
  );
  const [response, setResponse] = useState<string | null>(null);
  const { engine, ui } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const currentSource = engineSnapshot?.currentSource ?? '';

  const handleRefine = useCallback(async () => {
    if (!instruction.trim()) return;
    setState('refining');
    ui.setStatusMessage('Refining preset…');
    try {
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: instruction.trim(),
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.milkSource) {
        await engine.updateEditorSource(data.milkSource);
        setResponse(`Refined: ${data.title || 'New Preset'}`);
      } else {
        throw new Error('No source returned');
      }
    } catch (err) {
      const error = err as Error;
      setResponse(`Error: ${error.message}`);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, engine, instruction, ui]);

  const handleExplain = useCallback(async () => {
    if (!instruction.trim()) return;
    setState('explaining');
    ui.setStatusMessage('Analyzing preset…');
    try {
      const res = await fetch('/api/refine-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSource,
          instruction: 'explain this preset',
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setResponse(
        data.explanation || data.message || 'No explanation available.',
      );
    } catch (err) {
      const error = err as Error;
      setResponse(`Error: ${error.message}`);
    } finally {
      setState('idle');
      ui.setStatusMessage(null);
    }
  }, [currentSource, instruction, ui]);

  return (
    <div className="stims-shell__refine-panel">
      <div className="stims-shell__refine-input">
        <label htmlFor="refine-instruction" className="stims-shell__sr-only">
          Describe how to change the preset
        </label>
        <textarea
          id="refine-instruction"
          className="stims-shell__refine-textarea"
          placeholder="e.g., make it more blue, add slow rotation, increase bass reactivity"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          disabled={state !== 'idle'}
        />
      </div>
      <div className="stims-shell__refine-actions">
        <button
          type="button"
          className="stims-shell__refine-btn"
          onClick={handleRefine}
          disabled={state !== 'idle' || !instruction.trim()}
        >
          {state === 'refining' ? 'Refining…' : 'Refine'}
        </button>
        <button
          type="button"
          className="stims-shell__refine-btn stims-shell__refine-btn--secondary"
          onClick={handleExplain}
          disabled={state !== 'idle' || !instruction.trim()}
        >
          {state === 'explaining' ? 'Explaining…' : 'Explain'}
        </button>
      </div>
      {response && (
        <div
          className="stims-shell__refine-response"
          role="status"
          aria-live="polite"
        >
          {response}
        </div>
      )}
    </div>
  );
}

export function AudioMatchPanel({ onClose }: { onClose: () => void }) {
  const [matches, setMatches] = useState<Array<{
    presetId: string;
    score: number;
  }> | null>(null);
  const [loading, setLoading] = useState(false);
  const { engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const catalog = engine.catalog;
  const audioEnergy = engineSnapshot?.audioEnergy ?? 0;

  const handleMatch = useCallback(async () => {
    if (!audioEnergy || loading) return;
    setLoading(true);
    setMatches(null);
    try {
      const profile = buildAudioProfile({ audioEnergy });
      const results = await searchByAudioProfile(profile);
      setMatches(results.slice(0, 5));
    } catch (error) {
      console.error('Audio match failed:', error);
    } finally {
      setLoading(false);
    }
  }, [audioEnergy, loading]);

  useEffect(() => {
    if (audioEnergy > 0.02) {
      handleMatch();
    }
  }, [handleMatch, audioEnergy]);

  const getEntry = useCallback(
    (presetId: string) => catalog.find((e) => e.id === presetId),
    [catalog],
  );

  return (
    <div className="stims-shell__audiomatch-panel">
      <div className="stims-shell__audiomatch-header">
        <UiIcon
          name="music"
          className="stims-shell__audiomatch-icon"
          aria-hidden="true"
        />
        <h3>Match my music</h3>
        <p className="stims-shell__audiomatch-desc">
          Finding presets that fit the current audio energy…
        </p>
      </div>
      {loading ? (
        <div className="stims-shell__audiomatch-loading">Analyzing audio…</div>
      ) : matches ? (
        <ul className="stims-shell__audiomatch-results">
          {matches.length === 0 ? (
            <li className="stims-shell__audiomatch-empty">No matches found</li>
          ) : (
            matches.map((match, _i) => {
              const entry = getEntry(match.presetId);
              return (
                <li
                  key={match.presetId}
                  className="stims-shell__audiomatch-item"
                >
                  <button
                    type="button"
                    className="stims-shell__audiomatch-btn"
                    onClick={() => {
                      engine.handlePlayPreset(match.presetId);
                      onClose();
                    }}
                  >
                    {entry && <PresetArtwork entry={entry} compact />}
                    <span className="stims-shell__audiomatch-score">
                      {Math.round(match.score * 100)}%
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : (
        <button
          type="button"
          className="stims-shell__audiomatch-refresh"
          onClick={handleMatch}
          disabled={loading || audioEnergy < 0.02}
        >
          <UiIcon
            name="refresh"
            className="stims-icon-slot stims-icon-slot--sm"
            aria-hidden="true"
          />
          Analyze audio
        </button>
      )}
    </div>
  );
}

export function VisualSearchPanel({ onClose }: { onClose: () => void }) {
  const [matches, setMatches] = useState<Array<{
    presetId: string;
    score: number;
  }> | null>(null);
  const [loading, setLoading] = useState(false);
  const { engine, ui } = useWorkspace();
  const catalog = engine.catalog;

  const getEntry = useCallback(
    (presetId: string) => catalog.find((e) => e.id === presetId),
    [catalog],
  );

  const handleSearch = useCallback(async () => {
    if (loading) return;
    const canvas = ui.stageRef.current?.querySelector(
      'canvas',
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    setLoading(true);
    setMatches(null);
    try {
      const results = await searchByFrame(canvas);
      setMatches(results.slice(0, 5));
    } catch (error) {
      console.error('Visual search failed:', error);
    } finally {
      setLoading(false);
    }
  }, [loading, ui]);

  useEffect(() => {
    handleSearch();
  }, [handleSearch]);

  return (
    <div className="stims-shell__visualsearch-panel">
      <div className="stims-shell__visualsearch-header">
        <UiIcon
          name="eye"
          className="stims-shell__visualsearch-icon"
          aria-hidden="true"
        />
        <h3>More like this</h3>
        <p className="stims-shell__visualsearch-desc">
          Finding visually similar presets…
        </p>
      </div>
      {loading ? (
        <div className="stims-shell__visualsearch-loading">
          Analyzing frame…
        </div>
      ) : matches ? (
        <ul className="stims-shell__visualsearch-results">
          {matches.length === 0 ? (
            <li className="stims-shell__visualsearch-empty">
              No similar presets found
            </li>
          ) : (
            matches.map((match) => {
              const entry = getEntry(match.presetId);
              return (
                <li
                  key={match.presetId}
                  className="stims-shell__visualsearch-item"
                >
                  <button
                    type="button"
                    className="stims-shell__visualsearch-btn"
                    onClick={() => {
                      engine.handlePlayPreset(match.presetId);
                      onClose();
                    }}
                  >
                    {entry && <PresetArtwork entry={entry} compact />}
                    <div className="stims-shell__visualsearch-info">
                      <span className="stims-shell__visualsearch-title">
                        {entry?.title ?? match.presetId}
                      </span>
                      <span className="stims-shell__visualsearch-meta">
                        {entry?.author
                          ? `by ${entry.author}`
                          : 'Unknown author'}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : (
        <button
          type="button"
          className="stims-shell__visualsearch-refresh"
          onClick={handleSearch}
        >
          <UiIcon
            name="refresh"
            className="stims-icon-slot stims-icon-slot--sm"
            aria-hidden="true"
          />
          Analyze frame
        </button>
      )}
    </div>
  );
}
