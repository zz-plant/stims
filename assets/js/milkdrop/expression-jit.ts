import type { MilkdropExpressionNode } from './common-types.ts';

type JitFn = (env: Record<string, number>, r: () => number) => number;

const OPERATORS: Record<string, string> = {
  '+': 'l+r',
  '-': 'l-r',
  '*': 'l*r',
  '/': '(r===0?0:l/r)',
  '%': '(R===0?0:l%R)',
  '^': 'l**r',
  '<': '(l<r?1:0)',
  '<=': '(l<=r?1:0)',
  '>': '(l>r?1:0)',
  '>=': '(l>=r?1:0)',
  '==': '(l===r?1:0)',
  '!=': '(l!==r?1:0)',
  '&&': '(l&&r?1:0)',
  '||': '(l||r?1:0)',
};

const UNARY: Record<string, string> = {
  '+': '(+x)',
  '-': '(-x)',
  '!': '(x?-1:0)',
};

const FUNCTIONS: Record<string, string> = {
  sin: 'Math.sin',
  cos: 'Math.cos',
  tan: 'Math.tan',
  asin: '(a=Math.min(Math.max(a,-1),1),Math.asin(a))',
  acos: '(a=Math.min(Math.max(a,-1),1),Math.acos(a))',
  atan: 'Math.atan',
  atan2: 'Math.atan2',
  abs: 'Math.abs',
  sqrt: 'Math.sqrt(Math.max(0,a))',
  pow: '(a**b)',
  exp: 'Math.exp',
  log: 'Math.log(Math.max(1e-6,a))',
  sqr: '(a*a)',
  floor: 'Math.floor',
  ceil: 'Math.ceil',
  int: '((a|0)===a?a:Math.trunc(a))',
  frac: '(a-Math.floor(a))',
  sign: 'Math.sign',
  min: '(a<b?a:b)',
  max: '(a>b?a:b)',
  clamp: '(Math.min(Math.max(a,b),c))',
  mix: '(a+(b-a)*c)',
  lerp: '(a+(b-a)*c)',
  step: '(a>b?1:0)',
  smoothstep:
    '(function(e0,e1,x){var t=Math.max(0,Math.min((x-e0)/(e1-e0),1));return t*t*(3-2*t)})(a,b,c)',
  sigmoid: '(1/(1+Math.exp(-a*(b||1))))',
  above: '(a>b?1:0)',
  below: '(a<b?1:0)',
  equal: '(a===b?1:0)',
  if: '(a!==0?b:c)',
  mod: '(b===0?0:a%b)',
  fmod: '(b===0?0:a%b)',
  bor: '((a|0)|(b|0))',
  band: '((a|0)&(b|0))',
  bnot: '(~(a|0))',
  rand: 'r()*(a||1)',
};

function compileNode(node: MilkdropExpressionNode): string {
  switch (node.type) {
    case 'literal':
      return String(node.value);
    case 'identifier': {
      const name = node.name.toLowerCase();
      if (name === 'pi') return 'Math.PI';
      if (name === 'e') return 'Math.E';
      return `e[${JSON.stringify(node.name)}]`;
    }
    case 'unary': {
      const x = compileNode(node.operand);
      return UNARY[node.operator]?.replace('x', x) ?? '(0)';
    }
    case 'binary': {
      const l = compileNode(node.left);
      const r = compileNode(node.right);
      const op =
        node.operator === '%'
          ? `var R=Math.trunc(${r});${OPERATORS[node.operator]?.replace('R', 'R') ?? '(0)'}`
          : (OPERATORS[node.operator] ?? '(0)');
      return op.replace('l', l).replace('r', r);
    }
    case 'call': {
      const fn = FUNCTIONS[node.name.toLowerCase()];
      if (!fn) return '(0)';
      const args = node.args.map(compileNode);
      const names = ['a', 'b', 'c', 'd', 'e', 'f'];
      let code = fn;
      for (let i = args.length - 1; i >= 0; i--) {
        code = code.replace(names[i], () => args[i]);
      }
      return code;
    }
  }
}

const rawCache = new Map<string, JitFn>();

export function evaluateJit(
  node: MilkdropExpressionNode,
  env: Record<string, number>,
  nextRandom?: () => number,
): number {
  const key = JSON.stringify(node);
  let fn = rawCache.get(key);
  if (!fn) {
    const body = compileNode(node);
    fn = new Function(
      'e',
      'r',
      `"use strict";return (${body});`,
    ) as unknown as JitFn;
    rawCache.set(key, fn);
  }
  return fn(env, nextRandom ?? (() => Math.random()));
}

export function clearExpressionCache() {
  rawCache.clear();
}

export function getExpressionCacheSize() {
  return rawCache.size;
}
