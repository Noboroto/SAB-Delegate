import {
  ChatInputCommandInteraction,
  ChannelType,
  TextChannel,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

export default {
  name: "send",
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(this.name)
      .setDescription("Send a messsage to this channel or another")
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
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
    await interaction.deferReply({ ephemeral: true });

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

    if (messageFromID) {
      messageFromID.reply(message);
    } else {
      targetChannel.send(message);
    }

    interaction.editReply({
      content: "Sent!",
    });
  },
};
