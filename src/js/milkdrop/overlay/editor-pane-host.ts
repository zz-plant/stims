/**
 * What an editor dock pane needs from the panel that hosts it.
 *
 * The panes used to be methods and fields on one 4,600-line class, each
 * reaching for whatever it wanted. A pane module now gets exactly this: the
 * code view it reads and edits.
 */
import type { EditorView } from '@codemirror/view';

export interface EditorPaneHost {
  readonly editor: EditorView;
}
