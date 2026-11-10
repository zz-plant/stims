/**
 * `outline <file>…`: every declaration in a source file with its line range,
 * so a reader opens the forty lines they need instead of paging through four
 * thousand.
 *
 * Thirty days of agent transcripts in the repository this came from put the
 * cost in one place: 37% of all tool calls read or searched code, and the
 * largest files were paged through in 2.5 KB windows hundreds of times each,
 * because nothing said where a function started and ended. Each of those
 * calls re-reads the whole conversation, so a map that turns five windows
 * into one targeted read saves far more than the windows themselves.
 *
 * The parser is `@swc/core`, loaded on first use and declared as an optional
 * peer: the rest of this package has no runtime dependencies, and a
 * repository that never outlines a file should not have to install one.
 * Only syntax is read, so a file that does not type-check still outlines.
 */
import { readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import type { ParseOptions } from '@swc/core';
import type { Command } from './context.ts';

export type OutlineKind =
  | 'imports'
  | 'exports'
  /** Also a variable or property holding one: `const f = () => …`, `useCallback(() => …)`. */
  | 'function'
  | 'class'
  | 'method'
  | 'property'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'namespace'
  | 'member'
  | 'test'
  /** A call given an inline callback (`useEffect(() => …)`) or a long `return`. */
  | 'block';

export type OutlineEntry = {
  kind: OutlineKind;
  /** The declared name; a test's title; empty for import and re-export runs. */
  name: string;
  /** The declaration head on one line: `export function foo(a: A): B`. */
  label: string;
  /** First and last line, 1-based and inclusive. */
  start: number;
  end: number;
  children: OutlineEntry[];
};

export type Outline = { lines: number; entries: OutlineEntry[] };

type AstNode = {
  type: string;
  span: { start: number; end: number };
  [field: string]: unknown;
};

const isNode = (value: unknown): value is AstNode => {
  if (typeof value !== 'object' || value === null) return false;
  const { type, span } = value as { type?: unknown; span?: unknown };
  return (
    typeof type === 'string' &&
    typeof span === 'object' &&
    span !== null &&
    typeof (span as { start?: unknown }).start === 'number'
  );
};

const PARSERS: Record<string, ParseOptions> = {
  '.ts': { syntax: 'typescript', tsx: false, decorators: true },
  '.mts': { syntax: 'typescript', tsx: false, decorators: true },
  '.cts': { syntax: 'typescript', tsx: false, decorators: true },
  '.tsx': { syntax: 'typescript', tsx: true, decorators: true },
  '.js': { syntax: 'ecmascript', jsx: true },
  '.jsx': { syntax: 'ecmascript', jsx: true },
  '.mjs': { syntax: 'ecmascript', jsx: true },
  '.cjs': { syntax: 'ecmascript', jsx: true },
};

/** The extensions `outline` and `where` can parse. */
export const OUTLINE_EXTENSIONS = Object.keys(PARSERS).map((ext) =>
  ext.slice(1),
);

type ParseSync = (source: string, options: ParseOptions) => unknown;
let parser: ParseSync | undefined;

async function loadParser(): Promise<ParseSync> {
  if (parser) return parser;
  try {
    const swc = await import('@swc/core');
    parser = (source, options) => swc.parseSync(source, options);
  } catch {
    throw new Error(
      'outline and where parse source with @swc/core, which is not installed. Add it to devDependencies.',
    );
  }
  return parser;
}

/**
 * swc counts span offsets in bytes from a base it does not expose, and
 * reports the module as starting at its first token, so a file that opens
 * with a comment has no usable origin. A sentinel statement at byte 0 makes
 * the module's start the origin whatever the base is. A shebang is blanked
 * rather than removed so no line moves.
 */
const SENTINEL = '0;';

const TEST_BLOCKS = new Set(['describe', 'suite', 'test', 'it', 'bench']);
const TEST_HOOKS = new Set([
  'beforeAll',
  'beforeEach',
  'afterAll',
  'afterEach',
]);
const FUNCTION_LIKE = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'ClassExpression',
]);
const MAX_LABEL = 110;
/** A `return` at least this long is a section of its function, usually its JSX or its API object. */
const LONG_RETURN_LINES = 20;

