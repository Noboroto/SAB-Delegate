import {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { buildMessageCopy } from "../_shared/copyMessage";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "edit-copy";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Edit a message sent by this bot!")
      .addStringOption((Option) =>
        Option.setName("new-message-link")
          .setDescription("new message link")
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
    const newMessageFromID = await getMessageFromOption(
      interaction,
      "new-message-link"
    );

    if (!botMessageFromID || !newMessageFromID) {
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

    const message = buildMessageCopy(newMessageFromID);
    if (!message) {
      await interaction.editReply({
        content: "The new message has no text or attachment to copy!",
      });
      return;
    }

    try {
      await botMessageFromID.edit(message);
    } catch (error) {
      console.error("bot-message edit-copy failed", error);
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
