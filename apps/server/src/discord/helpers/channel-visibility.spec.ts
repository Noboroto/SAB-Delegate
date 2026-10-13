import { describe, expect, it } from 'vitest';
import { isHiddenChannelError } from './channel-visibility.js';

describe('isHiddenChannelError', () => {
  it('treats unknown channel and missing access alike', () => {
    for (const code of [10003, 50001, 50013]) {
      expect(isHiddenChannelError({ code }), String(code)).toBe(true);
    }
  });

  it('leaves every other failure to be reported as it is', () => {
    expect(isHiddenChannelError({ code: 50035 })).toBe(false);
    expect(isHiddenChannelError(new Error('socket hang up'))).toBe(false);
    expect(isHiddenChannelError(null)).toBe(false);
  });
});