const clip = (text: string, max = MAX_LABEL) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Parses one file's text and returns every declaration, nested as written. */
export async function outlineSource(
  text: string,
  fileName: string,
): Promise<Outline> {
  const options = PARSERS[extname(fileName).toLowerCase()];
  if (!options) {
    throw new Error(
      `outline reads ${OUTLINE_EXTENSIONS.map((ext) => `.${ext}`).join(' ')} files`,
    );
  }
  const parse = await loadParser();
  const prepared =
    SENTINEL + text.replace(/^#!.*/u, (line) => ' '.repeat(line.length));
  const ast = parse(prepared, options);
  if (!isNode(ast) || !Array.isArray(ast.body)) {
    throw new Error('the parser returned no module');
  }

  const bytes = Buffer.from(prepared, 'utf8');
  const base = ast.span.start;
  const lineStarts = [0];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) lineStarts.push(index + 1);
  }
  const lineAt = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const slice = (from: number, to: number) =>
    bytes.subarray(from, to).toString('utf8');
  const sourceOf = (node: AstNode) =>
    slice(node.span.start - base, node.span.end - base);

  /** The text from a declaration's start to its body, or to the end of its first line. */
  const head = (node: AstNode, bodyFrom: number | undefined) => {
    const from = node.span.start - base;
    const to = node.span.end - base;
    const lineEnd = bytes.indexOf(0x0a, from);
    const firstLine = lineEnd === -1 ? to : Math.min(lineEnd, to);
    const stop =
      bodyFrom !== undefined && bodyFrom > from ? bodyFrom : firstLine;
    return slice(from, Math.min(stop, from + 600))
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(/(?:\s*[{=])+$/u, '')
      .replace(/\(\s+/gu, '(')
      .replace(/,?\s+\)/gu, ')')
      .replace(/,$/u, '');
  };

  const bodyStart = (value: unknown): number | undefined => {
    if (!isNode(value)) return undefined;
    // A class method keeps its body one level down, in a `function` record
    // that is not itself a node.
    const holder = (value.function ?? value) as { body?: unknown };
    return isNode(holder.body) ? holder.body.span.start - base : undefined;
  };

  const make = (
    kind: OutlineKind,
    name: string,
    node: AstNode,
    label: string,
  ): OutlineEntry => {
    const from = node.span.start - base;
    const to = node.span.end - base;
    return {
      kind,
      name,
      label: clip(label),
      start: lineAt(from),
      end: lineAt(Math.max(from, to - 1)),
      children: [],
    };
  };

  const keyName = (key: unknown): string => {
    if (!isNode(key)) return '?';
    if (key.type === 'PrivateName') {
      const inner = isNode(key.id) ? key.id.value : key.value;
      return `#${String(inner ?? '?')}`;
    }
    if (typeof key.value === 'string' || typeof key.value === 'number') {
      return String(key.value);
    }
    return clip(sourceOf(key).replace(/\s+/gu, ' '), 48);
  };

  /**
   * Whether a value is a function, or a call handed one (`useCallback(() => …)`,
   * `memo(function …)`): either way the name it is bound to is what a reader
   * would call "the function this line is in".
   */
  const isCallable = (value: unknown): boolean => {
    if (!isNode(value)) return false;
    if (FUNCTION_LIKE.has(value.type)) return true;
    return (
      value.type === 'CallExpression' &&
      Array.isArray(value.arguments) &&
      value.arguments.some((arg) =>
        isCallable((arg as { expression?: unknown }).expression),
      )
    );
  };

  /** The text of a string or template literal, or undefined for anything else. */
  const literalText = (value: unknown): string | undefined => {
    if (!isNode(value)) return undefined;
    if (value.type === 'StringLiteral') return String(value.value);
    if (value.type === 'TemplateLiteral') return sourceOf(value).slice(1, -1);
    return undefined;
  };

  /** `test.each`, `describe.skip`, `test.describe`: the dotted path a call is made through. */
  const calleePath = (callee: unknown): string | undefined => {
    if (!isNode(callee)) return undefined;
    if (callee.type === 'Identifier') return String(callee.value);
    if (callee.type === 'CallExpression') return calleePath(callee.callee);
    if (callee.type === 'MemberExpression') {
      const object = calleePath(callee.object);
      const property = isNode(callee.property) ? callee.property.value : null;
      return object && typeof property === 'string'
        ? `${object}.${property}`
        : object;
    }
    return undefined;
  };

  const walkValue = (value: unknown, sink: OutlineEntry[]): void => {
    if (Array.isArray(value)) {
      for (const item of value) walkValue(item, sink);
    } else if (isNode(value)) {
      visit(value, sink);
    } else if (typeof value === 'object' && value !== null) {
      // Call arguments and a few other wrappers are plain objects around a node.
      for (const inner of Object.values(value)) walkValue(inner, sink);
    }
  };

  const walkChildren = (node: AstNode, sink: OutlineEntry[]): void => {
    for (const [field, value] of Object.entries(node)) {
      if (field !== 'span' && field !== 'type') walkValue(value, sink);
    }
  };

  const addEntry = (
    kind: OutlineKind,
    name: string,
    spanNode: AstNode,
    body: unknown,
    inside: unknown,
    sink: OutlineEntry[],
    label = head(spanNode, bodyStart(body)),
  ): void => {
    const entry = make(kind, name, spanNode, label);
    sink.push(entry);
    // Children are walked from the node's fields, never by visiting the node
    // itself, so `const Foo = class Foo {}` is one entry and not two.
    if (isNode(inside)) walkChildren(inside, entry.children);
    else walkValue(inside, entry.children);
  };

  let typeDepth = 0;
  function visit(node: AstNode, sink: OutlineEntry[], outer?: AstNode): void {
    switch (node.type) {
      case 'ExportDeclaration':
        if (isNode(node.declaration)) visit(node.declaration, sink, node);
        return;
      case 'ExportDefaultDeclaration':
        if (isNode(node.decl)) visit(node.decl, sink, node);
        return;
      case 'ExportDefaultExpression':
        addEntry('variable', 'default', node, undefined, node.expression, sink);
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const named = isNode(node.identifier) ? node.identifier.value : null;
        if (typeof named !== 'string' && !outer) {
          walkChildren(node, sink);
          return;
        }
        addEntry(
          node.type.startsWith('Class') ? 'class' : 'function',
          typeof named === 'string' ? named : 'default',
          outer ?? node,
          node,
          node,
          sink,
        );
        return;
      }
      case 'Constructor':
      case 'ClassMethod':
      case 'PrivateMethod':
      case 'MethodProperty':
      case 'GetterProperty':
      case 'SetterProperty':
        addEntry(
          'method',
          node.type === 'Constructor' ? 'constructor' : keyName(node.key),
          node,
          node,
          node,
          sink,
        );
        return;
      case 'ClassProperty':
      case 'PrivateProperty':
        addEntry(
          isCallable(node.value) ? 'method' : 'property',
          keyName(node.key),
          node,
          node.value,
          node.value,
          sink,
        );
        return;
      case 'KeyValueProperty':
        if (isNode(node.value) && FUNCTION_LIKE.has(node.value.type)) {
          addEntry(
            'method',
            keyName(node.key),
            node,
            node.value,
            node.value,
            sink,
          );
        } else {
          walkChildren(node, sink);
        }
        return;
      case 'VariableDeclaration': {
        const declarators = Array.isArray(node.declarations)
          ? node.declarations.filter(isNode)
          : [];
        for (const declarator of declarators) {
          const id = declarator.id;
          const name =
            isNode(id) && id.type === 'Identifier'
              ? String(id.value)
              : isNode(id)
                ? clip(sourceOf(id).replace(/\s+/gu, ' '), 48)
                : '?';
          const init = declarator.init;
          const callable = isCallable(init);
          const kind =
            isNode(init) && init.type === 'ClassExpression'
              ? 'class'
              : callable
                ? 'function'
                : 'variable';
          if (declarators.length === 1) {
            // A destructuring's first line is only `const {`, so name what it
            // binds and what it takes them from.
            const pattern =
              isNode(id) && id.type !== 'Identifier'
                ? `${outer ? 'export ' : ''}${String(node.kind)} ${name}${
                    isNode(init)
                      ? ` = ${clip(sourceOf(init).replace(/\s+/gu, ' '), 40)}`
                      : ''
                  }`
                : undefined;
            addEntry(kind, name, outer ?? node, init, init, sink, pattern);
            continue;
          }
          const entry = make(
            kind,
            name,
            declarator,
            `${String(node.kind)} ${head(declarator, callable ? bodyStart(init) : undefined)}`,
          );
          sink.push(entry);
          if (isNode(init)) walkChildren(init, entry.children);
        }
        return;
      }
      case 'TsInterfaceDeclaration':
      case 'TsTypeAliasDeclaration':
      case 'TsEnumDeclaration':
      case 'TsModuleDeclaration': {
        const kinds: Record<string, OutlineKind> = {
          TsInterfaceDeclaration: 'interface',
          TsTypeAliasDeclaration: 'type',
          TsEnumDeclaration: 'enum',
          TsModuleDeclaration: 'namespace',
        };
        const namedType =
          node.type === 'TsInterfaceDeclaration' ||
          node.type === 'TsTypeAliasDeclaration';
        if (namedType) typeDepth += 1;
        addEntry(
          kinds[node.type] ?? 'type',
          keyName(node.id),
          outer ?? node,
          node,
          node,
          sink,
        );
        if (namedType) typeDepth -= 1;
        return;
      }
      case 'TsMethodSignature':
      case 'TsPropertySignature':
      case 'TsGetterSignature':
      case 'TsSetterSignature':
        // Only a named type's members are declarations worth finding; the
        // fields of an inline `{ open: boolean }` parameter type are not.
        if (typeDepth === 0) walkChildren(node, sink);
        else addEntry('member', keyName(node.key), node, undefined, node, sink);
        return;
      case 'TsEnumMember':
        addEntry('member', keyName(node.id), node, undefined, node, sink);
        return;
      case 'ExpressionStatement': {
        const expression = isNode(node.expression) ? node.expression : null;
        const call =
          expression?.type === 'AwaitExpression' && isNode(expression.argument)
            ? expression.argument
            : expression;
        const path = call ? calleePath(call.callee) : undefined;
        const args =
          call?.type === 'CallExpression' && Array.isArray(call.arguments)
            ? call.arguments.map(
                (arg) => (arg as { expression?: unknown }).expression,
              )
            : [];
        const callback = args.some(
          (arg) => isNode(arg) && FUNCTION_LIKE.has(arg.type),
        );
        const root = path?.split('.')[0] ?? '';
        if (!callback || TEST_BLOCKS.has(root) || TEST_HOOKS.has(root)) {
          walkChildren(node, sink);
          return;
        }
        // A call broken after its paren would read as just `browserTest(`;
        // a leading string argument is its title, so carry it up.
        const opened = head(node, undefined);
        const title = literalText(args[0]);
        const opening =
          opened.endsWith('(') && title !== undefined
            ? `${opened}${JSON.stringify(title)}, …`
            : opened;
        // `useEffect(() => {…}, [a, b])` has no name, but in a component the
        // effects are most of the body: label it by its call and its deps.
        const last = args.at(-1);
        const deps =
          isNode(last) && last.type === 'ArrayExpression'
            ? ` …, ${clip(sourceOf(last).replace(/\s+/gu, ' '), 48)})`
            : '';
        addEntry(
          'block',
          path ?? '',
          node,
          undefined,
          args,
          sink,
          `${opening}${deps}`,
        );
        return;
      }
      case 'ReturnStatement': {
        const from = node.span.start - base;
        const to = node.span.end - base;
        if (lineAt(to - 1) - lineAt(from) + 1 < LONG_RETURN_LINES) {
          walkChildren(node, sink);
          return;
        }
        const lineEnd = bytes.indexOf(0x0a, from);
        const first = slice(from, lineEnd === -1 ? to : lineEnd).trim();
        const closer = { '(': ')', '{': '}', '[': ']' }[first.at(-1) ?? ''];
        addEntry(
          'block',
          '',
          node,
          undefined,
          node,
          sink,
          closer ? `${first}…${closer}` : `${first} …`,
        );
        return;
      }
      case 'CallExpression': {
        const path = calleePath(node.callee);
        const root = path?.split('.')[0] ?? '';
        const args = Array.isArray(node.arguments) ? node.arguments : [];
        const title = literalText(
          (args[0] as { expression?: unknown } | undefined)?.expression,
        );
        if (path && TEST_BLOCKS.has(root) && title !== undefined) {
          const entry = make(
            'test',
            title,
            node,
            `${path}(${JSON.stringify(title)})`,
          );
          sink.push(entry);
          walkValue(args, entry.children);
        } else if (path && TEST_HOOKS.has(path)) {
          const entry = make('test', path, node, path);
          sink.push(entry);
          walkValue(args, entry.children);
        } else {
          walkChildren(node, sink);
        }
        return;
      }
      default:
        walkChildren(node, sink);
    }
  }

  const entries: OutlineEntry[] = [];
  let run: { kind: OutlineKind; entry: OutlineEntry; count: number } | null =
    null;
  for (const item of ast.body.filter(isNode)) {
    const runKind: OutlineKind | null =
      item.type === 'ImportDeclaration' ||
      item.type === 'TsImportEqualsDeclaration'
        ? 'imports'
        : item.type === 'ExportNamedDeclaration' ||
            item.type === 'ExportAllDeclaration'
          ? 'exports'
          : null;
    if (!runKind) {
      run = null;
      visit(item, entries);
      continue;
    }
    const piece = make(runKind, '', item, runKind);
    if (run && run.kind === runKind) {
      run.count += 1;
      run.entry.end = piece.end;
    } else {
      run = { kind: runKind, entry: piece, count: 1 };
      entries.push(piece);
    }
    const noun = runKind === 'imports' ? 'imports' : 're-exports';
    run.entry.label = `${noun} (${run.count})`;
  }

  const lines =
    text.length === 0 ? 0 : text.replace(/\n$/u, '').split('\n').length;
  return { lines, entries };
}

