import type { ErrorInfo, ReactNode } from 'react';
import { Component, useState } from 'react';

function ErrorButton({
  onClick,
  children,
  primary = false,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setActive(false);
      }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        margin: '4px',
        padding: '12px 24px',
        background: primary ? '#5fc0b5' : 'rgba(255, 255, 255, 0.06)',
        color: primary ? '#0a0f19' : '#e9fbff',
        border: primary ? 'none' : '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '0.9rem',
        fontWeight: 500,
        letterSpacing: '0.01em',
        transition: 'all 150ms ease',
        transform: active ? 'scale(0.97)' : hover ? 'scale(1.02)' : 'scale(1)',
        opacity: hover ? 0.95 : 1,
        boxShadow:
          primary && hover ? '0 0 16px rgba(95, 192, 181, 0.4)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

export class StimsErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Stims crashed:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          className="stims-shell"
          style={{
            display: 'grid',
            placeItems: 'center',
            height: '100vh',
            background:
              'radial-gradient(circle at 30% 20%, rgba(95, 192, 181, 0.08), transparent 50%), radial-gradient(circle at 70% 80%, rgba(211, 137, 84, 0.06), transparent 50%), #0a0f19',
            color: '#e9fbff',
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            textAlign: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '20px',
              padding: '32px 40px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'rgba(255, 123, 114, 0.1)',
                border: '1px solid rgba(255, 123, 114, 0.2)',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 16px',
                color: '#ff7b72',
                fontSize: '1.4rem',
                fontWeight: 'bold',
              }}
            >
              ⚠
            </div>
            <h1
              style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                marginBottom: '8px',
                color: '#ff7b72',
              }}
            >
              Unexpected Error
            </h1>
            <p
              style={{
                opacity: 0.8,
                fontSize: '0.95rem',
                margin: '0 0 24px',
                lineHeight: 1.5,
              }}
            >
              Stims encountered an issue. Reload to retry, or try compatibility
              mode.
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '16px',
              }}
            >
              <ErrorButton primary onClick={() => window.location.reload()}>
                Reload page
              </ErrorButton>
              <ErrorButton
                onClick={() => {
                  try {
                    window.sessionStorage.removeItem(
                      'stims:webgpu-compat-override',
                    );
                  } catch {}
                  try {
                    window.localStorage.setItem(
                      'stims:compatibility-mode',
                      'true',
                    );
                  } catch {}
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
                  } catch {}
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
