/**
 * A destructive button that asks once, in place.
 *
 * The first press relabels the button with what the second press will do
 * ("Delete for good"); a second press within the window does it, and the
 * button goes back to its label on its own after the window, on blur, or on
 * Escape. No dialog: a confirmation that opens somewhere else is easy to
 * dismiss without reading, and the deletes this guards are one click from
 * where the user is looking.
 *
 * Framework-free so the DOM-built editor panel and React share one
 * behaviour; `frontend/hooks/use-two-step-confirm.ts` wraps it for React.
 */

export const TWO_STEP_CONFIRM_MS = 4000;

export type TwoStepConfirmState = {
  armed: boolean;
};

export type TwoStepConfirm = {
  /** First press arms; a press while armed runs the action and disarms. */
  press: () => void;
  disarm: () => void;
  isArmed: () => boolean;
  dispose: () => void;
};

export function createTwoStepConfirm({
  onConfirm,
  onChange,
  timeoutMs = TWO_STEP_CONFIRM_MS,
}: {
  onConfirm: () => void;
  onChange: (state: TwoStepConfirmState) => void;
  timeoutMs?: number;
}): TwoStepConfirm {
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const set = (next: boolean) => {
    if (armed === next) return;
    armed = next;
    onChange({ armed });
  };
  const disarm = () => {
    clear();
    set(false);
  };

  return {
    press() {
      if (armed) {
        disarm();
        onConfirm();
        return;
      }
      set(true);
      clear();
      timer = setTimeout(disarm, timeoutMs);
    },
    disarm,
    isArmed: () => armed,
    dispose: clear,
  };
}

/**
 * Wires a two-step confirm onto a DOM button: swaps its label (and
 * aria-label, when it has one) while armed, marks it `data-armed`, and
 * disarms on blur and Escape. Returns the controller; call `dispose` when
 * the button goes away.
 */
export function attachTwoStepConfirm(
  button: HTMLButtonElement,
  {
    confirmLabel,
    onConfirm,
    timeoutMs,
  }: { confirmLabel: string; onConfirm: () => void; timeoutMs?: number },
): TwoStepConfirm {
  const idleText = button.textContent ?? '';
  const idleAria = button.getAttribute('aria-label');
  const confirm = createTwoStepConfirm({
    onConfirm,
    timeoutMs,
    onChange: ({ armed }) => {
      button.textContent = armed ? confirmLabel : idleText;
      if (idleAria !== null) {
        button.setAttribute('aria-label', armed ? confirmLabel : idleAria);
      }
      if (armed) button.dataset.armed = 'true';
      else delete button.dataset.armed;
    },
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    confirm.press();
  });
  button.addEventListener('blur', () => confirm.disarm());
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && confirm.isArmed()) {
      event.stopPropagation();
      confirm.disarm();
    }
  });
  return confirm;
}