export type RenderOptions = {
  /** Nested declarations shorter than this are left out. Top-level ones never are. */
  minLines: number;
  /** How many levels below the top to show. */
  depth: number;
  /** Show only declarations whose name or head contains this, with their ancestors. */
  match?: string;
};

export const OUTLINE_DEFAULTS: RenderOptions = { minLines: 6, depth: 2 };

type Row = { entry: OutlineEntry; depth: number };

const span = ({ start, end }: OutlineEntry) => end - start + 1;

/** The rows an outline prints, plus how many declarations the limits left out. */
export function selectRows(
  outline: Outline,
  { minLines, depth, match }: RenderOptions,
): { rows: Row[]; hidden: number } {
  const rows: Row[] = [];
  let hidden = 0;
  const count = (entries: OutlineEntry[]): number =>
    entries.reduce((total, entry) => total + 1 + count(entry.children), 0);
  const visible = (entry: OutlineEntry, level: number) =>
    level === 0 || entry.kind === 'test' || span(entry) >= minLines;

  const emit = (entries: OutlineEntry[], level: number): void => {
    for (const entry of entries) {
      if (level > depth || !visible(entry, level)) {
        hidden += 1 + count(entry.children);
        continue;
      }
      rows.push({ entry, depth: level });
      emit(entry.children, level + 1);
    }
  };

  if (!match) {
    emit(outline.entries, 0);
    return { rows, hidden };
  }

  const wanted = match.toLowerCase();
  const hits = (entry: OutlineEntry): boolean =>
    `${entry.name} ${entry.label}`.toLowerCase().includes(wanted);
  const contains = (entry: OutlineEntry): boolean =>
    hits(entry) || entry.children.some(contains);
  const search = (entries: OutlineEntry[], level: number): void => {
    for (const entry of entries) {
      if (hits(entry)) {
        rows.push({ entry, depth: level });
        // A match shows its own contents under the usual limits, measured
        // from the match rather than from the top of the file.
        const before = rows.length;
        emit(entry.children, 1);
        for (const row of rows.slice(before)) row.depth += level;
      } else if (contains(entry)) {
        rows.push({ entry, depth: level });
        search(entry.children, level + 1);
      }
    }
  };
  search(outline.entries, 0);
  return { rows, hidden: 0 };
}

