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
            <h1 className="stims-shell__error-heading">Unexpected Error</h1>
            <p className="stims-shell__error-copy">
              Stims encountered an issue. Reload to retry, or try compatibility
              mode.
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
                Try WebGL mode
              </ErrorButton>
              <ErrorButton
                onClick={() => {
                  try {
                    const keys: string[] = [];
                    for (let i = 0; i < window.localStorage.length; i++) {
                      const key = window.localStorage.key(i);
                      if (key?.startsWith('stims:')) {
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
                Reset settings
              </ErrorButton>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
