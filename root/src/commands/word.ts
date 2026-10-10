import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import setCmd from "./word/set";
import resetCmd from "./word/reset";

export default {
  data: new SlashCommandBuilder()
    .setName("word")
    .setDescription("Trò chơi nối chữ")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((subcommad) => setCmd.addCommand(subcommad))
    .addSubcommand((subcommad) => resetCmd.addCommand(subcommad)),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case setCmd.name:
        await setCmd.execute(interaction);
        break;
      case resetCmd.name:
        await resetCmd.execute(interaction);
        break;
      default:
        await interaction.reply({
          content: `Invalid subcommand ${commands}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};
