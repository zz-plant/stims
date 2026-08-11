import { useEffect, useRef, useState } from 'react';
import type { ResumableAudioSource } from '../core/state/last-session-store.ts';
import { getLastSession } from '../core/state/last-session-store.ts';
import { resolvePresetCatalogEntry } from '../milkdrop/preset-id-resolution.ts';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { useWorkspace } from './workspace-context.tsx';

const RESUME_SOURCE_LABEL: Record<ResumableAudioSource, string> = {
  demo: 'demo audio',
  microphone: 'your mic',
  tab: "this tab's audio",
  youtube: 'YouTube audio',
};

/**
 * Home page with minimal launch interface.
 * Displays title, tagline, action buttons, and audio source selection.
 * Responsive layout scales from mobile (375px) to desktop (1920px+).
 *
 * Returning visitors with a resumable last session (see
 * `core/state/last-session-store.ts`) see a "Welcome back" variant that
 * pre-selects their last preset and offers a one-click resume with the
 * source they used last time.
 */
export function NewHomePage() {
  const { ui, engine } = useWorkspace();
  const [lastSession] = useState(() => getLastSession());
  const appliedResumeRef = useRef(false);

  const resumeEntry = lastSession
    ? resolvePresetCatalogEntry(engine.catalog, lastSession.presetId)
    : null;

  // Pre-select the resumed preset so the existing source buttons (demo,
  // mic, tab, YouTube) start it directly — no bespoke resume plumbing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ui.commitRoute/ui.routeState identity churns every render; the ref guard makes this idempotent.
  useEffect(() => {
    if (appliedResumeRef.current) return;
    if (ui.routeState.presetId) {
      appliedResumeRef.current = true;
      return;
    }
    if (!lastSession || !resumeEntry) return;
    appliedResumeRef.current = true;
    ui.commitRoute({ ...ui.routeState, presetId: resumeEntry.id });
  }, [resumeEntry, lastSession]);

  const handlePlayDemo = () => engine.handleAudioStart('demo');
  const handleResume = () => {
    if (!lastSession) return;
    engine.handleAudioStart(lastSession.source);
  };
  const handleBrowsePresets = () => ui.updatePanel('browse');

  const resume =
    lastSession && resumeEntry
      ? { session: lastSession, entry: resumeEntry }
      : null;

  return (
    <section
      className="stims-shell__launch stims-shell__launch--minimal"
      data-audio-controls
      aria-labelledby="stims-launch-title"
    >
      <div className="stims-shell__launch-center">
        <Header resume={resume} />
        <Actions
          resume={resume}
          onPlayDemo={handlePlayDemo}
          onResume={handleResume}
          isEngineReady={engine.engineReady}
          onBrowsePresets={handleBrowsePresets}
        />
        {resume ? null : (
          <p className="stims-shell__launch-explainer">
            Every scene is a preset — a small visual program from the MilkDrop
            community. Switch presets while the music plays, or generate your
            own.
          </p>
        )}
        <AudioSources />
      </div>
    </section>
  );
}

type ResumeState = {
  session: { source: ResumableAudioSource };
  entry: PresetCatalogEntry;
} | null;

function Header({ resume }: { resume: ResumeState }) {
  if (resume) {
    return (
      <>
        <h1 id="stims-launch-title" className="stims-shell__launch-title">
          Welcome back
        </h1>
        <p className="stims-shell__launch-tagline">
          Continue with &ldquo;{resume.entry.title}&rdquo;
        </p>
        <div className="stims-shell__launch-resume-art">
          <PresetArtwork entry={resume.entry} compact />
        </div>
      </>
    );
  }

  return (
    <>
      <h1 id="stims-launch-title" className="stims-shell__launch-title">
        Stims
      </h1>
      <p className="stims-shell__launch-tagline">
        Full-screen visuals that move to whatever you&rsquo;re listening to.
      </p>
    </>
  );
}

interface ActionsProps {
  resume: ResumeState;
  onPlayDemo: () => void;
  onResume: () => void;
  isEngineReady: boolean;
  onBrowsePresets: () => void;
}

function Actions({
  resume,
  onPlayDemo,
  onResume,
  isEngineReady,
  onBrowsePresets,
}: ActionsProps) {
  return (
    <div className="stims-shell__launch-actions-minimal">
      {resume ? (
        <button
          id="use-demo-audio"
          data-demo-audio-btn="true"
          type="button"
          className="stims-shell__launch-cta"
          disabled={!isEngineReady}
          onClick={onResume}
          aria-label={`Resume visualizer with ${RESUME_SOURCE_LABEL[resume.session.source]}`}
        >
          Resume with {RESUME_SOURCE_LABEL[resume.session.source]}
        </button>
      ) : (
        <button
          id="use-demo-audio"
          data-demo-audio-btn="true"
          type="button"
          className="stims-shell__launch-cta"
          disabled={!isEngineReady}
          onClick={onPlayDemo}
          aria-label="Start visualizer with demo audio"
        >
          Play demo
        </button>
      )}
      <button
        type="button"
        className="stims-shell__launch-secondary"
        onClick={onBrowsePresets}
        aria-label="Browse preset collection"
      >
        Browse presets
      </button>
    </div>
  );
}

function AudioSources() {
  return (
    <div className="stims-shell__launch-source-minimal">
      <AudioSourcePanel showHelp={false} />
    </div>
  );
}
