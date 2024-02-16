import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import list from "./privateThread/list";
import byReaction from "./privateThread/byReaction";

export default {
  data: new SlashCommandBuilder()
    .setName("private-thread")
    .setDescription("Manage a private thread for each member by condition")
    .addSubcommand(list.addCommand)
    .addSubcommand(byReaction.addCommand)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(`subcommand: ${commands}`);
    switch (commands) {
      case list.name:
        list.execute(interaction);
        break;
      case byReaction.name:
        byReaction.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
