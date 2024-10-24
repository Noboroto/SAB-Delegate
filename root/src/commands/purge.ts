import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import anyCmd from "./purge/any";

export default {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Purge messages in this channel.")

    .addSubcommand(anyCmd.addCommand)
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case anyCmd.name:
        await anyCmd.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
