import {
  ChatInputCommandInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

export default {
  name: "edit-send",
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(this.name)
      .setDescription("Edit a message sent by this bot!")
      .addStringOption((Option) =>
        Option.setName("new-content")
          .setDescription("new content")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("old-bot-message-link")
          .setDescription("bot message link")
          .setRequired(true)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const botMessageFromID = await getMessageFromOption(
      interaction,
      "old-bot-message-link"
    );
    const response = interaction.options.getString("content");

    const message = {
      content: response,
    };

    botMessageFromID.edit(message);

    await interaction.editReply({
      content: "Done!",
    });
  },
};
