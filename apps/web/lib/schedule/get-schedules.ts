import { SCHEDULE_LIST_MAX } from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import { ScheduledRowsSchema, type ScheduledRow } from './schedule-api';
import { guildApiPath } from '@/lib/guild-path';

/**
 * The messages still waiting to go out, oldest first. The route has no paging:
 * it returns the newest `SCHEDULE_LIST_MAX` of a status, which also bounds the
 * most one server may hold pending.
 */
export function getPendingSchedules(guildId: string): Promise<ScheduledRow[]> {
  return serverFetch(
    `${guildApiPath(guildId, 'schedules')}?status=PENDING&limit=${SCHEDULE_LIST_MAX}`,
    {
      parser: ScheduledRowsSchema,
    },
  );
}
