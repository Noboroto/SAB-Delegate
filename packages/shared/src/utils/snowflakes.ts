// Mentions that carry a number which is not a member: roles, channels, custom emoji.
const NON_MEMBER_TOKENS = /<@&\d+>|<#\d+>|<a?:\w+:\d+>/g;

const DIGIT_RUN = /\d+/g;

/**
 * Pulls Discord user ids out of free text: `<@id>`, `<@!id>`, or bare ids split
 * by commas, spaces or newlines. Role, channel and emoji mentions are ignored,
 * as is any digit run that is not 17 to 20 long (a 16-digit typo or a 21-digit
 * paste must not become somebody else's id). Duplicates collapse; order is the
 * order of first appearance.
 */
export function parseSnowflakes(text: string): string[] {
  const ids = new Set<string>();
  for (const [run] of text.replace(NON_MEMBER_TOKENS, ' ').matchAll(DIGIT_RUN)) {
    if (run.length >= 17 && run.length <= 20) ids.add(run);
  }
  return [...ids];
}
