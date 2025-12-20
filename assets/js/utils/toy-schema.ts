import { z } from 'zod';
import type { RendererCapabilities } from '../core/renderer-capabilities.ts';

export const toyEntrySchema = z
  .object({
    slug: z.string().min(1, 'Slug is required'),
    title: z.string().min(1, 'Title is required'),
    description: z.string().min(1, 'Description is required'),
    module: z.string().min(1, 'Module path is required'),
    type: z.enum(['module', 'page']).default('module'),
    controls: z.array(z.string()).default([]),
    requiresWebGPU: z.boolean().default(false),
    allowWebGLFallback: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.allowWebGLFallback && !value.requiresWebGPU) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'allowWebGLFallback may only be true when requiresWebGPU is true.',
        path: ['allowWebGLFallback'],
      });
    }
  });

const toyListSchema = z.array(toyEntrySchema).superRefine((list, ctx) => {
  const seen = new Set<string>();

  list.forEach((toy, index) => {
    if (seen.has(toy.slug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate toy slug detected: "${toy.slug}".`,
        path: [index, 'slug'],
      });
    } else {
      seen.add(toy.slug);
    }
  });
});

export type ToyEntry = z.infer<typeof toyEntrySchema>;

export type ToyCapabilityPolicy = {
  entryType: ToyEntry['type'];
  requiresWebGPU: boolean;
  allowWebGLFallback: boolean;
};

export type ValidatedToyEntry = ToyEntry & {
  capabilityPolicy: ToyCapabilityPolicy;
};

export type CapabilityDecision =
  | { status: 'ok'; fallbackReason: null; policy: ToyCapabilityPolicy }
  | { status: 'warn'; fallbackReason: string | null; policy: ToyCapabilityPolicy }
  | { status: 'block'; fallbackReason: string | null; policy: ToyCapabilityPolicy };

export function validateToyMetadata(input: unknown): ValidatedToyEntry[] {
  const parsed = toyListSchema.parse(input);

  return parsed.map((toy) => ({
    ...toy,
    requiresWebGPU: toy.requiresWebGPU ?? false,
    allowWebGLFallback: toy.allowWebGLFallback ?? false,
    controls: toy.controls ?? [],
    capabilityPolicy: {
      entryType: toy.type,
      requiresWebGPU: toy.requiresWebGPU ?? false,
      allowWebGLFallback: toy.allowWebGLFallback ?? false,
    },
  }));
}

export function evaluateCapabilityPolicy(
  policy: ToyCapabilityPolicy,
  capabilities: RendererCapabilities
): CapabilityDecision {
  if (!policy.requiresWebGPU) {
    return { status: 'ok', fallbackReason: null, policy };
  }

  if (capabilities.preferredBackend === 'webgpu') {
    return { status: 'ok', fallbackReason: null, policy };
  }

  if (policy.allowWebGLFallback) {
    return { status: 'warn', fallbackReason: capabilities.fallbackReason ?? null, policy };
  }

  return { status: 'block', fallbackReason: capabilities.fallbackReason ?? null, policy };
}
