import { describe, expect, test } from 'bun:test';
import type { MilkdropExpressionNode } from '../../src/js/milkdrop/common-types.ts';
import {
  foldExpression,
  foldProgramBlock,
} from '../../src/js/milkdrop/compiler/ast-constant-fold.ts';

function expectLiteral(node: MilkdropExpressionNode, value: number) {
  expect(node.type).toBe('literal');
  if (node.type === 'literal') {
    expect(node.value).toBeCloseTo(value, 6);
  }
}

describe('AST constant folding', () => {
  test('folds literal arithmetic', () => {
    // 2 * 3.14159265
    const result = foldExpression({
      type: 'binary',
      operator: '*',
      left: { type: 'literal', value: 2 },
      right: { type: 'literal', value: Math.PI },
    });
    expectLiteral(result, 2 * Math.PI);
  });

  test('folds division', () => {
    // 1.0 / 60.0
    const result = foldExpression({
      type: 'binary',
      operator: '/',
      left: { type: 'literal', value: 1 },
      right: { type: 'literal', value: 60 },
    });
    expectLiteral(result, 1 / 60);
  });

  test('folds pure intrinsic calls', () => {
    // sqrt(4)
    expectLiteral(
      foldExpression({
        type: 'call',
        name: 'sqrt',
        args: [{ type: 'literal', value: 4 }],
      }),
      2,
    );
    // abs(-1.5)
    expectLiteral(
      foldExpression({
        type: 'call',
        name: 'abs',
        args: [{ type: 'literal', value: -1.5 }],
      }),
      1.5,
    );
    // sqr(3)
    expectLiteral(
      foldExpression({
        type: 'call',
        name: 'sqr',
        args: [{ type: 'literal', value: 3 }],
      }),
      9,
    );
  });

  test('reduces identity x + 0', () => {
    const id: MilkdropExpressionNode = { type: 'identifier', name: 'wave_x' };
    const result = foldExpression({
      type: 'binary',
      operator: '+',
      left: id,
      right: { type: 'literal', value: 0 },
    });
    expect(result).toBe(id);
  });

  test('reduces identity x * 1', () => {
    const id: MilkdropExpressionNode = { type: 'identifier', name: 'wave_y' };
    const result = foldExpression({
      type: 'binary',
      operator: '*',
      left: id,
      right: { type: 'literal', value: 1 },
    });
    expect(result).toBe(id);
  });

  test('reduces x * 0 to 0', () => {
    const result = foldExpression({
      type: 'binary',
      operator: '*',
      left: { type: 'identifier', name: 'zoom' },
      right: { type: 'literal', value: 0 },
    });
    expectLiteral(result, 0);
  });

  test('does not fold runtime-mutable state', () => {
    const result = foldExpression({
      type: 'binary',
      operator: '+',
      left: { type: 'identifier', name: 'time' },
      right: { type: 'literal', value: 1 },
    });
    expect(result.type).toBe('binary');
    expect(result.type === 'binary' && result.left.type).toBe('identifier');
  });

  test('does not fold rand()', () => {
    const result = foldExpression({
      type: 'call',
      name: 'rand',
      args: [],
    });
    expect(result.type).toBe('call');
  });

  test('resolves pi and e identifiers to literals', () => {
    expectLiteral(foldExpression({ type: 'identifier', name: 'pi' }), Math.PI);
    expectLiteral(foldExpression({ type: 'identifier', name: 'e' }), Math.E);
  });

  test('folds a full program block', () => {
    const block = foldProgramBlock({
      statements: [
        {
          target: 'wave_x',
          expression: {
            type: 'binary',
            operator: '*',
            left: { type: 'identifier', name: 'time' },
            right: { type: 'literal', value: 1 },
          },
          line: 1,
          source: 'wave_x = time * 1',
        },
        {
          target: 'q1',
          expression: {
            type: 'call',
            name: 'abs',
            args: [{ type: 'literal', value: -1.5 }],
          },
          line: 2,
          source: 'q1 = abs(-1.5)',
        },
      ],
      sourceLines: [],
    });

    expect(block.statements[0]?.expression.type).toBe('identifier');
    expectLiteral(block.statements[1]?.expression as never, 1.5);
  });

  test('folds control flow counts and bodies', () => {
    const block = foldProgramBlock({
      statements: [
        {
          target: 'loop',
          expression: { type: 'literal', value: 0 },
          line: 1,
          source: '',
          control: {
            kind: 'loop',
            count: {
              type: 'binary',
              operator: '*',
              left: { type: 'literal', value: 2 },
              right: { type: 'literal', value: 3 },
            },
            body: [
              {
                target: 'sample',
                expression: {
                  type: 'binary',
                  operator: '+',
                  left: { type: 'identifier', name: 'sample' },
                  right: { type: 'literal', value: 0 },
                },
                line: 2,
                source: '',
              },
            ],
          },
        },
      ],
      sourceLines: [],
    });

    expectLiteral((block.statements[0]?.control?.count ?? null) as never, 6);
    expect(block.statements[0]?.control?.body[0]?.expression.type).toBe(
      'identifier',
    );
  });
});
