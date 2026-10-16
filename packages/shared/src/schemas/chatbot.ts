import { z } from 'zod';
import { ChatbotConfigSchema as ChatbotConfigModelSchema } from '../generated/zod/schemas/models/ChatbotConfig.schema.js';
import { CHATBOT_LIMIT_MAX, CHATBOT_MAX_CHANNELS } from '../constants/chatbot.js';
import { partialWithoutDefaults } from '../utils/partial-without-defaults.js';
import { ListQuerySchema } from './list-query.js';
import { LlmSettingsInputSchema } from './llm.js';
import { SnowflakeSchema } from './snowflake.js';

/** A token amount a limit, bonus or spent counter can hold. */
const TokenLimitSchema = z.number().int().min(0).max(CHATBOT_LIMIT_MAX);

/**
 * A server's chatbot as the dashboard, REST and MCP show it. `llm` says which
 * model answers; the override's key is stored encrypted and none of its
 * columns, ciphertext included, is ever picked into a response.
 */
export const ChatbotConfigSchema = ChatbotConfigModelSchema.pick({
  enabled: true,
  defaultMonthlyLimit: true,
}).extend({
  defaultMonthlyLimit: TokenLimitSchema,
  channels: z.array(SnowflakeSchema).max(CHATBOT_MAX_CHANNELS),
  llm: z.object({
    /** `guild`: the server's own override; `global`: the shared model; `none`: nothing can answer. */
    source: z.enum(['guild', 'global', 'none']),
    baseUrl: z.string().nullable(),
    model: z.string().nullable(),
    keyLast4: z.string().nullable(),
    /** Whether the shared model exists and is switched on. */
    globalAvailable: z.boolean(),
  }),
});

export type ChatbotConfig = z.infer<typeof ChatbotConfigSchema>;

/** A field left out is left alone; `.partial()` would keep the column defaults and overwrite them. */
export const ChatbotConfigPatchSchema = partialWithoutDefaults(
  ChatbotConfigSchema.pick({ enabled: true, defaultMonthlyLimit: true }),
);

export type ChatbotConfigPatch = z.infer<typeof ChatbotConfigPatchSchema>;

export const ChatbotChannelRequestSchema = z.object({ channelId: SnowflakeSchema });

export type ChatbotChannelRequest = z.infer<typeof ChatbotChannelRequestSchema>;

/** A server's own model; saving it needs a key, so it is not offered through chat or MCP. */
export const ChatbotLlmOverrideInputSchema = LlmSettingsInputSchema.pick({
  baseUrl: true,
  model: true,
  apiKey: true,
});

export type ChatbotLlmOverrideInput = z.infer<typeof ChatbotLlmOverrideInputSchema>;

export const ChatbotQuotaListQuerySchema = ListQuerySchema(['used', 'limit', 'userId']);

export type ChatbotQuotaListQuery = z.infer<typeof ChatbotQuotaListQuerySchema>;

export const ChatbotQuotaRowSchema = z.object({
  userId: SnowflakeSchema,
  /** The member's name in the server; null once they have left. */
  displayName: z.string().nullable(),
  used: z.number().int().min(0),
  /** The monthly limit in force, before the bonus. */
  limit: TokenLimitSchema,
  bonus: TokenLimitSchema,
  /** Whether `limit` is the member's own rather than the server default. */
  overridden: z.boolean(),
  remaining: z.number().int().min(0),
});

export type ChatbotQuotaRow = z.infer<typeof ChatbotQuotaRowSchema>;

/** `null` drops the member's own limit, so the server default applies again. */
export const ChatbotQuotaSetRequestSchema = z.object({ limit: TokenLimitSchema.nullable() });

export type ChatbotQuotaSetRequest = z.infer<typeof ChatbotQuotaSetRequestSchema>;

/** A signed change of this month's bonus; a negative one takes back an earlier grant. */
export const ChatbotQuotaGrantRequestSchema = z.object({
  tokens: z
    .number()
    .int()
    .min(-CHATBOT_LIMIT_MAX)
    .max(CHATBOT_LIMIT_MAX)
    .refine((tokens) => tokens !== 0, { message: 'must not be zero' }),
});

export type ChatbotQuotaGrantRequest = z.infer<typeof ChatbotQuotaGrantRequestSchema>;

export const ChatbotMemoryClearRequestSchema = z
  .object({
    scope: z.enum(['user', 'channel', 'all']),
    userId: SnowflakeSchema.optional(),
    channelId: SnowflakeSchema.optional(),
    /** Count what would go without deleting it. */
    dryRun: z.boolean().default(false),
  })
  // Exactly the id the scope names: an extra id would be silently ignored and
  // clear more than the caller meant to.
  .refine((body) => (body.userId !== undefined) === (body.scope === 'user'), {
    message: 'userId is required for scope "user" and refused otherwise',
    path: ['userId'],
  })
  .refine((body) => (body.channelId !== undefined) === (body.scope === 'channel'), {
    message: 'channelId is required for scope "channel" and refused otherwise',
    path: ['channelId'],
  });

export type ChatbotMemoryClearRequest = z.infer<typeof ChatbotMemoryClearRequestSchema>;

export const ChatbotMemoryClearResultSchema = z.object({
  dryRun: z.boolean(),
  userMemories: z.number().int().min(0),
  channelMemories: z.number().int().min(0),
});

export type ChatbotMemoryClearResult = z.infer<typeof ChatbotMemoryClearResultSchema>;
