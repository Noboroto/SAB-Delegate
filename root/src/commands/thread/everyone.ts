import {
  ChatInputCommandInteraction,
  ChannelType,
  SlashCommandSubcommandBuilder,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { errorMessage } from "../_shared/errorMessage";

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
          .setMaxLength(1900)
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

    const targetChannel = interaction.channel;
    if (
      targetChannel.type !== ChannelType.PublicThread &&
      targetChannel.type !== ChannelType.PrivateThread
    ) {
      await interaction.editReply({
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

    try {
      if (messageFromID) {
        await messageFromID.reply(message);
      } else {
        await targetChannel.send(message);
      }
    } catch (error) {
      console.error("thread everyone failed", error);
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
