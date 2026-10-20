import { z } from 'zod';
import { EmailVerificationSchema as EmailVerificationModelSchema } from '../generated/zod/schemas/models/EmailVerification.schema.js';
import { EmailVerifyConfigSchema as EmailVerifyConfigModelSchema } from '../generated/zod/schemas/models/EmailVerifyConfig.schema.js';
import { SmtpConfigSchema as SmtpConfigModelSchema } from '../generated/zod/schemas/models/SmtpConfig.schema.js';
import { AccessConditionSchema, LIST_NAME_PATTERN } from '../email-verify/condition.js';
import {
  ACCESS_RULES_MAX,
  EMAIL_ADDRESS_MAX,
  EMAIL_BLOCK_PATTERNS_MAX,
  EMAIL_LIST_BATCH_MAX,
  EMAIL_VERIFY_MESSAGE_MAX,
} from '../email-verify/constants.js';
import { partialWithoutDefaults } from '../utils/partial-without-defaults.js';
import { ListQuerySchema } from './list-query.js';
import { PaginatedSchema } from './pagination.js';
import { SnowflakeSchema } from './snowflake.js';

/** Roles a server may hand out in one place (default roles, one rule's roles). */
export const ROLES_MAX = 25;

const RoleIdsSchema = z.array(SnowflakeSchema).max(ROLES_MAX);

/** An address a person typed; compared in its normalised form by the service. */
const EmailInputSchema = z.string().trim().min(3).max(EMAIL_ADDRESS_MAX);

/** A server's email verification as the dashboard, REST and MCP show it. */
export const EmailVerifyConfigSchema = EmailVerifyConfigModelSchema.pick({
  enabled: true,
  autoVerifyOnJoin: true,
  autoUnverifiedOnJoin: true,
}).extend({
  defaultRoleIds: RoleIdsSchema,
  unverifiedRoleId: SnowflakeSchema.nullable(),
  logChannelId: SnowflakeSchema.nullable(),
  /** Text shown above the verify button's email form; null for the built-in text. */
  verifyMessage: z.string().trim().min(1).max(EMAIL_VERIFY_MESSAGE_MAX).nullable(),
});

export type EmailVerifyConfig = z.infer<typeof EmailVerifyConfigSchema>;

/** A field left out is left alone; `.partial()` would keep the column defaults and overwrite them. */
export const EmailVerifyConfigPatchSchema = partialWithoutDefaults(EmailVerifyConfigSchema);

export type EmailVerifyConfigPatch = z.infer<typeof EmailVerifyConfigPatchSchema>;

/** One access rule: the roles a member gets when its condition holds. Its position is its index in the array. */
export const AccessRuleSchema = z.object({
  condition: AccessConditionSchema,
  roleIds: RoleIdsSchema,
});

export type AccessRule = z.infer<typeof AccessRuleSchema>;

/** The whole rule set of a server; it replaces what was there. */
export const AccessRulesInputSchema = z.object({
  rules: z.array(AccessRuleSchema).max(ACCESS_RULES_MAX),
});

export type AccessRulesInput = z.infer<typeof AccessRulesInputSchema>;

/** A rule as read back: the text form of its condition, and the lists it names that no longer exist. */
const AccessRuleViewSchema = AccessRuleSchema.extend({
  text: z.string(),
  missingLists: z.array(z.string()),
});

export const AccessRulesViewSchema = z.object({ rules: z.array(AccessRuleViewSchema) });

export type AccessRulesView = z.infer<typeof AccessRulesViewSchema>;

