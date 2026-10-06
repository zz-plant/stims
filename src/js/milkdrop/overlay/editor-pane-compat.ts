/**
 * The Compat pane: what will not run as written on Stims, worst first, and
 * what will not carry over to MilkDrop 2 ("Beyond Stims").
 */
import { buildCompatChecklist } from '../compat-checklist.ts';
import { checkPortability } from '../portability.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
} from '../types';
import type { EditorPaneHost } from './editor-pane-host.ts';

export class CompatPane {
  readonly element: HTMLElement;
  private compatHeadline: HTMLElement | null = null;
  private compatEngines: HTMLElement | null = null;
  private compatList: HTMLElement | null = null;
  private compatTab: HTMLButtonElement | null = null;
  private portabilityHeadline: HTMLElement | null = null;
  private portabilityList: HTMLElement | null = null;

  constructor(private readonly host: EditorPaneHost) {
    this.element = this.renderCompatPane();
  }

  /** Compat pane: everything about this preset that will not run the way
   * its source says, worst first, each pointing at a line. The dock used to
   * show one "Simplified" flag with a single reason. */
  private renderCompatPane(): HTMLElement {
    const pane = document.createElement('div');
    this.compatHeadline = document.createElement('p');
    this.compatHeadline.className = 'stims-editor__compat-headline';
    this.compatEngines = document.createElement('p');
    this.compatEngines.className = 'stims-editor__hint';
    this.compatList = document.createElement('div');
    this.compatList.className = 'stims-editor__compat';
    this.compatList.setAttribute('role', 'list');
    const beyond = document.createElement('h3');
    beyond.className = 'stims-editor__compat-section';
    beyond.textContent = 'Beyond Stims';
    const beyondHint = document.createElement('p');
    beyondHint.className = 'stims-editor__hint';
    beyondHint.textContent =
      'Checked against MilkDrop 2\u2019s own functions, variables, settings, and textures. projectM and Butterchurn read the same format; where they differ from MilkDrop 2 is not checked.';
    this.portabilityHeadline = document.createElement('p');
    this.portabilityHeadline.className = 'stims-editor__compat-headline';
    this.portabilityList = document.createElement('div');
    this.portabilityList.className = 'stims-editor__compat';
    this.portabilityList.setAttribute('role', 'list');
    this.portabilityList.dataset.scope = 'portability';
    pane.append(
      this.compatHeadline,
      this.compatEngines,
      this.compatList,
      beyond,
      this.portabilityHeadline,
      beyondHint,
      this.portabilityList,
    );
    return pane;
  }
  private paintCompat(state: MilkdropEditorSessionState) {
    const list = this.compatList;
    if (!list || !this.compatHeadline || !this.compatEngines) return;
    const compiled = state.latestCompiled;
    if (!compiled) {
      this.compatHeadline.textContent = 'Nothing compiled yet.';
      this.compatEngines.textContent = '';
      list.replaceChildren();
      this.portabilityList?.replaceChildren();
      if (this.portabilityHeadline) this.portabilityHeadline.textContent = '';
      return;
    }
    const checklist = buildCompatChecklist(compiled, state.source);
    this.compatHeadline.textContent = checklist.headline;
    this.compatHeadline.dataset.fidelity = checklist.fidelity;
    this.compatEngines.textContent = checklist.engines
      .map((entry) => `${entry.engine}: ${entry.status}`)
      .join(' · ');
    if (this.compatTab) {
      const count = checklist.items.length;
      this.compatTab.textContent = count > 0 ? `Compat · ${count}` : 'Compat';
      this.compatTab.dataset.tone = checklist.items.some(
        (item) => item.severity === 'blocker',
      )
        ? 'danger'
        : count > 0
          ? 'warning'
          : 'muted';
    }
    const labels = {
      blocker: 'Won\u2019t work',
      approximation: 'Approximated',
      ignored: 'Ignored',
      note: 'Note',
    } as const;
    list.replaceChildren(
      ...checklist.items.map((item) =>
        this.buildCompatRow(item, labels[item.severity]),
      ),
    );
    this.paintPortability(compiled, state.source);
  }
  /** One Compat row; a row with a line jumps to it. */
  private buildCompatRow(
    item: {
      severity: string;
      title: string;
      detail: string;
      line: number | null;
    },
    label: string,
  ): HTMLElement {
    const line = item.line;
    const row = document.createElement(line ? 'button' : 'div');
    if (row instanceof HTMLButtonElement) row.type = 'button';
    row.className = 'stims-editor__compat-row';
    row.setAttribute('role', 'listitem');
    row.dataset.severity = item.severity;
    const head = document.createElement('span');
    head.className = 'stims-editor__compat-head';
    const badge = document.createElement('span');
    badge.className = 'stims-editor__compat-badge';
    badge.textContent = label;
    const title = document.createElement('strong');
    // Titles wrap identifiers in backticks; render them as code.
    item.title.split('`').forEach((part, index) => {
      if (index % 2 === 1) {
        const code = document.createElement('code');
        code.textContent = part;
        title.appendChild(code);
      } else if (part) {
        title.appendChild(document.createTextNode(part));
      }
    });
    head.append(badge, title);
    if (line) {
      const where = document.createElement('span');
      where.className = 'stims-editor__compat-line';
      where.textContent = `line ${line}`;
      head.appendChild(where);
    }
    const detail = document.createElement('span');
    detail.className = 'stims-editor__compat-detail';
    detail.textContent = item.detail;
    row.append(head, detail);
    if (line) {
      row.addEventListener('click', () => {
        if (line < 1 || line > this.host.editor.state.doc.lines) return;
        const target = this.host.editor.state.doc.line(line);
        this.host.editor.dispatch({
          selection: { anchor: target.from, head: target.to },
          scrollIntoView: true,
        });
        this.host.editor.focus();
      });
    }
    return row;
  }
  /** Beyond Stims: what will not carry over to MilkDrop 2 and its kin. */
  private paintPortability(compiled: MilkdropCompiledPreset, source: string) {
    const list = this.portabilityList;
    if (!list || !this.portabilityHeadline) return;
    const items = checkPortability(compiled, source);
    this.portabilityHeadline.textContent =
      items.length === 0
        ? 'Nothing here stops this preset from running in MilkDrop 2.'
        : items.some((item) => item.severity === 'breaks')
          ? 'Will not run as-is in MilkDrop 2.'
          : 'Runs in MilkDrop 2, with differences.';
    const labels = {
      breaks: 'Breaks',
      differs: 'Differs',
      needs: 'Needs file',
    } as const;
    list.replaceChildren(
      ...items.map((item) => this.buildCompatRow(item, labels[item.severity])),
    );
  }

  /** The dock tab, which shows the item count and worst severity. */
  bindTab(tab: HTMLButtonElement) {
    this.compatTab = tab;
  }

  update(state: MilkdropEditorSessionState) {
    this.paintCompat(state);
  }
}
