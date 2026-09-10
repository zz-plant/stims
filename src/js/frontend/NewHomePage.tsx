/**
 * Home & Launch Page Component — implements the flagship launch landing page with session resumption,
 * curated starter presets, audio source selectors, and quick-start actions.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ResumableAudioSource } from '../core/state/last-session-store.ts';
import { getLastSession } from '../core/state/last-session-store.ts';
import { resolvePresetCatalogEntry } from '../milkdrop/preset-id-resolution.ts';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import { getArrivalPresetId } from './arrival-url.ts';
import type { PresetCatalogEntry } from './contracts.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { LaunchSignalTrace } from './SignalField.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';
import { describePresetMood, STIMS_REPO_URL } from './workspace-helpers.ts';

const RESUME_SOURCE_LABEL: Record<ResumableAudioSource, string> = {
  demo: 'demo audio',
  microphone: 'your mic',
  tab: "this tab's audio",
  youtube: 'YouTube audio',
};

/**
 * The automation hook (`core/agent-api.ts`, `scripts/play-toy.ts`) for the
 * source a button starts. The resume CTA used to carry `data-demo-audio-btn`
 * whatever it resumed with, so `enableDemoAudio()` on a returning visitor's
 * page asked for their microphone.
 */
const RESUME_SOURCE_HOOK: Partial<Record<ResumableAudioSource, string>> = {
  demo: 'data-demo-audio-btn',
  microphone: 'data-mic-audio-btn',
  tab: 'data-tab-audio-btn',
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

  // The URL the visitor actually arrived on — captured at document load by
  // `arrival-url.ts`, not at component mount and not at this chunk's eval.
  // Route state is written to by the app itself (the resume effect below, and
  // preset navigation once a session is running), and reading it here made
  // those writes indistinguishable from a real `?preset=` arrival: a bare "/"
  // visit could auto-start demo audio with no click.
  const [deepLinkPresetId] = useState(getArrivalPresetId);

  // Memoized: resolution of an id the catalog does NOT contain costs two
  // full catalog scans, and this component re-renders with workspace state.
  const resumeEntry = useMemo(
    () =>
      lastSession
        ? resolvePresetCatalogEntry(engine.catalog, lastSession.presetId)
        : null,
    [engine.catalog, lastSession],
  );

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
  const deepLinkEntry = useMemo(
    () =>
      deepLinkPresetId
        ? resolvePresetCatalogEntry(engine.catalog, deepLinkPresetId)
        : null,
    [engine.catalog, deepLinkPresetId],
  );

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!deepLinkPresetId) return;
    if (!engine.engineReady) return;
    // A resolved entry starts the named preset. A link whose id the settled
    // catalog does NOT contain must still start — handleAudioStart heals the
    // route to the featured preset and says so in a status message. Without
    // this branch a stale or renamed id (old share links, indexed search
    // results) stranded the arrival on the generic launch form with no
    // feedback at all.
    if (!deepLinkEntry && !engine.missingRequestedPreset) return;
    autoStartedRef.current = true;
    void engine.handleAudioStart('demo');
  }, [
    deepLinkPresetId,
    deepLinkEntry,
    engine.engineReady,
    engine.missingRequestedPreset,
    engine.handleAudioStart,
  ]);

  // Without attract mode (mobile, low-power) the engine only boots when this
  // is pressed, which takes seconds on a phone. A CTA that just sits there
  // reads as broken and invites rage-taps; show the in-flight state.
  const [audioStarting, setAudioStarting] = useState(false);
  const startWithFeedback = (source: ResumableAudioSource) => {
    // The CTAs stay focusable while this runs (see `aria-disabled` below), so
    // a second Enter can land before the first start resolves.
    if (audioStarting) return;
    setAudioStarting(true);
    void Promise.resolve(engine.handleAudioStart(source)).finally(() =>
      setAudioStarting(false),
    );
  };
  const handlePlayDemo = () => startWithFeedback('demo');
  const handleResume = () => {
    if (!lastSession) return;
    startWithFeedback(lastSession.source);
  };
  const handleBrowsePresets = () => ui.updatePanel('browse');

  const resume =
    lastSession && resumeEntry
      ? { session: lastSession, entry: resumeEntry }
      : null;

  // A `?preset=` arrival came for one specific preset; while the engine and
  // catalog get ready (up to a few seconds on mid devices), name it instead
  // of showing the generic pitch — otherwise the page reads as "configure
  // me" and then replaces itself without explanation when demo audio
  // auto-starts. The catalog title wins once it lands; before that, the slug
  // is prettified so the wait is still acknowledged.
  const deepLink =
    !resume && deepLinkPresetId && !autoStartedRef.current
      ? {
          title: deepLinkEntry?.title ?? prettifyPresetSlug(deepLinkPresetId),
          entry: deepLinkEntry,
        }
      : null;

  return (
    <section
      className="stims-shell__launch stims-shell__launch--minimal"
      data-audio-controls
      aria-labelledby="stims-launch-title"
    >
      <div
        className="stims-shell__launch-center"
        data-variant={resume ? 'resume' : deepLink ? 'deep-link' : 'launch'}
      >
        <Header resume={resume} deepLink={deepLink} />
        <Actions
          resume={resume}
          onPlayDemo={handlePlayDemo}
          onResume={handleResume}
          isEngineReady={engine.engineReady}
          isStarting={audioStarting}
          onBrowsePresets={handleBrowsePresets}
        />
        {resume ? null : (
          <p className="stims-shell__launch-explainer">
            Every scene is a preset — a small visual program from the MilkDrop
            community. Switch presets while the music plays, or generate your
            own.
          </p>
        )}
        <AudioSources resume={resume} />
        {/* Returning visitor: switching preset changes context, it is not
            a second way to start, so it ranks below the sources as a quiet
            text action rather than pairing with Resume as an equal. */}
        {resume ? (
          <button
            type="button"
            className="stims-shell__launch-secondary stims-shell__launch-secondary--quiet"
            onClick={handleBrowsePresets}
          >
            Browse presets
          </button>
        ) : null}
        <ProjectMeta />
      </div>
    </section>
  );
}

