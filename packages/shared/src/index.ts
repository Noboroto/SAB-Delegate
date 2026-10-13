// Single import surface for '@sab/shared': add exports here instead of letting
// consumers reach into internal paths.

// The single place zod is imported. Consumers take `z` from '@sab/shared' so one
// zod instance (and any `z.config` set on it) serves every schema.
export { z } from 'zod';

export { ErrorCode, ErrorCodeSchema } from './errors/error-code.js';
export { partialWithoutDefaults } from './utils/partial-without-defaults.js';
export { isValidMonthDay } from './utils/month-day.js';
export { SnowflakeSchema, type Snowflake } from './schemas/snowflake.js';
export {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PaginatedSchema,
  PaginationQuerySchema,
  PaginationSchema,
} from './schemas/pagination.js';
export { ListQuerySchema, SEARCH_MAX_LENGTH } from './schemas/list-query.js';
export {
  BIRTHDAY_NAME_PLACEHOLDER,
  BIRTHDAY_WISHES,
  renderBirthdayWish,
} from './constants/birthday-wishes.js';
export { REACTION_PHRASES } from './constants/reaction-phrases.js';
export { QUEUES, type QueueName } from './constants/queues.js';
export { BUSINESS_TIME_ZONE, MESSAGE_MAX_LENGTH } from './constants/limits.js';
export { ActorContextSchema, ActorSourceSchema, type ActorContext } from './actor.js';
export { AUDIT_ACTIONS, AuditActionSchema, type AuditAction } from './audit-actions.js';
export {
  DEFAULT_LOCALE,
  LocaleSchema,
  resolveLocale,
  toSupportedLocale,
  type Locale,
} from './utils/locale.js';
export {
  CanManageGuildInputSchema,
  canManageGuild,
  type CanManageGuildInput,
} from './permissions/can-manage-guild.js';
export {
  GuildSettingsDryRunSchema,
  GuildSettingsPatchSchema,
  GuildSettingsSchema,
  WORD_MAX_WORDS_MAX,
  WORD_MAX_WORDS_MIN,
  type GuildSettings,
  type GuildSettingsDryRun,
  type GuildSettingsPatch,
} from './schemas/guild-config.js';
export {
  BIRTHDAY_CSV_HEADER,
  BIRTHDAY_CSV_TEMPLATE,
  BIRTHDAY_IMPORT_MAX_ROWS,
  BIRTHDAY_SAMPLE_SIZE,
  BirthdayAddResultSchema,
  BirthdayAddSchema,
  BirthdayEntryViewSchema,
  BirthdayImportProblemSchema,
  BirthdayImportResultSchema,
  BirthdayImportSchema,
  BirthdayRemoveResultSchema,
  BirthdaySelectorSchema,
  type BirthdayAdd,
  type BirthdayAddResult,
  type BirthdayEntryView,
  type BirthdayImport,
  type BirthdayImportProblem,
  type BirthdayImportResult,
  type BirthdayRemoveResult,
  type BirthdaySelector,
} from './schemas/birthday.js';
export { splitMessage } from './utils/split-message.js';
export { parseSnowflakes } from './utils/snowflakes.js';
export {
  MessageRefFailureSchema,
  MessageRefResultSchema,
  parseMessageRef,
  type MessageRefFailure,
  type MessageRefResult,
} from './utils/message-ref.js';
export {
  COMMAND_DESCRIPTION_MAX_LENGTH,
  MESSAGES,
  MessageNamespaceSchema,
  type MessageNamespace,
} from './messages/index.js';
