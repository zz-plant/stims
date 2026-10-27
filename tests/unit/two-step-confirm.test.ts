import { describe, expect, mock, test } from 'bun:test';
import { attachTwoStepConfirm } from '../../src/js/core/two-step-confirm.ts';

function makeButton(label: string) {
  const button = document.createElement('button');
  button.textContent = label;
  button.setAttribute('aria-label', label);
  document.body.append(button);
  return button;
}

describe('two-step confirm', () => {
  test('the first press only relabels; the second runs the action', () => {
    const button = makeButton('Delete preset');
    const onConfirm = mock();
    attachTwoStepConfirm(button, {
      confirmLabel: 'Delete for good',
      onConfirm,
    });

    button.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Delete for good');
    expect(button.getAttribute('aria-label')).toBe('Delete for good');
    expect(button.dataset.armed).toBe('true');

    button.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Delete preset');
    expect(button.dataset.armed).toBeUndefined();
    button.remove();
  });

  test('disarms on its own, on blur and on Escape', async () => {
    const button = makeButton('Delete');
    const onConfirm = mock();
    attachTwoStepConfirm(button, {
      confirmLabel: 'Delete for good',
      onConfirm,
      timeoutMs: 20,
    });

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(button.textContent).toBe('Delete');
    button.click();
    expect(onConfirm).not.toHaveBeenCalled();

    button.dispatchEvent(new window.FocusEvent('blur'));
    expect(button.textContent).toBe('Delete');

    button.click();
    button.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(button.textContent).toBe('Delete');
    expect(onConfirm).not.toHaveBeenCalled();
    button.remove();
  });
});
