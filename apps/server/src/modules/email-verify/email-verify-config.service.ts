import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ACCESS_CONDITION_DEPTH_MAX,
  ACCESS_RULE_TERMS_MAX,
  AUDIT_ACTIONS,
  AccessRulesInputSchema,
  EmailBlocklistSchema,
  EmailVerifyConfigPatchSchema,
  EmailVerifyConfigSchema,
  ErrorCode,
  ROLES_MAX,
  collectListNames,
  isAccessGroup,
  serializeCondition,
  type AccessGroup,
  type AccessRulesView,
  type ActorContext,
  type EmailBlocklist,
  type EmailVerifyConfig,
  type z,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { EmailCryptoService } from './email-crypto.js';
import { findGuildRowId, parseGuildId, readRules } from './email-verify-data.js';
import { SmtpConfigService } from './smtp-config.service.js';

/** `dryRun` validates and answers what the write would leave, and writes and audits nothing. */
type WriteOptions = { dryRun?: boolean };

const CONFIG_SELECT = {
  enabled: true,
  defaultRoleIds: true,
  unverifiedRoleId: true,
  logChannelId: true,
  verifyMessage: true,
  autoVerifyOnJoin: true,
  autoUnverifiedOnJoin: true,
} satisfies Prisma.EmailVerifyConfigSelect;

const DEFAULT_CONFIG: EmailVerifyConfig = {
  enabled: false,
  defaultRoleIds: [],
  unverifiedRoleId: null,
  logChannelId: null,
  verifyMessage: null,
  autoVerifyOnJoin: false,
  autoUnverifiedOnJoin: false,
};

const LIMIT_REASONS: Readonly<Record<string, string>> = {
  TOO_DEEP: `groups nested more than ${ACCESS_CONDITION_DEPTH_MAX} levels deep`,
  TOO_MANY_TERMS: `more than ${ACCESS_RULE_TERMS_MAX} conditions`,
};

/** The value at `path` inside raw input, `undefined` when the path leaves it. */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let node = input;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

type PlainIssue = { readonly path: readonly PropertyKey[]; readonly message: string };
type RuleIssue = z.ZodError['issues'][number];

/**
 * The problem inside a failed union, which Zod reports as "Invalid input": a
 * member of a group is a condition or a nested group, so the useful message
 * belongs to the option that got furthest (a wrong value in a condition, not
 * "a group needs a combinator"). On a tie the first option, the condition, wins.
 */
function leafIssue(issue: RuleIssue): PlainIssue {
  if (issue.code !== 'invalid_union') return issue;
  let best: PlainIssue = issue;
  let bestDepth = -1;
  for (const option of issue.errors) {
    const first = option[0];
    if (first === undefined) continue;
    const leaf = leafIssue(first);
    const path = [...issue.path, ...leaf.path];
    // A limit (too deep, too many) is the answer even when another option got further.
    if (Object.hasOwn(LIMIT_REASONS, leaf.message)) return { path, message: leaf.message };
    if (path.length > bestDepth) {
      best = { path, message: leaf.message };
      bestDepth = path.length;
    }
  }
  return best;
}

/**
 * The `term` and `reason` an `EMAIL_RULE_INVALID` message shows for the first
 * problem of the rules the caller sent: the text that was wrong (cut short)
 * and a plain reason, not a path into the request body such as
 * `condition.rules.0.value`.
 */
function ruleProblem(input: unknown, raised: RuleIssue): { term: string; reason: string } {
  const issue = leafIssue(raised);
  const inside = issue.path.slice(2);
  if (inside[0] === 'roleIds') {
    return {
      term: 'roles',
      reason: inside.length === 1 ? `more than ${ROLES_MAX} roles` : 'not a role id',
    };
  }
  const reason = LIMIT_REASONS[issue.message] ?? issue.message;
  const offending = inside.at(-1) === 'value' ? valueAt(input, issue.path) : undefined;
  return { term: typeof offending === 'string' ? offending.slice(0, 60) : 'condition', reason };
}

/** Conditions in a group and its nested groups. */
function termCount(group: AccessGroup): number {
  return group.rules.reduce<number>(
    (sum, node) => sum + (isAccessGroup(node) ? termCount(node) : 1),
    0,
  );
}

/**
 * A server's email verification settings: the switch, the roles, the access
 * rules and the blocklist. The slash commands, the REST API and the MCP tools
 * all go through here, so validation and the audit trail are the same for each.
 * Nothing here ever touches an address: those live in the lists and members.
 */
