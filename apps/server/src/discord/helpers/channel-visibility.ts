import { discordErrorCode } from './reply.js';

/**
 * Unknown Channel, Missing Access, Missing Permissions. For a caller that must
 * not learn which channels exist in other servers, all three read as "there is
 * no such channel": a distinct answer for 50001 would tell a key which ids are
 * real channels it cannot see.
 */
const HIDDEN_CHANNEL_CODES: ReadonlySet<number> = new Set([10003, 50001, 50013]);

export function isHiddenChannelError(error: unknown): boolean {
  const code = discordErrorCode(error);
  return code !== undefined && HIDDEN_CHANNEL_CODES.has(code);
}
