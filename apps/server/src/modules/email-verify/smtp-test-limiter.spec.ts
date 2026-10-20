import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SMTP_TEST_MAX, SMTP_TEST_WINDOW_MS, SmtpTestLimiter } from './smtp-test-limiter.js';

describe('SmtpTestLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
    // lru-cache treats a clock reading of 0 as "no time".
    vi.advanceTimersByTime(1);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows five tests per person per window, then refuses until it ends', () => {
    const limiter = new SmtpTestLimiter();
    for (let i = 0; i < SMTP_TEST_MAX; i += 1) limiter.consume('a');
    expect(() => limiter.consume('a')).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }));
    // Another person has their own budget.
    expect(() => limiter.consume('b')).not.toThrow();
    vi.advanceTimersByTime(SMTP_TEST_WINDOW_MS + 1);
    expect(() => limiter.consume('a')).not.toThrow();
  });
});
