export interface HintOptions {
  id: string;
  tips: string[];
  title?: string;
  ctaLabel?: string;
  container?: HTMLElement;
  trigger?: 'idle' | 'interaction' | 'manual';
  idleDelayMs?: number;
  manualButton?: {
    container?: HTMLElement | null;
    label?: string;
    className?: string;
  };
}

const STYLE_ID = 'stims-hints-style';
const STORAGE_PREFIX = 'stims.hints.dismissed.';
const DEFAULT_IDLE_DELAY_MS = 1200;

function injectHintStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .stims-hint {
      position: fixed;
      bottom: 12px;
      right: 12px;
      max-width: 340px;
      background: linear-gradient(145deg, rgba(5, 10, 20, 0.95), rgba(12, 20, 38, 0.95));
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.5);
      border-radius: 12px;
      padding: 12px 14px 10px;
      font-family: 'Inter', 'SF Pro Text', system-ui, -apple-system, sans-serif;
      font-size: 0.95rem;
      line-height: 1.4;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      z-index: 9999;
      pointer-events: auto;
    }

    .stims-hint__title {
      margin: 0 0 6px 0;
      font-size: 0.85rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7dd3fc;
    }

    .stims-hint__list {
      margin: 0 0 10px;
      padding-left: 16px;
    }

    .stims-hint__item {
      margin-bottom: 6px;
      color: #f1f5f9;
    }

    .stims-hint__actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .stims-hint__button,
    .stims-hint__dismiss {
      border: none;
      cursor: pointer;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 10px 12px;
      min-height: 44px;
      touch-action: manipulation;
      transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
    }

    .stims-hint__button {
      background: linear-gradient(135deg, #22d3ee, #0ea5e9);
      color: #0b1224;
      box-shadow: 0 6px 18px rgba(14, 165, 233, 0.45);
    }

    .stims-hint__button:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 20px rgba(14, 165, 233, 0.55);
    }

    .stims-hint__dismiss {
      background: rgba(241, 245, 249, 0.08);
      color: #e2e8f0;
      border: 1px solid rgba(148, 163, 184, 0.45);
    }

    .stims-hint__dismiss:hover {
      transform: translateY(-1px);
    }

    .stims-hint__trigger {
      border: 1px solid rgba(125, 211, 252, 0.6);
      background: rgba(15, 23, 42, 0.7);
      color: #e2e8f0;
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
      min-height: 40px;
      touch-action: manipulation;
    }

    .stims-hint__trigger:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 14px rgba(14, 165, 233, 0.3);
    }

    @media (max-width: 600px) {
      .stims-hint {
        left: 12px;
        right: 12px;
        max-width: none;
      }

      .stims-hint__actions {
        flex-wrap: wrap;
      }
    }
  `;
  document.head.appendChild(style);
}

function hasDismissed(id: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${id}`) === 'true';
  } catch (error) {
    console.warn('Hint storage unavailable', error);
    return false;
  }
}

function setDismissed(id: string) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${id}`, 'true');
  } catch (error) {
    console.warn('Unable to persist hint dismissal', error);
  }
}

export function initHints({
  id,
  tips,
  title = 'Quick tips',
  ctaLabel = 'Got it',
  container = document.body,
  trigger = 'interaction',
  idleDelayMs = DEFAULT_IDLE_DELAY_MS,
  manualButton,
}: HintOptions): void {
  if (!tips?.length || hasDismissed(id)) return;
  injectHintStyles();

  const doc = container.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  const hintId = `stims-hint-${id}`;
  let hintElement: HTMLElement | null = null;
  let idleTimeout: number | null = null;
  let manualButtonElement: HTMLButtonElement | null = null;

  const cleanupManualButton = () => {
    manualButtonElement?.remove();
    manualButtonElement = null;
  };

  const renderHint = () => {
    if (hintElement || hasDismissed(id)) return;

    const wrapper = doc.createElement('section');
    wrapper.className = 'stims-hint';
    wrapper.id = hintId;
    wrapper.role = 'status';
    wrapper.setAttribute('aria-live', 'polite');

    const heading = doc.createElement('h2');
    heading.className = 'stims-hint__title';
    heading.textContent = title;
    wrapper.appendChild(heading);

    const list = doc.createElement('ul');
    list.className = 'stims-hint__list';
    tips.forEach((tip) => {
      const item = doc.createElement('li');
      item.className = 'stims-hint__item';
      item.textContent = tip;
      list.appendChild(item);
    });
    wrapper.appendChild(list);

    const actions = doc.createElement('div');
    actions.className = 'stims-hint__actions';

    const confirm = doc.createElement('button');
    confirm.className = 'stims-hint__button';
    confirm.type = 'button';
    confirm.textContent = ctaLabel;
    confirm.addEventListener('click', () => {
      wrapper.remove();
      hintElement = null;
    });

    const dismiss = doc.createElement('button');
    dismiss.className = 'stims-hint__dismiss';
    dismiss.type = 'button';
    dismiss.textContent = "Don't show again";
    dismiss.addEventListener('click', () => {
      setDismissed(id);
      wrapper.remove();
      hintElement = null;
      cleanupManualButton();
    });

    actions.appendChild(confirm);
    actions.appendChild(dismiss);
    wrapper.appendChild(actions);

    container.appendChild(wrapper);
    hintElement = wrapper;
  };

  if (manualButton?.container) {
    manualButtonElement = doc.createElement('button');
    manualButtonElement.type = 'button';
    manualButtonElement.textContent = manualButton.label ?? 'Need tips?';
    manualButtonElement.className =
      manualButton.className ?? 'stims-hint__trigger';
    manualButtonElement.setAttribute('aria-controls', hintId);
    manualButtonElement.addEventListener('click', () => {
      renderHint();
    });
    manualButton.container.appendChild(manualButtonElement);
  }

  const removeInteractionListeners = (handler: () => void) => {
    doc.removeEventListener('pointerdown', handler);
    doc.removeEventListener('keydown', handler);
  };

  const handleFirstInteraction = () => {
    removeInteractionListeners(handleFirstInteraction);
    if (trigger === 'interaction') {
      renderHint();
      return;
    }
    if (trigger === 'idle') {
      if (idleTimeout !== null) return;
      idleTimeout = win.setTimeout(() => {
        idleTimeout = null;
        renderHint();
      }, idleDelayMs);
    }
  };

  if (trigger === 'interaction' || trigger === 'idle') {
    doc.addEventListener('pointerdown', handleFirstInteraction, {
      passive: true,
    });
    doc.addEventListener('keydown', handleFirstInteraction);
  }
}
