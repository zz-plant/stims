/**
 * LL-01 reference finder: find an editable starting preset from a reference
 * description (and optionally validate the shortlist against a reference
 * image with Clef), then record an explicit outcome episode.
 *
 * Retrieval runs entirely on the device (the static EmbeddingGemma 2 preview
 * vectors and the same text scorer Browse uses), so it works offline and
 * while any hosted service is down. The image is sent to the hosted Clef
 * service only when the user clicks "Ask Clef to pick", and is retained on
 * this device only when the user checks the retention box. Outcome episodes
 * are recorded in the bounded local store (LL-00): proposal shown, applied,
 * and an explicit accept or reject. Accepted references are offered again so
 * the workflow exercises reuse of an accepted episode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../css/ReferenceFinderPanel.module.css';
import {
  createLearningLoopStore,
  type EpisodeStore,
  LEARNING_LOOP_SCHEMA_VERSION,
  type LearningLoopEpisode,
  newEpisodeId,
  newSessionId,
} from '../core/services/learning-loop-store.ts';
import { resolveOptionalApiUrl } from '../core/services/optional-api.ts';
import {
  chooseReferenceWithClef,
  type ReferenceShortlist,
  retrieveReferenceCandidates,
} from './reference-retrieval.ts';
import { useWorkspace } from './workspace-context.tsx';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const RECENT_REFERENCES_LIMIT = 5;
const ACTIVE_EPISODE_KEY = 'stims:active-reference-episode';

function readActiveEpisodeId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_EPISODE_KEY);
  } catch {
    return null;
  }
}

function writeActiveEpisodeId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(ACTIVE_EPISODE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_EPISODE_KEY);
  } catch {
    // Storage unavailable: the outcome buttons just stay tied to this mount.
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function toFileList(milkSource: string, name: string): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(new File([milkSource], name));
  return transfer.files;
}

const episodeStore: EpisodeStore = createLearningLoopStore();

export function ReferenceFinderPanel({
  offline = false,
}: {
  offline?: boolean;
}) {
  const { engine, ui } = useWorkspace();
  const sessionIdRef = useRef<string | null>(null);
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [retainImage, setRetainImage] = useState(false);
  const [shortlist, setShortlist] = useState<ReferenceShortlist | null>(null);
  const [clefPickId, setClefPickId] = useState<string | null>(null);
  const [status, setStatus] = useState(
    'Describe the look you want; Stims finds editable starting presets on this device.',
  );
  const [finding, setFinding] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [currentEpisodeId, setCurrentEpisodeId] = useState<string | null>(null);
  /** True once the current episode's starting point was opened in the editor;
   * the accept/reject question is only meaningful after that. */
  const [activeApplied, setActiveApplied] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  const [recent, setRecent] = useState<LearningLoopEpisode[]>([]);
  const runRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  const hostedAvailable =
    !offline && Boolean(resolveOptionalApiUrl('/api/decide'));

  const refreshRecent = useCallback(async () => {
    const episodes = await episodeStore.list();
    const reusable = episodes
      .filter((episode) =>
        episode.outcomes.some(
          (event) => event.kind === 'accepted' || event.kind === 'rejected',
        ),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .slice(0, RECENT_REFERENCES_LIMIT);
    if (aliveRef.current) setRecent(reusable);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // An episode survives the panel closing behind the editor: restore its
    // outcome buttons so accept/reject can be recorded after the edit.
    const activeId = readActiveEpisodeId();
    if (activeId) {
      void episodeStore.get(activeId).then((episode) => {
        if (
          aliveRef.current &&
          episode &&
          !episode.outcomes.some(
            (event) => event.kind === 'accepted' || event.kind === 'rejected',
          )
        ) {
          const applied = episode.outcomes.some(
            (event) => event.kind === 'applied',
          );
          setCurrentEpisodeId(episode.id);
          setActiveApplied(applied);
          if (applied) {
            setStatus(
              'Your last starting point is waiting for a verdict below.',
            );
          }
        }
      });
    }
    void refreshRecent();
    return () => {
      aliveRef.current = false;
      controllerRef.current?.abort();
    };
  }, [refreshRecent]);

  const recordOutcome = useCallback(
    async (kind: 'accepted' | 'rejected') => {
      if (!currentEpisodeId) {
        setStatus('Nothing is open yet to accept or reject.');
        return;
      }
      const result = await episodeStore.appendOutcome(currentEpisodeId, {
        kind,
        at: new Date().toISOString(),
      });
      writeActiveEpisodeId(null);
      setCurrentEpisodeId(null);
      setActiveApplied(false);
      setNotSaved(!result.persisted);
      await refreshRecent();
      setStatus(
        result.persisted
          ? kind === 'accepted'
            ? 'Saved: this reference now seeds future searches.'
            : 'Saved: this reference is a rejected example, not a success.'
          : 'Outcome could not be saved to this device; it stays in memory for this session.',
      );
    },
    [currentEpisodeId, refreshRecent],
  );

  const handleFind = useCallback(
    async (parentEpisodeId?: string, queryOverride?: string) => {
      const query = (queryOverride ?? description).trim();
      if (!query) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const runId = ++runRef.current;
      const isCurrent = () => aliveRef.current && runId === runRef.current;
      setFinding(true);
      setShortlist(null);
      setClefPickId(null);
      setActiveApplied(false);
      setNotSaved(false);
      setStatus('Searching the catalog on this device…');
      const attempt = async () => {
        const found = await retrieveReferenceCandidates(query, engine.catalog, {
          topK: 8,
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        if (found.empty) {
          setStatus(
            'No catalog preset plausibly matches that reference. Try different wording, or browse normally.',
          );
          return;
        }
        // Episode created when the proposal is shown; the outcome is
        // unreviewed until the user acts.
        sessionIdRef.current ??= newSessionId();
        const imageArtifactId =
          imageFile && retainImage ? `ref-${Date.now()}` : undefined;
        const imageDataUrl =
          imageArtifactId && imageFile ? await fileToBase64(imageFile) : null;
        if (!isCurrent()) return;
        const now = new Date().toISOString();
        const episode: LearningLoopEpisode = {
          schemaVersion: LEARNING_LOOP_SCHEMA_VERSION,
          id: newEpisodeId(),
          loop: 'reference-remix',
          ...(parentEpisodeId ? { parentEpisodeId } : {}),
          createdAt: now,
          sessionId: sessionIdRef.current,
          intent: {
            request: query,
            preserve: [],
            annotations: [
              { label: 'reference-request', source: 'user' as const },
              ...(imageFile
                ? [
                    {
                      label: 'reference-image' as const,
                      source: 'user' as const,
                    },
                  ]
                : []),
            ],
            ...(imageArtifactId
              ? { referenceArtifactIds: [imageArtifactId] }
              : {}),
          },
          source: {
            sourceRefs: found.candidates.map((candidate) => candidate.presetId),
          },
          outcomes: [{ kind: 'proposal-shown' as const, at: now }],
          ownership: {
            origin: 'local',
            retainedConsent: retainImage,
          },
          reference: {
            kind: imageFile ? 'image' : 'description',
            description: query,
            ...(imageArtifactId ? { imageArtifactId } : {}),
          },
          ...(imageArtifactId && imageDataUrl
            ? { artifacts: { [imageArtifactId]: imageDataUrl } }
            : {}),
        };
        const result = await episodeStore.put(episode);
        if (!isCurrent()) return;
        writeActiveEpisodeId(episode.id);
        setNotSaved(!result.persisted);
        setCurrentEpisodeId(episode.id);
        setShortlist(found);
        const chosenCount = found.candidates.filter(
          (candidate) => candidate.reason !== 'visual',
        ).length;
        const total = found.candidates.length;
        const status =
          chosenCount === 0
            ? `${total} starting point${total === 1 ? '' : 's'} found that look like your reference. Open one to edit.`
            : chosenCount === total
              ? `${total} starting point${total === 1 ? '' : 's'} found — all name your reference. Open one to edit.`
              : `${total} starting point${total === 1 ? '' : 's'} found — ${chosenCount} name your reference, the rest just look like it. Open one to edit.`;
        setStatus(status);
      };
      try {
        await attempt();
      } catch (error) {
        if (isCurrent() && !controller.signal.aborted) {
          setStatus(
            `Search failed: ${error instanceof Error ? error.message : 'try again later'}`,
          );
        }
      }
      if (isCurrent()) setFinding(false);
    },
    [description, engine.catalog, imageFile, retainImage],
  );

  const handleClefPick = useCallback(async () => {
    if (
      !imageFile ||
      !shortlist ||
      shortlist.candidates.length === 0 ||
      selecting
    ) {
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const runId = ++runRef.current;
    const isCurrent = () => aliveRef.current && runId === runRef.current;
    setSelecting(true);
    setClefPickId(null);
    setStatus('Sending your reference image and candidate list to Clef…');
    const attempt = async () => {
      const image = await fileToBase64(imageFile);
      if (!isCurrent()) return;
      const outcome = await chooseReferenceWithClef({
        image,
        description: description.trim(),
        candidates: shortlist.candidates,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (outcome.kind === 'chosen') {
        setClefPickId(outcome.presetId);
        setStatus(
          'Clef picked the closest starting point below. A similarity judgment is not a promise the preset reproduces your reference.',
        );
      } else if (outcome.kind === 'abstained') {
        setStatus(
          'Clef abstained: none of the candidates plausibly matches your reference image, or the image was unclear. The list below is kept for you to judge.',
        );
      } else {
        setStatus(outcome.message);
      }
    };
    try {
      await attempt();
    } catch (error) {
      if (isCurrent() && !controller.signal.aborted) {
        setStatus(
          `Clef selection failed: ${error instanceof Error ? error.message : 'try again later'}`,
        );
      }
    }
    if (isCurrent()) setSelecting(false);
  }, [imageFile, shortlist, description, selecting]);

  const handleOpen = useCallback(
    async (candidate: ReferenceShortlist['candidates'][number]) => {
      const entry = candidate.entry;
      if (!entry) {
        setStatus('That preset has no bundled source to open.');
        return;
      }
      const sourcePath = entry.bundledFile ?? entry.file;
      if (!sourcePath) {
        setStatus('That preset has no bundled source to open.');
        return;
      }
      const runId = ++runRef.current;
      const isCurrent = () => aliveRef.current && runId === runRef.current;
      setOpeningId(candidate.presetId);
      setStatus(`Opening ${entry.title} as a starting point…`);
      const attempt = async () => {
        const response = await fetch(sourcePath);
        if (!response.ok) {
          throw new Error(`Source file responded ${response.status}.`);
        }
        const milkSource = await response.text();
        if (!isCurrent()) return;
        await engine.importPresetFiles(
          toFileList(milkSource, `${candidate.presetId}.milk`),
        );
        if (!isCurrent()) return;
        if (currentEpisodeId) {
          const result = await episodeStore.appendOutcome(currentEpisodeId, {
            kind: 'applied',
            at: new Date().toISOString(),
          });
          setNotSaved(!result.persisted);
        }
        if (!isCurrent()) return;
        setActiveApplied(true);
        // The panel unmounts when the editor opens, so the question the user
        // has to answer lives on the stage toast and returns with the panel.
        const message = `${entry.title} is open in the editor. Does this starting point work for you?`;
        setStatus(message);
        ui.setStatusMessage(message);
        ui.updatePanel('editor');
      };
      try {
        await attempt();
      } catch (error) {
        if (isCurrent()) {
          setStatus(
            `Could not open ${entry.title}: ${error instanceof Error ? error.message : 'try again later'}`,
          );
        }
      }
      if (isCurrent()) setOpeningId(null);
    },
    [currentEpisodeId, engine, ui],
  );

  const handleReuse = useCallback(
    (episode: LearningLoopEpisode) => {
      setDescription(episode.reference.description);
      setImageFile(null);
      setRetainImage(false);
      void handleFind(episode.id, episode.reference.description);
    },
    [handleFind],
  );

  const handleImageChange = useCallback((file: File | null) => {
    if (file && file.size > MAX_IMAGE_BYTES) {
      setImageFile(null);
      setStatus('Reference images must be 4 MB or smaller.');
      return;
    }
    setImageFile(file);
    if (file) {
      setStatus(
        'Your reference image is sent to the hosted Clef service only when you click "Ask Clef to pick", and is not kept on this device unless you check the box below.',
      );
    }
  }, []);

  const working = finding || selecting || openingId !== null;
  const imageBase64Ready = imageFile !== null;

  return (
    <section className={styles.panel}>
      <p className={styles.intro}>
        Find an editable starting preset that matches a look you describe.
        Search happens on this device; nothing is sent unless you ask Clef to
        check an image.
      </p>

      <label className={styles.field}>
        <span className={styles.label}>Reference description</span>
        <textarea
          className={styles.textarea}
          placeholder="e.g., a slow neon tunnel with a warm palette"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          disabled={working}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>
          Reference image (optional{imageFile ? `: ${imageFile.name}` : ''})
        </span>
        <input
          className={styles.input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) =>
            handleImageChange(event.target.files?.[0] ?? null)
          }
          disabled={working}
        />
      </label>

      {imageFile ? (
        <label className={styles.retain}>
          <input
            type="checkbox"
            checked={retainImage}
            onChange={(event) => setRetainImage(event.target.checked)}
            disabled={working}
          />
          <span>
            Keep my reference image on this device (counts toward the local
            episode budget)
          </span>
        </label>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void handleFind()}
          disabled={working || !description.trim()}
        >
          {finding ? 'Searching…' : 'Find starting points'}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void handleClefPick()}
          disabled={
            working ||
            !imageBase64Ready ||
            !shortlist ||
            shortlist.candidates.length === 0 ||
            !hostedAvailable
          }
        >
          {selecting ? 'Asking Clef…' : 'Ask Clef to pick'}
        </button>
      </div>

      {imageFile && !hostedAvailable ? (
        <p className={styles.hint}>
          Clef selection needs the hosted decision service and a connection; the
          on-device list still works offline.
        </p>
      ) : null}

      {!imageFile && shortlist && hostedAvailable ? (
        <p className={styles.hint}>
          Ask Clef to pick needs a reference image to judge against; without
          one, the on-device ranking stands.
        </p>
      ) : null}

      {shortlist ? (
        <>
          <ul className={styles.results}>
            {shortlist.candidates.map((candidate, index) => (
              <li key={candidate.presetId} className={styles.item}>
                <div className={styles.itemMain}>
                  <span
                    className={styles.rank}
                    role="img"
                    aria-label={
                      clefPickId === candidate.presetId
                        ? `Clef's pick, rank ${index + 1}`
                        : `Rank ${index + 1}`
                    }
                  >
                    {clefPickId === candidate.presetId ? '★' : index + 1}
                  </span>
                  <div className={styles.itemText}>
                    <span className={styles.title}>
                      {candidate.entry?.title ?? candidate.presetId}
                    </span>
                    <span className={styles.reason}>
                      {candidate.reason === 'text'
                        ? 'names your reference'
                        : candidate.reason === 'visual'
                          ? 'looks like your reference'
                          : 'names and looks like your reference'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.open}
                  onClick={() => void handleOpen(candidate)}
                  disabled={working}
                >
                  {openingId === candidate.presetId
                    ? 'Opening…'
                    : 'Open as starting point'}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {currentEpisodeId && activeApplied ? (
        <div className={styles.outcome}>
          <p className={styles.hint}>
            {notSaved
              ? 'Outcome not saved to this device (local store full or unavailable).'
              : 'Did this starting point work for you?'}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.accept}
              onClick={() => void recordOutcome('accepted')}
              disabled={working}
            >
              This works
            </button>
            <button
              type="button"
              className={styles.reject}
              onClick={() => void recordOutcome('rejected')}
              disabled={working}
            >
              Not this one
            </button>
          </div>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <details className={styles.recent}>
          <summary className={styles.recentSummary}>
            Reuse an earlier reference
          </summary>
          <ul className={styles.recentList}>
            {recent.map((episode) => (
              <li key={episode.id}>
                <button
                  type="button"
                  className={styles.recentItem}
                  onClick={() => handleReuse(episode)}
                  disabled={working}
                >
                  <span className={styles.recentText}>
                    {episode.reference.description}
                  </span>
                  <span className={styles.recentBadge}>
                    {episode.outcomes.some((event) => event.kind === 'accepted')
                      ? 'worked'
                      : 'rejected'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
