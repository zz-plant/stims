import { useEffect, useRef, useState } from 'react';
import type { ResumableAudioSource } from '../core/state/last-session-store.ts';
import { getLastSession } from '../core/state/last-session-store.ts';
import { resolvePresetCatalogEntry } from '../milkdrop/preset-id-resolution.ts';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';
import { STIMS_REPO_URL } from './workspace-helpers.ts';

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
  const autoStartedRef = useRef(false);

  // Captured at mount so it reflects the URL the visitor actually arrived on.
  // The resume effect below writes `presetId` into the route a tick later, and
  // a resumed session must keep its explicit "Resume" button rather than
  // start on its own.
  const [deepLinkPresetId] = useState(() => ui.routeState.presetId ?? null);

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

  // A `?preset=` link is a request to watch that preset, not to configure an
  // audio source. Social cards advertise one specific preset by name, so
  // landing those clicks on the setup form threw the arrival away. Start demo
  // audio directly instead.
  //
  // Autoplay policy may leave the AudioContext suspended because this runs
  // outside a user gesture. That is handled: `core/audio-handler.ts` installs
  // capture-phase pointerdown/touchstart/keydown listeners that resume every
  // registered context, so the visitor's first interaction unblocks sound
  // while the visuals have been running from the start.
  // Waiting for the catalog to actually contain the requested preset is the
  // point of `deepLinkEntry`, not just a readiness nicety. `handleAudioStart`
  // "heals" a request it believes is missing by substituting the featured
  // preset — and until the catalog lands, every id looks missing. Starting on
  // `engineReady` alone therefore raced the catalog and silently played a
  // different preset than the link named, which is the exact failure this
  // whole path exists to prevent.
  const deepLinkEntry = deepLinkPresetId
    ? resolvePresetCatalogEntry(engine.catalog, deepLinkPresetId)
    : null;

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!deepLinkEntry) return;
    if (!engine.engineReady) return;
    autoStartedRef.current = true;
    void engine.handleAudioStart('demo');
  }, [deepLinkEntry, engine.engineReady, engine.handleAudioStart]);

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
        <ProjectMeta />
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
        >
          Play demo
        </button>
      )}
      <button
        type="button"
        className="stims-shell__launch-secondary"
        onClick={onBrowsePresets}
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

/**
 * Closes the launch column with the project's provenance. Deliberately muted —
 * the repository is a fact about Stims, not a competing call to action.
 */
function ProjectMeta() {
  return (
    <p className="stims-shell__launch-meta">
      <a
        className="stims-shell__launch-meta-link"
        href={STIMS_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <UiIcon name="github" className="stims-shell__launch-meta-icon" />
        Open source on GitHub
      </a>
    </p>
  );
}
