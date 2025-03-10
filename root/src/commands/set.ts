import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import introChannel from "./set/introChannel";
import birthdayChannel from "./birthday/setChannel";
import logChannel from "./set/logChannel";

export default {
  data: new SlashCommandBuilder()
    .setName("set")
    .setDescription("Set configurations for server")
    .addSubcommand(introChannel.addCommand)
    .addSubcommand(birthdayChannel.addCommand)
    .addSubcommand(logChannel.addCommand)
    .setDMPermission(true)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case introChannel.name:
        await introChannel.execute(interaction);
        break;
      case birthdayChannel.name:
        await birthdayChannel.execute(interaction);
        break;
      case logChannel.name:
        await logChannel.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
