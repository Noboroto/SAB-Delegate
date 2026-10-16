import { clipText, neutralize, plainName } from './chatbot-prompt.js';

/** Largest JSON a tool hands back; the model pays for every byte on each later step. */
export const TOOL_RESULT_MAX_BYTES = 4096;

/** What a tool returns when it cannot answer: a code, never text from a provider or the database. */
export const UNAVAILABLE = { error: 'unavailable' } as const;

export const INVALID = { error: 'invalid' } as const;

/** A member as the bot writes a mention; rendered without a ping. */
export function mentionOf(id: string): string {
  return `<@${id}>`;
}

/** Free text written by a member, made safe to sit in a tool result. */
export function untrustedText(text: string, max: number): string {
  return clipText(neutralize(text), max);
}

/** A name (channel, member) as one short line. */
export function shortName(name: string): string {
  return plainName(name);
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/**
 * Keeps `result` within `TOOL_RESULT_MAX_BYTES` by dropping entries from the
 * end of its list at `listKey`, and says so in `truncated`. A result that is
 * still too big with an empty list is replaced by a failure rather than cut
 * mid-JSON.
 */
export function fitResult<T extends Record<string, unknown>>(
  result: T,
  listKey: keyof T & string,
): T | typeof UNAVAILABLE {
  const list = result[listKey];
  if (!Array.isArray(list)) return bytesOf(result) <= TOOL_RESULT_MAX_BYTES ? result : UNAVAILABLE;
  const kept = [...(list as unknown[])];
  let cut = false;
  const build = (): T => ({ ...result, [listKey]: kept, ...(cut ? { truncated: true } : {}) });
  while (bytesOf(build()) > TOOL_RESULT_MAX_BYTES && kept.length > 0) {
    kept.pop();
    cut = true;
  }
  const fitted = build();
  return bytesOf(fitted) <= TOOL_RESULT_MAX_BYTES ? fitted : UNAVAILABLE;
}
