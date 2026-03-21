import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from '../assets/js/milkdrop/shader-ast.ts';
import { normalizeMilkdropShaderSamplerName } from '../assets/js/milkdrop/shader-samplers.ts';

const SAMPLER_ALIAS_CASES = [
  {
    alias: 'sampler_fw_noise_lq',
    canonical: 'noise',
  },
  {
    alias: 'fw_noise_hq',
    canonical: 'noise',
  },
  {
    alias: 'sampler_noisevol',
    canonical: 'simplex',
  },
  {
    alias: 'sampler_fw_noisevol_lq',
    canonical: 'simplex',
  },
] as const;

describe('milkdrop shader sampler aliases', () => {
  test('normalizes supported aliases through the shared helper', () => {
    for (const { alias, canonical } of SAMPLER_ALIAS_CASES) {
      expect(normalizeMilkdropShaderSamplerName(alias)).toBe(canonical);
    }

    expect(normalizeMilkdropShaderSamplerName('sampler_unknown_alias')).toBe(
      null,
    );
  });

  test('keeps AST shader sampling aligned with compiler shader extraction', () => {
    for (const { alias, canonical } of SAMPLER_ALIAS_CASES) {
      const astStatement = parseMilkdropShaderStatement(
        `ret = tex2d(${alias}, uv)`,
      );
      expect(astStatement).not.toBeNull();
      if (!astStatement) {
        throw new Error(`Failed to parse shader statement for ${alias}`);
      }
      const astValue = evaluateMilkdropShaderExpression(
        astStatement.expression,
        { uv: { kind: 'vec2', value: [0.25, 0.75] } },
        {},
      );

      expect(astValue).toMatchObject({
        kind: 'sample',
        source: canonical,
      });

      const sampledCompile = compileMilkdropPresetSource(
        `title=Alias Sample\ncomp_shader=ret = tex2d(${alias}, uv).rgb`,
        { id: `sample-${alias}` },
      );
      expect(sampledCompile.ir.shaderText.supported).toBe(true);
      expect(sampledCompile.ir.post.shaderControls.textureLayer.source).toBe(
        canonical,
      );
      expect(sampledCompile.ir.post.shaderControls.textureLayer.mode).toBe(
        'replace',
      );

      const assignedCompile = compileMilkdropPresetSource(
        `title=Alias Control\ncomp_shader=texture_source = ${alias}`,
        { id: `control-${alias}` },
      );
      expect(assignedCompile.ir.shaderText.supported).toBe(true);
      expect(assignedCompile.ir.post.shaderControls.textureLayer.source).toBe(
        canonical,
      );
      expect(assignedCompile.ir.post.shaderControls.textureLayer.mode).toBe(
        'mix',
      );
    }
  });
});
