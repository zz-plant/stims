import { useEffect, useRef, useState } from 'react';
import {
  createTwoStepConfirm,
  type TwoStepConfirm,
} from '../../core/two-step-confirm.ts';

/**
 * React face of `core/two-step-confirm.ts`: render `armed` to swap the
 * button's label, call `press` from onClick, and `disarm` from onBlur.
 * The latest `onConfirm` runs, so it may close over render state.
 */
export function useTwoStepConfirm(onConfirm: () => void, timeoutMs?: number) {
  const [armed, setArmed] = useState(false);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const confirmRef = useRef<TwoStepConfirm | null>(null);
  if (!confirmRef.current) {
    confirmRef.current = createTwoStepConfirm({
      onConfirm: () => onConfirmRef.current(),
      onChange: (state) => setArmed(state.armed),
      timeoutMs,
    });
  }
  useEffect(() => () => confirmRef.current?.dispose(), []);
  const confirm = confirmRef.current;
  return {
    armed,
    press: confirm.press,
    disarm: confirm.disarm,
  };
}
