import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ErrorCode, ErrorCodeSchema } from '../errors/error-code.js';
import {
  BIRTHDAY_NAME_PLACEHOLDER,
  BIRTHDAY_WISHES,
  renderBirthdayWish,
} from './birthday-wishes.js';
import { MESSAGE_MAX_LENGTH } from './limits.js';
import { QUEUES } from './queues.js';
import { REACTION_PHRASES } from './reaction-phrases.js';

describe('BIRTHDAY_WISHES', () => {
  it('has at least the 20 original wishes, each carrying the name placeholder', () => {
    expect(BIRTHDAY_WISHES.length).toBeGreaterThanOrEqual(20);
    for (const [index, wish] of BIRTHDAY_WISHES.entries()) {
      expect(wish, `wish ${index}`).toContain(BIRTHDAY_NAME_PLACEHOLDER);
    }
    expect(BIRTHDAY_NAME_PLACEHOLDER).toBe('${name}');
  });

  it('locks the order: an index is the stored wish id', () => {
    // Hash of the first 20 entries, so appending a wish keeps this green while
    // editing, removing or reordering an existing one turns it red.
    const prefix = JSON.stringify(BIRTHDAY_WISHES.slice(0, 20));
    expect(createHash('sha256').update(prefix).digest('hex')).toBe(
      '4e099a1e04cf9f6a8b1078684ba2fcde0018957c5e9fdfa5e662114601f19f30',
    );
  });

  it('fills every placeholder and rejects an unknown index', () => {
    const rendered = renderBirthdayWish(1, '<@123456789012345678>');
    expect(rendered).not.toContain('${name}');
    expect(rendered.match(/<@123456789012345678>/g)).toHaveLength(2);
    expect(() => renderBirthdayWish(BIRTHDAY_WISHES.length, 'x')).toThrow(RangeError);
    expect(() => renderBirthdayWish(-1, 'x')).toThrow(RangeError);
  });

  it('keeps every wish within one Discord message once a mention is filled in', () => {
    for (const index of BIRTHDAY_WISHES.keys()) {
      expect(renderBirthdayWish(index, '<@123456789012345678>').length).toBeLessThanOrEqual(
        MESSAGE_MAX_LENGTH,
      );
    }
  });
});

describe('REACTION_PHRASES', () => {
  it('holds the 12 legacy phrases, each with at least one reaction', () => {
    expect(Object.keys(REACTION_PHRASES)).toHaveLength(12);
    for (const reactions of Object.values(REACTION_PHRASES)) {
      expect(reactions.length).toBeGreaterThan(0);
    }
    expect(REACTION_PHRASES['react yes no']).toEqual(['yes', 'no']);
  });
});

describe('QUEUES and limits', () => {
  it('uses distinct queue names', () => {
    const names = Object.values(QUEUES);
    expect(new Set(names).size).toBe(names.length);
    expect(QUEUES.birthdayDaily).toBe('birthday-daily');
    expect(QUEUES.scheduledMessageSend).toBe('scheduled-message-send');
  });

  it('pins the Discord message limit', () => {
    expect(MESSAGE_MAX_LENGTH).toBe(2000);
  });
});

describe('ErrorCode', () => {
  it('maps each code to itself and keeps the screaming-snake format', () => {
    for (const code of ErrorCodeSchema.options) {
      expect(ErrorCode[code]).toBe(code);
      expect(code).toMatch(/^[A-Z]+(?:_[A-Z]+)*$/);
    }
  });
});
