/**
 * lab:shader-fix-bench scoring. The real grader is glslangValidator, which
 * CI does not install, so these cover the scoring logic with a stand-in
 * validator: an answer must compile AND keep the shader's textures AND
 * stay a local edit, which is what stops "delete the broken line" or "empty
 * the stage" from scoring as a fix.
 */
import { describe, expect, test } from 'bun:test';
import {
  compileStage,
  editFraction,
  type ShaderFixTask,
  sampledTextures,
  scoreAnswer,
  summarize,
} from '../../scripts/preset-lab-shader-fix-bench.ts';

// A stand-in compiler that rejects the one mistake these fixtures contain:
// dot() over mismatched vector sizes.
const validate = (glsl: string) =>
  /dot\(uv, vec3/.test(glsl)
    ? "ERROR: 0:1: 'dot' : no matching overloaded function found"
    : null;

const broken = [
  '  vec3 base = texture2D(currentTex, sampleUv(uv, textureWrap)).rgb;',
  '  float glow = dot(uv, vec3(1.0));',
  '  vec3 noise = texture2D(sampler_noise_lq, uv).rgb;',
  '  ret = base * glow + noise * 0.1;',
].join('\n');
const fixed = broken.replace('dot(uv, vec3(1.0))', 'dot(uv, vec2(1.0))');

const bodies = { warp: broken, comp: '  ret = vec3(0.0);' };
const task: ShaderFixTask = {
  taskId: 'demo:warp',
  presetId: 'demo',
  stage: 'warp',
  source: '',
  glsl: broken,
  error: 'dot',
};

describe('compileStage', () => {
  test('assembles the answer into its stage before validating', () => {
    expect(compileStage(bodies, 'warp', broken, validate)).toContain('dot');
    expect(compileStage(bodies, 'warp', fixed, validate)).toBeNull();
    // The other stage keeps its own body.
    expect(compileStage(bodies, 'composite', null, validate)).toBeNull();
  });
});

describe('sampledTextures', () => {
  test('lists every texture a body samples', () => {
    expect([...sampledTextures(broken)].sort()).toEqual([
      'currentTex',
      'sampler_noise_lq',
    ]);
    expect(
      sampledTextures('ret = tex2D(sampler_main, uv).xyz;').has('sampler_main'),
    ).toBe(true);
    expect(sampledTextures('ret = vec3(0.0);').size).toBe(0);
  });

  test('ignores reads that are commented out', () => {
    const commented = [
      '  vec3 base = texture2D(currentTex, uv).rgb;',
      '  // vec3 noise = texture2D(sampler_noise_lq, uv).rgb;',
      '  /* vec3 blur = texture2D(sampler_blur1,',
      '     uv).rgb; */',
    ].join('\n');
    expect([...sampledTextures(commented)]).toEqual(['currentTex']);
  });
});

describe('editFraction', () => {
  test('is the share of lines changed, ignoring whitespace', () => {
    expect(editFraction(broken, broken)).toBe(0);
    expect(editFraction(broken, broken.replace(/ {2}/g, '\t'))).toBe(0);
    expect(editFraction(broken, fixed)).toBe(0.25);
    expect(editFraction(broken, '')).toBe(1);
  });
});

describe('scoreAnswer', () => {
  test('a local fix that compiles and keeps every texture is fixed', () => {
    expect(scoreAnswer(task, bodies, fixed, { validate })).toMatchObject({
      compiles: true,
      texturesKept: 1,
      editFraction: 0.25,
      fixed: true,
    });
  });

  test('the unchanged translation does not compile', () => {
    const score = scoreAnswer(task, bodies, broken, { validate });
    expect(score.compiles).toBe(false);
    expect(score.fixed).toBe(false);
  });

  test('emptying the stage compiles but is not a fix', () => {
    const score = scoreAnswer(task, bodies, '', { validate });
    expect(score).toMatchObject({
      compiles: true,
      texturesKept: 0,
      fixed: false,
    });
  });

  test('deleting the broken line and a texture read is not a fix', () => {
    const gutted = broken
      .split('\n')
      .filter((line) => !line.includes('dot(') && !line.includes('noise_lq'))
      .join('\n')
      .replace('base * glow + noise * 0.1', 'base');
    const score = scoreAnswer(task, bodies, gutted, { validate });
    expect(score.compiles).toBe(true);
    expect(score.texturesKept).toBe(0.5);
    expect(score.fixed).toBe(false);
  });

  test('a small edit that compiles but drops a texture is not a fix', () => {
    // Fixes the dot() and zeroes the noise read: two lines, so local, and it
    // compiles; only the lost texture disqualifies it.
    const dropped = fixed.replace(
      'texture2D(sampler_noise_lq, uv).rgb',
      'vec3(0.0)',
    );
    const score = scoreAnswer(task, bodies, dropped, { validate });
    expect(score).toMatchObject({ compiles: true, texturesKept: 0.5 });
    expect(score.changedLines).toBeLessThanOrEqual(2);
    expect(score.fixed).toBe(false);
  });

  test('a rewrite beyond --max-edit is not a fix', () => {
    const rewrite = [
      '  vec3 a = texture2D(currentTex, sampleUv(uv, textureWrap)).rgb;',
      '  vec3 b = texture2D(sampler_noise_lq, uv).rgb;',
      '  ret = a + b * dot(uv, vec2(1.0));',
    ].join('\n');
    const score = scoreAnswer(task, bodies, rewrite, { validate });
    expect(score.compiles).toBe(true);
    expect(score.editFraction).toBe(1);
    expect(score.fixed).toBe(false);
    expect(
      scoreAnswer(task, bodies, rewrite, { validate, maxEdit: 1 }).fixed,
    ).toBe(true);
  });

  test('on a short shader, fixing two lines is still local', () => {
    const short = [
      '  float a = dot(uv, vec3(1.0));',
      '  float b = dot(uv, vec3(2.0));',
      '  ret = texture2D(currentTex, uv).rgb * (a + b);',
    ].join('\n');
    const answer = short
      .replaceAll('vec3(1.0)', 'vec2(1.0)')
      .replaceAll('vec3(2.0)', 'vec2(2.0)');
    const score = scoreAnswer(
      { ...task, glsl: short },
      { ...bodies, warp: short },
      answer,
      {
        validate,
      },
    );
    expect(score.editFraction).toBeCloseTo(2 / 3, 10);
    expect(score.changedLines).toBe(2);
    expect(score.fixed).toBe(true);
  });

  test('summaries count compiles and fixes', () => {
    const summary = summarize([
      scoreAnswer(task, bodies, fixed, { validate }),
      scoreAnswer(task, bodies, '', { validate }),
    ]);
    expect(summary).toMatchObject({ tasks: 2, compiles: 2, fixed: 1 });
    expect(summary.meanTexturesKept).toBe(0.5);
  });
});
