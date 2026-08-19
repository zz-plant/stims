import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ResumableAudioSource } from '../core/state/last-session-store.ts';
import { getLastSession } from '../core/state/last-session-store.ts';
import { resolvePresetCatalogEntry } from '../milkdrop/preset-id-resolution.ts';
import { AudioSourcePanel } from './AudioSourcePanel.tsx';
import type { PresetCatalogEntry } from './contracts.ts';
import {
  getAudioEnergy,
  subscribeAudioEnergy,
} from './engine-audio-energy-store.ts';
import { PresetArtwork } from './PresetArtwork.tsx';
import { UiIcon } from './UiIcon.tsx';
import { useWorkspace } from './workspace-context.tsx';
import { STIMS_REPO_URL } from './workspace-helpers.ts';

/** `?preset=` from the URL the document loaded with; see deepLinkPresetId. */
const ARRIVAL_PRESET_ID =
  typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('preset');

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

  // The URL the visitor actually arrived on — captured at document load, not
  // component mount. Route state is written to by the app itself (the resume
  // effect below, and engine startup selection once attract mode boots), and
  // reading it here made those writes indistinguishable from a real
  // `?preset=` arrival: a bare "/" visit could auto-start demo audio with no
  // click the moment the startup preset landed in the route.
  const [deepLinkPresetId] = useState(() => ARRIVAL_PRESET_ID);

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
      <div className="stims-shell__launch-center">
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

type DeepLinkState = {
  title: string;
  entry: PresetCatalogEntry | null;
} | null;

// One period is 150 viewBox units (both component frequencies divide it), so
// the CSS drift of -25% of the doubled 600-unit strip loops seamlessly.
const TRACE_PRIMARY =
  'M0,20.0 L6,25.2 L12,27.5 L18,26.6 L24,24.9 L30,25.2 L36,28.1 L42,31.2 L48,31.6 L54,28.2 L60,23.2 L66,19.8 L72,19.4 L78,20.6 L84,20.2 L90,16.8 L96,11.8 L102,8.4 L108,8.8 L114,11.9 L120,14.8 L126,15.1 L132,13.4 L138,12.5 L144,14.8 L150,20.0 L156,25.2 L162,27.5 L168,26.6 L174,24.9 L180,25.2 L186,28.1 L192,31.2 L198,31.6 L204,28.2 L210,23.2 L216,19.8 L222,19.4 L228,20.6 L234,20.2 L240,16.8 L246,11.8 L252,8.4 L258,8.8 L264,11.9 L270,14.8 L276,15.1 L282,13.4 L288,12.5 L294,14.8 L300,20.0 L306,25.2 L312,27.5 L318,26.6 L324,24.9 L330,25.2 L336,28.1 L342,31.2 L348,31.6 L354,28.2 L360,23.2 L366,19.8 L372,19.4 L378,20.6 L384,20.2 L390,16.8 L396,11.8 L402,8.4 L408,8.8 L414,11.9 L420,14.8 L426,15.1 L432,13.4 L438,12.5 L444,14.8 L450,20.0 L456,25.2 L462,27.5 L468,26.6 L474,24.9 L480,25.2 L486,28.1 L492,31.2 L498,31.6 L504,28.2 L510,23.2 L516,19.8 L522,19.4 L528,20.6 L534,20.2 L540,16.8 L546,11.8 L552,8.4 L558,8.8 L564,11.9 L570,14.8 L576,15.1 L582,13.4 L588,12.5 L594,14.8 L600,20.0';
const TRACE_ECHO =
  'M0,30.5 L6,30.2 L12,27.5 L18,25.5 L24,26.2 L30,28.4 L36,29.4 L42,26.8 L48,21.5 L54,16.6 L60,14.7 L66,15.6 L72,16.7 L78,15.4 L84,11.7 L90,8.3 L96,7.9 L102,11.1 L108,15.6 L114,18.3 L120,18.1 L126,16.9 L132,17.8 L138,21.9 L144,27.2 L150,30.5 L156,30.2 L162,27.5 L168,25.5 L174,26.2 L180,28.4 L186,29.4 L192,26.8 L198,21.5 L204,16.6 L210,14.7 L216,15.6 L222,16.7 L228,15.4 L234,11.7 L240,8.3 L246,7.9 L252,11.1 L258,15.6 L264,18.3 L270,18.1 L276,16.9 L282,17.8 L288,21.9 L294,27.2 L300,30.5 L306,30.2 L312,27.5 L318,25.5 L324,26.2 L330,28.4 L336,29.4 L342,26.8 L348,21.5 L354,16.6 L360,14.7 L366,15.6 L372,16.7 L378,15.4 L384,11.7 L390,8.3 L396,7.9 L402,11.1 L408,15.6 L414,18.3 L420,18.1 L426,16.9 L432,17.8 L438,21.9 L444,27.2 L450,30.5 L456,30.2 L462,27.5 L468,25.5 L474,26.2 L480,28.4 L486,29.4 L492,26.8 L498,21.5 L504,16.6 L510,14.7 L516,15.6 L522,16.7 L528,15.4 L534,11.7 L540,8.3 L546,7.9 L552,11.1 L558,15.6 L564,18.3 L570,18.1 L576,16.9 L582,17.8 L588,21.9 L594,27.2 L600,30.5';

/**
 * The product's pitch drawn as a picture: a signal trace and its visual echo,
 * one in each brand accent. Pure CSS drift, so it gives the launch page life
 * on exactly the devices where attract mode is gated off; reduced-motion gets
 * the static trace.
 *
 * Once audio flows (Play demo pressed, or a deep link auto-starting while
 * this header is still up), the trace amplitude follows live energy via the
 * `--stims-energy` custom property — the launch page starts moving to the
 * music before the stage takes over, so the handoff reads as one continuous
 * instrument rather than a page swap.
 */
function LaunchSignalTrace() {
  const traceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const updateEnergy = () => {
      const energy = Math.min(1, Math.max(0, getAudioEnergy()));
      traceRef.current?.style.setProperty('--stims-energy', String(energy));
    };
    updateEnergy();
    return subscribeAudioEnergy(updateEnergy);
  }, []);

  return (
    <div
      className="stims-shell__launch-trace"
      aria-hidden="true"
      ref={traceRef}
    >
      <svg viewBox="0 0 600 40" preserveAspectRatio="none" role="presentation">
        <g className="stims-shell__launch-trace-amp">
          <path
            d={TRACE_ECHO}
            fill="none"
            stroke="var(--stims-cool)"
            strokeWidth="1.4"
            opacity="0.45"
          />
          <path
            d={TRACE_PRIMARY}
            fill="none"
            stroke="var(--stims-accent)"
            strokeWidth="1.6"
          />
        </g>
      </svg>
    </div>
  );
}

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
  return (
    <div className="stims-shell__launch-actions-minimal">
      {resume ? (
        <button
          ref={ctaRef}
          id="use-demo-audio"
          data-demo-audio-btn="true"
          type="button"
          className="stims-shell__launch-cta"
          disabled={!isEngineReady || isStarting}
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
          disabled={!isEngineReady || isStarting}
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

/**
 * The alternatives to the primary CTA, behind a disclosure.
 *
 * The pitch is "press one button and it plays" — but the YouTube field and
 * the four source cards rendered flat underneath the CTA at roughly equal
 * visual weight, so the page offered six ways to start and ranked none of
 * them. Collapsing them restores the ranking without removing anything: the
 * summary names every source inside, so nothing becomes undiscoverable, and
 * a returning visitor's usual source is already the primary button ("Resume
 * with your mic"), which is why this stays closed even for them.
 */
function AudioSources() {
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
