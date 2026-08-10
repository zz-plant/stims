// Cloudflare's Workers bundler turns .wasm imports into WebAssembly.Module
// instances. Bun's asset loader (used by bun test) resolves the same import
// to a file-path string, so consumers must handle both shapes at runtime.
declare module '*.wasm' {
  const wasmModule: WebAssembly.Module | string;
  export default wasmModule;
}
