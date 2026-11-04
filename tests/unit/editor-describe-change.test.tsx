import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import { EditorDescribeChange } from '../../src/js/frontend/EditorDescribeChange.tsx';
import { renderWorkspace } from '../frontend-harness.tsx';

const SOURCE = ['title=Alpha', 'zoom=1.000', 'rot=0.000'].join('\n');
const CHANGED = ['title=Alpha', 'zoom=1.500', 'rot=0.000'].join('\n');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answerWith(response: Response) {
  const fetchMock = mock(async () => response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function mount() {
  const onChange = mock((_source: string) => {});
  const rendered = renderWorkspace(
    <EditorDescribeChange source={SOURCE} onChange={onChange} />,
  );
  const input = () =>
    rendered.container.querySelector<HTMLInputElement>(
      '.stims-editor-describe__input',
    );
  const type = (value: string) =>
    act(() => {
      const field = input();
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set?.call(field, value);
      field?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  const submit = () =>
    act(async () => {
      rendered.container
        .querySelector('form')
        ?.dispatchEvent(
          new window.Event('submit', { bubbles: true, cancelable: true }),
        );
    });
  const button = (name: string) =>
    [...rendered.container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === name,
    );
  return { rendered, onChange, input, type, submit, button };
}

describe('describing a change from the editor', () => {
  test('says what gets sent only once there is something to send', () => {
    const { rendered, type } = mount();
    try {
      expect(rendered.container.textContent).not.toContain('AI model');
      type('more blue');
      expect(rendered.container.textContent).toContain(
        'Sends this preset’s code to the AI model.',
      );
    } finally {
      rendered.dispose();
    }
  });

  test('sends the running source and applies the answer only on Apply', async () => {
    const fetchMock = answerWith(
      new Response(JSON.stringify({ milkSource: CHANGED })),
    );
    const { rendered, onChange, type, submit, button } = mount();
    try {
      type('zoom in');
      await submit();
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe('/api/refine-preset');
      expect(JSON.parse(String(init.body))).toEqual({
        currentSource: SOURCE,
        instruction: 'zoom in',
      });
      expect(onChange).not.toHaveBeenCalled();
      expect(
        rendered.container.querySelector('.stims-shell__refine-diff'),
      ).not.toBeNull();

      act(() => button('Apply')?.click());
      expect(onChange).toHaveBeenCalledWith(CHANGED);
      expect(
        rendered.container.querySelector('.stims-shell__refine-diff'),
      ).toBeNull();
    } finally {
      rendered.dispose();
    }
  });

  test('sends nothing for an empty field', async () => {
    const fetchMock = answerWith(new Response('{}'));
    const { rendered, submit } = mount();
    try {
      await submit();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      rendered.dispose();
    }
  });

  test('without the AI service it says so and names what still works', async () => {
    answerWith(new Response('nope', { status: 500 }));
    const { rendered, onChange, type, submit } = mount();
    try {
      type('something no keyword matches');
      await submit();
      expect(onChange).not.toHaveBeenCalled();
      expect(rendered.container.textContent).toContain('AI is unavailable');
      expect(rendered.container.textContent).toContain(
        'You can still edit the code directly.',
      );
    } finally {
      rendered.dispose();
    }
  });
});
