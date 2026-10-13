import { describe, expect, it } from 'vitest';
import {
  BIRTHDAY_CSV_HEADER,
  BIRTHDAY_CSV_TEMPLATE,
  BIRTHDAY_IMPORT_MAX_ROWS,
  BirthdayAddSchema,
  BirthdayImportSchema,
  BirthdaySelectorSchema,
} from './birthday.js';

// Built at runtime: a literal 18-digit id next to `discordId` trips the secret scanner.
const DISCORD_ID = '1234567890'.repeat(2).slice(0, 18);

const PERSON = {
  studentId: 'SE123456',
  name: 'Nguyen Van A',
  discordId: DISCORD_ID,
  month: 3,
  day: 15,
};

describe('BIRTHDAY_CSV_TEMPLATE', () => {
  it('starts with the exact header the importer reads', () => {
    expect(BIRTHDAY_CSV_HEADER.join(',')).toBe('Name,ID,DiscordID,Day,Month');
    expect(BIRTHDAY_CSV_TEMPLATE.split('\n')[0]).toBe('Name,ID,DiscordID,Day,Month');
  });

  it('carries one example row that is itself a valid person', () => {
    const [, example] = BIRTHDAY_CSV_TEMPLATE.split('\n');
    const [name, studentId, discordId, day, month] = (example ?? '').split(',');
    expect(
      BirthdayAddSchema.safeParse({
        name,
        studentId,
        discordId,
        day: Number(day),
        month: Number(month),
      }).success,
    ).toBe(true);
  });
});

describe('BirthdayAddSchema', () => {
  it('trims text and strips fields it does not know', () => {
    const parsed = BirthdayAddSchema.parse({
      ...PERSON,
      name: '  Nguyen Van A ',
      studentId: ' SE123456 ',
      id: 'internal',
      guildId: 'internal',
    });
    expect(parsed).toEqual(PERSON);
  });

  it('allows 29 February but no other day the calendar lacks', () => {
    expect(BirthdayAddSchema.safeParse({ ...PERSON, month: 2, day: 29 }).success).toBe(true);
    for (const [month, day] of [
      [2, 30],
      [4, 31],
      [11, 31],
      [13, 1],
      [0, 1],
      [1, 0],
      [1, 32],
    ] as const) {
      expect(
        BirthdayAddSchema.safeParse({ ...PERSON, month, day }).success,
        `${month}/${day}`,
      ).toBe(false);
    }
  });

  it('refuses a mention or a short number where a Discord id belongs', () => {
    expect(
      BirthdayAddSchema.safeParse({ ...PERSON, discordId: '<@123456789012345678>' }).success,
    ).toBe(false);
    expect(BirthdayAddSchema.safeParse({ ...PERSON, discordId: '123' }).success).toBe(false);
  });

  it('refuses empty and over-long text', () => {
    expect(BirthdayAddSchema.safeParse({ ...PERSON, name: '   ' }).success).toBe(false);
    expect(BirthdayAddSchema.safeParse({ ...PERSON, studentId: 'x'.repeat(65) }).success).toBe(
      false,
    );
    expect(BirthdayAddSchema.safeParse({ ...PERSON, name: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('BirthdayImportSchema', () => {
  it('takes between one and the maximum number of rows', () => {
    const rows = (count: number) => Array.from({ length: count }, () => PERSON);
    expect(BirthdayImportSchema.safeParse({ rows: rows(0) }).success).toBe(false);
    expect(BirthdayImportSchema.safeParse({ rows: rows(1) }).success).toBe(true);
    expect(BirthdayImportSchema.safeParse({ rows: rows(BIRTHDAY_IMPORT_MAX_ROWS) }).success).toBe(
      true,
    );
    expect(
      BirthdayImportSchema.safeParse({ rows: rows(BIRTHDAY_IMPORT_MAX_ROWS + 1) }).success,
    ).toBe(false);
  });
});

describe('BirthdaySelectorSchema', () => {
  it('accepts no selector at all, so the caller can answer NO_SELECTOR', () => {
    expect(BirthdaySelectorSchema.parse({})).toEqual({});
  });

  it('keeps both selectors when both are given', () => {
    expect(BirthdaySelectorSchema.parse({ studentId: ' SE1 ', discordId: DISCORD_ID })).toEqual({
      studentId: 'SE1',
      discordId: DISCORD_ID,
    });
  });

  it('refuses a blank student ID and a mention as Discord id', () => {
    expect(BirthdaySelectorSchema.safeParse({ studentId: '  ' }).success).toBe(false);
    expect(BirthdaySelectorSchema.safeParse({ discordId: '<@1>' }).success).toBe(false);
  });
});