type ResumeState = {
  session: { source: ResumableAudioSource };
  entry: PresetCatalogEntry;
} | null;

type DeepLinkState = {
  title: string;
  entry: PresetCatalogEntry | null;
} | null;

/** "aderrasi-potion-of-spirits" → "Aderrasi Potion Of Spirits". */
function prettifyPresetSlug(slug: string) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function Header({
  resume,
  deepLink,
}: {
  resume: ResumeState;
  deepLink: DeepLinkState;
}) {
  if (deepLink) {
    return (
      <>
        <h1 id="stims-launch-title" className="stims-shell__launch-title">
          {deepLink.title}
        </h1>
        <p className="stims-shell__launch-tagline" aria-live="polite">
          Starting with demo audio…
        </p>
        {deepLink.entry ? (
          <div className="stims-shell__launch-resume-art">
            <PresetArtwork entry={deepLink.entry} compact />
          </div>
        ) : null}
      </>
    );
  }
  if (resume) {
    // The preset is one object — its artwork with its name on it — not a
    // headline, a "Continue with…" sentence and a strip of art each
    // announcing the same thing. The decision on this page is small (this
    // preset, or something else) and the layout should look it.
    const { entry } = resume;
    return (
      <>
        <h1 id="stims-launch-title" className="stims-shell__launch-title">
          Welcome back
        </h1>
        <div className="stims-shell__launch-resume-card">
          <PresetArtwork entry={entry} compact />
          <div className="stims-shell__launch-resume-card-copy">
            <p className="stims-shell__launch-resume-card-title">
              {entry.title}
            </p>
            <p className="stims-shell__launch-resume-card-meta">
              {entry.author ? `by ${entry.author}` : describePresetMood(entry)}
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 id="stims-launch-title" className="stims-shell__launch-title">
        Stims
      </h1>
      <LaunchSignalTrace />
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
  isStarting: boolean;
  onBrowsePresets: () => void;
}

function Actions({
  resume,
  onPlayDemo,
  onResume,
  isEngineReady,
  isStarting,
  onBrowsePresets,
}: ActionsProps) {
  const engineStatusId = useId();
  const ctaRef = useRef<HTMLButtonElement>(null);
  // The CTA is disabled until the engine reports ready, so a plain autoFocus
  // would focus a button that can't yet be activated. Move focus the moment
  // it becomes enabled instead — but only if nothing has claimed focus since
  // mount (no Tab press, no click elsewhere), so a keyboard user landing here
  // needs exactly one Enter, without ever stealing focus from someone who's
  // already interacting with the page.
  const focusClaimedRef = useRef(false);
  useEffect(() => {
    const claim = () => {
      focusClaimedRef.current = true;
    };
    document.addEventListener('focusin', claim);
    document.addEventListener('pointerdown', claim);
    document.addEventListener('keydown', claim);
    return () => {
      document.removeEventListener('focusin', claim);
      document.removeEventListener('pointerdown', claim);
      document.removeEventListener('keydown', claim);
    };
  }, []);
  useEffect(() => {
    if (isEngineReady && !focusClaimedRef.current) {
      ctaRef.current?.focus();
    }
  }, [isEngineReady]);
  const resumeHook = resume ? RESUME_SOURCE_HOOK[resume.session.source] : null;
  return (
    <div className="stims-shell__launch-actions-minimal">
      {resume ? (
        <button
          ref={ctaRef}
          id="use-demo-audio"
          {...(resumeHook ? { [resumeHook]: 'true' } : {})}
          type="button"
          className="stims-shell__launch-cta"
          // Disabled only *before* it can be used. Going `disabled` on press
          // instead — which is what "Starting…" used to do — makes the
          // browser blur the button the user just activated: focus drops to
          // `<body>`, the "Starting…"/busy state is never announced because
          // nothing is focused to announce it, and the next Tab restarts at
          // the top of the document. `aria-disabled` states the same thing
          // without taking focus away; `startWithFeedback` ignores the
          // repeat press that leaves possible.
          disabled={!isEngineReady}
          aria-disabled={isStarting || undefined}
          aria-busy={isStarting}
          aria-describedby={!isEngineReady ? engineStatusId : undefined}
          onClick={onResume}
        >
          {isStarting
            ? 'Starting…'
            : `Resume with ${RESUME_SOURCE_LABEL[resume.session.source]}`}
        </button>
      ) : (
        <button
          ref={ctaRef}
          id="use-demo-audio"
          data-demo-audio-btn="true"
          type="button"
          className="stims-shell__launch-cta"
          // Disabled only *before* it can be used. Going `disabled` on press
          // instead — which is what "Starting…" used to do — makes the
          // browser blur the button the user just activated: focus drops to
          // `<body>`, the "Starting…"/busy state is never announced because
          // nothing is focused to announce it, and the next Tab restarts at
          // the top of the document. `aria-disabled` states the same thing
          // without taking focus away; `startWithFeedback` ignores the
          // repeat press that leaves possible.
          disabled={!isEngineReady}
          aria-disabled={isStarting || undefined}
          aria-busy={isStarting}
          aria-describedby={!isEngineReady ? engineStatusId : undefined}
          onClick={onPlayDemo}
        >
          {isStarting ? 'Starting…' : 'Play demo'}
        </button>
      )}
      {/* Buttons above go disabled the instant this page mounts if the
          catalog fetch failed (see engineReady in workspace-shell-hooks.ts);
          without this, a disabled primary CTA with no visible reason reads
          as broken rather than transient. Mirrors the same message
          AudioSourcePanel already shows for its own source buttons. */}
      {!isEngineReady ? (
        <p
          id={engineStatusId}
          className="stims-shell__launch-status"
          aria-live="polite"
        >
          Audio engine is starting. This will unlock in a moment.
        </p>
      ) : null}
      {/* Demo audio is not the visitor's own audio, so it does not belong
          among "use a different source". For someone resuming with a real
          source it is the no-permission escape hatch, and lives here as a
          small action under Resume. */}
      {resume && resume.session.source !== 'demo' ? (
        <button
          type="button"
          className="stims-shell__launch-demo-link"
          data-demo-audio-btn="true"
          disabled={!isEngineReady}
          aria-disabled={isStarting || undefined}
          aria-busy={isStarting}
          onClick={onPlayDemo}
        >
          Try demo audio instead, no permission needed
        </button>
      ) : null}
      {resume ? null : (
        <button
          type="button"
          className="stims-shell__launch-secondary"
          onClick={onBrowsePresets}
        >
          Browse presets
        </button>
      )}
    </div>
  );
}

/**
 * The alternatives to the primary CTA.
 *
 * The pitch is "press one button and it plays" — but the YouTube field and
 * the four source cards rendered flat underneath the CTA at roughly equal
 * visual weight, so the page offered six ways to start and ranked none of
 * them. On a first visit they collapse behind a disclosure: the summary
 * names every source inside, so nothing becomes undiscoverable.
 *
 * A returning visitor gets them as a row of compact chips instead. Their
 * usual source is already the primary button ("Resume with your mic"), so
 * the chips are ranked by size alone and need no disclosure — which also
 * removes the page-length jump between its closed and open states, and the
 * second "Microphone" that the open state used to show a few lines under
 * "Resume with your mic". Demo audio is not their own audio and is offered
 * under Resume instead (see `Actions`).
 */
function AudioSources({ resume }: { resume: ResumeState }) {
  if (resume) {
    return (
      <div className="stims-shell__launch-sources-inline">
        <AudioSourcePanel
          showHelp={false}
          layout="chips"
          heading="Use a different source"
          omitSources={['demo', resume.session.source]}
        />
      </div>
    );
  }
  return (
    <details className="stims-shell__launch-source-minimal">
      <summary className="stims-shell__launch-sources-summary">
        Or use your own audio — YouTube, mic, a file, or this tab
      </summary>
      <div className="stims-shell__launch-sources-body">
        <AudioSourcePanel showHelp={false} />
      </div>
    </details>
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
