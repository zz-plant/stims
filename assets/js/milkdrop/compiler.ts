import { createIR, createPresetSource } from './compiler/core';
import { DEFAULT_MILKDROP_STATE } from './compiler/default-state';
import {
  evaluateMilkdropShaderControlExpressions,
  evaluateMilkdropShaderControlProgram,
} from './compiler/shader-analysis';
import { formatMilkdropPreset } from './formatter';
import { parseMilkdropPreset } from './preset-parser';
import type {
  MilkdropCompiledPreset,
  MilkdropCompileOptions,
  MilkdropPresetSource,
} from './types';

export {
  DEFAULT_MILKDROP_STATE,
  evaluateMilkdropShaderControlExpressions,
  evaluateMilkdropShaderControlProgram,
};

export function compileMilkdropPresetSource(
  raw: string,
  source: Partial<MilkdropPresetSource> = {},
  _options: MilkdropCompileOptions = {},
): MilkdropCompiledPreset {
  const parsed = parseMilkdropPreset(raw);
  const diagnostics = [...parsed.diagnostics];
  const ir = createIR(parsed.ast, diagnostics, source);
  const presetSource = createPresetSource(source, raw, ir.title, ir.author);

  const compiled: MilkdropCompiledPreset = {
    source: presetSource,
    ast: parsed.ast,
    ir,
    diagnostics,
    formattedSource: '',
    title: presetSource.title,
    author: presetSource.author,
  };

  compiled.formattedSource = formatMilkdropPreset(compiled);
  return compiled;
}
