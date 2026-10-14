import { BirthdayEntryViewSchema, BirthdayListQuerySchema, z } from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import { guildApiPath } from '@/lib/guild-path';

const EntriesSchema = z.array(BirthdayEntryViewSchema);

/** The month filter of the page URL; anything that is not a month 1-12 means "all months". */
export function parseMonthParam(raw: string | string[] | undefined): number | undefined {
  const parsed = BirthdayListQuerySchema.safeParse({
    month: typeof raw === 'string' ? raw : undefined,
  });
  return parsed.success ? parsed.data.month : undefined;
}

/** The server filters by month; it has no paging or sorting of its own for this list. */
export function getBirthdays(guildId: string, month: number | undefined) {
  const query = month === undefined ? '' : `?month=${month}`;
  return serverFetch(`${guildApiPath(guildId, 'birthdays')}${query}`, { parser: EntriesSchema });
}
