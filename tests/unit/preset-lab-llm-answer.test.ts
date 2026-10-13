/**
 * lab:llm-answer turns a model's reply into the answer a benchmark scores,
 * so a parsing slip reads as the model's mistake. These cover the reply
 * shapes local models actually produce: fenced, thinking, and edit blocks
 * whose whitespace does not match the original.
 */
import { describe, expect, test } from 'bun:test';
import {
  applyEdits,
  editPrompt,
  extractAnswer,
  shaderFollowUp,
  shaderPrompt,
} from '../../scripts/preset-lab-llm-answer.ts';

const body = [
  'vec2 dz = vec2(0.0);',
  'dz -= texture2D(currentTex, uv).xyz;',
  'ret = vec3(dz, 0.0);',
].join('\n');

const block = (search: string, replace: string) =>
  `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

describe('extractAnswer', () => {
  test('takes the longest fenced block when the model fences its answer', () => {
    expect(
      extractAnswer('Here:\n```glsl\nret = a;\nret += b;\n```\nor ```\nx\n```'),
    ).toBe('ret = a;\nret += b;');
  });

  test('drops thinking and returns an unfenced reply as is', () => {
    expect(extractAnswer('<think>hmm</think>\nret = a;\n')).toBe('ret = a;');
  });
});

describe('applyEdits', () => {
  test('applies a verbatim block and keeps the rest', () => {
    const result = applyEdits(
      body,
      block(
        'dz -= texture2D(currentTex, uv).xyz;',
        'dz -= texture2D(currentTex, uv).xy;',
      ),
    );
    expect(result).toMatchObject({ applied: 1, failed: 0 });
    expect(result.text).toBe(body.replace(').xyz;', ').xy;'));
  });

  test('matches a block whose whitespace differs from the original', () => {
    const result = applyEdits(
      body,
      `\`\`\`\n${block('  dz -=  texture2D(currentTex,uv).xyz;\n', 'dz -= vec2(1.0);')}\n\`\`\``,
    );
    expect(result).toMatchObject({ applied: 1, failed: 0 });
    expect(result.text.split('\n')[1]).toBe('dz -= vec2(1.0);');
    expect(result.text.split('\n')).toHaveLength(3);
  });

  test('counts a block that matches nowhere and leaves the text alone', () => {
    const result = applyEdits(body, block('float nope = 1.0;', 'x'));
    expect(result).toEqual({ text: body, applied: 0, failed: 1 });
  });

  test('a repeated block counts once and does not fail', () => {
    const edit = block('ret = vec3(dz, 0.0);', 'ret = vec3(dz, 1.0);');
    const result = applyEdits(body, `${edit}\n\n${edit}`);
    expect(result).toMatchObject({ applied: 2, failed: 0 });
    expect(result.text.split('\n')[2]).toBe('ret = vec3(dz, 1.0);');
  });

  test('a reply with no blocks changes nothing', () => {
    expect(applyEdits(body, 'ret = vec3(0.0);')).toEqual({
      text: body,
      applied: 0,
      failed: 0,
    });
  });

  test('replacement text containing $ patterns is inserted literally', () => {
    const result = applyEdits(
      body,
      block('ret = vec3(dz, 0.0);', "ret = $&$'x;"),
    );
    expect(result.text.split('\n')[2]).toBe("ret = $&$'x;");
  });
});

describe('prompts', () => {
  const editTask = {
    taskId: 't',
    instruction:
      'Edit the MilkDrop preset "P" below into a remix of it.\n1. increase warp\nAnswer with the complete edited .milk preset.',
    parentSource: '[preset00]\nfWarp=1.0',
  };

  test('the edit format replaces the whole-preset request with the block form', () => {
    const prompt = editPrompt(editTask, 'edit');
    expect(prompt.user).not.toContain('Answer with the complete edited');
    expect(prompt.user).toContain('<<<<<<< SEARCH');
    expect(prompt.user).toContain('fWarp=1.0');
    expect(editPrompt(editTask, 'whole').user).toContain('all 2 lines');
  });

  const shaderTask = {
    taskId: 's',
    presetId: 'p',
    stage: 'composite' as const,
    source: 'float3 x;',
    glsl: body,
    error: "ERROR: 0:675: 'assign' : cannot convert",
    errorLine: 2,
  };

  test('the shader prompt quotes the line the error points at', () => {
    expect(shaderPrompt(shaderTask).user).toContain(
      'line 2 of the body:\ndz -= texture2D(currentTex, uv).xyz;',
    );
    expect(shaderPrompt(shaderTask, { errorLine: false }).user).not.toContain(
      'line 2 of the body',
    );
  });
});

describe('shaderFollowUp', () => {
  const failure = {
    error: "ERROR: 0:681: 'saturate' : no matching overloaded function found",
    errorLine: 3,
  };

  test('quotes the new error and the line of the current body it points at', () => {
    const text = shaderFollowUp(failure, body, 'whole');
    expect(text).toContain("'saturate'");
    expect(text).toContain('line 3 of the body:\nret = vec3(dz, 0.0);');
    expect(text).toContain('all 3 lines');
  });

  test('shows an edit-format model the body its edits produced, and what was skipped', () => {
    const text = shaderFollowUp(failure, body, 'edit', 2);
    expect(text).toContain('2 of your edits matched nothing');
    expect(text).toContain(body);
    expect(text).toContain('<<<<<<< SEARCH');
    expect(shaderFollowUp(failure, body, 'edit')).not.toContain(
      'matched nothing',
    );
  });
});
