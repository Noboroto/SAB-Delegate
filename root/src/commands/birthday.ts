import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import appendList from "./birthday/appendList";
import getList from "./birthday/getList";
import removeCmd from "./birthday/remove";
import setChannel from "./birthday/setChannel";

export default {
  data: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Manage birthday wishes for users.")
    .addSubcommand(appendList.addCommand)
    .addSubcommand(getList.addCommand)
    .addSubcommand(removeCmd.addCommand)
    .addSubcommand(setChannel.addCommand)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case setChannel.name:
        await setChannel.execute(interaction);
        break;
      case getList.name:
        await getList.execute(interaction);
        break;
      case appendList.name:
        await appendList.execute(interaction);
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
