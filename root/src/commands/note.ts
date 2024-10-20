import addCmd from "./note/add";
import getCmd from "./note/get";
import removeCmd from "./note/remove";
import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("note")
    .setDescription("Manage notes by role")
    .addSubcommand((subcommad) => addCmd.addCommand(subcommad))
    .addSubcommand((subcommad) => getCmd.addCommand(subcommad))
    .addSubcommand((subcommad) => removeCmd.addCommand(subcommad)),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case addCmd.name:
        addCmd.execute(interaction);
        break;
      case getCmd.name:
        getCmd.execute(interaction);
        break;
      case removeCmd.name:
        removeCmd.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
