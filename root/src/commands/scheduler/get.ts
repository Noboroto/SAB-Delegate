import {
	SlashCommandSubcommandBuilder,
	ChatInputCommandInteraction,
} from "discord.js";
import { jobScheduler } from "../../ultils";


export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("get")
			.setDescription("Get all scheduler jobs")
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
