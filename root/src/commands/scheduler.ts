import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import getCmd from "./scheduler/get";
import cancelCmd from "./scheduler/cancel";

export default {
  data: new SlashCommandBuilder()
    .setName("scheduler")
    .setDescription("Scheduler command")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommad) => getCmd.addCommand(subcommad))
    .addSubcommand((subcommad) => cancelCmd.addCommand(subcommad)),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case getCmd.name:
        getCmd.execute(interaction);
        break;
      case cancelCmd.name:
        cancelCmd.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
