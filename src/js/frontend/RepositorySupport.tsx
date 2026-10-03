import { useState } from 'react';
import '../../css/repository-support.css';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import { readStored, writeStored } from '../core/state/browser-storage.ts';
import { STIMS_REPO_URL } from './workspace-helpers.ts';

const DISMISSED_KEY = 'stims:repository-support-dismissed';

/** Mounted by a successful share or video save, never by an attempted action. */
export function RepositorySupport() {
  const [dismissed, setDismissed] = useState(
    () => readStored(DISMISSED_KEY) === '1',
  );
  if (dismissed) return null;
  return (
    <aside className="stims-repository-support" aria-label="Support Stims">
      <p>Enjoying Stims? A GitHub star helps people find it.</p>
      <div>
        <a
          href={STIMS_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => noteGrowthEvent('github-clicked')}
        >
          Star Stims on GitHub ↗
        </a>
        <button
          type="button"
          aria-label="Dismiss GitHub suggestion"
          onClick={() => {
            writeStored(DISMISSED_KEY, '1');
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