const range = ({ start, end }: OutlineEntry) =>
  start === end ? String(start) : `${start}-${end}`;

/** The outline as lines: a header, then `start-end  declaration`, indented by nesting. */
export function renderOutline(
  file: string,
  outline: Outline,
  options: RenderOptions,
): string[] {
  const { rows, hidden } = selectRows(outline, options);
  const width = Math.max(0, ...rows.map(({ entry }) => range(entry).length));
  const lines = [`${file} — ${outline.lines} lines`];
  for (const { entry, depth } of rows) {
    lines.push(
      `${range(entry).padStart(width)}  ${'  '.repeat(depth)}${entry.label}`,
    );
  }
  if (hidden > 0) {
    lines.push(
      `(${hidden} shorter or deeper declarations not shown: --match <name> finds one, --min-lines 1 --depth 9 lists all)`,
    );
  }
  return lines;
}

const VALUE_FLAGS = new Set(['--match', '--depth', '--min-lines']);

const wholeNumber = (value: string | undefined): number | null =>
  value !== undefined && /^\d+$/u.test(value) ? Number(value) : null;

/** `outline <file>… [--match <name>] [--depth <n>] [--min-lines <n>] [--json]` */
export const runOutline: Command = async (args, { cwd, io }) => {
  const files: string[] = [];
  const flags = new Map<string, string | undefined>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (VALUE_FLAGS.has(arg)) {
      index += 1;
      flags.set(arg, args[index]);
    } else if (arg.startsWith('--')) {
      flags.set(arg, undefined);
    } else {
      files.push(arg);
    }
  }
  const usage =
    'Usage: outline <file>… [--match <name>] [--depth <n>] [--min-lines <n>] [--json]';
  if (files.length === 0) {
    io.error(usage);
    return 2;
  }
  const options: RenderOptions = { ...OUTLINE_DEFAULTS };
  for (const [flag, key] of [
    ['--depth', 'depth'],
    ['--min-lines', 'minLines'],
  ] as const) {
    if (!flags.has(flag)) continue;
    const value = wholeNumber(flags.get(flag));
    if (value === null) {
      io.error(`${flag} takes a whole number\n${usage}`);
      return 2;
    }
    options[key] = value;
  }
  if (flags.has('--match')) {
    const match = flags.get('--match');
    if (!match) {
      io.error(`--match takes part of a name\n${usage}`);
      return 2;
    }
    options.match = match;
  }

  let status = 0;
  const json: Array<{ file: string } & Outline> = [];
  for (const [index, file] of files.entries()) {
    const path = resolve(cwd, file);
    const shown = relative(cwd, path) || file;
    let outline: Outline;
    try {
      outline = await outlineSource(readFileSync(path, 'utf8'), path);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // swc reports a syntax error as a multi-line code frame; the first line names it.
      io.error(`${shown}: ${reason.split('\n')[0]?.trim() ?? reason}`);
      status = 1;
      continue;
    }
    if (flags.has('--json')) {
      json.push({ file: shown, ...outline });
      continue;
    }
    const lines = renderOutline(shown, outline, options);
    if (options.match && lines.length === 1) {
      io.error(`${shown}: no declaration named like "${options.match}"`);
      status = 1;
      continue;
    }
    if (index > 0) io.log();
    for (const line of lines) io.log(line);
  }
  if (flags.has('--json')) io.log(JSON.stringify(json, null, 2));
  return status;
};
