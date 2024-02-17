import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { jobScheduler } from "../../ultils";

const commandName = "get";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Get all scheduler jobs");
  },

  async execute(interaction: ChatInputCommandInteraction) {
    const groupID = interaction.guildId;
    interaction.reply({
      content: jobScheduler.getJobs(groupID),
      ephemeral: false,
      embeds: [],
    });
  },
};
