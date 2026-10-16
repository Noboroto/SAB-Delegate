import {
  LlmModelsRequestSchema,
  LlmModelsResultSchema,
  LlmSettingsInputSchema,
  LlmSettingsSchema,
  LlmTestResultSchema,
  type LlmModelsRequest,
  type LlmModelsResult,
  type LlmSettings,
  type LlmSettingsInput,
  type LlmTestResult,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

export function saveLlmSettings(guildId: string, input: LlmSettingsInput): Promise<LlmSettings> {
  return apiFetch(guildApiPath(guildId, 'llm'), {
    method: 'PUT',
    body: LlmSettingsInputSchema.parse(input),
    parser: LlmSettingsSchema,
  });
}

/** Asks the server to call the provider with these values; nothing is stored. */
export function testLlmSettings(guildId: string, input: LlmSettingsInput): Promise<LlmTestResult> {
  return apiFetch(guildApiPath(guildId, 'llm', 'test'), {
    method: 'POST',
    body: LlmSettingsInputSchema.parse(input),
    parser: LlmTestResultSchema,
  });
}

/** Asks the server which models the endpoint serves; nothing is stored. */
export function listLlmModels(guildId: string, input: LlmModelsRequest): Promise<LlmModelsResult> {
  return apiFetch(guildApiPath(guildId, 'llm', 'models'), {
    method: 'POST',
    body: LlmModelsRequestSchema.parse(input),
    parser: LlmModelsResultSchema,
  });
}
