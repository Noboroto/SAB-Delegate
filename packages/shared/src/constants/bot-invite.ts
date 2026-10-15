/**
 * Permission bits (Discord's numbering) the bot's features need in a server it
 * is invited to. Listed by name so a bit is never added or dropped by accident;
 * the server spec checks every entry against discord.js `PermissionFlagsBits`.
 */
export const BOT_INVITE_PERMISSION_BITS = {
  CreateInstantInvite: 0n,
  // `/create-activity` creates channels and grants these in their overwrites;
  // Discord refuses an overwrite that grants a permission the bot lacks.
  ManageChannels: 4n,
  PrioritySpeaker: 8n,
  Stream: 9n,
  SendTTSMessages: 12n,
  Connect: 20n,
  Speak: 21n,
  ManageWebhooks: 29n,
  UseApplicationCommands: 31n,
  AddReactions: 6n,
  ViewChannel: 10n,
  SendMessages: 11n,
  ManageMessages: 13n,
  EmbedLinks: 14n,
  AttachFiles: 15n,
  ReadMessageHistory: 16n,
  MentionEveryone: 17n,
  UseExternalEmojis: 18n,
  ChangeNickname: 26n,
  ManageNicknames: 27n,
  ManageRoles: 28n,
  ManageThreads: 34n,
  CreatePublicThreads: 35n,
  CreatePrivateThreads: 36n,
  SendMessagesInThreads: 38n,
} as const satisfies Record<string, bigint>;

/**
 * The `permissions` value of the invite link: the bits above OR-ed together as a
 * decimal string, because the set outgrows the safe integer range.
 */
export const BOT_INVITE_PERMISSIONS: string = Object.values<bigint>(BOT_INVITE_PERMISSION_BITS)
  .reduce<bigint>((bits, shift) => bits | (1n << shift), 0n)
  .toString();

/**
 * Discord's authorize page for adding the bot to one server. The server is
 * fixed and the picker hidden, so the person cannot add it somewhere else
 * by mistake.
 */
export function buildBotInviteUrl(input: {
  clientId: string;
  permissions: string;
  guildId: string;
}): string {
  const query = new URLSearchParams({
    client_id: input.clientId,
    scope: 'bot applications.commands',
    permissions: input.permissions,
    guild_id: input.guildId,
    disable_guild_select: 'true',
  });
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}
