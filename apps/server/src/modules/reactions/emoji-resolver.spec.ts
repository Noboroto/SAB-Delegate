import { describe, expect, it } from 'vitest';
import { EMOJI_SOURCE, resolveReactionEmoji } from './emoji-resolver.js';

const party = { id: '123456789012345678', name: 'party' };
const guild = {
  emojis: {
    cache: {
      find: (predicate: (emoji: { name: string | null }) => boolean) =>
        [party, { id: '2', name: null }].find(predicate),
    },
  },
};

describe('resolveReactionEmoji', () => {
  it('turns a name into the custom emoji of the server, matching the name exactly', () => {
    expect(resolveReactionEmoji(guild as never, 'party')).toBe(party);
    expect(resolveReactionEmoji(guild as never, 'Party')).toBe('Party');
  });

  it('leaves a unicode emoji and a custom-emoji string for discord.js to understand', () => {
    expect(resolveReactionEmoji(guild as never, '👌')).toBe('👌');
    expect(resolveReactionEmoji(guild as never, '<a:party:123456789012345678>')).toBe(
      '<a:party:123456789012345678>',
    );
  });

  it('returns the word unchanged when the server has no such emoji or there is no server', () => {
    expect(resolveReactionEmoji(guild as never, 'unknown')).toBe('unknown');
    expect(resolveReactionEmoji(null, 'party')).toBe('party');
  });
});

describe('EMOJI_SOURCE', () => {
  const whole = new RegExp(`^${EMOJI_SOURCE}$`, 'u');

  it('accepts unicode and custom emoji', () => {
    for (const text of [
      '🎉',
      '❌',
      '<:blob:123456789012345678>',
      '<a:party:12345678901234567890>',
    ]) {
      expect(whole.test(text), text).toBe(true);
    }
  });

  it('rejects words, short ids and unclosed custom emoji', () => {
    for (const text of [
      'yes',
      '<a:x:1>',
      '<:blob:123456789012345678',
      '<:bl ob:123456789012345678>',
    ]) {
      expect(whole.test(text), text).toBe(false);
    }
  });
});
