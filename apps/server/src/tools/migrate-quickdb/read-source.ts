import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  LEGACY_FILES,
  LegacyColumnsSchema,
  LegacyDataSchema,
  type LegacyColumns,
  type DictionaryCheck,
  type LegacyData,
  type LegacyFileKey,
  type LegacyRow,
} from './types.js';

export class LegacyWalError extends Error {
  constructor(readonly file: LegacyFileKey) {
    super(
      `${LEGACY_FILES[file]} has a non-empty -wal file next to it; checkpoint the database ` +
        '(stop the bot, then PRAGMA wal_checkpoint(TRUNCATE)) and retry',
    );
    this.name = 'LegacyWalError';
  }
}

export class LegacyJournalError extends Error {
  constructor(readonly file: LegacyFileKey) {
    super(
      `${LEGACY_FILES[file]} has a non-empty -journal file next to it (a write was interrupted); ` +
        'reopen it with sqlite so the journal rolls back, stop the bot, and retry',
    );
    this.name = 'LegacyJournalError';
  }
}

class LegacySchemaError extends Error {
  constructor(readonly file: LegacyFileKey) {
    super(`${LEGACY_FILES[file]} has no quick.db "json" table with an id and a value column`);
    this.name = 'LegacySchemaError';
  }
}

/**
 * quick.db names the columns `ID` and `json`; the lookup is by PRAGMA so a
 * different casing does not silently read nothing.
 */
export function detectColumns(db: DatabaseSync): LegacyColumns | null {
  const names = (db.prepare(`PRAGMA table_info("json")`).all() as { name: string }[]).map(
    (column) => column.name,
  );
  const find = (...candidates: string[]) =>
    names.find((name) => candidates.includes(name.toLowerCase()));
  const id = find('id');
  const value = find('json', 'value');
  return id && value ? LegacyColumnsSchema.parse({ id, value }) : null;
}

function isNonEmpty(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}

/**
 * Read-only and immutable: SQLite takes no lock and never writes a journal or
 * -shm next to the source, so a live copy cannot be disturbed. The price is
 * that anything still in a -wal file is invisible and a hot rollback journal
 * is not applied, hence the refusal of both.
 */
function openReadOnly(path: string): DatabaseSync {
  const uri = `${pathToFileURL(path).href}?mode=ro&immutable=1`;
  return new DatabaseSync(uri, { readOnly: true });
}

function readRows(file: LegacyFileKey, path: string): { rows: LegacyRow[]; unparsable: number } {
  if (isNonEmpty(`${path}-wal`)) throw new LegacyWalError(file);
  if (isNonEmpty(`${path}-journal`)) throw new LegacyJournalError(file);
  const db = openReadOnly(path);
  try {
    const columns = detectColumns(db);
    if (!columns) throw new LegacySchemaError(file);
    const raw = db
      .prepare(`SELECT "${columns.id}" AS id, "${columns.value}" AS value FROM "json"`)
      .all() as { id: unknown; value: unknown }[];
    const rows: LegacyRow[] = [];
    let unparsable = 0;
    for (const row of raw) {
      try {
        rows.push({ id: String(row.id), value: JSON.parse(String(row.value)) as unknown });
      } catch {
        unparsable++;
      }
    }
    return { rows, unparsable };
  } finally {
    db.close();
  }
}

export function readLegacy(sourceDir: string): LegacyData {
  const data: LegacyData = {
    rows: { birthday: [], config: [], note: [], word: [] },
    dictKeyCount: null,
    missingFiles: [],
    unparsableRows: 0,
  };
  for (const file of Object.keys(LEGACY_FILES) as LegacyFileKey[]) {
    const path = join(sourceDir, LEGACY_FILES[file]);
    if (!existsSync(path)) {
      data.missingFiles.push(file);
      continue;
    }
    const { rows, unparsable } = readRows(file, path);
    data.unparsableRows += unparsable;
    if (file === 'dict') {
      const dict = rows.find((row) => row.id === 'dict')?.value;
      data.dictKeyCount =
        dict !== null && typeof dict === 'object' && !Array.isArray(dict)
          ? Object.keys(dict).length
          : null;
    } else {
      data.rows[file] = rows;
    }
  }
  // A mistyped directory would otherwise "migrate" nothing and look clean.
  if (data.missingFiles.length === Object.keys(LEGACY_FILES).length) {
    throw new Error('No quick.db file found in the source directory');
  }
  return LegacyDataSchema.parse(data);
}

/** Compares the key count of the dumped dictionary with the packaged asset, when there is one. */
export function checkDictionary(
  sourceKeys: number | null,
  assetPath: string | null,
): DictionaryCheck {
  if (!assetPath || !existsSync(assetPath)) return { status: 'SKIPPED_NO_ASSET' };
  if (sourceKeys === null) return { status: 'SKIPPED_NO_SOURCE' };
  const asset = JSON.parse(readFileSync(assetPath, 'utf8')) as unknown;
  const assetKeys = asset !== null && typeof asset === 'object' ? Object.keys(asset).length : 0;
  return { status: assetKeys === sourceKeys ? 'OK' : 'MISMATCH', sourceKeys, assetKeys };
}
