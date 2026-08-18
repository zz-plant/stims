import { expose } from 'comlink';
import { compileMilkdropPresetSource } from './compiler';
import type { MilkdropEditorCompiler } from './types';

const editorCompiler: MilkdropEditorCompiler = {
  async compile(source, preset, options) {
    return compileMilkdropPresetSource(
      source,
      preset,
      options?.cacheCompile ? { cacheCompile: true } : {},
    );
  },
};

expose(editorCompiler);
