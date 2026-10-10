import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
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
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case list.name:
        await list.execute(interaction);
        break;
      case byReaction.name:
        await byReaction.execute(interaction);
        break;
      default:
        await interaction.reply({
          content: `Invalid subcommand ${commands}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};
