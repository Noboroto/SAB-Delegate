import { z } from 'zod';
import { GuildConfigSchema } from '../generated/zod/schemas/models/GuildConfig.schema.js';
import { LocaleSchema } from '../utils/locale.js';
import { partialWithoutDefaults } from '../utils/partial-without-defaults.js';
import { SnowflakeSchema } from './snowflake.js';

/** The word game needs room for a real chain; below this it ends before it starts. */
export const WORD_MAX_WORDS_MIN = 200;

/** Largest value the `Int` column holds; a bigger number would fail at the database. */
export const WORD_MAX_WORDS_MAX = 2_147_483_647;

/** A stored channel is a Discord id, or null when nothing is configured. */
const ChannelRefSchema = SnowflakeSchema.nullable();

/**
 * What a server has configured: the channels the bot works in, the word-game
 * limit and the language it answers in. The channel and limit columns come from
 * the generated model; they are tightened here because the generated types
 * accept any string and any integer, while the database CHECKs do not.
 */
export const GuildSettingsSchema = GuildConfigSchema.pick({
  introChannelId: true,
  logChannelId: true,
  birthdayChannelId: true,
  activityCategoryId: true,
  wordChannelId: true,
  wordMaxWords: true,
}).extend({
  introChannelId: ChannelRefSchema,
  logChannelId: ChannelRefSchema,
  birthdayChannelId: ChannelRefSchema,
  activityCategoryId: ChannelRefSchema,
  wordChannelId: ChannelRefSchema,
  wordMaxWords: z.number().int().min(WORD_MAX_WORDS_MIN).max(WORD_MAX_WORDS_MAX).default(1500),
  locale: LocaleSchema,
});

export type GuildSettings = z.infer<typeof GuildSettingsSchema>;

/**
 * A partial update. A field left out is left alone (the default of
 * `wordMaxWords` must not turn an absent field into "reset it"), `null` clears
 * a channel, and a field this schema does not know is dropped.
 */
export const GuildSettingsPatchSchema = partialWithoutDefaults(GuildSettingsSchema);

export type GuildSettingsPatch = z.infer<typeof GuildSettingsPatchSchema>;

/** What a dry-run of a settings update reports: nothing was written. */
export const GuildSettingsDryRunSchema = z.object({
  before: GuildSettingsSchema,
  after: GuildSettingsSchema,
});

export type GuildSettingsDryRun = z.infer<typeof GuildSettingsDryRunSchema>;
