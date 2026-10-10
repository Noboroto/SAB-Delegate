import addCmd from "./note/add";
import getCmd from "./note/get";
import removeCmd from "./note/remove";
import { SlashCommandBuilder, MessageFlags } from "discord.js";

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
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case addCmd.name:
        await addCmd.execute(interaction);
        break;
      case getCmd.name:
        await getCmd.execute(interaction);
        break;
      case removeCmd.name:
        await removeCmd.execute(interaction);
        break;
      default:
        await interaction.reply({
          content: `Invalid subcommand ${commands}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};
