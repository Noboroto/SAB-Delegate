import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";

import { noteUltils } from "../../ultils";

export default {
  name: "remove",
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(this.name)
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

    noteUltils.removeNote(role.id, topic);

    interaction.reply({
      content: `Note removed for @${role.name} with topic ${topic}`,
      ephemeral: false,
    });
  },
};
