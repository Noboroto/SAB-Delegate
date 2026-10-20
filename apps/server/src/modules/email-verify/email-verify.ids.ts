/**
 * Custom ids of the verify button and its two forms. Every id ends with the
 * Discord id of the server so a button posted in a server, or sent to a member
 * by direct message, always says which server it verifies for.
 */
const PREFIX = 'ev';

const EMAIL_VERIFY_ACTIONS = ['start', 'email', 'code', 'resend'] as const;

export type EmailVerifyAction = (typeof EMAIL_VERIFY_ACTIONS)[number];

/**
 * `ev/<action>/<guildId>`. Buttons: `start` (asks for the address), `code`
 * (asks for the code), `resend`. Modals: `email` (the address) and `code`.
 */
export function emailVerifyCustomId(action: EmailVerifyAction, guildId: string): string {
  return `${PREFIX}/${action}/${guildId}`;
}

/** The action and server of one of this module's custom ids, `null` for any other id. */
export function parseEmailVerifyCustomId(
  customId: string,
): { action: EmailVerifyAction; guildId: string } | null {
  const [prefix, action, guildId, ...rest] = customId.split('/');
  if (
    prefix !== PREFIX ||
    rest.length > 0 ||
    guildId === undefined ||
    !/^\d{17,20}$/.test(guildId)
  ) {
    return null;
  }
  const known = EMAIL_VERIFY_ACTIONS.find((candidate) => candidate === action);
  return known === undefined ? null : { action: known, guildId };
}
