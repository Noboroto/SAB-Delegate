import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_GUILD_A,
  prodShapedContent,
  writeLegacyDb,
  writeLegacyFixture,
} from '../../testing/legacy-quickdb-fixtures.js';
import { LegacyJournalError, LegacyWalError, checkDictionary, readLegacy } from './read-source.js';

describe('readLegacy', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quickdb-read-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads every row of every quick.db file', () => {
    writeLegacyFixture(dir, prodShapedContent(new Date()));
    const data = readLegacy(dir);
    expect(data.rows.birthday.map((row) => row.id).sort()).toEqual(
      ['max', FIXTURE_GUILD_A, '100000000000000002'].sort(),
    );
    expect(data.rows.word).toHaveLength(3);
    expect(data.rows.note).toHaveLength(1);
    expect(data.dictKeyCount).toBe(3);
    expect(data.missingFiles).toEqual([]);
  });

  it('finds the columns by PRAGMA, whatever their casing', () => {
    const db = new DatabaseSync(join(dir, 'config.sqlite'));
    db.exec('CREATE TABLE json (id TEXT, value TEXT)');
    db.prepare('INSERT INTO json VALUES (?, ?)').run('k', '{"a":1}');
    db.close();
    expect(readLegacy(dir).rows.config).toEqual([{ id: 'k', value: { a: 1 } }]);
  });

  it('counts rows whose JSON does not parse instead of loading them', () => {
    const db = new DatabaseSync(join(dir, 'config.sqlite'));
    db.exec('CREATE TABLE json (ID TEXT, json TEXT)');
    db.prepare('INSERT INTO json VALUES (?, ?)').run('good', '{}');
    db.prepare('INSERT INTO json VALUES (?, ?)').run('bad', '{not json');
    db.close();
    const data = readLegacy(dir);
    expect(data.unparsableRows).toBe(1);
    expect(data.rows.config.map((row) => row.id)).toEqual(['good']);
  });

  it('refuses a directory with no quick.db file', () => {
    expect(() => readLegacy(dir)).toThrow('No quick.db file found');
  });

  it('refuses a source that still has a non-empty -wal file', () => {
    const path = writeLegacyDb(dir, 'birthday', { max: 20 });
    const live = new DatabaseSync(path);
    try {
      live.exec('PRAGMA journal_mode=WAL');
      live.exec('PRAGMA wal_autocheckpoint=0');
      live.prepare('INSERT OR REPLACE INTO json (ID, json) VALUES (?, ?)').run('late', '1');
      expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
      expect(() => readLegacy(dir)).toThrow(LegacyWalError);
    } finally {
      live.close();
    }
  });

  it('refuses a source with a non-empty -journal file and ignores an empty one', () => {
    const path = writeLegacyDb(dir, 'birthday', { max: 20 });
    writeFileSync(`${path}-journal`, '');
    expect(readLegacy(dir).rows.birthday).toHaveLength(1);
    writeFileSync(`${path}-journal`, 'hot journal bytes');
    expect(() => readLegacy(dir)).toThrow(LegacyJournalError);
  });

  it('reads a checkpointed WAL-mode source in full through the immutable read-only open', () => {
    const path = writeLegacyDb(dir, 'birthday', { max: 20 });
    const live = new DatabaseSync(path);
    live.exec('PRAGMA journal_mode=WAL');
    live.prepare('INSERT OR REPLACE INTO json (ID, json) VALUES (?, ?)').run('late', '1');
    live.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    live.close();
    expect(existsSync(`${path}-wal`) ? statSync(`${path}-wal`).size : 0).toBe(0);
    expect(
      readLegacy(dir)
        .rows.birthday.map((row) => row.id)
        .sort(),
    ).toEqual(['late', 'max']);
  });

  it('opens read-only: reading never creates a journal or changes the file', () => {
    const path = writeLegacyDb(dir, 'birthday', { max: 20 });
    const before = statSync(path).mtimeMs;
    readLegacy(dir);
    expect(statSync(path).mtimeMs).toBe(before);
    expect(existsSync(`${path}-journal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });
});

describe('checkDictionary', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quickdb-dict-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is skipped, not failed, when there is no asset', () => {
    expect(checkDictionary(3, null)).toEqual({ status: 'SKIPPED_NO_ASSET' });
    expect(checkDictionary(3, join(dir, 'missing.json'))).toEqual({ status: 'SKIPPED_NO_ASSET' });
  });

  it('compares key counts when the asset exists', () => {
    const asset = join(dir, 'dict.json');
    writeFileSync(asset, JSON.stringify({ a: 1, b: 1, c: 1 }));
    expect(checkDictionary(3, asset)).toEqual({ status: 'OK', sourceKeys: 3, assetKeys: 3 });
    expect(checkDictionary(4, asset).status).toBe('MISMATCH');
    expect(checkDictionary(null, asset).status).toBe('SKIPPED_NO_SOURCE');
  });
});
