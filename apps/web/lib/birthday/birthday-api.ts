import {
  BirthdayAddResultSchema,
  BirthdayImportReportSchema,
  BirthdayRemoveResultSchema,
  type BirthdayAdd,
  type BirthdayAddResult,
  type BirthdayImportReport,
  type BirthdayRemoveResult,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

const birthdaysPath = (guildId: string) => guildApiPath(guildId, 'birthdays');

export function addBirthday(guildId: string, entry: BirthdayAdd): Promise<BirthdayAddResult> {
  return apiFetch(birthdaysPath(guildId), {
    method: 'POST',
    body: entry,
    parser: BirthdayAddResultSchema,
  });
}

/** `dryRun` asks the service what the removal would do; `confirm` runs it. Never both. */
export function removeBirthday(
  guildId: string,
  studentId: string,
  mode: 'dryRun' | 'confirm',
): Promise<BirthdayRemoveResult> {
  const query = new URLSearchParams({ studentId, [mode]: 'true' });
  return apiFetch(`${birthdaysPath(guildId)}?${query.toString()}`, {
    method: 'DELETE',
    parser: BirthdayRemoveResultSchema,
  });
}

/** The file's text goes to the server as is: the server is the only CSV parser. */
export function importBirthdays(
  guildId: string,
  csv: string,
  dryRun: boolean,
): Promise<BirthdayImportReport> {
  return apiFetch(`${birthdaysPath(guildId)}/import`, {
    method: 'POST',
    body: { csv, dryRun },
    parser: BirthdayImportReportSchema,
  });
}
