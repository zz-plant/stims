import { afterEach, expect, mock, test } from 'bun:test';
import { createRoot } from 'react-dom/client';
import { BottomSheet } from '../assets/js/frontend/BottomSheet.tsx';
import { flushTasks } from './test-helpers.ts';

afterEach(() => {
  document.body.innerHTML = '';
});

test('BottomSheet schedules close once for repeated close actions', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const host = document.getElementById('root');
  if (!host) throw new Error('Expected root host');
  const onClose = mock();
  const root = createRoot(host);

  root.render(
    <BottomSheet
      open={true}
      onClose={onClose}
      title="Tools"
      description="Test sheet"
    >
      <button type="button">Child</button>
    </BottomSheet>,
  );
  await flushTasks(2);

  const closeButton = host.querySelector('button[aria-label="Close"]');
  if (!(closeButton instanceof HTMLButtonElement)) {
    throw new Error('Expected close button');
  }
  closeButton.click();
  closeButton.click();
  document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape' }),
  );

  await new Promise((resolve) => setTimeout(resolve, 280));

  expect(onClose).toHaveBeenCalledTimes(1);
  root.unmount();
});
