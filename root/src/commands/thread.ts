import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import removeByPrefix from "./thread/removeByPrefix";
import editPrefix from "./thread/editPrefix";

export default {
  data: new SlashCommandBuilder()
    .setName("thread")
    .setDescription("Manage a thread for each member by condition")
    .addSubcommand(removeByPrefix.addCommand)
    .addSubcommand(editPrefix.addCommand)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(`subcommand: ${commands}`);
    switch (commands) {
      case editPrefix.name:
        editPrefix.execute(interaction);
        break;
      case removeByPrefix.name:
        removeByPrefix.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
