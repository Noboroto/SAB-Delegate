import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LEGACY_FILES, type LegacyFileKey } from '../tools/migrate-quickdb/types.js';
import { businessDate, shiftDate } from '../tools/migrate-quickdb/transform.js';

/** Synthetic ids shaped like Discord snowflakes; none belongs to a real guild or member. */
export const FIXTURE_GUILD_A = '100000000000000001';
export const FIXTURE_GUILD_B = '100000000000000002';
export const FIXTURE_GUILD_WORD_ONLY = '100000000000000003';
export const FIXTURE_GUILD_BAD_CHANNEL = '100000000000000004';

export type LegacyFixtureContent = Partial<Record<LegacyFileKey, Record<string, unknown>>>;

/** quick.db layout: one table `json(ID TEXT, json TEXT)`, one row per top-level key. */
export function writeLegacyDb(
  dir: string,
  file: LegacyFileKey,
  rows: Record<string, unknown>,
): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, LEGACY_FILES[file]);
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS json (ID TEXT PRIMARY KEY, json TEXT)');
    const insert = db.prepare('INSERT OR REPLACE INTO json (ID, json) VALUES (?, ?)');
    for (const [id, value] of Object.entries(rows)) insert.run(id, JSON.stringify(value));
  } finally {
    db.close();
  }
  return path;
}

export function writeLegacyFixture(dir: string, content: LegacyFixtureContent): void {
  for (const [file, rows] of Object.entries(content) as [
    LegacyFileKey,
    Record<string, unknown>,
  ][]) {
    writeLegacyDb(dir, file, rows);
  }
}

/** quick.db keys carry no zero padding: 2026-10-3. */
export function legacyDateKey(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}-${month}-${day}`;
}

/**
 * Data in the shapes measured on the live files, plus the malformed variants
 * the old code could have written: array and object `wishes`, the legacy
 * `isCompleted` matrix, the `max` row, word rows missing optional fields and a
 * note row keyed by role id.
 */
export function prodShapedContent(now: Date): LegacyFixtureContent {
  const today = businessDate(now);
  const person = (id: string, discord: number) => ({
    id,
    name: `Member ${id}`,
    discordId: ` 30000000000000${String(discord).padStart(4, '0')} `,
  });

  const wishesA = Array.from({ length: 20 }, () => true);
  for (const index of [3, 7, 19]) wishesA[index] = false;

  return {
    birthday: {
      max: 20,
      [FIXTURE_GUILD_A]: {
        channel: '200000000000000001',
        count: 17,
        wishes: wishesA,
        isCompleted: [null, [null, true, null], null],
        completedDates: {
          [legacyDateKey(today)]: true,
          [legacyDateKey(shiftDate(today, -1))]: true,
          [legacyDateKey(shiftDate(today, -2))]: true,
          [legacyDateKey(shiftDate(today, -3))]: true,
          '2020-1-1': true,
          [legacyDateKey(shiftDate(today, -1)) + 'x']: true,
        },
        data: {
          '1': { '5': [person('S001', 1)] },
          '2': {
            '29': [person('S002', 2)],
            '30': [person('S003', 3)],
          },
          '3': { '4': [person('S001', 4), null, { id: '', name: 'x', discordId: '1' }] },
          '4': { '1': [], '2': 'not a list' },
          '13': { '1': [person('S004', 5)] },
        },
      },
      [FIXTURE_GUILD_B]: {
        channel: '',
        wishes: { '0': false, '1': true, '19': false, '25': false },
        completedDates: { [legacyDateKey(today)]: true },
        data: { '12': { '31': [person('S101', 6)] } },
      },
    },
    config: {
      [FIXTURE_GUILD_A]: { intro_channel: '210000000000000001' },
      [FIXTURE_GUILD_B]: { log_channel: '210000000000000002' },
      [FIXTURE_GUILD_BAD_CHANNEL]: { intro_channel: 'not-a-channel' },
    },
    note: { '400000000000000001': { topic: 'text', other: null } },
    word: {
      [FIXTURE_GUILD_A]: {
        channelID: '220000000000000001',
        start: false,
        used: { hello: 1, World: 1, '': 1 },
        maxWords: 50,
        lastUser: '300000000000000001',
        lastWord: 'World',
        count: 3,
      },
      [FIXTURE_GUILD_WORD_ONLY]: { start: true, used: {} },
      weird: { start: true, used: {} },
    },
    dict: { dict: { a: 1, b: 1, c: 1 } },
  };
}
