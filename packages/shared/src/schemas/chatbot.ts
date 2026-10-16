import { z } from 'zod';
import { ChatbotConfigSchema as ChatbotConfigModelSchema } from '../generated/zod/schemas/models/ChatbotConfig.schema.js';
import { ChatbotTurnSchema as ChatbotTurnModelSchema } from '../generated/zod/schemas/models/ChatbotTurn.schema.js';
import {
  CHATBOT_LIMIT_MAX,
  CHATBOT_MAX_CHANNELS,
  CHATBOT_TURN_ANSWER_MAX_CHARS,
  CHATBOT_TURN_QUESTION_MAX_CHARS,
} from '../constants/chatbot.js';
import { partialWithoutDefaults } from '../utils/partial-without-defaults.js';
import { ListQuerySchema } from './list-query.js';
import { LlmSettingsInputSchema, LlmTestResultSchema } from './llm.js';
import { PaginatedSchema } from './pagination.js';
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
    /** Set while the provider refused for lack of credit and calls to this model are held back. */
    pausedUntil: z.iso.datetime().optional(),
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

/** The month's members, with the month they are counted in and the default a member without a limit of their own gets. */
export const ChatbotQuotaPageSchema = PaginatedSchema(ChatbotQuotaRowSchema).extend({
  /** The quota month, `YYYY-MM` in the business time zone. */
  period: z.string().regex(/^\d{4}-\d{2}$/),
  defaultLimit: TokenLimitSchema,
});

export type ChatbotQuotaPage = z.infer<typeof ChatbotQuotaPageSchema>;

/** The member a route names. */
export const ChatbotUserParamSchema = z.object({ userId: SnowflakeSchema });

export const ChatbotQuotaResetRequestSchema = z.object({
  /** Report what would be cleared without clearing it. */
  dryRun: z.boolean().default(false),
});

export const ChatbotQuotaResetResultSchema = z.object({
  dryRun: z.boolean(),
  /** What the member had spent this month, before the reset. */
  used: z.number().int().min(0),
});

export type ChatbotQuotaResetResult = z.infer<typeof ChatbotQuotaResetResultSchema>;

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

/** What a memory clear targets; MCP takes it without `dryRun`, which its write guard supplies. */
export const ChatbotMemoryClearTargetSchema = z.object({
  scope: z.enum(['user', 'channel', 'all']),
  userId: SnowflakeSchema.optional(),
  channelId: SnowflakeSchema.optional(),
});

