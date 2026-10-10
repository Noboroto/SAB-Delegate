import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

import { noteUltils } from "../../ultils";
import { errorMessage } from "../_shared/errorMessage";

const commandName = "remove";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Remove saved-note by role")

      .addRoleOption((Option) =>
        Option.setName("role").setDescription("role to note").setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("topic")
          .setDescription("Warning: case-sensitive!")
          .setRequired(true)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const role = interaction.options.getRole("role");
    const topic = interaction.options.getString("topic");

    try {
      await noteUltils.removeNote(role.id, topic);
    } catch (error) {
      console.error("note remove failed", error);
      await interaction.reply({
        content: `Cannot remove the note: ${errorMessage(error)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `Note removed for @${role.name} with topic ${topic}`,
    });
  },
};
