import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { noteUltils } from "../../ultils";

const commandName = "add";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Note eveything and save by role")

      .addRoleOption((Option) =>
        Option.setName("role").setDescription("role to note").setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("topic")
          .setDescription("Warning: case-sensitive!")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("note")
          .setDescription("will be replaced if topic existed")
          .setRequired(false)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const role = interaction.options.getRole("role");
    const topic = interaction.options.getString("topic");
    const note = interaction.options.getString("note");

    await noteUltils.saveNote(role.id, topic, note);

    interaction.reply({
      content: `Note saved for @${role.name} with topic ${topic}`,
      ephemeral: false,
    });
  },
};
