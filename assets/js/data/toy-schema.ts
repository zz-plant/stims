import { z } from 'zod';

const toyCapabilitiesSchema = z.object({
  microphone: z.boolean(),
  demoAudio: z.boolean(),
  motion: z.boolean(),
});

const lifecycleStageSchema = z.enum(['featured', 'prototype', 'archived']);

export const toyEntrySchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    module: z.string().min(1),
    type: z.enum(['module', 'page']),
    requiresWebGPU: z.boolean().optional(),
    allowWebGLFallback: z.boolean().optional(),
    lifecycleStage: lifecycleStageSchema.optional(),
    featuredRank: z.number().int().positive().optional(),
    moods: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    controls: z.array(z.string().min(1)).optional(),
    capabilities: toyCapabilitiesSchema,
  })
  .superRefine((entry, ctx) => {
    if (entry.allowWebGLFallback && !entry.requiresWebGPU) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'allowWebGLFallback requires requiresWebGPU to be true.',
        path: ['allowWebGLFallback'],
      });
    }
  });

export const toyManifestSchema = z
  .array(toyEntrySchema)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate slug "${entry.slug}" detected.`,
          path: [index, 'slug'],
        });
      }
      seen.add(entry.slug);
    });
  });

export type ToyEntry = z.infer<typeof toyEntrySchema>;
export type ToyManifest = z.infer<typeof toyManifestSchema>;
