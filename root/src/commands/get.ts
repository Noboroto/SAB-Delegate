import { SlashCommandBuilder } from "discord.js";
import intro from "./get/intro";
import idByAReaction from "./get/idByReaction";
import idByRole from "./get/idByRole";
import inviteLink from "./get/inviteLink";

export default {
  data: new SlashCommandBuilder()
    .setName("get")
    .setDescription("Get usefull information and configurations")
    .addSubcommand(intro.addCommand)
    .addSubcommand(idByAReaction.addCommand)
    .addSubcommand(idByRole.addCommand)
    .addSubcommand(inviteLink.addCommand)
    .setDMPermission(true),
  async execute(interaction) {
    const commands = interaction.options.getSubcommand();
    console.info(
      `[[${interaction.client.user?.username}][Subcommad] ${interaction.user.username} - ${commands}`
    );
    switch (commands) {
      case intro.name:
        await intro.execute(interaction);
        break;
      case idByAReaction.name:
        await idByAReaction.execute(interaction);
        break;
      case idByRole.name:
        await idByRole.execute(interaction);
        break;
      case inviteLink.name:
        await inviteLink.execute(interaction);
        break;
      default:
        interaction.reply({
          content: `Invalid subcommand ${commands}`,
          ephemeral: true,
        });
    }
  },
};
