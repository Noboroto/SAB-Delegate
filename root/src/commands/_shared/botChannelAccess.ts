import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";

/**
 * Whether the bot lacks what it needs in one specific channel. Guild-level
 * permissions say nothing here: channel overwrites can deny a role that the
 * guild grants.
 */
export const botLacksChannelAccess = async (
  interaction: ChatInputCommandInteraction,
  channelId: string,
  need: "send" | "read"
): Promise<boolean> => {
  const channel = await interaction.client.channels.fetch(channelId);
  if (!channel || channel.isDMBased() || !("permissionsFor" in channel)) {
    return true;
  }
  const me =
    interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  const permissions = channel.permissionsFor(me);
  if (!permissions) return true;

  const required =
    need === "read"
      ? [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ]
      : [
          PermissionFlagsBits.ViewChannel,
          channel.isThread()
            ? PermissionFlagsBits.SendMessagesInThreads
            : PermissionFlagsBits.SendMessages,
        ];
  return !permissions.has(required);
};