export const ChatbotMemoryClearRequestSchema = ChatbotMemoryClearTargetSchema.extend({
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

// Per-field bounds, so the schema alone limits what one snapshot can hold; the
// serialized size cap in the service is the final limit.
const CONTEXT_SYSTEM_MAX = 30_000;
const CONTEXT_MESSAGE_MAX = 4000;
const CONTEXT_MEMORY_MAX = 2000;
const CONTEXT_NAME_MAX = 255;
const CONTEXT_KIND_MAX = 50;
const CONTEXT_NOTE_MAX = 500;
const CONTEXT_ITEMS_MAX = 100;
const MODEL_NAME_MAX = 200;

/**
 * What the model was given for one turn, kept so an admin can see why it
 * answered as it did. Every field but `system` has a default: a snapshot
 * written by an older build parses instead of being lost. Text is stored as
 * sent, so none of it is trimmed. Image and file bytes are never part of it;
 * `attachments` only describes them.
 */
export const ChatbotTurnContextSchema = z.object({
  system: z.string().max(CONTEXT_SYSTEM_MAX),
  channelMessages: z
    .array(
      z.object({
        authorName: z.string().max(CONTEXT_NAME_MAX),
        authorId: SnowflakeSchema,
        content: z.string().max(CONTEXT_MESSAGE_MAX),
        at: z.iso.datetime(),
      }),
    )
    .max(CONTEXT_ITEMS_MAX)
    .default([]),
  memory: z
    .object({
      channel: z.string().max(CONTEXT_MEMORY_MAX).optional(),
      user: z.string().max(CONTEXT_MEMORY_MAX).optional(),
    })
    .default({}),
  /** How many earlier turns of the member were replayed into the prompt. */
  recentTurns: z.number().int().min(0).default(0),
  attachments: z
    .array(
      z.object({
        name: z.string().max(CONTEXT_NAME_MAX),
        kind: z.string().max(CONTEXT_KIND_MAX),
        bytes: z.number().int().min(0),
        /** Whether the model actually received it. */
        included: z.boolean(),
        note: z.string().max(CONTEXT_NOTE_MAX).optional(),
      }),
    )
    .max(CONTEXT_ITEMS_MAX)
    .default([]),
});

export type ChatbotTurnContext = z.infer<typeof ChatbotTurnContextSchema>;

const TurnBaseSchema = ChatbotTurnModelSchema.pick({ status: true, estimated: true }).extend({
  channelId: SnowflakeSchema,
  userId: SnowflakeSchema,
  triggerMessageId: SnowflakeSchema,
  replyMessageId: SnowflakeSchema.nullable(),
  /** One of the model call's failure reason codes, never text a provider sent back. */
  failureReason: LlmTestResultSchema.shape.reason.unwrap().nullable(),
  question: z.string().max(CHATBOT_TURN_QUESTION_MAX_CHARS),
  answer: z.string().max(CHATBOT_TURN_ANSWER_MAX_CHARS).nullable(),
  model: z.string().max(MODEL_NAME_MAX).nullable(),
  /** `guild`: the server's own model; `global`: the shared one. */
  llmSource: z.enum(['guild', 'global']).nullable(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

/**
 * A turn as the pipeline finishes it; the server it belongs to is a Discord id.
 * PENDING and EXPIRED are states of the intake and recovery, never an outcome.
 */
export const ChatbotTurnRecordSchema = TurnBaseSchema.extend({
  status: TurnBaseSchema.shape.status.exclude(['PENDING', 'EXPIRED']),
  guildId: SnowflakeSchema,
  context: ChatbotTurnContextSchema,
}).refine((turn) => turn.status !== 'OK' || turn.answer !== null, {
  message: 'an OK turn has an answer',
  path: ['answer'],
});

export type ChatbotTurnRecord = z.infer<typeof ChatbotTurnRecordSchema>;

/**
 * A turn in a list: the context snapshot is only in the detail. Members get
 * rows of their own turns, never the detail: its snapshot holds other members'
 * messages and the system prompt.
 */
export const ChatbotTurnRowSchema = TurnBaseSchema.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});

export type ChatbotTurnRow = z.infer<typeof ChatbotTurnRowSchema>;

/** A turn in a list, with the name the member has in the server; null once they have left. */
const ChatbotTurnListRowSchema = ChatbotTurnRowSchema.extend({
  displayName: ChatbotQuotaRowSchema.shape.displayName,
});

export const ChatbotTurnPageSchema = PaginatedSchema(ChatbotTurnListRowSchema);

export type ChatbotTurnPage = z.infer<typeof ChatbotTurnPageSchema>;

/** The turn a route names. */
export const ChatbotTurnParamSchema = z.object({ id: z.uuid() });

/**
 * For admins of the server only. `context` is null when the stored snapshot no
 * longer parses.
 */
export const ChatbotTurnDetailSchema = ChatbotTurnRowSchema.extend({
  context: ChatbotTurnContextSchema.nullable(),
});

export type ChatbotTurnDetail = z.infer<typeof ChatbotTurnDetailSchema>;

/** One earlier exchange of a member, replayed into the prompt. Ids let the prompt skip what the live messages already show. */
export const ChatbotRecentTurnSchema = ChatbotTurnRowSchema.pick({
  triggerMessageId: true,
  replyMessageId: true,
  question: true,
  createdAt: true,
}).extend({ answer: z.string() });

export type ChatbotRecentTurn = z.infer<typeof ChatbotRecentTurnSchema>;

export const ChatbotTurnListQuerySchema = ListQuerySchema(['createdAt'])
  .extend({
    /** Newest first unless asked otherwise. */
    order: z.enum(['asc', 'desc']).default('desc'),
    userId: SnowflakeSchema.optional(),
    channelId: SnowflakeSchema.optional(),
    status: ChatbotTurnModelSchema.shape.status.optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export type ChatbotTurnListQuery = z.infer<typeof ChatbotTurnListQuerySchema>;

/** What a turn delete targets; MCP takes it without `dryRun`, which its write guard supplies. */
export const ChatbotTurnDeleteTargetSchema = z.object({
  scope: z.enum(['turn', 'user', 'all']),
  turnId: z.uuid().optional(),
  userId: SnowflakeSchema.optional(),
});

export const ChatbotTurnDeleteRequestSchema = ChatbotTurnDeleteTargetSchema.extend({
  /** Count what would go without deleting it. */
  dryRun: z.boolean().default(false),
})
  // Exactly the ids the scope names: an extra id would be silently ignored and
  // delete more than the caller meant to. For scope "turn" a userId is an
  // optional owner check, which is how a member deletes only their own turn.
  .refine((body) => (body.turnId !== undefined) === (body.scope === 'turn'), {
    message: 'turnId is required for scope "turn" and refused otherwise',
    path: ['turnId'],
  })
  .refine(
    (body) => body.scope === 'turn' || (body.userId !== undefined) === (body.scope === 'user'),
    {
      message: 'userId is required for scope "user", optional for "turn" and refused otherwise',
      path: ['userId'],
    },
  );

export type ChatbotTurnDeleteRequest = z.infer<typeof ChatbotTurnDeleteRequestSchema>;

export const ChatbotTurnDeleteResultSchema = z.object({
  dryRun: z.boolean(),
  count: z.number().int().min(0),
});

export type ChatbotTurnDeleteResult = z.infer<typeof ChatbotTurnDeleteResultSchema>;
