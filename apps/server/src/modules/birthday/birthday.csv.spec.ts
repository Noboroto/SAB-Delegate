import { describe, expect, it } from 'vitest';
import { parseBirthdayCsv } from './birthday.csv.js';

const HEADER = 'Name,ID,DiscordID,Day,Month';
const A = '111111111111111111';
const B = '222222222222222222';

function parsed(text: string) {
  const result = parseBirthdayCsv(text);
  if (!result.ok) throw new Error(`expected a readable file, got ${result.reason}`);
  return result;
}

describe('parseBirthdayCsv header', () => {
  it('refuses a file without the exact header, whatever else it holds', () => {
    expect(parseBirthdayCsv('')).toEqual({ ok: false, reason: 'BAD_HEADER' });
    expect(parseBirthdayCsv(`Ann,SE1,${A},1,2\n`)).toEqual({ ok: false, reason: 'BAD_HEADER' });
    expect(parseBirthdayCsv('name,id,discordid,day,month\n')).toEqual({
      ok: false,
      reason: 'BAD_HEADER',
    });
    expect(parseBirthdayCsv('Name,ID,DiscordID,Day\n')).toEqual({
      ok: false,
      reason: 'BAD_HEADER',
    });
  });

  it('accepts the columns in any order, extra columns, a byte order mark and CRLF', () => {
    const result = parsed(`﻿Month,Day,Extra,DiscordID,ID,Name\r\n2,5,x,${A},SE1,Ann\r\n`);
    expect(result.rows).toEqual([
      { row: 2, entry: { studentId: 'SE1', name: 'Ann', discordId: A, month: 2, day: 5 } },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('reports an unterminated quote as unreadable', () => {
    expect(parseBirthdayCsv(`${HEADER}\n"Ann,SE1,${A},1,2\n`)).toEqual({
      ok: false,
      reason: 'UNREADABLE',
    });
  });
});

describe('parseBirthdayCsv rows', () => {
  it('takes valid rows, counts every data row, and numbers lines from the header as line 1', () => {
    const result = parsed(`${HEADER}\nAnn,SE1,${A},15,3\nBob,SE2,${B},29,2\n`);
    expect(result.total).toBe(2);
    expect(result.rows.map(({ row, entry }) => [row, entry.studentId])).toEqual([
      [2, 'SE1'],
      [3, 'SE2'],
    ]);
    expect(result.problems).toEqual([]);
  });

  it('cleans a mention in the DiscordID cell down to the id', () => {
    const result = parsed(`${HEADER}\nAnn,SE1,<@${A}>,1,2\nBob,SE2, <@!${B}> ,1,2\n`);
    expect(result.rows.map(({ entry }) => entry.discordId)).toEqual([A, B]);
  });

  it('trims every cell and skips blank lines without counting them', () => {
    const result = parsed(`${HEADER}\n\n  Ann , SE1 , ${A} , 1 , 2 \n\n`);
    expect(result.total).toBe(1);
    expect(result.rows[0]?.entry).toEqual({
      studentId: 'SE1',
      name: 'Ann',
      discordId: A,
      month: 2,
      day: 1,
    });
  });

  it('reports each kind of bad row against its line and keeps reading', () => {
    const result = parsed(
      [
        HEADER,
        `,SE1,${A},1,2`, // 2: no name
        `Ann,SE2,${A},32,1`, // 3: day 32
        `Ann,SE3,${A},1,13`, // 4: month 13
        `Ann,SE4,${A},31,2`, // 5: 31 February
        `Ann,SE5,<@123>,1,2`, // 6: not a snowflake
        `Ann,SE6,${A},x,2`, // 7: not a number
        `Ann,${'9'.repeat(65)},${A},1,2`, // 8: id too long
        `Ann,SE7,${A},1,2`, // 9: fine
        `Bob,SE7,${B},3,4`, // 10: same ID again
        `Cat,SE8,${B},1,2`, // 11: fine
      ].join('\n'),
    );
    expect(result.total).toBe(10);
    expect(result.problems).toEqual([
      { row: 2, kind: 'MISSING_FIELDS' },
      { row: 3, kind: 'INVALID_DATE' },
      { row: 4, kind: 'INVALID_DATE' },
      { row: 5, kind: 'INVALID_DATE' },
      { row: 6, kind: 'INVALID_DISCORD_ID' },
      { row: 7, kind: 'INVALID_DATE' },
      { row: 8, kind: 'INVALID_VALUE' },
      { row: 10, kind: 'DUPLICATE_ID', studentId: 'SE7' },
    ]);
    expect(result.rows.map(({ row }) => row)).toEqual([9, 11]);
  });

  it('allows 29 February', () => {
    expect(parsed(`${HEADER}\nAnn,SE1,${A},29,2\n`).problems).toEqual([]);
  });

  it('treats a missing trailing cell as an invalid date, not as a crash', () => {
    expect(parsed(`${HEADER}\nAnn,SE1,${A}\n`).problems).toEqual([
      { row: 2, kind: 'INVALID_DATE' },
    ]);
  });
});
