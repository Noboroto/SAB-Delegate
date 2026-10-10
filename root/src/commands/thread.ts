import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import removeByPrefix from "./thread/removeByPrefix";
import editPrefix from "./thread/editPrefix";
import create from "./thread/create";
import everyone from "./thread/everyone";

export default {
  data: new SlashCommandBuilder()
    .setName("thread")
    .setDescription("Manage a thread for each member by condition")
    .addSubcommand(removeByPrefix.addCommand)
    .addSubcommand(editPrefix.addCommand)
    .addSubcommand(create.addCommand)
    .addSubcommand(everyone.addCommand)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case everyone.name:
        await everyone.execute(interaction);
        break;
      case editPrefix.name:
        await editPrefix.execute(interaction);
        break;
      case removeByPrefix.name:
        await removeByPrefix.execute(interaction);
        break;
      case create.name:
        await create.execute(interaction);
        break;
      default:
        await interaction.reply({
          content: `Invalid subcommand ${commands}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};
