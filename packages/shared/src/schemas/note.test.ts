import { describe, expect, it } from 'vitest';
import {
  NOTE_CONTENT_MAX_LENGTH,
  NOTE_TOPIC_MAX_LENGTH,
  NoteKeySchema,
  NoteUpsertSchema,
} from './note.js';

const ROLE = '123456789012345678';

describe('NoteUpsertSchema', () => {
  it('keeps the case of the topic and the layout of the content', () => {
    const parsed = NoteUpsertSchema.parse({
      roleId: ROLE,
      topic: 'Rules',
      content: '  first line\n\n    indented\n',
    });
    expect(parsed).toEqual({
      roleId: ROLE,
      topic: 'Rules',
      content: '  first line\n\n    indented\n',
    });
  });

  it('trims the topic so a typed topic and a suggested one are the same key', () => {
    expect(NoteUpsertSchema.parse({ roleId: ROLE, topic: ' Rules ', content: 'x' }).topic).toBe(
      'Rules',
    );
  });

  it('strips fields it does not know', () => {
    const parsed = NoteUpsertSchema.parse({
      roleId: ROLE,
      topic: 't',
      content: 'c',
      guildId: 'internal-key',
      id: 'row-id',
    });
    expect(parsed).toEqual({ roleId: ROLE, topic: 't', content: 'c' });
  });

  it('rejects empty and blank content or topic', () => {
    for (const content of ['', '   ', '\n\t\n']) {
      expect(NoteUpsertSchema.safeParse({ roleId: ROLE, topic: 't', content }).success).toBe(false);
    }
    for (const topic of ['', '   ']) {
      expect(NoteUpsertSchema.safeParse({ roleId: ROLE, topic, content: 'c' }).success).toBe(false);
    }
  });

  it('rejects content or a topic past its limit, and accepts exactly the limit', () => {
    const limit = (topic: string, content: string) =>
      NoteUpsertSchema.safeParse({ roleId: ROLE, topic, content }).success;
    expect(limit('t'.repeat(NOTE_TOPIC_MAX_LENGTH), 'c'.repeat(NOTE_CONTENT_MAX_LENGTH))).toBe(
      true,
    );
    expect(limit('t'.repeat(NOTE_TOPIC_MAX_LENGTH + 1), 'c')).toBe(false);
    expect(limit('t', 'c'.repeat(NOTE_CONTENT_MAX_LENGTH + 1))).toBe(false);
  });

  it('rejects a role that is not a snowflake, such as a mention', () => {
    for (const roleId of ['<@&123456789012345678>', '123', '', 42]) {
      expect(NoteUpsertSchema.safeParse({ roleId, topic: 't', content: 'c' }).success).toBe(false);
    }
  });
});

describe('NoteKeySchema', () => {
  it('takes only the role and the topic', () => {
    expect(NoteKeySchema.parse({ roleId: ROLE, topic: 't', content: 'dropped' })).toEqual({
      roleId: ROLE,
      topic: 't',
    });
  });
});
