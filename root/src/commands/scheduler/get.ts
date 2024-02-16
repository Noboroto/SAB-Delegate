import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
} from "discord.js";
import { jobScheduler } from "../../ultils";

export default {
  name: "get",
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder.setName(this.name).setDescription("Get all scheduler jobs");
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
