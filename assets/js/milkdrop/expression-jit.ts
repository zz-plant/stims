import type { MilkdropExpressionNode } from './common-types.ts';
import { aliasMap } from './field-normalization.ts';

type JitFn = (
  env: Record<string, number>,
  r: () => number,
  megabuf: (index: number) => number,
) => number;
type CachedExpressionNode = MilkdropExpressionNode & { compiledFn?: JitFn };

function compileNode(node: MilkdropExpressionNode): string {
  switch (node.type) {
    case 'literal':
      return String(node.value);
    case 'identifier': {
      const name = node.name.toLowerCase();
      if (name === 'pi') return 'Math.PI';
      if (name === 'e') return 'Math.E';
      const normalized = name.replace(/[^a-z0-9_]+/gu, '_');
      const aliased = aliasMap[normalized] || normalized;
      if (aliased !== node.name) {
        return `(e[${JSON.stringify(node.name)}] ?? e[${JSON.stringify(aliased)}] ?? 0)`;
      }
      return `(e[${JSON.stringify(node.name)}] ?? 0)`;
    }
    case 'unary': {
      const x = compileNode(node.operand);
      switch (node.operator) {
        case '+':
          return `(+(${x}))`;
        case '-':
          return `(-(${x}))`;
        case '!':
          return `((${x}) === 0 ? 1 : 0)`;
      }
      return '(0)';
    }
    case 'binary': {
      const l = compileNode(node.left);
      const r = compileNode(node.right);
      switch (node.operator) {
        case '+':
          return `((${l}) + (${r}))`;
        case '-':
          return `((${l}) - (${r}))`;
        case '*':
          return `((${l}) * (${r}))`;
        case '/':
          return `(((${r}) === 0) ? 0 : (${l}) / (${r}))`;
        case '%':
          return `((function(a,b){var ai=Math.trunc(a)||0,bi=Math.trunc(b)||0;return bi===0?0:ai%bi})(${l},${r}))`;
        case '^':
          return `((${l}) ** (${r}))`;
        case '|':
          return `((Math.trunc(${l})||0) | (Math.trunc(${r})||0))`;
        case '&':
          return `((Math.trunc(${l})||0) & (Math.trunc(${r})||0))`;
        case '<':
          return `((${l}) < (${r}) ? 1 : 0)`;
        case '<=':
          return `((${l}) <= (${r}) ? 1 : 0)`;
        case '>':
          return `((${l}) > (${r}) ? 1 : 0)`;
        case '>=':
          return `((${l}) >= (${r}) ? 1 : 0)`;
        case '==':
          return `((${l}) === (${r}) ? 1 : 0)`;
        case '!=':
          return `((${l}) !== (${r}) ? 1 : 0)`;
        case '&&':
          return `((${l}) !== 0 && (${r}) !== 0 ? 1 : 0)`;
        case '||':
          return `((${l}) !== 0 || (${r}) !== 0 ? 1 : 0)`;
      }
      return '(0)';
    }
    case 'call': {
      const args = node.args.map(compileNode);
      const name = node.name.toLowerCase();
      switch (name) {
        case 'sin':
          return `Math.sin(${args[0] ?? '0'})`;
        case 'cos':
          return `Math.cos(${args[0] ?? '0'})`;
        case 'tan':
          return `Math.tan(${args[0] ?? '0'})`;
        case 'asin':
          return `Math.asin(Math.min(1, Math.max(-1, ${args[0] ?? '0'})))`;
        case 'acos':
          return `Math.acos(Math.min(1, Math.max(-1, ${args[0] ?? '0'})))`;
        case 'atan':
          return `Math.atan(${args[0] ?? '0'})`;
        case 'abs':
          return `Math.abs(${args[0] ?? '0'})`;
        case 'sqrt':
          return `Math.sqrt(Math.max(0, ${args[0] ?? '0'}))`;
        case 'pow':
          return `((${args[0] ?? '0'}) ** (${args[1] ?? '0'}))`;
        case 'mod':
        case 'fmod':
          return `((${args[1] ?? '0'}) === 0 ? 0 : (${args[0] ?? '0'}) % (${args[1] ?? '0'}))`;
        case 'min':
          return `Math.min(${args.join(',') || '0'})`;
        case 'max':
          return `Math.max(${args.join(',') || '0'})`;
        case 'mix':
        case 'lerp':
          return `((${args[0] ?? '0'}) + ((${args[1] ?? '0'}) - (${args[0] ?? '0'})) * (${args[2] ?? '0'}))`;
        case 'floor':
          return `Math.floor(${args[0] ?? '0'})`;
        case 'int':
          return `(Math.trunc(${args[0] ?? '0'})||0)`;
        case 'ceil':
          return `Math.ceil(${args[0] ?? '0'})`;
        case 'sqr':
          return `((${args[0] ?? '0'}) * (${args[0] ?? '0'}))`;
        case 'clamp':
          return `Math.min(Math.max(${args[0] ?? '0'}, ${args[1] ?? '0'}), ${args[2] ?? '1'})`;
        case 'step':
          return `((${args[1] ?? '0'}) < (${args[0] ?? '0'}) ? 0 : 1)`;
        case 'smoothstep':
          return `((function(e0,e1,v){if(e0===e1)return v<e0?0:1;var t=Math.min(Math.max((v-e0)/(e1-e0),0),1);return t*t*(3-2*t)})(${args[0] ?? '0'},${args[1] ?? '1'},${args[2] ?? '0'}))`;
        case 'log':
          return `Math.log(Math.max(0.000001, ${args[0] ?? '0'}))`;
        case 'exp':
          return `Math.exp(${args[0] ?? '0'})`;
        case 'sigmoid':
          return `(1 / (1 + Math.exp(-(${args[0] ?? '0'}) * (${args[1] ?? '1'}))))`;
        case 'sign':
          return `Math.sign(${args[0] ?? '0'})`;
        case 'bor':
          return `((Math.trunc(${args[0] ?? '0'})||0) | (Math.trunc(${args[1] ?? '0'})||0))`;
        case 'band':
          return `((Math.trunc(${args[0] ?? '0'})||0) & (Math.trunc(${args[1] ?? '0'})||0))`;
        case 'bnot':
          return `(~(Math.trunc(${args[0] ?? '0'})||0))`;
        case 'atan2':
          return `Math.atan2(${args[0] ?? '0'}, ${args[1] ?? '0'})`;
        case 'frac':
          return `((${args[0] ?? '0'}) - Math.floor(${args[0] ?? '0'}))`;
        case 'if':
          return `((${args[0] ?? '0'}) !== 0 ? (${args[1] ?? '0'}) : (${args[2] ?? '0'}))`;
        case 'above':
          return `((${args[0] ?? '0'}) > (${args[1] ?? '0'}) ? 1 : 0)`;
        case 'below':
          return `((${args[0] ?? '0'}) < (${args[1] ?? '0'}) ? 1 : 0)`;
        case 'equal':
          return `((${args[0] ?? '0'}) === (${args[1] ?? '0'}) ? 1 : 0)`;
        case 'rand':
          return `(r() * (${args[0] ?? '1'}))`;
        case 'megabuf':
          return `megabuf(${args[0] ?? '0'})`;
      }
      return '(0)';
    }
  }
}

const rawCache = new Map<string, JitFn>();

export function evaluateJit(
  node: MilkdropExpressionNode,
  env: Record<string, number>,
  nextRandom?: () => number,
  megabuf: (index: number) => number = () => 0,
): number {
  const cacheableNode = node as CachedExpressionNode;
  let fn = cacheableNode.compiledFn;
  if (!fn) {
    const key = JSON.stringify(node);
    fn = rawCache.get(key);
    if (!fn) {
      const body = compileNode(node);
      fn = new Function(
        'e',
        'r',
        'megabuf',
        `"use strict";return (${body});`,
      ) as unknown as JitFn;
      rawCache.set(key, fn);
    }
    try {
      cacheableNode.compiledFn = fn;
    } catch {
      // Safe fallback if node is frozen
    }
  }
  return fn(env, nextRandom ?? (() => Math.random()), megabuf);
}

export function clearExpressionCache() {
  rawCache.clear();
}

export function getExpressionCacheSize() {
  return rawCache.size;
}
