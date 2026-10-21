import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { UiIcon } from './UiIcon.tsx';

function ErrorButton({
  onClick,
  children,
  primary = false,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`stims-shell__error-btn${primary ? ' stims-shell__error-btn--primary' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * Things the visitor made rather than chose, kept by Reset settings. The
 * reset used to clear every `stims:` key, so a visitor who pressed it to get
 * past a crash also lost their saved versions, preset sets, queue, perform
 * pins and MIDI mappings, with nothing on the button saying so. Edited
 * presets, drafts and favourites live in IndexedDB and were never touched.
 */
const USER_WORK_KEY_PREFIXES = [
  'stims:versions:',
  'stims:preset-sets:',
  'stims:preset-queue:',
  'stims:perform-pins:',
  'stims:midi-state:',
];

export class StimsErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; copyStatus: 'idle' | 'copied' | 'failed' }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, copyStatus: 'idle' };
  }
  static getDerivedStateFromError(error: Error) {
    return { error, copyStatus: 'idle' as const };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Stims crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="stims-shell stims-shell__error-boundary">
          <div className="stims-shell__error-card">
            <div className="stims-shell__error-icon">
              <UiIcon
                name="warning"
                className="stims-icon-slot stims-icon-slot--md"
              />
            </div>
            <h1 className="stims-shell__error-heading">Unexpected error</h1>
            <p className="stims-shell__error-copy">
              Something in Stims broke. Your edits and saved presets are kept.
              Reload to try again; if it happens again, switch to the WebGL
              renderer, which works on more graphics hardware.
            </p>
            {this.state.error && (
              <details className="stims-shell__error-details">
                <summary className="stims-shell__error-details-summary">
                  Error details ({this.state.error.name})
                </summary>
                <pre className="stims-shell__error-stack">
                  {this.state.error.stack?.trim() ||
                    `${this.state.error.name}: ${this.state.error.message}`}
                </pre>
              </details>
            )}
            <div className="stims-shell__error-actions">
              <ErrorButton primary onClick={() => window.location.reload()}>
                Reload page
              </ErrorButton>
              <ErrorButton
                onClick={async () => {
                  const error = this.state.error;
                  const clipboard = globalThis.navigator?.clipboard;
                  if (!error || !clipboard?.writeText) {
                    this.setState({ copyStatus: 'failed' });
                    return;
                  }
                  const text =
                    error.stack?.trim() || `${error.name}: ${error.message}`;
                  try {
                    await clipboard.writeText(text);
                    this.setState({ copyStatus: 'copied' });
                  } catch (err) {
                    this.setState({ copyStatus: 'failed' });
                    console.warn(
                      'Could not copy error details to clipboard:',
                      err,
                    );
                  }
                }}
              >
                {this.state.copyStatus === 'copied'
                  ? 'Copied error details'
                  : this.state.copyStatus === 'failed'
                    ? 'Copy unavailable'
                    : 'Copy error details'}
              </ErrorButton>
              <ErrorButton
                onClick={() => {
                  try {
                    window.sessionStorage.removeItem(
                      'stims:webgpu-compat-override',
                    );
                  } catch (error) {
                    console.warn(
                      'Failed to clear sessionStorage override:',
                      error,
                    );
                  }
                  try {
                    window.localStorage.setItem(
                      'stims:compatibility-mode',
                      'true',
                    );
                  } catch (error) {
                    console.warn('Failed to enable compatibility mode:', error);
                  }
                  window.location.reload();
                }}
              >
                Reload with WebGL
              </ErrorButton>
              <ErrorButton
                onClick={() => {
                  try {
                    const keys: string[] = [];
                    for (let i = 0; i < window.localStorage.length; i++) {
                      const key = window.localStorage.key(i);
                      if (
                        key?.startsWith('stims:') &&
                        !USER_WORK_KEY_PREFIXES.some((prefix) =>
                          key.startsWith(prefix),
                        )
                      ) {
                        keys.push(key);
                      }
                    }
                    keys.forEach((key) => window.localStorage.removeItem(key));
                    window.sessionStorage.removeItem(
                      'stims:webgpu-compat-override',
                    );
                  } catch (error) {
                    console.warn(
                      'Failed to reset localStorage settings:',
                      error,
                    );
                  }
                  window.location.href = '/';
                }}
              >
                Reset settings (keeps your work)
              </ErrorButton>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
