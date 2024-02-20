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
		const jobInfos:{
			cmdName: string,
			id: string,
			description: string,
			time : string,
			setTime: string,
			authorUsername: string,
			job,
			isCancel: boolean
		}[] = jobScheduler.getJobs(groupID);
		if (jobInfos.length === 0) {
			await interaction.reply("No job found");
			return;
		}

		await interaction.reply("List of jobs:");
		for (const job of jobInfos) {
			await interaction.followUp(
				`## ${(job.isCancel) ? "(End) " : ""}[${job.cmdName}] - ${job.id}\n`
			+ `**Author**: ${job.authorUsername}\n`
			+ `**Description**: ${job.description}\n`
			+ `**Time**: ${job.time}\n`
			+ `**Created time**: ${job.setTime}`
			)
		}
  },
};
