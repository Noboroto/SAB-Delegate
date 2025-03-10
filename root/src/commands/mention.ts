import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
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
        thread_everyone.execute(interaction);
        break;
      case byAReaction.name:
        byAReaction.execute(interaction);
        break;
      case notReact.name:
        notReact.execute(interaction);
        break;
      default:
        console.error("Invalid subcommand");
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
