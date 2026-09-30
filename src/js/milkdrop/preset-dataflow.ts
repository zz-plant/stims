/**
 * Static dataflow analysis of a compiled preset: for every variable the
 * per-frame program leaves behind, which inputs its value can depend on.
 *
 * Sources: the audio signals (by name), the clock (`time`, `frame`, `fps`,
 * `progress`), `rand()`, the `megabuf`/`gmegabuf` memory, and pointer input.
 * A variable with no source is constant; one whose sources are only the clock
 * and `rand` is clockwork: the same trajectory on every song.
 *
 * The model follows the VM's execution rules:
 * - Built-in controls (`zoom`, `wave_r`, …) are restored to their base value
 *   before every frame, so reading one before writing it reads a constant.
 * - User variables, `q`/`t` registers and megabuf persist across frames, so
 *   reading one before writing it reads last frame's value. Those reads are
 *   resolved by a fixpoint over the frame, and a variable that (transitively)
 *   reads its own previous value is an accumulator.
 * - An assignment that only sometimes runs (inside `if`, `&&`, `||`, a loop)
 *   depends on the condition too, and keeps its old value otherwise.
 * - `init` runs once with silent audio, so what it sets is constant.
 * - The VM draws every `rand()` from one stream seeded by the preset id, so
 *   random values are identical on every song, unless some `rand()` call,
 *   in any program, runs only when an audio-dependent condition holds. Then
 *   the stream's position depends on the audio and every `rand()` does too.
 *
 * It is conservative: a dependency that never matters at runtime (multiplied
 * by zero, a threshold the signal never crosses) is still reported.
 */
import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from './common-types';
import { DEFAULT_MILKDROP_STATE } from './compiler';
import type { MilkdropPresetIR } from './compiler-types';
import { normalizeProgramAssignmentTarget } from './field-normalization';

const AUDIO = new Set([
  // the waveform samples a custom wave's per-point code reads
  'value1',
  'value2',
  'bass',
  'mid',
  'med',
  'mids',
  'treb',
  'att',
  'treble',
  'bass_att',
  'mid_att',
  'med_att',
  'mids_att',
  'treb_att',
  'treble_att',
  'bassatt',
  'midatt',
  'midsatt',
  'trebleatt',
  'vol',
  'vol_att',
  'rms',
  'music',
  'beat',
  'beat_pulse',
  'beatpulse',
  'beatbass',
  'beatmid',
  'beattreble',
  'beat_bass',
  'beat_mid',
  'beat_treb',
  'beat_treble',
  'bandflux',
  'transient',
  'spectralflux',
  'weightedenergy',
]);
const CLOCK = new Set(['time', 'frame', 'fps', 'progress']);
const POINTER = new Set([
  'inputx',
  'inputy',
  'input_x',
  'input_y',
  'inputdx',
  'inputdy',
  'input_dx',
  'input_dy',
  'inputspeed',
]);
/** Pseudo-variable standing for the whole megabuf/gmegabuf memory. */
const MEMORY = '__memory';
const RANDOM = 'rand';
/** Marks a value read out of megabuf/gmegabuf. */
const MEMORY_READ = 'memory';

/** What one value can depend on: atoms are `audio:<name>`, `clock:<name>`,
 * `rand`, `pointer`, or `prev:<variable>` (last frame's value). */
type Atoms = Set<string>;

export type VariableDataflow = {
  /** Audio signals the value can depend on, sorted. */
  audio: string[];
  /** Clock inputs it can depend on, sorted; `accumulator` when it follows a
   * variable that feeds back on itself, which advances every frame. */
  clock: string[];
  random: boolean;
  memory: boolean;
  pointer: boolean;
  /** It depends on an earlier frame's per-frame state: it has memory. */
  history: boolean;
  /** It feeds back on itself: depends (transitively) on its own previous value. */
  accumulates: boolean;
  kind: 'constant' | 'clockwork' | 'audio' | 'pointer';
};

export type PresetDataflow = {
  variables: Map<string, VariableDataflow>;
  /** Some `rand()` call runs only under an audio-dependent condition, so the
   * random stream itself depends on the audio. */
  randomStreamFollowsAudio: boolean;
};

const union = (...sets: ReadonlyArray<Atoms>): Atoms => {
  const out: Atoms = new Set();
  for (const set of sets) for (const atom of set) out.add(atom);
  return out;
};
const keyOf = (name: string) =>
  name.startsWith('__') ? name : normalizeProgramAssignmentTarget(name);
const hasAudio = (atoms: Atoms) =>
  [...atoms].some((a) => a.startsWith('audio:'));

class FramePass {
  /** Atoms of each variable written so far in this frame. */
  readonly env = new Map<string, Atoms>();
  /** Union of the conditions every `rand()` call ran under. */
  readonly randomGuards: Atoms = new Set();
  /** Variables this pass assigned (MEMORY for megabuf/gmegabuf writes). */
  readonly written = new Set<string>();

  constructor(private readonly builtins: ReadonlySet<string>) {}

