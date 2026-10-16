import {
  ChatbotConfigPatchSchema,
  ChatbotConfigSchema,
  ChatbotLlmOverrideInputSchema,
  ChatbotMemoryClearRequestSchema,
  ChatbotMemoryClearResultSchema,
  ChatbotQuotaGrantRequestSchema,
  ChatbotQuotaResetRequestSchema,
  ChatbotQuotaResetResultSchema,
  ChatbotQuotaRowSchema,
  ChatbotQuotaSetRequestSchema,
  ChatbotTurnDeleteRequestSchema,
  ChatbotTurnDeleteResultSchema,
  LlmModelsRequestSchema,
  LlmModelsResultSchema,
  LlmTestResultSchema,
  type ChatbotConfig,
  type ChatbotConfigPatch,
  type ChatbotLlmOverrideInput,
  type ChatbotMemoryClearResult,
  type ChatbotMemoryClearTargetSchema,
  type ChatbotQuotaResetResult,
  type ChatbotQuotaRow,
  type ChatbotTurnDeleteResult,
  type ChatbotTurnDeleteTargetSchema,
  type LlmModelsRequest,
  type LlmModelsResult,
  type LlmTestResult,
  type z,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

const chatbotPath = (guildId: string, ...rest: string[]) =>
  guildApiPath(guildId, 'chatbot', ...rest);

/** A field left out is left alone. */
export function configureChatbot(
  guildId: string,
  patch: ChatbotConfigPatch,
): Promise<ChatbotConfig> {
  return apiFetch(chatbotPath(guildId, 'config'), {
    method: 'PATCH',
    body: ChatbotConfigPatchSchema.parse(patch),
    parser: ChatbotConfigSchema,
  });
}

/** Adding a channel that is already one answers like the first call. */
export function addChatbotChannel(guildId: string, channelId: string): Promise<ChatbotConfig> {
  return apiFetch(chatbotPath(guildId, 'channels', channelId), {
    method: 'PUT',
    parser: ChatbotConfigSchema,
  });
}

export function removeChatbotChannel(guildId: string, channelId: string): Promise<ChatbotConfig> {
  return apiFetch(chatbotPath(guildId, 'channels', channelId), {
    method: 'DELETE',
    parser: ChatbotConfigSchema,
  });
}

/** Needs a recent login; the server answers `AUTH_REAUTH_REQUIRED` otherwise. */
export function saveChatbotLlm(
  guildId: string,
  input: ChatbotLlmOverrideInput,
): Promise<ChatbotConfig> {
  return apiFetch(chatbotPath(guildId, 'llm'), {
    method: 'PUT',
    body: ChatbotLlmOverrideInputSchema.parse(input),
    parser: ChatbotConfigSchema,
  });
}

/** Needs a recent login, like saving. */
export function clearChatbotLlm(guildId: string): Promise<ChatbotConfig> {
  return apiFetch(chatbotPath(guildId, 'llm'), { method: 'DELETE', parser: ChatbotConfigSchema });
}

/** Asks the server to call the provider with these values; nothing is stored. */
export function testChatbotLlm(
  guildId: string,
  input: ChatbotLlmOverrideInput,
): Promise<LlmTestResult> {
  return apiFetch(chatbotPath(guildId, 'llm', 'test'), {
    method: 'POST',
    body: ChatbotLlmOverrideInputSchema.parse(input),
    parser: LlmTestResultSchema,
  });
}

/** Asks the server which models the endpoint serves; nothing is stored. */
export function listChatbotLlmModels(
  guildId: string,
  input: LlmModelsRequest,
): Promise<LlmModelsResult> {
  return apiFetch(chatbotPath(guildId, 'llm', 'models'), {
    method: 'POST',
    body: LlmModelsRequestSchema.parse(input),
    parser: LlmModelsResultSchema,
  });
}

/** `null` drops the member's own limit, so the server default applies again. */
export function setChatbotLimit(
  guildId: string,
  userId: string,
  limit: number | null,
): Promise<ChatbotQuotaRow> {
  return apiFetch(chatbotPath(guildId, 'quota', userId), {
    method: 'PUT',
    body: ChatbotQuotaSetRequestSchema.parse({ limit }),
    parser: ChatbotQuotaRowSchema,
  });
}

/** A signed change of this month's bonus; a negative one takes tokens back. */
export function grantChatbotTokens(
  guildId: string,
  userId: string,
  tokens: number,
): Promise<ChatbotQuotaRow> {
  return apiFetch(chatbotPath(guildId, 'quota', userId, 'grant'), {
    method: 'POST',
    body: ChatbotQuotaGrantRequestSchema.parse({ tokens }),
    parser: ChatbotQuotaRowSchema,
  });
}

/** `dryRun` reports what the member has spent this month and changes nothing. */
export function resetChatbotUsage(
  guildId: string,
  userId: string,
  dryRun: boolean,
): Promise<ChatbotQuotaResetResult> {
  return apiFetch(chatbotPath(guildId, 'quota', userId, 'reset'), {
    method: 'POST',
    body: ChatbotQuotaResetRequestSchema.parse({ dryRun }),
    parser: ChatbotQuotaResetResultSchema,
  });
}

/** `dryRun` counts the memories that would go. */
export function clearChatbotMemory(
  guildId: string,
  target: z.infer<typeof ChatbotMemoryClearTargetSchema>,
  dryRun: boolean,
): Promise<ChatbotMemoryClearResult> {
  return apiFetch(chatbotPath(guildId, 'memory', 'clear'), {
    method: 'POST',
    body: ChatbotMemoryClearRequestSchema.parse({ ...target, dryRun }),
    parser: ChatbotMemoryClearResultSchema,
  });
}

/** `dryRun` counts the exchanges that would go. */
export function deleteChatbotTurns(
  guildId: string,
  target: z.infer<typeof ChatbotTurnDeleteTargetSchema>,
  dryRun: boolean,
): Promise<ChatbotTurnDeleteResult> {
  return apiFetch(chatbotPath(guildId, 'turns'), {
    method: 'DELETE',
    body: ChatbotTurnDeleteRequestSchema.parse({ ...target, dryRun }),
    parser: ChatbotTurnDeleteResultSchema,
  });
}
