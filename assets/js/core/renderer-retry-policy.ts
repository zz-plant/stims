export type RendererRetryFailureKind =
  | 'device-request'
  | 'renderer-init'
  | 'device-lost'
  | 'presentation-context'
  | 'unknown';

export type RendererRetryPolicyConfig = {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  now: () => number;
};

export type RendererRetrySnapshot = {
  attempts: number;
  maxAttempts: number;
  lastFailureKind: RendererRetryFailureKind | null;
  lastFailureReason: string | null;
  nextRetryAt: number | null;
  canRetryNow: boolean;
};

const DEFAULT_POLICY: RendererRetryPolicyConfig = {
  maxAttempts: 3,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  now: () => Date.now(),
};

type RetryEntry = {
  attempts: number;
  lastFailureKind: RendererRetryFailureKind;
  lastFailureReason: string;
  nextRetryAt: number;
};

let policy = { ...DEFAULT_POLICY };
const entries = new Map<string, RetryEntry>();

function getBackoffMs(attempts: number) {
  return Math.min(
    policy.maxBackoffMs,
    policy.baseBackoffMs * 2 ** Math.max(0, attempts - 1),
  );
}

export function configureRendererRetryPolicy(
  config: Partial<RendererRetryPolicyConfig>,
) {
  policy = { ...policy, ...config };
}

export function resetRendererRetryPolicy() {
  policy = { ...DEFAULT_POLICY };
  entries.clear();
}

export function recordRendererRetrySuccess(environmentKey: string) {
  entries.delete(environmentKey);
}

export function recordRendererRetryFailure({
  environmentKey,
  failureKind,
  reason,
}: {
  environmentKey: string;
  failureKind: RendererRetryFailureKind;
  reason: string;
}): RendererRetrySnapshot {
  const previous = entries.get(environmentKey);
  const attempts = (previous?.attempts ?? 0) + 1;
  const nextRetryAt = policy.now() + getBackoffMs(attempts);
  entries.set(environmentKey, {
    attempts,
    lastFailureKind: failureKind,
    lastFailureReason: reason,
    nextRetryAt,
  });
  return getRendererRetrySnapshot(environmentKey);
}

export function getRendererRetrySnapshot(
  environmentKey: string,
): RendererRetrySnapshot {
  const entry = entries.get(environmentKey);
  if (!entry) {
    return {
      attempts: 0,
      maxAttempts: policy.maxAttempts,
      lastFailureKind: null,
      lastFailureReason: null,
      nextRetryAt: null,
      canRetryNow: true,
    };
  }

  return {
    attempts: entry.attempts,
    maxAttempts: policy.maxAttempts,
    lastFailureKind: entry.lastFailureKind,
    lastFailureReason: entry.lastFailureReason,
    nextRetryAt: entry.nextRetryAt,
    canRetryNow:
      entry.attempts < policy.maxAttempts && policy.now() >= entry.nextRetryAt,
  };
}
