/**
 * The Reference pane: every builtin the compiler accepts, searchable by name
 * or by what it does, inserted at the cursor.
 */
import { searchReference } from '../reference-search.ts';
import type { EditorPaneHost } from './editor-pane-host.ts';

export class ReferencePane {
  readonly element: HTMLElement;

  constructor(private readonly host: EditorPaneHost) {
    this.element = this.renderReferencePane();
  }

  /** Reference pane: every builtin the compiler accepts, searchable by name
   * or by what it does, inserted at the cursor. Built from the same table
   * that drives highlighting and autocomplete, so it cannot list a function
   * the compiler would reject. */
  private renderReferencePane(): HTMLElement {
    const pane = document.createElement('div');
    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'Search functions and variables by name or by what they do. Click one to insert it at the cursor.';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'stims-editor__ref-search';
    search.placeholder = 'e.g. clamp, absolute value, bass';
    search.setAttribute('aria-label', 'Search functions and variables');
    const results = document.createElement('div');
    results.className = 'stims-editor__ref-results';
    results.setAttribute('role', 'list');

    const paint = () => {
      const entries = searchReference(search.value);
      if (entries.length === 0) {
        const none = document.createElement('p');
        none.className = 'stims-editor__hint';
        none.textContent = 'Nothing matches. Try a shorter word.';
        results.replaceChildren(none);
        return;
      }
      results.replaceChildren(
        ...entries.map((entry) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'stims-editor__ref-row';
          row.setAttribute('role', 'listitem');
          row.dataset.ref = entry.name;
          const head = document.createElement('span');
          head.className = 'stims-editor__ref-head';
          const name = document.createElement('code');
          name.textContent = entry.insertText;
          const badge = document.createElement('span');
          badge.className = 'stims-editor__ref-badge';
          badge.textContent = entry.category;
          head.append(name, badge);
          const doc = document.createElement('span');
          doc.className = 'stims-editor__ref-doc';
          doc.textContent = entry.doc;
          row.append(head, doc);
          row.addEventListener('click', () =>
            this.insertInline(entry.insertText),
          );
          return row;
        }),
      );
    };
    search.addEventListener('input', paint);
    paint();
    pane.append(hint, search, results);
    return pane;
  }
  /** Replace the selection with `text` in place. */
  private insertInline(text: string) {
    const selection = this.host.editor.state.selection.main;
    this.host.editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
      scrollIntoView: true,
    });
    this.host.editor.focus();
  }
}
