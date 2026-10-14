import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  API_KEY_MAX_ACTIVE,
  ApiKeyMintSchema,
  AUDIT_ACTIONS,
  ErrorCode,
  PrincipalSchema,
  SnowflakeSchema,
  z,
  type ActorContext,
  type ApiKeyMintInput,
  type ApiKeyMintResult,
  type ApiKeyView,
  type Principal,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ScheduleService } from '../schedule/schedule.service.js';

const KEY_PREFIX = 'sab_';
/** 32 random bytes in base64url are 43 characters; anything else is not one of our keys and never reaches the database. */
export const API_KEY_FORMAT = /^sab_[A-Za-z0-9_-]{43}$/;
const DISPLAY_PREFIX_LENGTH = 8;
const DAY_MS = 86_400_000;
/** `lastUsedAt` moves at most this often, so a busy agent does not write a row per call. */
const LAST_USED_INTERVAL_MS = 60_000;
const IP_MAX_LENGTH = 64;
/** Newest first; a person who never revokes still gets a bounded answer. */
const LIST_MAX = 100;

const VIEW_SELECT = {
  id: true,
  name: true,
  prefix: true,
  mode: true,
  lastUsedIp: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.ApiKeySelect;

/** Only the columns a listing may show: the hash and the owner never leave this file. */
function toView(row: Prisma.ApiKeyGetPayload<{ select: typeof VIEW_SELECT }>): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    mode: row.mode,
    lastUsedIp: row.lastUsedIp,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

/** The key is high-entropy random, so a fast hash is enough and gives a unique index to look it up by. */
function hashKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function activeWhere(discordUserId: string, now: Date): Prisma.ApiKeyWhereInput {
  return {
    discordUserId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/**
 * API keys of a person. A key is the person's own authority, scoped per
 * request by their current Manage Server rights, so nothing here knows about
 * servers. The secret exists in memory only while it is minted and in the
 * answer to that one call; the database keeps its hash.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly schedules: ScheduleService,
  ) {}

  /**
   * Creates a key and returns its secret, the only time it is available. The
   * freshness of the login for a WRITE key is the caller's check (it is a
   * property of the session, which the service never sees).
   */
  async mint(
    discordUserId: string,
    input: ApiKeyMintInput,
    actor: ActorContext,
  ): Promise<ApiKeyMintResult> {
    const owner = SnowflakeSchema.safeParse(discordUserId);
    const request = ApiKeyMintSchema.safeParse(input);
    if (!owner.success || !request.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);

    const plaintext = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + request.data.expiresInDays * DAY_MS);

    const row = await this.prisma.$transaction(async (tx) => {
      // Counting and inserting are not atomic on their own: two mints could both
      // see four keys. The lock makes them take turns per person and is released
      // with the transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`api-key:${owner.data}`}, 0))`;
      const active = await tx.apiKey.count({ where: activeWhere(owner.data, now) });
      if (active >= API_KEY_MAX_ACTIVE) throw new ServiceError(ErrorCode.API_KEY_LIMIT_REACHED);

      // createdAt is written here so the WRITE expiry CHECK compares two values
      // from the same clock.
      const created = await tx.apiKey.create({
        data: {
          discordUserId: owner.data,
          name: request.data.name,
          prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
          keyHash: hashKey(plaintext),
          mode: request.data.mode,
          expiresAt,
          createdAt: now,
        },
        select: VIEW_SELECT,
      });
      await this.audit.record(
        {
          actor,
          action: AUDIT_ACTIONS.apiKeyMint,
          params: { targetId: created.id, keyPrefix: created.prefix, mode: created.mode },
        },
        tx,
      );
      return created;
    });

    return { ...toView(row), plaintext };
  }

  /** The person's keys, newest first, revoked and expired ones included so the page can say so. */
  async list(discordUserId: string): Promise<ApiKeyView[]> {
    const owner = SnowflakeSchema.safeParse(discordUserId);
    if (!owner.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const rows = await this.prisma.apiKey.findMany({
      where: { discordUserId: owner.data },
      select: VIEW_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_MAX,
    });
    return rows.map(toView);
  }

  /**
   * Revokes a key of this person and withdraws what it scheduled. Repeating
   * it is harmless: the first call sets the time, later ones change nothing,
   * and the withdrawal runs every time so a call that failed after the commit
   * can simply be made again. A key of someone else is "not found".
   */
  async revoke(discordUserId: string, keyId: string, actor: ActorContext): Promise<ApiKeyView> {
    const owner = SnowflakeSchema.safeParse(discordUserId);
    const id = z.uuid().safeParse(keyId);
    if (!owner.success || !id.success) throw new ServiceError(ErrorCode.API_KEY_NOT_FOUND);

    const row = await this.prisma.$transaction(async (tx) => {
      const where = { id: id.data, discordUserId: owner.data };
      const revoked = await tx.apiKey.updateMany({
        where: { ...where, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const current = await tx.apiKey.findFirst({ where, select: VIEW_SELECT });
      if (current === null) throw new ServiceError(ErrorCode.API_KEY_NOT_FOUND);
      if (revoked.count > 0) {
        await this.audit.record(
          {
            actor,
            action: AUDIT_ACTIONS.apiKeyRevoke,
            params: { targetId: current.id, keyPrefix: current.prefix, mode: current.mode },
          },
          tx,
        );
      }
      return current;
    });

    // After the commit: it talks to the job queue, which no transaction may do.
    await this.schedules.cancelByApiKey(row.id, actor);
    return toView(row);
  }

  /**
   * Who a bearer secret belongs to, or `null` for anything that is not a live
   * key (malformed, unknown, revoked, expired); the caller must not tell those
   * apart to the client. Records the use at most once a minute.
   */
  async verify(bearer: string, ip?: string): Promise<Principal | null> {
    if (!API_KEY_FORMAT.test(bearer)) return null;
    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashKey(bearer) },
      select: { id: true, discordUserId: true, mode: true, revokedAt: true, expiresAt: true },
    });
    const now = new Date();
    if (key === null || key.revokedAt !== null) return null;
    if (key.expiresAt !== null && key.expiresAt <= now) return null;

    const principal = PrincipalSchema.safeParse({
      discordUserId: key.discordUserId,
      apiKeyId: key.id,
      mode: key.mode,
    });
    if (!principal.success) return null;

    // Bookkeeping only: a key that checked out is not denied because the use
    // could not be recorded. Conditional write: concurrent calls race to one
    // update instead of one each.
    try {
      await this.prisma.apiKey.updateMany({
        where: {
          id: key.id,
          OR: [
            { lastUsedAt: null },
            { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_INTERVAL_MS) } },
          ],
        },
        data: { lastUsedAt: now, lastUsedIp: ip?.slice(0, IP_MAX_LENGTH) ?? null },
      });
    } catch (error) {
      // The id and the error class only: nothing that helps rebuild a secret.
      this.logger.warn(
        `Could not record the use of API key ${key.id} (${error instanceof Error ? error.name : 'unknown error'})`,
      );
    }
    return principal.data;
  }
}
