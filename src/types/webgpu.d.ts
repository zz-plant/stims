// WebGPU platform globals (GPUBufferUsage, GPUShaderStage, GPUDevice, …).
//
// These used to arrive by accident: @types/three 0.183 carried a reference to
// @webgpu/types, so importing `three` happened to pull the globals in. 0.185
// dropped that, and every `GPUBufferUsage` in the WebGPU backend and the
// GPU-differential lab stopped resolving.
//
// A renderer with a first-class WebGPU path should not depend on its 3D
// library's type manifest to describe the platform it targets, so the
// reference is explicit here. tsconfig's `types` field only auto-includes
// `@types/*` packages, and this one is published under the `@webgpu` scope,
// so it has to be referenced rather than listed there.
/// <reference types="@webgpu/types" />
