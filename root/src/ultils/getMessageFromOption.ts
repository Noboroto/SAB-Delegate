import { ChatInputCommandInteraction, TextChannel, Message } from "discord.js";

export const getMessageFromOption = async (
  interaction: ChatInputCommandInteraction,
  optionName: string
) => {
  const messageLink = interaction.options.getString(optionName);

  if (!messageLink) {
    return null;
  }
  try {
    const part = messageLink.split("/");
    const channelId = part[part.length - 2];
    const messageId = part[part.length - 1];
    const channel = (await interaction.client.channels.fetch(
      channelId
    )) as TextChannel;
    if (!channel) return null;
    const messageFromID = await channel.messages.fetch(messageId);
    return messageFromID as Message;
  } catch (error) {
    console.error(`Failed to fetch message from option "${optionName}":`, error);
    return null;
  }
};
