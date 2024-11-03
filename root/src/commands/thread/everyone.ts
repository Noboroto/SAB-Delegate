import {
  ChatInputCommandInteraction,
  ChannelType,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

const commandName = "everyone";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Send a messsage to current THREAD with @everyone")
      .addStringOption((Option) =>
        Option.setName("content")
          .setDescription("message content")
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
      `${interaction.user} mentioned @everyone\n` +
      (interaction.options.getString("content") || "");
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
