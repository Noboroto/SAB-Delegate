import {
  ScheduleCancelQuerySchema,
  ScheduleCancelResultSchema,
  ScheduleCreateRequestSchema,
  ScheduleCreateResultSchema,
  ScheduledMessageViewSchema,
  z,
  type ScheduleCancelResult,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

/**
 * The server's JSON carries instants as ISO text, which the shared schemas
 * (written for the server, where the database hands over `Date`s) do not read.
 */
const ScheduledRowSchema = ScheduledMessageViewSchema.extend({
  runAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export type ScheduledRow = z.infer<typeof ScheduledRowSchema>;

export const ScheduledRowsSchema = z.array(ScheduledRowSchema);

const CreateResultSchema = ScheduleCreateResultSchema.extend({
  runAt: z.coerce.date(),
  schedule: ScheduledRowSchema.nullable(),
});

type CreateFields =
  | { kind: 'send'; channelId: string; content: string }
  | { kind: 'copy'; channelId: string; source: string };

/** `runAt` is ISO text with the `+07:00` offset; the server turns it into the instant. */
export function createSchedule(guildId: string, fields: CreateFields, runAt: string) {
  const body = { ...fields, runAt, dryRun: false };
  // Checked against the server's own schema so a request it would refuse never leaves the browser.
  ScheduleCreateRequestSchema.parse(body);
  return apiFetch(guildApiPath(guildId, 'schedules'), {
    method: 'POST',
    body,
    parser: CreateResultSchema,
  });
}

/** Cancels message number `seq`; `dryRun` reports what would happen and changes nothing. */
export function cancelSchedule(
  guildId: string,
  seq: number,
  dryRun: boolean,
): Promise<ScheduleCancelResult> {
  const flag: Record<string, string> = dryRun ? { dryRun: 'true' } : { confirm: 'true' };
  ScheduleCancelQuerySchema.parse(flag);
  return apiFetch(
    `${guildApiPath(guildId, 'schedules', String(seq))}?${new URLSearchParams(flag)}`,
    {
      method: 'DELETE',
      parser: ScheduleCancelResultSchema,
    },
  );
}
