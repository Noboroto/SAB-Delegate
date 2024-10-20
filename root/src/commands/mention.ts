import { SlashCommandBuilder } from "discord.js";
import byAReaction from "./mention/byAReaction";
import notReact from "./mention/notReact";

export default {
  data: new SlashCommandBuilder()
    .setName("mention")
    .setDescription("Mention many members by condition")
    .addSubcommand(byAReaction.addCommand)
    .addSubcommand(notReact.addCommand),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case byAReaction.name:
        byAReaction.execute(interaction);
        break;
      case notReact.name:
        notReact.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
