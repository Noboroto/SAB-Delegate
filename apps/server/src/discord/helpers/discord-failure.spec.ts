import { describe, expect, it } from 'vitest';
import { discordRefusal } from './discord-failure.js';

describe('discordRefusal', () => {
  it('gives Discord’s own explanation of a refusal', () => {
    const refusal = Object.assign(new Error('Missing Permissions'), { code: 50013 });
    expect(discordRefusal(refusal)).toBe('Missing Permissions');
  });

  it('gives nothing for an error that is not a refusal, so it reaches the error handler', () => {
    expect(discordRefusal(new TypeError('boom'))).toBeUndefined();
    expect(discordRefusal('text')).toBeUndefined();
  });

  it('keeps the explanation short', () => {
    const refusal = Object.assign(new Error('x'.repeat(500)), { code: 50013 });
    expect(discordRefusal(refusal)).toHaveLength(200);
  });
});
