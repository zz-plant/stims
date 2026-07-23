import { describe, expect, test } from 'bun:test';
import {
  configureRendererRetryPolicy,
  getRendererRetrySnapshot,
  recordRendererRetryFailure,
  recordRendererRetrySuccess,
  resetRendererRetryPolicy,
} from '../../assets/js/core/renderer-retry-policy.ts';

describe('renderer retry policy', () => {
  test('backs off retryable WebGPU failures and resets after success', () => {
    let now = 1_000;
    resetRendererRetryPolicy();
    configureRendererRetryPolicy({
      maxAttempts: 3,
      baseBackoffMs: 100,
      maxBackoffMs: 1_000,
      now: () => now,
    });

    const first = recordRendererRetryFailure({
      environmentKey: 'desktop-chrome',
      failureKind: 'device-request',
      reason: 'Unable to acquire a WebGPU device.',
    });

    expect(first).toMatchObject({
      attempts: 1,
      maxAttempts: 3,
      lastFailureKind: 'device-request',
      canRetryNow: false,
    });

    now = 1_101;
    expect(getRendererRetrySnapshot('desktop-chrome').canRetryNow).toBe(true);

    recordRendererRetrySuccess('desktop-chrome');
    expect(getRendererRetrySnapshot('desktop-chrome')).toMatchObject({
      attempts: 0,
      canRetryNow: true,
      lastFailureKind: null,
    });
  });
});