  read(rawName: string): Atoms {
    // The VM resolves a read through the same alias table the compiler
    // applies to writes (`mv_x` is stored as `motion_vectors_x`).
    const name = keyOf(rawName);
    const written = this.env.get(name);
    if (written) return written;
    if (AUDIO.has(name)) return new Set([`audio:${name}`]);
    if (CLOCK.has(name)) return new Set([`clock:${name}`]);
    if (POINTER.has(name)) return new Set(['pointer']);
    // A built-in is restored to its base before every frame: a constant.
    if (this.builtins.has(name)) return new Set();
    return new Set([`prev:${name}`]);
  }

  assign(name: string, value: Atoms, guard: Atoms) {
    const key = keyOf(name);
    this.written.add(key);
    // A write that only sometimes runs keeps the old value otherwise.
    this.env.set(key, guard.size ? union(value, guard, this.read(key)) : value);
  }

  eval(node: MilkdropExpressionNode, guard: Atoms): Atoms {
    switch (node.type) {
      case 'literal':
        return new Set();
      case 'identifier':
        return this.read(node.name);
      case 'unary':
        return this.eval(node.operand, guard);
      case 'binary': {
        if (node.operator === '=') {
          const value = this.eval(node.right, guard);
          this.store(node.left, value, guard);
          return value;
        }
        const left = this.eval(node.left, guard);
        // `&&` and `||` evaluate their right side only for some left values.
        const rightGuard =
          node.operator === '&&' || node.operator === '||'
            ? union(guard, left)
            : guard;
        return union(left, this.eval(node.right, rightGuard));
      }
      case 'call': {
        const name = node.name.toLowerCase();
        if (name === 'if' && node.args.length === 3) {
          const cond = this.eval(node.args[0] as MilkdropExpressionNode, guard);
          const branchGuard = union(guard, cond);
          return union(
            cond,
            this.eval(node.args[1] as MilkdropExpressionNode, branchGuard),
            this.eval(node.args[2] as MilkdropExpressionNode, branchGuard),
          );
        }
        const args = union(...node.args.map((arg) => this.eval(arg, guard)));
        if (name === 'rand' || name === 'randint') {
          for (const atom of guard) this.randomGuards.add(atom);
          return union(args, new Set([RANDOM]));
        }
        if (name === 'megabuf' || name === 'gmegabuf') {
          return union(args, this.read(MEMORY), new Set([MEMORY_READ]));
        }
        return args;
      }
    }
  }

  store(target: MilkdropExpressionNode, value: Atoms, guard: Atoms) {
    if (target.type === 'identifier') {
      this.assign(target.name, value, guard);
    } else if (target.type === 'call') {
      // megabuf(i) = v: the memory as a whole keeps everything written into it.
      const index = union(...target.args.map((arg) => this.eval(arg, guard)));
      this.written.add(MEMORY);
      this.env.set(MEMORY, union(this.read(MEMORY), value, index, guard));
    }
  }

  run(statements: readonly MilkdropCompiledStatement[], guard: Atoms) {
    for (const statement of statements) {
      if (statement.control) {
        const { control } = statement;
        const condition =
          control.kind === 'loop' ? control.count : control.condition;
        const loopGuard = union(
          guard,
          condition ? this.eval(condition, guard) : new Set(),
        );
        // Twice, so a value carried from one iteration to the next is seen.
        this.run(control.body, loopGuard);
        this.run(control.body, loopGuard);
        continue;
      }
      if (statement.target === '__control') {
        this.eval(statement.expression, guard);
      } else if (statement.targetExpression) {
        const value = this.eval(statement.expression, guard);
        this.store(
          {
            type: 'call',
            name: statement.target,
            args: [statement.targetExpression],
          },
          value,
          guard,
        );
      } else {
        this.assign(
          statement.target,
          this.eval(statement.expression, guard),
          guard,
        );
      }
    }
  }
}

/** Sources of last frame's value of `name`: what the per-frame program left in
 * it, plus what other programs wrote into it if it is shared state. */
const previousSources = (resolved: ReadonlyMap<string, Atoms>, name: string) =>
  [resolved.get(name), resolved.get(`ext:${name}`)].filter(
    (atoms): atoms is Atoms => atoms !== undefined,
  );

/** Replace every `prev:x` by what x holds at the end of the frame (and what
 * other programs wrote into it, keyed `ext:x`), to a fixpoint. */
function resolvePrevious(
  env: ReadonlyMap<string, Atoms>,
  external: ReadonlyMap<string, Atoms>,
) {
  const resolved = new Map<string, Atoms>();
  for (const [name, atoms] of env) resolved.set(name, new Set(atoms));
  for (const [name, atoms] of external)
    resolved.set(`ext:${name}`, new Set(atoms));
  let changed = true;
  while (changed) {
    changed = false;
    for (const atoms of resolved.values()) {
      for (const atom of [...atoms]) {
        if (!atom.startsWith('prev:')) continue;
        // never written anywhere per frame: its init value, a constant
        for (const source of previousSources(resolved, atom.slice(5))) {
          for (const next of source) {
            if (!atoms.has(next)) {
              atoms.add(next);
              changed = true;
            }
          }
        }
      }
    }
  }
  return resolved;
}

