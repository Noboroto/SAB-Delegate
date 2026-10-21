import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const touchSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-client', () => ({ touchSession }));

import { SESSION_TOUCH_INTERVAL_MS, SessionKeepAlive } from './session-keep-alive';

beforeEach(() => {
  touchSession.mockReset();
  touchSession.mockResolvedValue(undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionKeepAlive', () => {
  it('reads the session once on mount, not on every render', () => {
    const { rerender } = render(<SessionKeepAlive />);
    rerender(<SessionKeepAlive />);
    rerender(<SessionKeepAlive />);
    expect(touchSession).toHaveBeenCalledTimes(1);
  });

  it('re-reads on focus only after an hour', () => {
    render(<SessionKeepAlive />);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(touchSession).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(SESSION_TOUCH_INTERVAL_MS + 1);
      window.dispatchEvent(new Event('focus'));
    });
    expect(touchSession).toHaveBeenCalledTimes(2);
  });
});
