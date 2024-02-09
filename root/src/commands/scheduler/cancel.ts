import {
	SlashCommandSubcommandBuilder,
	ChatInputCommandInteraction,
} from "discord.js";

import { jobScheduler } from "../../ultils";

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("cancel")
			.setDescription("Cancel a scheduler job")
			.addIntegerOption((Option) =>
				Option.setName("id")
					.setDescription("The id of the job you want to cancel")
					.setRequired(true)
			);
	},

	async execute(interaction: ChatInputCommandInteraction) {
		const groupID = interaction.guildId;
		const id = interaction.options.getInteger("id");
		const msg = jobScheduler.cancelJob(groupID, id);
		interaction.reply({
			content: `${msg}`,
			ephemeral: true,
		});
	},
};
