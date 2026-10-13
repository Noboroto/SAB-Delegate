import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_GUILD_A,
  FIXTURE_GUILD_B,
  FIXTURE_GUILD_BAD_CHANNEL,
  FIXTURE_GUILD_WORD_ONLY,
  prodShapedContent,
  writeLegacyFixture,
  type LegacyFixtureContent,
} from '../../testing/legacy-quickdb-fixtures.js';
import { readLegacy } from './read-source.js';
import { businessDate, shiftDate, transform } from './transform.js';
import type { PlannedGuild } from './types.js';

// 12:00 on 2026-10-13 in Asia/Ho_Chi_Minh.
const NOW = new Date('2026-10-13T05:00:00Z');

describe('transform', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quickdb-transform-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const planOf = (content: LegacyFixtureContent) => {
    writeLegacyFixture(dir, content);
    return transform(readLegacy(dir), NOW);
  };
  const guild = (plan: ReturnType<typeof planOf>, id: string): PlannedGuild => {
    const found = plan.guilds.find((candidate) => candidate.discordId === id);
    if (!found) throw new Error('guild missing from the plan');
    return found;
  };

  it('plans one guild per distinct key across birthday, config and word, never the max row', () => {
    const plan = planOf(prodShapedContent(NOW));
    expect(plan.guilds.map((planned) => planned.discordId)).toEqual([
      FIXTURE_GUILD_A,
      FIXTURE_GUILD_B,
      FIXTURE_GUILD_WORD_ONLY,
      FIXTURE_GUILD_BAD_CHANNEL,
    ]);
  });

  it('reads used wishes as the false entries of an array and of an object alike', () => {
    const array = planOf({
      birthday: { [FIXTURE_GUILD_A]: { wishes: [false, true, false, true] } },
    });
    const object = planOf({
      birthday: { [FIXTURE_GUILD_A]: { wishes: { '0': false, '1': true, '2': false, '3': true } } },
    });
    expect(guild(array, FIXTURE_GUILD_A).wishIndexes).toEqual([0, 2]);
    expect(guild(object, FIXTURE_GUILD_A)).toEqual(guild(array, FIXTURE_GUILD_A));
  });

  it('drops wish indexes past the shared list and keeps the rest', () => {
    const plan = planOf(prodShapedContent(NOW));
    expect(guild(plan, FIXTURE_GUILD_A).wishIndexes).toEqual([3, 7, 19]);
    expect(guild(plan, FIXTURE_GUILD_B).wishIndexes).toEqual([0, 19]);
    expect(plan.skipped.WISH_INDEX_OUT_OF_RANGE).toBe(1);
  });

  it('keeps only the last three business days of finished runs and drops the legacy flag matrix', () => {
    const plan = planOf(prodShapedContent(NOW));
    const today = businessDate(NOW);
    expect(guild(plan, FIXTURE_GUILD_A).completedDates).toEqual([
      shiftDate(today, -2),
      shiftDate(today, -1),
      today,
    ]);
    expect(guild(plan, FIXTURE_GUILD_B).completedDates).toEqual([today]);
    expect(plan.skipped.COMPLETED_DATE_EXPIRED).toBe(2);
    expect(plan.skipped.COMPLETED_DATE_INVALID).toBe(1);
    expect(plan.skipped.LEGACY_IS_COMPLETED_DROPPED).toBe(1);
  });

  it('uses the Asia/Ho_Chi_Minh day, not the UTC day, for the window', () => {
    // 17:30 UTC on the 12th is already the 13th in Vietnam.
    expect(businessDate(new Date('2026-10-12T17:30:00Z'))).toBe('2026-10-13');
    expect(businessDate(new Date('2026-10-12T16:30:00Z'))).toBe('2026-10-12');
  });

  it('skips impossible dates, duplicate student ids and malformed entries by code', () => {
    const plan = planOf(prodShapedContent(NOW));
    const birthdays = guild(plan, FIXTURE_GUILD_A).birthdays;
    expect(birthdays.map(({ studentId, month, day }) => [studentId, month, day])).toEqual([
      ['S001', 1, 5],
      ['S002', 2, 29],
    ]);
    // The Discord id is trimmed like the old append command did.
    expect(birthdays[0]?.discordId).toBe('300000000000000001');
    expect(plan.skipped).toMatchObject({
      BIRTHDAY_DATE_INVALID: 2,
      BIRTHDAY_DUPLICATE_STUDENT: 1,
      BIRTHDAY_ENTRY_INVALID: 2,
      BIRTHDAY_DAY_NOT_LIST: 1,
    });
  });

  it('counts legacy notes as unattributable and plans no note rows', () => {
    const plan = planOf(prodShapedContent(NOW));
    expect(plan.skipped.NOTE_UNATTRIBUTABLE).toBe(1);
    expect(plan.noteRows).toBe(1);
    expect(JSON.stringify(plan)).not.toContain('text');
  });

  it('defaults a missing or too small maxWords to 1500 and tolerates absent word fields', () => {
    const plan = planOf(prodShapedContent(NOW));
    expect(guild(plan, FIXTURE_GUILD_A).config.wordMaxWords).toBe(1500);
    expect(plan.skipped.WORD_MAX_WORDS_DEFAULTED).toBe(1);

    const bare = guild(plan, FIXTURE_GUILD_WORD_ONLY);
    expect(bare.config).toMatchObject({ wordChannelId: null, wordMaxWords: 1500 });
    expect(bare.wordGame).toEqual({
      started: true,
      lastUserId: '',
      lastWord: '',
      count: 0,
      words: [],
    });
  });

  it('turns used words into lower-case rows and skips empty ones', () => {
    const plan = planOf(prodShapedContent(NOW));
    expect(guild(plan, FIXTURE_GUILD_A).wordGame).toEqual({
      started: false,
      lastUserId: '300000000000000001',
      lastWord: 'world',
      count: 3,
      words: ['hello', 'world'],
    });
    expect(plan.skipped.WORD_EMPTY).toBe(1);
  });

  it('rebuilds a word that contains a dot from its nested path, then lower-cases and dedupes', () => {
    const plan = planOf({
      word: {
        [FIXTURE_GUILD_A]: {
          used: { Hello: true, a: { b: true, C: { d: true } }, A: { B: true }, e: {} },
        },
      },
    });
    expect(guild(plan, FIXTURE_GUILD_A).wordGame?.words.sort()).toEqual([
      'a.b',
      'a.c.d',
      'e',
      'hello',
    ]);
  });

  it('rejects finished days dated after today in the business time zone', () => {
    const today = businessDate(NOW);
    const plan = planOf({
      birthday: {
        [FIXTURE_GUILD_A]: {
          completedDates: {
            [today.replace(/-0/g, '-')]: true,
            [shiftDate(today, 1).replace(/-0/g, '-')]: true,
          },
        },
      },
    });
    expect(guild(plan, FIXTURE_GUILD_A).completedDates).toEqual([today]);
    expect(plan.skipped.COMPLETED_DATE_IN_FUTURE).toBe(1);
  });

  it('nulls an invalid channel id and skips rows whose key is not a snowflake', () => {
    const plan = planOf(prodShapedContent(NOW));
    expect(guild(plan, FIXTURE_GUILD_BAD_CHANNEL).config.introChannelId).toBeNull();
    expect(plan.skipped.CHANNEL_ID_INVALID).toBe(1);
    expect(plan.skipped.GUILD_KEY_INVALID).toBe(1);
    expect(guild(plan, FIXTURE_GUILD_A).config).toMatchObject({
      introChannelId: '210000000000000001',
      birthdayChannelId: '200000000000000001',
      wordChannelId: '220000000000000001',
    });
    expect(guild(plan, FIXTURE_GUILD_B).config.birthdayChannelId).toBeNull();
  });

  it('never puts a member value into the skip report', () => {
    const plan = planOf(prodShapedContent(NOW));
    const report = JSON.stringify(plan.skipped);
    for (const value of ['Member', '3000000', FIXTURE_GUILD_A]) expect(report).not.toContain(value);
  });
});
