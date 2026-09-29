/**
 * The Insert pane: the technique cookbook, each recipe added to the block it
 * belongs in (see cookbook.ts).
 */
import { applyRecipe, COOKBOOK, type Recipe } from '../cookbook.ts';
import type { EditorPaneHost } from './editor-pane-host.ts';

export class InsertPane {
  readonly element: HTMLElement;

  constructor(private readonly host: EditorPaneHost) {
    this.element = this.renderInsertPane();
  }

  /** Insert pane: the technique cookbook. Each recipe explains itself and is
   * added to the block it belongs in — a bare line pasted at the cursor is a
   * base value, evaluated once, and does nothing. */
  private renderInsertPane(): HTMLElement {
    const pane = document.createElement('div');
    const hint = document.createElement('p');
    hint.className = 'stims-editor__hint';
    hint.textContent =
      'Techniques MilkDrop authors use, added to the right part of your preset. Each uses only what MilkDrop 2 has, so it works everywhere.';
    const list = document.createElement('div');
    list.className = 'stims-editor__recipes';
    list.setAttribute('role', 'list');
    for (const recipe of COOKBOOK) {
      const card = document.createElement('div');
      card.className = 'stims-editor__recipe';
      card.setAttribute('role', 'listitem');
      card.dataset.recipe = recipe.id;
      const head = document.createElement('div');
      head.className = 'stims-editor__recipe-head';
      const title = document.createElement('strong');
      title.textContent = recipe.title;
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'stims-editor__btn stims-editor__recipe-add';
      add.dataset.recipe = recipe.id;
      add.textContent = 'Add';
      add.setAttribute('aria-label', `Add ${recipe.title}`);
      add.addEventListener('click', () => this.addRecipe(recipe));
      head.append(title, add);
      const summary = document.createElement('p');
      summary.className = 'stims-editor__recipe-summary';
      summary.textContent = recipe.summary;
      const more = document.createElement('details');
      more.className = 'stims-editor__recipe-more';
      const label = document.createElement('summary');
      label.textContent = 'How it works';
      const how = document.createElement('p');
      how.textContent = recipe.how;
      const code = document.createElement('pre');
      code.className = 'stims-editor__proposal-lines';
      code.textContent = applyRecipe('', recipe).source.trim();
      more.append(label, how, code);
      card.append(head, summary, more);
      list.appendChild(card);
    }
    pane.append(hint, list);
    return pane;
  }
  /** Append a recipe to its blocks and select what was added. */
  private addRecipe(recipe: Recipe) {
    const before = this.host.editor.state.doc.toString();
    const { source, firstLine } = applyRecipe(before, recipe);
    const doc = this.host.editor.state.doc;
    this.host.editor.dispatch({
      changes: { from: 0, to: doc.length, insert: source },
      scrollIntoView: true,
    });
    const next = this.host.editor.state.doc;
    if (firstLine <= next.lines) {
      const line = next.line(firstLine);
      this.host.editor.dispatch({
        selection: { anchor: line.from, head: line.to },
        scrollIntoView: true,
      });
    }
    this.host.editor.focus();
  }
}
