import {
  ChatInputCommandInteraction,
  ChannelType,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

let commandName = "thread-everyone";

export default {
  name: () => commandName,
  changeName(newName: string) {
    commandName = newName;
  },
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Send a messsage to this thread")
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
          .setRequired(false)
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

    const targetChannel = interaction.channel;
    if (
      targetChannel.type !== ChannelType.PublicThread &&
      targetChannel.type !== ChannelType.PrivateThread
    ) {
      interaction.editReply({
        content: "This command can only be used in a thread",
      });
      return;
    }
    const response =
      "@everyone\n" + (interaction.options.getString("content") || "");
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
