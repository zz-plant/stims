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

/**
 * The compiled preset carries its source (id, title), so the cache is keyed on
 * the id as well as the text. Keyed on text alone, two presets with identical
 * text shared one entry and the second got the first one's id back, which
 * anything keyed by preset id (solo/mute, drafts, lineage) then mixed up.
 */
function cacheKey(raw: string, id: string | undefined) {
  return `${id ?? ''}\u0000${raw}`;
}

function insertCompiledPresetCacheEntry(
  key: string,
  compiled: MilkdropCompiledPreset,
) {
  compiledPresetCache.delete(key);
  compiledPresetCache.set(key, compiled);

  while (compiledPresetCache.size > MAX_COMPILED_PRESET_CACHE) {
    const oldestKey = compiledPresetCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    compiledPresetCache.delete(oldestKey);
  }
}

export function clearCompiledPresetCache() {
  compiledPresetCache.clear();
}

export function getCompiledPresetCacheSize() {
  return compiledPresetCache.size;
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
  // The load path opts into the raw-string cache explicitly so re-loading a
  // preset skips the parse+IR rebuild. Only honored when no other compile
  // option could make the cached IR stale.
  const cacheable =
    isSimpleCall ||
    (options.cacheCompile === true && Object.keys(options).length === 1);

  const key = cacheKey(raw, source.id);
  if (cacheable) {
    const cached = compiledPresetCache.get(key);
    if (cached) {
      insertCompiledPresetCacheEntry(key, cached);
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

  if (cacheable) {
    insertCompiledPresetCacheEntry(key, compiled);
  }

  return compiled;
}

export function warmupCompiledPresetCache(presets: MilkdropCompiledPreset[]) {
  presets.slice(-MAX_COMPILED_PRESET_CACHE).forEach((compiled) => {
    if (compiled.source?.raw) {
      insertCompiledPresetCacheEntry(
        cacheKey(compiled.source.raw, compiled.source.id),
        compiled,
      );
    }
  });
}
