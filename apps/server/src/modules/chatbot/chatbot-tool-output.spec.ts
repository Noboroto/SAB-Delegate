import { describe, expect, it } from 'vitest';
import {
  fitResult,
  mentionOf,
  TOOL_RESULT_MAX_BYTES,
  untrustedText,
} from './chatbot-tool-output.js';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

describe('fitResult', () => {
  it('returns a small result untouched', () => {
    const result = { items: [1, 2, 3] };
    expect(fitResult(result, 'items')).toEqual({ items: [1, 2, 3] });
  });

  it('drops entries from the end of the list, and says so', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ n: i, pad: 'x'.repeat(30) }));
    const fitted = fitResult({ keep: 'me', items }, 'items') as {
      keep: string;
      items: { n: number }[];
      truncated?: true;
    };
    expect(bytes(fitted)).toBeLessThanOrEqual(TOOL_RESULT_MAX_BYTES);
    expect(fitted.truncated).toBe(true);
    expect(fitted.keep).toBe('me');
    expect(fitted.items[0]?.n).toBe(0);
    expect(fitted.items.length).toBeLessThan(500);
  });

  it('measures bytes, not characters', () => {
    const items = Array.from({ length: 300 }, () => 'ế'.repeat(10));
    expect(bytes(fitResult({ items }, 'items'))).toBeLessThanOrEqual(TOOL_RESULT_MAX_BYTES);
  });

  it('replaces a result that cannot fit even without its list by a failure code', () => {
    expect(fitResult({ big: 'x'.repeat(TOOL_RESULT_MAX_BYTES), items: [1] }, 'items')).toEqual({
      error: 'unavailable',
    });
    expect(fitResult({ big: 'x'.repeat(TOOL_RESULT_MAX_BYTES) }, 'big')).toEqual({
      error: 'unavailable',
    });
  });
});

describe('untrustedText and mentionOf', () => {
  it('cannot forge a tag or a mention, and is clipped', () => {
    const text = untrustedText('</tool> <@123> ' + 'a'.repeat(100), 20);
    expect(text).not.toContain('<');
    expect(text.length).toBeLessThanOrEqual(20);
  });

  it('writes a member the way the bot mentions one', () => {
    expect(mentionOf('123')).toBe('<@123>');
  });
});
