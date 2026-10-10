import {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "edit-send";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Edit a message sent by this bot!")
      .addStringOption((Option) =>
        Option.setName("new-content")
          .setDescription("new content")
          .setMaxLength(2000)
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("old-bot-message-link")
          .setDescription("bot message link")
          .setRequired(true)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const botMessageFromID = await getMessageFromOption(
      interaction,
      "old-bot-message-link"
    );

    if (!botMessageFromID) {
      await interaction.editReply({
        content: "Message not found!",
      });
      return;
    }

    if (botMessageFromID.author.id !== interaction.client.user.id) {
      await interaction.editReply({
        content: "The old message was not sent by this bot!",
      });
      return;
    }

    const response = interaction.options.getString("new-content");
    if (!response?.trim()) {
      await interaction.editReply({
        content: "New content must not be empty!",
      });
      return;
    }

    try {
      await botMessageFromID.edit({ content: response });
    } catch (error) {
      console.error("bot-message edit-send failed", error);
      await interaction.editReply({
        content: `Cannot edit the message: ${errorMessage(error)}`,
      });
      return;
    }

    await interaction.editReply({
      content: "Done!",
    });
  },
};
