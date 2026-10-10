import {
  ChannelType,
  TextChannel,
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { buildMessageCopy } from "../_shared/copyMessage";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "copy-paste";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Copy a messsage to specific channel!")
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addChannelOption((Option) =>
        Option.setName("destination")
          .addChannelTypes(ChannelType.GuildText)
          .addChannelTypes(ChannelType.GuildAnnouncement)
          .addChannelTypes(ChannelType.AnnouncementThread)
          .addChannelTypes(ChannelType.PublicThread)
          .addChannelTypes(ChannelType.PrivateThread)
          .setDescription("default is where you run this command")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as TextChannel;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const messageFromID = await getMessageFromOption(
      interaction,
      "message-link"
    );

    if (!messageFromID) {
      await interaction.editReply({
        content: "Message not found!",
      });
      return;
    }

    const message = buildMessageCopy(messageFromID);
    if (!message) {
      await interaction.editReply({
        content: "The source message has no text or attachment to copy!",
      });
      return;
    }

    try {
      await targetChannel.sendTyping();
      await targetChannel.send(message);
    } catch (error) {
      console.error("bot-message copy-paste failed", error);
      await interaction.editReply({
        content: `Cannot send to ${targetChannel}: ${errorMessage(error)}`,
      });
      return;
    }

    await interaction.editReply({
      content: "Done!",
    });
  },
};
