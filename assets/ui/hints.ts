export interface HintOptions {
  id: string;
  tips: string[];
  title?: string;
  ctaLabel?: string;
  container?: HTMLElement;
}

const STYLE_ID = 'stims-hints-style';
const STORAGE_PREFIX = 'stims.hints.dismissed.';

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
      font-size: 14px;
      line-height: 1.4;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      z-index: 9999;
      pointer-events: auto;
    }

    .stims-hint__title {
      margin: 0 0 6px 0;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #67e8f9;
    }

    .stims-hint__list {
      margin: 0 0 10px;
      padding-left: 16px;
    }

    .stims-hint__item {
      margin-bottom: 6px;
      color: #e2e8f0;
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
      font-size: 12px;
      font-weight: 600;
      padding: 8px 10px;
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
  ctaLabel = "Got it",
  container = document.body,
}: HintOptions): void {
  if (!tips?.length || hasDismissed(id)) return;
  injectHintStyles();

  const wrapper = document.createElement('section');
  wrapper.className = 'stims-hint';
  wrapper.role = 'status';
  wrapper.setAttribute('aria-live', 'polite');

  const heading = document.createElement('h2');
  heading.className = 'stims-hint__title';
  heading.textContent = title;
  wrapper.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'stims-hint__list';
  tips.forEach((tip) => {
    const item = document.createElement('li');
    item.className = 'stims-hint__item';
    item.textContent = tip;
    list.appendChild(item);
  });
  wrapper.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'stims-hint__actions';

  const confirm = document.createElement('button');
  confirm.className = 'stims-hint__button';
  confirm.type = 'button';
  confirm.textContent = ctaLabel;
  confirm.addEventListener('click', () => {
    setDismissed(id);
    wrapper.remove();
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'stims-hint__dismiss';
  dismiss.type = 'button';
  dismiss.textContent = "Don't show again";
  dismiss.addEventListener('click', () => {
    setDismissed(id);
    wrapper.remove();
  });

  actions.appendChild(confirm);
  actions.appendChild(dismiss);
  wrapper.appendChild(actions);

  container.appendChild(wrapper);
}
