import { ChatInputCommandInteraction, TextChannel, Message } from "discord.js";

export const getMessageFromOption = async (
  interaction: ChatInputCommandInteraction,
  optionName: string
) => {
  const messageLink = await interaction.options.getString(optionName);

  if (!messageLink) {
    return null;
  }
  const part = messageLink.split("/");
  const channelId = part[part.length - 2];
  const messageId = part[part.length - 1];
  const channel = (await interaction.client.channels.fetch(
    channelId
  )) as TextChannel;
  const messageFromID = await channel.messages.fetch(messageId);
  return messageFromID as Message;
};
