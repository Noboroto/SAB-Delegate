import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import removeByPrefix from "./thread/removeByPrefix";
import editPrefix from "./thread/editPrefix";
import create from "./thread/create";
import everyone from "./thread/everyone";

everyone.changeName("mention-everyone");

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
      case everyone.name():
        everyone.execute(interaction);
        break;
      case editPrefix.name:
        editPrefix.execute(interaction);
        break;
      case removeByPrefix.name:
        removeByPrefix.execute(interaction);
        break;
      case create.name:
        create.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
