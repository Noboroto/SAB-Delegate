import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import list from "./bulkAssign/list";
import byReaction from "./bulkAssign/byReaction";

export default {
  data: new SlashCommandBuilder()
    .setName("bulk-assign")
    .setDescription("Assign or remove a role for many members")
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
