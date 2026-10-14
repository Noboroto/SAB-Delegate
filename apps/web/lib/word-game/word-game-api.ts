import {
  WordGameConfigRequestSchema,
  WordGameConfigResultSchema,
  WordGameResetRequestSchema,
  WordGameResetResultSchema,
  type WordGameConfigResult,
  type WordGameResetResult,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

export interface WordGameChange {
  channelId?: string;
  maxWords?: number;
}

/** `dryRun` asks what the change would do (a new channel clears the round's words) and changes nothing. */
export function configureWordGame(
  guildId: string,
  change: WordGameChange,
  dryRun: boolean,
): Promise<WordGameConfigResult> {
  return apiFetch(guildApiPath(guildId, 'word-game', 'config'), {
    method: 'PATCH',
    body: WordGameConfigRequestSchema.parse({ ...change, dryRun }),
    parser: WordGameConfigResultSchema,
  });
}

/** The server refuses a reset that is neither a preview nor confirmed, so the two calls differ in the flag they set. */
export function resetWordGame(guildId: string, dryRun: boolean): Promise<WordGameResetResult> {
  return apiFetch(guildApiPath(guildId, 'word-game', 'reset'), {
    method: 'POST',
    body: WordGameResetRequestSchema.parse(dryRun ? { dryRun: true } : { confirm: true }),
    parser: WordGameResetResultSchema,
  });
}
