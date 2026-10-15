import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ActorSourceSchema,
  AuditActionSchema,
  ErrorCode,
  PAGE_SIZE_MAX,
  SnowflakeSchema,
  z,
  type ActorContext,
  type AuditAction,
} from '@sab/shared';
import { ServiceError } from '../errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * The only keys that survive into `AuditLog.params`, at any depth. A row is
 * kept for a long time and shown in the dashboard, so what goes in is decided
 * here, by name: ids, counts and setting names, never message text, file
 * contents, tokens or keys. A new kind of audited action adds its keys here;
 * anything else it passes is dropped rather than stored.
 */
const PARAM_KEYS: ReadonlySet<string> = new Set([
  // Settings and their old/new values.
  'before',
  'after',
  'introChannelId',
  'logChannelId',
  'birthdayChannelId',
  'activityCategoryId',
  'wordChannelId',
  'wordMaxWords',
  'locale',
  // What an action touched.
  'channelId',
  'messageId',
  'threadId',
  'roleId',
  'userId',
  'targetId',
  'scheduleId',
  'count',
  'total',
  'failed',
  'skipped',
  'month',
  'day',
  'emoji',
  'topic',
  'kind',
  'mode',
  'scopes',
  'keyPrefix',
  'game',
  'model',
  'enabled',
  'keyChanged',
  'host',
]);

const MAX_PARAM_DEPTH = 4;
const MAX_PARAM_STRING = 200;
const MAX_PARAM_ARRAY = 50;
const MAX_ERROR_LENGTH = 200;

type Json = Prisma.InputJsonValue;

function sanitizeValue(value: unknown, depth: number): Json | null | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return value.slice(0, MAX_PARAM_STRING);
    case 'number':
      return Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return value;
    case 'object':
      break;
    default:
      return undefined;
  }
  if (depth >= MAX_PARAM_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_PARAM_ARRAY)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is Json | null => item !== undefined);
  }
  return sanitizeObject(value as Record<string, unknown>, depth);
}

function sanitizeObject(source: Record<string, unknown>, depth: number): Json {
  const out: Record<string, Json | null> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!PARAM_KEYS.has(key)) continue;
    const clean = sanitizeValue(value, depth + 1);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** Reduces `params` to the allowlisted keys and plain values; exported for the specs. */
export function sanitizeAuditParams(params: Record<string, unknown>): Json {
  return sanitizeObject(params, 0);
}

type AuditEntry = {
  /** Discord id of the server the action concerned; absent for global actions. */
  guildId?: string | null;
  actor: ActorContext;
  action: AuditAction;
  params?: Record<string, unknown>;
  /** False for an attempt that failed; `error` then carries the error code. */
  ok?: boolean;
  error?: string;
};

type AuditDb = Pick<Prisma.TransactionClient, 'auditLog' | 'guild'>;

const ListQuerySchema = z.object({
  guildId: SnowflakeSchema,
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
  action: AuditActionSchema.optional(),
  source: ActorSourceSchema.optional(),
  since: z.date().optional(),
});

export type AuditListQuery = z.input<typeof ListQuerySchema>;

const LIST_SELECT = {
  id: true,
  source: true,
  actorDiscordId: true,
  apiKeyId: true,
  action: true,
  params: true,
  ok: true,
  error: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

type AuditListItem = Prisma.AuditLogGetPayload<{ select: typeof LIST_SELECT }>;

type AuditPage = {
  items: AuditListItem[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
};

/**
 * The trail of who changed what. Services call `record` with the transaction
 * that makes the change, so the row exists exactly when the change does.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one row. Pass `tx` from the caller's `$transaction` to commit or
   * roll back together with the change; without it the row is written on its
   * own. Never call Discord between the change and this call.
   */
  async record(entry: AuditEntry, tx?: AuditDb): Promise<void> {
    const db: AuditDb = tx ?? this.prisma;
    const guild =
      entry.guildId === undefined || entry.guildId === null
        ? null
        : await db.guild.findUnique({ where: { discordId: entry.guildId }, select: { id: true } });

    await db.auditLog.create({
      data: {
        guildId: guild?.id ?? null,
        source: entry.actor.source,
        actorDiscordId: entry.actor.userId ?? null,
        apiKeyId: entry.actor.apiKeyId ?? null,
        action: entry.action,
        params: entry.params === undefined ? undefined : sanitizeAuditParams(entry.params),
        ok: entry.ok ?? true,
        error: entry.error?.slice(0, MAX_ERROR_LENGTH) ?? null,
      },
    });
  }

  /**
   * Newest first. Paged by cursor rather than offset: rows arrive while
   * someone is reading, and an offset would repeat or skip them.
   */
  async list(query: AuditListQuery): Promise<AuditPage> {
    const parsed = ListQuerySchema.safeParse(query);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { guildId, cursor, limit, action, source, since } = parsed.data;

    // One extra row tells whether another page exists without a count query.
    const rows = await this.prisma.auditLog.findMany({
      where: {
        guild: { discordId: guildId },
        ...(action === undefined ? {} : { action }),
        ...(source === undefined ? {} : { source }),
        ...(since === undefined ? {} : { createdAt: { gte: since } }),
      },
      select: LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });

    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? last.id : null };
  }
}
