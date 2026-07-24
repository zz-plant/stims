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

const MAX_COMPILED_PRESET_CACHE = 50;
const compiledPresetCache = new Map<string, MilkdropCompiledPreset>();

export function clearCompiledPresetCache() {
  compiledPresetCache.clear();
}

export function compileMilkdropPresetSource(
  raw: string,
  source: Partial<MilkdropPresetSource> = {},
  options: MilkdropCompileOptions = {},
): MilkdropCompiledPreset {
  // If options or custom source overrides are specified, skip simple string cache
  const isSimpleCall =
    Object.keys(options).length === 0 &&
    (source.id === undefined || Object.keys(source).length <= 1);

  if (isSimpleCall) {
    const cached = compiledPresetCache.get(raw);
    if (cached) {
      compiledPresetCache.delete(raw);
      compiledPresetCache.set(raw, cached);
      return cached;
    }
  }

  const parsed = parseMilkdropPreset(raw);
  const diagnostics = [...parsed.diagnostics];
  const ir = createIR(parsed.ast, diagnostics, source, options);
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

  if (isSimpleCall) {
    if (compiledPresetCache.size >= MAX_COMPILED_PRESET_CACHE) {
      const oldestKey = compiledPresetCache.keys().next().value;
      if (oldestKey !== undefined) {
        compiledPresetCache.delete(oldestKey);
      }
    }
    compiledPresetCache.set(raw, compiled);
  }

  return compiled;
}