/** Shared between programs across frames: megabuf memory and the q bank. */
const isShared = (name: string) => name === MEMORY || /^q\d+$/.test(name);
const signature = (map: ReadonlyMap<string, Atoms>) =>
  JSON.stringify([...map].map(([k, v]) => [k, [...v].sort()]).sort());

export function analyzePresetDataflow(
  ir: MilkdropPresetIR,
  builtins: Iterable<string> = Object.keys(DEFAULT_MILKDROP_STATE),
): PresetDataflow {
  const builtinSet = new Set([...builtins].map((name) => name.toLowerCase()));
  for (const name of Object.keys(ir.numericFields))
    builtinSet.add(name.toLowerCase());
  // Waves, shapes and per-pixel code share the random stream with per-frame
  // code, and can write the megabuf memory and q registers it reads on the
  // next frame. So: analyse per-frame, run the others with its results in
  // scope, feed their shared writes back as sources of last frame's values,
  // and repeat until those writes stop changing.
  const others: MilkdropProgramBlock[] = [
    ir.programs.perPixel,
    ...ir.customWaves.flatMap((wave) => [
      wave.programs.perFrame,
      wave.programs.perPoint,
    ]),
    ...ir.customShapes.map((shape) => shape.programs.perFrame),
  ];
  let external = new Map<string, Atoms>();
  let frame = new FramePass(builtinSet);
  let resolved = new Map<string, Atoms>();
  let guards: Atoms = new Set();
  for (let round = 0; round < 8; round += 1) {
    frame = new FramePass(builtinSet);
    frame.run(ir.programs.perFrame.statements, new Set());
    resolved = resolvePrevious(frame.env, external);
    guards = new Set(frame.randomGuards);
    const next = new Map<string, Atoms>();
    for (const block of others) {
      const pass = new FramePass(builtinSet);
      for (const [name, atoms] of resolved) {
        if (!name.startsWith('ext:')) pass.env.set(name, atoms);
      }
      if (block === ir.programs.perPixel) {
        // A vertex's rad and ang are fixed by the grid and the aspect, as in
        // MilkDrop, whatever per-frame code left in variables of those names.
        pass.env.set('rad', new Set());
        pass.env.set('ang', new Set());
      }
      pass.run(block.statements, new Set());
      for (const atom of pass.randomGuards) guards.add(atom);
      for (const name of pass.written) {
        if (!isShared(name)) continue;
        next.set(
          name,
          union(next.get(name) ?? new Set(), pass.env.get(name) ?? new Set()),
        );
      }
    }
    if (signature(next) === signature(external)) break;
    external = next;
  }
  const resolvedGuards = union(
    ...[...guards].map((atom) =>
      atom.startsWith('prev:')
        ? union(...previousSources(resolved, atom.slice(5)))
        : new Set([atom]),
    ),
  );
  const randomStreamFollowsAudio = hasAudio(resolvedGuards);

  const variables = new Map<string, VariableDataflow>();
  // A shared register's value at the end of the frame is what per-frame code
  // left in it, or what a wave, shape or per-pixel pass wrote after that.
  const names = new Set(
    [...resolved.keys()].map((key) =>
      key.startsWith('ext:') ? key.slice(4) : key,
    ),
  );
  const atomsOf = (name: string) => union(...previousSources(resolved, name));
  // A variable that feeds back on itself changes from frame to frame even with
  // no input (`counter = counter + 1`): an implicit clock for everything
  // that reads it.
  const accumulators = new Set(
    [...names].filter((name) => atomsOf(name).has(`prev:${name}`)),
  );
  for (const name of names) {
    if (name === MEMORY) continue;
    const atoms = atomsOf(name);
    const audio = new Set<string>();
    const clock = new Set<string>();
    for (const atom of atoms) {
      if (atom.startsWith('audio:')) audio.add(atom.slice(6));
      else if (atom.startsWith('clock:')) clock.add(atom.slice(6));
      else if (atom.startsWith('prev:') && accumulators.has(atom.slice(5))) {
        clock.add('accumulator');
      }
    }
    const random = atoms.has(RANDOM);
    if (random && randomStreamFollowsAudio) {
      for (const atom of resolvedGuards)
        if (atom.startsWith('audio:')) audio.add(atom.slice(6));
    }
    const pointer = atoms.has('pointer');
    variables.set(name, {
      audio: [...audio].sort(),
      clock: [...clock].sort(),
      random,
      memory: atoms.has(MEMORY_READ),
      pointer,
      history: [...atoms].some(
        (atom) =>
          atom.startsWith('prev:') &&
          previousSources(resolved, atom.slice(5)).length > 0,
      ),
      accumulates: atoms.has(`prev:${name}`),
      kind: audio.size
        ? 'audio'
        : pointer
          ? 'pointer'
          : clock.size || random
            ? 'clockwork'
            : 'constant',
    });
  }
  return { variables, randomStreamFollowsAudio };
}
