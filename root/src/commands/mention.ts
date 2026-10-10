import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import byAReaction from "./mention/byAReaction";
import notReact from "./mention/notReact";
import thread_everyone from "./thread/everyone";

export default {
  data: new SlashCommandBuilder()
    .setName("mention")
    .setDescription("Mention many members by condition")
    .addSubcommand(byAReaction.addCommand)
    .addSubcommand(notReact.addCommand)
    .addSubcommand(thread_everyone.addCommand)
    .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case thread_everyone.name:
        await thread_everyone.execute(interaction);
        break;
      case byAReaction.name:
        await byAReaction.execute(interaction);
        break;
      case notReact.name:
        await notReact.execute(interaction);
        break;
      default:
        console.error("Invalid subcommand");
        await interaction.reply({
          content: `Invalid subcommand ${commands}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};
