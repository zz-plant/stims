import { expose } from 'comlink';
import {
  clearCompiledPresetCache,
  compileMilkdropPresetSource,
} from './compiler';
import {
  isShaderBranchDesugarEnabled,
  setShaderBranchDesugarEnabled,
} from './compiler/shader-branch-desugar';
import type { MilkdropEditorCompiler } from './types';

const editorCompiler: MilkdropEditorCompiler = {
  async compile(source, preset, options) {
    return compileMilkdropPresetSource(
      source,
      preset,
      options?.cacheCompile ? { cacheCompile: true } : {},
    );
  },

  // The branch desugar is a session flag held in a module-level boolean, and a
  // worker is its own module instance: nothing here ever saw the page resolve
  // the flag, so without this the worker compiled every preset with the
  // desugar off and reported `translated` for bodies the main thread had just
  // classified `direct`. The compiled-preset cache is keyed by raw source
  // alone, so a change of the setting has to drop it — otherwise the answers
  // from before the flip outlive it.
  async setShaderBranchDesugar(enabled) {
    if (enabled === isShaderBranchDesugarEnabled()) {
      return;
    }
    setShaderBranchDesugarEnabled(enabled);
    clearCompiledPresetCache();
  },
};

expose(editorCompiler);