@Injectable()
export class EmailVerifyConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly smtp: SmtpConfigService,
    private readonly crypto: EmailCryptoService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /** The settings; the defaults for a server that never configured them. Writes nothing. */
  async get(guildId: string): Promise<EmailVerifyConfig> {
    const id = parseGuildId(guildId);
    const row = await this.prisma.emailVerifyConfig.findFirst({
      where: { guild: { discordId: id } },
      select: CONFIG_SELECT,
    });
    return EmailVerifyConfigSchema.parse(row ?? DEFAULT_CONFIG);
  }

  /**
   * Changes the given settings and leaves the rest. Turning verification on
   * needs a mail account and the key secret; a log channel must be one the
   * bot can post in.
   */
  async patch(
    guildId: string,
    patch: unknown,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<EmailVerifyConfig> {
    const id = parseGuildId(guildId);
    const parsed = EmailVerifyConfigPatchSchema.safeParse(patch);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const changes = Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    ) as Prisma.EmailVerifyConfigUpdateInput;
    if (Object.keys(changes).length === 0) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    if (parsed.data.defaultRoleIds !== undefined) {
      changes.defaultRoleIds = [...new Set(parsed.data.defaultRoleIds)];
    }

    // Only what the call changes is checked: a server whose mail account was
    // switched off later, or whose log channel lost the bot's permission, can
    // still change its other settings.
    const before = await this.get(id);
    if (parsed.data.enabled === true && !before.enabled) {
      if (!this.crypto.available) throw new ServiceError(ErrorCode.EMAIL_VERIFY_UNAVAILABLE);
      if (!(await this.smtp.ready())) throw new ServiceError(ErrorCode.SMTP_NOT_CONFIGURED);
    }
    const { logChannelId } = parsed.data;
    if (
      logChannelId !== undefined &&
      logChannelId !== null &&
      logChannelId !== before.logChannelId
    ) {
      const access = await this.channelAccess.check(logChannelId, 'send', id);
      if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      if (access !== 'ok') {
        throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'send' });
      }
    }

    const after = EmailVerifyConfigSchema.parse({ ...before, ...changes });
    if (options.dryRun === true) return after;

    await this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      await tx.emailVerifyConfig.upsert({
        where: { guildId: guild.id },
        create: {
          ...(changes as Omit<Prisma.EmailVerifyConfigUncheckedCreateInput, 'guildId'>),
          guildId: guild.id,
        },
        update: changes,
      });
      const changed = Object.keys(parsed.data).filter(
        (key) => parsed.data[key as keyof typeof parsed.data] !== undefined,
      );
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.emailVerifyConfigure,
          params: {
            changed,
            before: audited(before, changed),
            after: audited(after, changed),
          },
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** The rules in order, each with its text form and the lists it names that do not exist. */
  async rules(guildId: string): Promise<AccessRulesView> {
    const id = parseGuildId(guildId);
    const guildRowId = await findGuildRowId(this.prisma, id);
    if (guildRowId === null) return { rules: [] };
    const [rules, lists] = await Promise.all([
      readRules(this.prisma, guildRowId),
      this.prisma.emailList.findMany({ where: { guildId: guildRowId }, select: { name: true } }),
    ]);
    return this.view(
      rules,
      lists.map((list) => list.name),
    );
  }

  /** Replaces the whole rule set; the input's order is the rules' order. */
  async setRules(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<AccessRulesView> {
    const id = parseGuildId(guildId);
    const parsed = AccessRulesInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const [, index] = issue?.path ?? [];
      if (typeof index !== 'number') throw new ServiceError(ErrorCode.VALIDATION_FAILED);
      throw new ServiceError(ErrorCode.EMAIL_RULE_INVALID, {
        rule: index + 1,
        ...(issue === undefined ? { term: 'rule', reason: 'invalid' } : ruleProblem(input, issue)),
      });
    }
    const rules = parsed.data.rules.map((rule) => ({
      condition: rule.condition,
      roleIds: [...new Set(rule.roleIds)],
    }));
    const guildRowId = await findGuildRowId(this.prisma, id);
    const lists =
      guildRowId === null
        ? []
        : await this.prisma.emailList.findMany({
            where: { guildId: guildRowId },
            select: { name: true },
          });
    const view = this.view(
      rules,
      lists.map((list) => list.name),
    );
    if (options.dryRun === true) return view;

    await this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-rules:${guild.id}`}, 0))`;
      await tx.accessRule.deleteMany({ where: { guildId: guild.id } });
      await tx.accessRule.createMany({
        data: rules.map((rule, position) => ({
          guildId: guild.id,
          position,
          roleIds: rule.roleIds,
          // Parsed by `AccessRulesInputSchema` above, which is what makes it plain JSON.
          condition: rule.condition,
        })),
      });
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.emailVerifyRulesSet,
          params: {
            ruleCount: rules.length,
            termCount: rules.reduce((sum, rule) => sum + termCount(rule.condition), 0),
          },
        },
        tx,
      );
    });
    return this.rules(id);
  }

  async blocklist(guildId: string): Promise<EmailBlocklist> {
    const id = parseGuildId(guildId);
    const rows = await this.prisma.emailBlockPattern.findMany({
      where: { guild: { discordId: id } },
      orderBy: { pattern: 'asc' },
      select: { pattern: true },
    });
    return { patterns: rows.map((row) => row.pattern) };
  }

  /** Replaces the whole blocklist. */
  async setBlocklist(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<EmailBlocklist> {
    const id = parseGuildId(guildId);
    const parsed = EmailBlocklistSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const patterns = [...new Set(parsed.data.patterns)].sort();
    if (options.dryRun === true) return { patterns };

    await this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-blocklist:${guild.id}`}, 0))`;
      await tx.emailBlockPattern.deleteMany({ where: { guildId: guild.id } });
      await tx.emailBlockPattern.createMany({
        data: patterns.map((pattern) => ({ guildId: guild.id, pattern })),
      });
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.emailVerifyBlocklistSet,
          params: { patternCount: patterns.length },
        },
        tx,
      );
    });
    return { patterns };
  }

  private view(
    rules: readonly { condition: AccessGroup; roleIds: readonly string[] }[],
    existingLists: readonly string[],
  ): AccessRulesView {
    const known = new Set(existingLists);
    return {
      rules: rules.map((rule) => ({
        condition: rule.condition,
        roleIds: [...rule.roleIds],
        text: serializeCondition(rule.condition),
        missingLists: collectListNames(rule.condition).filter((name) => !known.has(name)),
      })),
    };
  }
}

/** The changed settings only, and no message text: the audit log keeps what changed, not what was said. */
function audited(config: EmailVerifyConfig, changed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of changed) {
    if (key === 'verifyMessage') continue;
    out[key] = config[key as keyof EmailVerifyConfig];
  }
  return out;
}