/** A lower-case wildcard on a whole address, such as `*@mailinator.com`. */
const BlockPatternSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(EMAIL_ADDRESS_MAX)
  .regex(/^[a-z0-9._%+*'@-]+$/, 'must be an address pattern');

/** The whole blocklist of a server; it replaces what was there. */
export const EmailBlocklistSchema = z.object({
  patterns: z.array(BlockPatternSchema).max(EMAIL_BLOCK_PATTERNS_MAX),
});

export type EmailBlocklist = z.infer<typeof EmailBlocklistSchema>;

export const EmailListNameSchema = z.string().trim().toLowerCase().regex(LIST_NAME_PATTERN);

export const EmailListCreateSchema = z.object({ name: EmailListNameSchema });

export type EmailListCreate = z.infer<typeof EmailListCreateSchema>;

/** A list without its addresses, which are only kept as hashes. */
export const EmailListSummarySchema = z.object({
  id: z.uuid(),
  name: EmailListNameSchema,
  entryCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});

export type EmailListSummary = z.infer<typeof EmailListSummarySchema>;

/** The list a route names. */
export const EmailListParamSchema = z.object({ listId: z.uuid() });

/** Addresses to add to or remove from a list; the server normalises them and counts what it could not use. */
export const EmailListEntriesInputSchema = z.object({
  emails: z
    .array(z.string().max(EMAIL_ADDRESS_MAX + 100))
    .min(1)
    .max(EMAIL_LIST_BATCH_MAX),
});

export type EmailListEntriesInput = z.infer<typeof EmailListEntriesInputSchema>;

export const EmailListEntriesResultSchema = z.object({
  /** New to the list (or removed from it, for a removal). */
  changed: z.number().int().min(0),
  /** Valid but already there (or not there, for a removal). */
  skipped: z.number().int().min(0),
  /** Not an address. */
  invalid: z.number().int().min(0),
});

export type EmailListEntriesResult = z.infer<typeof EmailListEntriesResultSchema>;

export const EmailVerifyMethodSchema = EmailVerificationModelSchema.shape.method;

export const EmailMemberListQuerySchema = ListQuerySchema(['verifiedAt', 'domain']);

export type EmailMemberListQuery = z.infer<typeof EmailMemberListQuerySchema>;

/** A verified member as the dashboard lists them; `email` is null when it cannot be decrypted. */
export const EmailMemberRowSchema = EmailVerificationModelSchema.pick({
  domain: true,
  method: true,
}).extend({
  userId: SnowflakeSchema,
  email: z.string().nullable(),
  /** The name the member has in the server; null once they have left. */
  displayName: z.string().nullable(),
  verifiedAt: z.iso.datetime(),
});

export type EmailMemberRow = z.infer<typeof EmailMemberRowSchema>;

export const EmailMemberPageSchema = PaginatedSchema(EmailMemberRowSchema);

export type EmailMemberPage = z.infer<typeof EmailMemberPageSchema>;

/** The member a route names. */
export const EmailMemberParamSchema = z.object({ userId: SnowflakeSchema });

/** A manager confirms a member's address by hand. */
export const EmailManualVerifyInputSchema = z.object({
  userId: SnowflakeSchema,
  email: EmailInputSchema,
});

export type EmailManualVerifyInput = z.infer<typeof EmailManualVerifyInputSchema>;

/**
 * A row of the Excel export. `email` is null when it cannot be decrypted;
 * `username` and `displayName` are null once the member has left the server.
 */
export const EmailVerifyExportRowSchema = EmailMemberRowSchema.omit({ email: true }).extend({
  email: z.string().nullable(),
  username: z.string().nullable(),
  roleIds: z.array(SnowflakeSchema),
  roleNames: z.array(z.string()),
});

export type EmailVerifyExportRow = z.infer<typeof EmailVerifyExportRowSchema>;

/** The columns of the export, in order; the header labels come from the message catalog. */
export const EMAIL_VERIFY_EXPORT_COLUMNS = [
  'email',
  'username',
  'displayName',
  'userId',
  'roles',
  'domain',
  'method',
  'verifiedAt',
] as const;

/** Posts the verify button in a channel. */
export const EmailVerifyButtonInputSchema = z.object({
  channelId: SnowflakeSchema,
  title: z.string().trim().min(1).max(256).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
  buttonText: z.string().trim().min(1).max(80).optional(),
});

export type EmailVerifyButtonInput = z.infer<typeof EmailVerifyButtonInputSchema>;

export const EmailVerifyButtonResultSchema = z.object({
  channelId: SnowflakeSchema,
  messageId: SnowflakeSchema,
});

export type EmailVerifyButtonResult = z.infer<typeof EmailVerifyButtonResultSchema>;

export const EmailTestMailInputSchema = z.object({ email: EmailInputSchema });

export type EmailTestMailInput = z.infer<typeof EmailTestMailInputSchema>;

/** Where a server's email verification stands, for the overview tab. */
export const EmailVerifyStatusSchema = z.object({
  enabled: z.boolean(),
  /** Whether mail can be sent: the SMTP account is set and on, and the key secret exists. */
  smtpReady: z.boolean(),
  verified: z.number().int().min(0),
  pending: z.number().int().min(0),
  lists: z.number().int().min(0),
  rules: z.number().int().min(0),
  sentToday: z.number().int().min(0),
  dailyCap: z.number().int().min(1),
});

export type EmailVerifyStatus = z.infer<typeof EmailVerifyStatusSchema>;

/** What the dashboard shows of the SMTP account; the password never leaves the server. */
export const SmtpSettingsSchema = SmtpConfigModelSchema.pick({
  host: true,
  port: true,
  secure: true,
  username: true,
  fromAddress: true,
  fromName: true,
  enabled: true,
}).extend({
  /** Whether the asked server is the admin server, the only one that configures SMTP. */
  adminServer: z.boolean(),
  /** False while the server has no LLM_KEY_SECRET: nothing can be saved. */
  available: z.boolean(),
  /** Whether a password is stored; the password itself is never returned. */
  passwordSet: z.boolean(),
});

export type SmtpSettings = z.infer<typeof SmtpSettingsSchema>;

/** A save or a connection test. `password` may be left out to keep the stored one. */
export const SmtpSettingsInputSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  // A password is kept exactly as typed; trimming would change it.
  password: z.string().min(1).max(500).optional(),
  fromAddress: z.string().trim().toLowerCase().max(EMAIL_ADDRESS_MAX).pipe(z.email()),
  fromName: z.string().trim().min(1).max(100).nullable(),
  enabled: z.boolean(),
});

export type SmtpSettingsInput = z.infer<typeof SmtpSettingsInputSchema>;

export const SmtpTestResultSchema = z.object({
  ok: z.boolean(),
  /** Why the test failed; the server's own error text is never passed on. */
  reason: z.enum(['unreachable', 'auth', 'rejected', 'blocked']).optional(),
});

export type SmtpTestResult = z.infer<typeof SmtpTestResultSchema>;
