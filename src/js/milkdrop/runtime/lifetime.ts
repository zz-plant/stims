export function createMilkdropRuntimeLifetime() {
  let disposed = false;
  let attachmentRevision = 0;

  return {
    isActive() {
      return !disposed;
    },

    beginAttachment() {
      attachmentRevision += 1;
      return attachmentRevision;
    },

    isCurrentAttachment(revision: number) {
      return !disposed && revision === attachmentRevision;
    },

    dispose() {
      disposed = true;
      attachmentRevision += 1;
    },
  };
}

export type MilkdropRuntimeLifetime = ReturnType<
  typeof createMilkdropRuntimeLifetime
>;
