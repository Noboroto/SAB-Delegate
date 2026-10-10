import {
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  SlashCommandSubcommandBuilder,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "send";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Send a messsage to this channel or another")
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
          .setMaxLength(2000)
          .setRequired(true)
      )

      .addChannelOption((Option) =>
        Option.setName("destination")
          .addChannelTypes(ChannelType.GuildText)
          .addChannelTypes(ChannelType.GuildAnnouncement)
          .addChannelTypes(ChannelType.AnnouncementThread)
          .addChannelTypes(ChannelType.PublicThread)
          .addChannelTypes(ChannelType.PrivateThread)
          .setDescription("destination channel")
          .setRequired(false)
      )

      .addStringOption((Option) =>
        Option.setName("reply-message")
          .setDescription("reply message link")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetChannel = (interaction.options.getChannel("destination") ??
      interaction.channel) as TextChannel;
    const response = interaction.options.getString("content");
    const messageFromID = await getMessageFromOption(
      interaction,
      "reply-message"
    );

    const message = {
      content: response,
    };

    try {
      if (messageFromID) {
        await messageFromID.reply(message);
      } else {
        await targetChannel.send(message);
      }
    } catch (error) {
      console.error("bot-message send failed", error);
      await interaction.editReply({
        content: `Cannot send: ${errorMessage(error)}`,
      });
      return;
    }

    await interaction.editReply({
      content: "Sent!",
    });
  },
};
