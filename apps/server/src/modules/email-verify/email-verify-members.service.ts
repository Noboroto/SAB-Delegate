import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import writeXlsxFile from 'write-excel-file/node';
import {
  AUDIT_ACTIONS,
  BUSINESS_TIME_ZONE,
  EMAIL_VERIFY_EXPORT_COLUMNS,
  EmailManualVerifyInputSchema,
  EmailMemberListQuerySchema,
  ErrorCode,
  SnowflakeSchema,
  emailDomain,
  escapeLike,
  normalizeEmail,
  type ActorContext,
  type EmailMemberPage,
  type EmailMemberRow,
  type EmailVerifyExportRow,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { translatorFor } from '../../i18n/translator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { EmailCryptoService } from './email-crypto.js';
import { roleMentions } from './email-verify.command-support.js';
import { EmailVerifyDiscordService, type GrantResult } from './email-verify-discord.service.js';
import {
  isUniqueViolation,
  judgeEmail,
  lockMember,
  parseGuildId,
  findGuildRowId,
} from './email-verify-data.js';

type WriteOptions = { dryRun?: boolean };

/**
 * The most rows one export holds; a larger server is refused before any work
 * is done. The file is built in memory in the request, so the limit is what
 * that can carry (rows are small; reading names from Discord is the slow part).
 */
const EMAIL_EXPORT_MAX_ROWS = 20_000;

const TX = { timeout: 15_000, maxWait: 5_000 } as const;

const WHEN = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const FILE_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** What `revoke` did; `grant` is set only when roles were taken back. */
type RevokeResult = { removed: boolean; domain: string | null; grant: GrantResult | null };

type ExportFile = {
  buffer: Buffer;
  /** Verified members in the file, 0 when nobody is verified yet. */
  count: number;
  /** Members whose name and roles could not be read from Discord, so their cells are empty. */
  unresolved: number;
  fileName: string;
  contentType: string;
};

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function parseUser(userId: string): string {
  const parsed = SnowflakeSchema.safeParse(userId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * The verified members of a server: the list a manager reads, verifying and
 * un-verifying by hand, a member deleting their own data, and the Excel export.
 * The list and the export are the same query; the export only has no paging.
 * Addresses are decrypted for managers only here and never reach a log, an
 * audit row or an MCP result.
 */
@Injectable()
export class EmailVerifyMembersService {
  /** The export being built for each server, by Discord id. */
  private readonly exporting = new Map<string, Promise<ExportFile>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly crypto: EmailCryptoService,
    private readonly discord: EmailVerifyDiscordService,
  ) {}

  /**
   * One page of verified members, searched by the start of the member id or a
   * part of the domain (addresses are encrypted, so they cannot be searched),
   * with their address and name in the server.
   */
  async members(
    guildId: string,
    query: unknown,
    options: { withEmail?: boolean } = {},
  ): Promise<EmailMemberPage> {
    const id = parseGuildId(guildId);
    const parsed = EmailMemberListQuerySchema.safeParse(query);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { page, pageSize, sort, order, q } = parsed.data;
    const where = this.searchWhere(id, q);
    const direction = order;
    const orderBy: Prisma.EmailVerificationOrderByWithRelationInput[] = [
      sort === 'domain' ? { domain: direction } : { verifiedAt: direction },
      { id: 'asc' },
    ];
    const [rows, total] = await Promise.all([
      this.prisma.emailVerification.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { userId: true, domain: true, method: true, verifiedAt: true, emailEnc: true },
      }),
      this.prisma.emailVerification.count({ where }),
    ]);
    const names = await this.discord.lookupMembers(
      id,
      rows.map((row) => row.userId),
    );
    return {
      items: rows.map((row) => ({
        userId: row.userId,
        domain: row.domain,
        method: row.method,
        email: options.withEmail === false ? null : this.crypto.decrypt(row.emailEnc),
        displayName: names.get(row.userId)?.displayName ?? null,
        verifiedAt: row.verifiedAt.toISOString(),
      })),
      pagination: { page, pageSize, total },
    };
  }

  /**
   * Verifies a member by hand: no code is mailed, the blocklist and rules are
   * not applied (the manager decided), but one address still belongs to one
   * member. Replaces an earlier verification of the same member. The member
   * gets the default roles and those of the rules their address meets.
   */
  async manualVerify(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<{ member: EmailMemberRow; grant: GrantResult | null }> {
    const id = parseGuildId(guildId);
    const parsed = EmailManualVerifyInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const email = normalizeEmail(parsed.data.email);
    if (email === null) throw new ServiceError(ErrorCode.EMAIL_INVALID);
    const { userId } = parsed.data;
    const emailHash = this.crypto.hashEmail(email);
    const domain = emailDomain(email);
    const guild = await this.guilds.ensureGuild(id);
    const judged = await judgeEmail(this.prisma, {
      guildRowId: guild.id,
      userId,
      email,
      emailHash,
    });
    const addRoleIds = judged.status === 'ACCEPTED' ? judged.roleIds : judged.defaultRoleIds;

    const verifiedAt = new Date();
    const member: EmailMemberRow = {
      userId,
      domain,
      method: 'MANUAL',
      email,
      displayName: null,
      verifiedAt: verifiedAt.toISOString(),
    };
    if (options.dryRun === true) return { member, grant: null };

    try {
      await this.prisma.$transaction(async (tx) => {
        await lockMember(tx, guild.id, userId);
        await tx.emailVerifyPending.deleteMany({ where: { guildId: guild.id, userId } });
        await tx.emailVerification.deleteMany({ where: { guildId: guild.id, userId } });
        await tx.emailVerification.create({
          data: {
            guildId: guild.id,
            userId,
            emailEnc: this.crypto.encrypt(email),
            emailHash,
            domain,
            method: 'MANUAL',
            verifiedAt,
          },
        });
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.emailVerifyManual,
            params: { emailDomain: domain, method: 'MANUAL', userId },
          },
          tx,
        );
      }, TX);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ServiceError(ErrorCode.EMAIL_ALREADY_USED);
      throw error;
    }

    const grant = await this.discord.grantRoles(id, userId, {
      add: addRoleIds,
      remove: judged.unverifiedRoleId === null ? [] : [judged.unverifiedRoleId],
    });
    const t = translatorFor(await this.discord.locale(id));
    const user = `<@${userId}>`;
    const given = grant.memberGone
      ? []
      : addRoleIds.filter((roleId) => !grant.refused.includes(roleId));
    const lines = [
      t('email-verify.log.manual', {
        user,
        actor: actor.userId === undefined ? 'API' : `<@${actor.userId}>`,
        domain,
        roles: roleMentions(given, t('email-verify.status.none')),
      }),
    ];
    if (grant.failure !== null) {
      lines.push(t('email-verify.log.roleFailed', { user, reason: grant.failure }));
    }
    await this.discord.postLog(id, lines.join('\n'));
    const names = await this.discord.lookupMembers(id, [userId]);
    return { member: { ...member, displayName: names.get(userId)?.displayName ?? null }, grant };
  }

  /**
   * Forgets a member's verification and any pending code. By default no role
   * is touched; with `removeRoles` the roles the verification gave (the
   * defaults and those of the rules the address meets) are taken back and the
   * unverified role is given again. `dryRun` only says whether there is
   * something to forget.
   */
  async revoke(
    guildId: string,
    userId: string,
    actor: ActorContext,
    options: WriteOptions & { removeRoles?: boolean } = {},
  ): Promise<RevokeResult> {
    const id = parseGuildId(guildId);
    const user = parseUser(userId);
    const guildRowId = await findGuildRowId(this.prisma, id);
    const row =
      guildRowId === null
        ? null
        : await this.prisma.emailVerification.findUnique({
            where: { guildId_userId: { guildId: guildRowId, userId: user } },
            select: { domain: true, emailEnc: true, emailHash: true },
          });
    if (guildRowId === null || row === null) {
      if (options.dryRun !== true && guildRowId !== null) {
        await this.prisma.emailVerifyPending.deleteMany({
          where: { guildId: guildRowId, userId: user },
        });
      }
      return { removed: false, domain: null, grant: null };
    }
    if (options.dryRun === true) return { removed: true, domain: row.domain, grant: null };

    let rolesBack: { remove: string[]; add: string[] } | null = null;
    if (options.removeRoles === true) {
      const email = this.crypto.decrypt(row.emailEnc);
      const judged =
        email === null
          ? null
          : await judgeEmail(this.prisma, {
              guildRowId,
              userId: user,
              email,
              emailHash: row.emailHash,
            });
      const config = await this.prisma.emailVerifyConfig.findUnique({
        where: { guildId: guildRowId },
        select: { defaultRoleIds: true, unverifiedRoleId: true },
      });
      const remove =
        judged !== null && judged.status === 'ACCEPTED'
          ? judged.roleIds
          : (config?.defaultRoleIds ?? []);
      rolesBack = {
        remove,
        add: config?.unverifiedRoleId == null ? [] : [config.unverifiedRoleId],
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await lockMember(tx, guildRowId, user);
      await tx.emailVerification.deleteMany({ where: { guildId: guildRowId, userId: user } });
      await tx.emailVerifyPending.deleteMany({ where: { guildId: guildRowId, userId: user } });
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.emailVerifyRevoke,
          params: { emailDomain: row.domain, userId: user },
        },
        tx,
      );
    }, TX);

    const grant = rolesBack === null ? null : await this.discord.grantRoles(id, user, rolesBack);
    const t = translatorFor(await this.discord.locale(id));
    await this.discord.postLog(
      id,
      t('email-verify.log.revoked', {
        user: `<@${user}>`,
        actor: actor.userId === undefined ? 'API' : `<@${actor.userId}>`,
      }),
    );
    return { removed: true, domain: row.domain, grant };
  }

  /**
   * A member erases their own verification and pending code (`/verify
   * delete-data`). Roles stay: the data is gone, what it earned is not taken
   * back. `false` when there was nothing of theirs.
   */
  async deleteOwnData(guildId: string, userId: string): Promise<boolean> {
    const id = parseGuildId(guildId);
    const user = parseUser(userId);
    const guildRowId = await findGuildRowId(this.prisma, id);
    if (guildRowId === null) return false;
    return this.prisma.$transaction(async (tx) => {
      await lockMember(tx, guildRowId, user);
      const verification = await tx.emailVerification.deleteMany({
        where: { guildId: guildRowId, userId: user },
      });
      const pending = await tx.emailVerifyPending.deleteMany({
        where: { guildId: guildRowId, userId: user },
      });
      if (verification.count + pending.count === 0) return false;
      await this.audit.record(
        {
          guildId: id,
          actor: { source: 'DISCORD', userId: user },
          action: AUDIT_ACTIONS.emailVerifyRevoke,
          params: { userId: user },
        },
        tx,
      );
      return true;
    }, TX);
  }

  /**
   * Every verified member as an Excel file: address, username, name in the
   * server, id, roles, domain, method and when they verified (in the business
   * time zone). Names and roles are read live from Discord, so a member who
   * left has empty cells (`unresolved` counts them). Refused above
   * `EMAIL_EXPORT_MAX_ROWS` members. One file is built per server at a time:
   * a request that arrives meanwhile gets that file, so a repeated click or a
   * script cannot pile up reads of the whole member list. Each caller is
   * still audited.
   */
  async exportXlsx(guildId: string, actor: ActorContext): Promise<ExportFile> {
    const id = parseGuildId(guildId);
    let building = this.exporting.get(id);
    if (building === undefined) {
      building = this.buildExport(id).finally(() => this.exporting.delete(id));
      this.exporting.set(id, building);
    }
    const file = await building;
    await this.audit.record({
      guildId: id,
      actor,
      action: AUDIT_ACTIONS.emailVerifyExport,
      params: { count: file.count },
    });
    return file;
  }

  private async buildExport(id: string): Promise<ExportFile> {
    const where = this.searchWhere(id, undefined);
    const total = await this.prisma.emailVerification.count({ where });
    if (total > EMAIL_EXPORT_MAX_ROWS) {
      throw new ServiceError(ErrorCode.EMAIL_EXPORT_TOO_LARGE, { max: EMAIL_EXPORT_MAX_ROWS });
    }
    const rows = await this.prisma.emailVerification.findMany({
      where,
      orderBy: [{ verifiedAt: 'asc' }, { id: 'asc' }],
      take: EMAIL_EXPORT_MAX_ROWS,
      select: { userId: true, domain: true, method: true, verifiedAt: true, emailEnc: true },
    });
    const { found: infos, unresolved } = await this.discord.lookupManyMembers(
      id,
      rows.map((row) => row.userId),
    );
    const exported: EmailVerifyExportRow[] = rows.map((row) => {
      const info = infos.get(row.userId);
      return {
        userId: row.userId,
        domain: row.domain,
        method: row.method,
        email: this.crypto.decrypt(row.emailEnc),
        displayName: info?.displayName ?? null,
        username: info?.username ?? null,
        roleIds: info?.roleIds ?? [],
        roleNames: info?.roleNames ?? [],
        verifiedAt: row.verifiedAt.toISOString(),
      };
    });

    const t = translatorFor(await this.discord.locale(id));
    const header = EMAIL_VERIFY_EXPORT_COLUMNS.map((column) => ({
      value: t(`email-verify.export.columns.${column}`),
      fontWeight: 'bold' as const,
    }));
    const cell = (
      row: EmailVerifyExportRow,
      column: (typeof EMAIL_VERIFY_EXPORT_COLUMNS)[number],
    ) => {
      switch (column) {
        case 'email':
          return row.email;
        case 'username':
          return row.username;
        case 'displayName':
          return row.displayName;
        case 'userId':
          return row.userId;
        case 'roles':
          return row.roleNames.join(', ');
        case 'domain':
          return row.domain;
        case 'method':
          return t(`email-verify.export.methods.${row.method}`);
        case 'verifiedAt':
          return WHEN.format(new Date(row.verifiedAt));
      }
    };
    const data = [
      header,
      ...exported.map((row) =>
        EMAIL_VERIFY_EXPORT_COLUMNS.map((column) => {
          const value = cell(row, column);
          // Text only: a cell of text is never read as a formula, whatever a name starts with.
          return value === null || value === '' ? null : { value, type: String };
        }),
      ),
    ];
    const buffer = await writeXlsxFile(data, {
      sheet: t('email-verify.export.sheet'),
      columns: [
        { width: 32 },
        { width: 22 },
        { width: 22 },
        { width: 22 },
        { width: 40 },
        { width: 24 },
        { width: 16 },
        { width: 18 },
      ],
      stickyRowsCount: 1,
    }).toBuffer();

    return {
      buffer,
      count: exported.length,
      unresolved,
      fileName: `${t('email-verify.export.fileName')}-${FILE_DATE.format(new Date())}.xlsx`,
      contentType: XLSX_CONTENT_TYPE,
    };
  }

  private searchWhere(
    discordId: string,
    q: string | undefined,
  ): Prisma.EmailVerificationWhereInput {
    const needle = q?.trim().toLowerCase() ?? '';
    if (needle === '') return { guild: { discordId } };
    return {
      guild: { discordId },
      OR: [
        { domain: { contains: escapeLike(needle) } },
        ...(/^\d+$/.test(needle) ? [{ userId: { startsWith: needle } }] : []),
      ],
    };
  }
}
