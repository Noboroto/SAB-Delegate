import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, resolveLocale, toSupportedLocale } from './locale.js';
import { parseMessageRef } from './message-ref.js';
import { parseSnowflakes } from './snowflakes.js';
import { splitMessage } from './split-message.js';

const GUILD = '111111111111111111';
const CHANNEL = '222222222222222222';
const MESSAGE = '333333333333333333';
// A high surrogate with no low one after it, or a low one with no high one before it.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const LINK = `https://discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`;

describe('splitMessage', () => {
  it('keeps text at the limit in one piece and splits one character past it', () => {
    expect(splitMessage('a'.repeat(2000))).toEqual(['a'.repeat(2000)]);
    const pieces = splitMessage(`${'a'.repeat(1999)}\nb`);
    expect(pieces).toEqual(['a'.repeat(1999), 'b']);
  });

  it('packs whole lines together and never exceeds the limit', () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    const pieces = splitMessage(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(2000);
    expect(pieces.join('\n')).toBe(text);
  });

  it('cuts a single line longer than the limit hard', () => {
    const pieces = splitMessage('a'.repeat(4500));
    expect(pieces.map((p) => p.length)).toEqual([2000, 2000, 500]);
  });

  it('does not strand half of a surrogate pair at a cut', () => {
    const pieces = splitMessage('😀'.repeat(5), 5);
    expect(pieces.join('')).toBe('😀'.repeat(5));
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(5);
      expect(piece).not.toMatch(LONE_SURROGATE);
    }
  });

  it('answers a placeholder for empty or blank input, which Discord would reject', () => {
    expect(splitMessage('')).toEqual(['(empty)']);
    expect(splitMessage('  \n \t\n')).toEqual(['(empty)']);
  });

  it('drops blank pieces between real ones', () => {
    expect(splitMessage(`${'a'.repeat(5)}\n   \n${'b'.repeat(5)}`, 5)).toEqual(['aaaaa', 'bbbbb']);
  });

  it('rejects a limit that cannot make progress', () => {
    expect(() => splitMessage('x', 0)).toThrow(RangeError);
    expect(() => splitMessage('x', 1.5)).toThrow(RangeError);
  });
});

describe('parseMessageRef', () => {
  const ok = { ok: true, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE };

  it.each([
    ['a plain link', LINK],
    ['a link wrapped in angle brackets', `<${LINK}>`],
    ['a link with a trailing slash', `${LINK}/`],
    ['surrounding whitespace', `  \n${LINK}\t `],
    ['ptb', `https://ptb.discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`],
    ['canary', `https://canary.discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`],
    ['discordapp.com', `https://discordapp.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`],
    ['a trailing query', `${LINK}?utm=1`],
    ['no scheme', `discord.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`],
  ])('reads %s', (_label, input) => {
    expect(parseMessageRef(input)).toEqual(ok);
  });

  it('reads a direct-message link without a guild', () => {
    expect(parseMessageRef(`https://discord.com/channels/@me/${CHANNEL}/${MESSAGE}`)).toEqual({
      ok: true,
      channelId: CHANNEL,
      messageId: MESSAGE,
    });
  });

  it('reads a channel/message pair, as the old parser did', () => {
    expect(parseMessageRef(`${CHANNEL}/${MESSAGE}`)).toEqual({
      ok: true,
      channelId: CHANNEL,
      messageId: MESSAGE,
    });
  });

  it('resolves a bare message id in the default channel', () => {
    expect(parseMessageRef(MESSAGE, { channelId: CHANNEL })).toEqual({
      ok: true,
      channelId: CHANNEL,
      messageId: MESSAGE,
    });
  });

  it('says why a bare id cannot be used without a default channel', () => {
    expect(parseMessageRef(MESSAGE)).toEqual({ ok: false, reason: 'CHANNEL_REQUIRED' });
  });

  it('says the input was empty', () => {
    expect(parseMessageRef('')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parseMessageRef('  <> ')).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it.each([
    'hello',
    `https://example.com/channels/${GUILD}/${CHANNEL}/${MESSAGE}`,
    `https://discord.com/channels/${GUILD}/${CHANNEL}`,
    `https://discord.com/channels/${GUILD}/${CHANNEL}/12345`,
    `${LINK}/extra`,
    '123',
  ])('rejects %s as malformed', (input) => {
    expect(parseMessageRef(input, { channelId: CHANNEL })).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
  });
});

describe('parseSnowflakes', () => {
  const A = '444444444444444444';
  const B = '55555555555555555';
  const ROLE = '666666666666666666';

  it('reads mentions, commas, spaces and newlines in order of appearance', () => {
    expect(parseSnowflakes(`<@${A}>, ${B}\n<@!${A}> ${B}`)).toEqual([A, B]);
  });

  it('ignores role, channel and custom emoji mentions', () => {
    expect(
      parseSnowflakes(`<@&${ROLE}> <#${ROLE}> <:wave:${ROLE}> <a:dance:${ROLE}> ${A}`),
    ).toEqual([A]);
  });

  it('keeps only ids of 17 to 20 digits', () => {
    const tooShort = '1'.repeat(16);
    const tooLong = '2'.repeat(21);
    const longest = '3'.repeat(20);
    expect(parseSnowflakes(`${tooShort} ${tooLong} ${longest} ${B}`)).toEqual([longest, B]);
  });

  it('returns nothing for text without ids', () => {
    expect(parseSnowflakes('')).toEqual([]);
    expect(parseSnowflakes('no ids here, 123')).toEqual([]);
  });
});

describe('locale resolution', () => {
  it('maps regional tags onto the catalog language', () => {
    expect(toSupportedLocale('vi')).toBe('vi');
    expect(toSupportedLocale('en-US')).toBe('en');
    expect(toSupportedLocale('EN_gb')).toBe('en');
    expect(toSupportedLocale('fr')).toBeUndefined();
    expect(toSupportedLocale('')).toBeUndefined();
    expect(toSupportedLocale(null)).toBeUndefined();
  });

  it('takes the first supported candidate and skips unsupported ones', () => {
    expect(resolveLocale(['en', 'vi'])).toBe('en');
    expect(resolveLocale([undefined, 'fr', 'en-GB', 'vi'])).toBe('en');
  });

  it('falls back to Vietnamese when nothing is supported', () => {
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(['fr', null, 'ja'])).toBe('vi');
  });
});
