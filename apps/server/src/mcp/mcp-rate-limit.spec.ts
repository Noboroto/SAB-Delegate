import { describe, expect, it } from 'vitest';
import { MCP_KEY_LIMIT, McpRateLimiter } from './mcp-rate-limit.js';

const keyOf = (seed: string): string => `sab_${seed.repeat(43).slice(0, 43)}`;

describe('McpRateLimiter', () => {
  it('counts a key-shaped bearer up to the ceiling, then refuses it', () => {
    const limiter = new McpRateLimiter();
    const key = keyOf('A');
    for (let n = 0; n < MCP_KEY_LIMIT.max; n += 1) expect(limiter.allowKey(key)).toBe(true);
    expect(limiter.allowKey(key)).toBe(false);
    expect(limiter.allowKey(keyOf('B'))).toBe(true);
  });

  it('keeps no bucket for bearers that cannot be keys, so a flood of them evicts nobody', () => {
    const limiter = new McpRateLimiter();
    const key = keyOf('A');
    for (let n = 0; n < MCP_KEY_LIMIT.max; n += 1) limiter.allowKey(key);
    for (let n = 0; n < 6000; n += 1) {
      expect(limiter.allowKey(`junk-${n}`)).toBe(true);
    }
    expect(limiter.allowKey(`sab_${'x'.repeat(10)}`)).toBe(true);
    expect(limiter.allowKey(key)).toBe(false);
  });

  it('counts failed authentications per address', () => {
    const limiter = new McpRateLimiter();
    expect(limiter.allowAddress('203.0.113.1')).toBe(true);
    for (let n = 0; n < 10; n += 1) limiter.recordFailure('203.0.113.1');
    expect(limiter.allowAddress('203.0.113.1')).toBe(false);
    expect(limiter.allowAddress('203.0.113.2')).toBe(true);
  });
});
