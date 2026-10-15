import {
  LlmSettingsInputSchema,
  LlmSettingsSchema,
  LlmTestResultSchema,
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
