import { expose } from 'comlink';
import { compileMilkdropPresetSource } from './compiler';
import type { MilkdropEditorCompiler } from './types';

const editorCompiler: MilkdropEditorCompiler = {
  async compile(source, preset) {
    return compileMilkdropPresetSource(source, preset);
  },
};

expose(editorCompiler);
