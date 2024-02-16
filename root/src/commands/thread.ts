import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import removeByPrefix from "./threads/removeByPrefix";
import editPrefix from "./threads/editPrefix";

export default {
	data: new SlashCommandBuilder()
		.setName("thread")
		.setDescription("Manage a thread for each member by condition")
		.addSubcommand(removeByPrefix.addCommand)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	async execute(interaction) {
		const commands = interaction.options.getSubcommand();
		console.info(`subcommand: ${commands}`)
		switch (commands) {
			case "edit-prefix":
				editPrefix.execute(interaction);
				break;
			case "remove-by-prefix":
				removeByPrefix.execute(interaction);
				break;
			default:
				interaction.reply({
					content: `Invalid subcommand ${commands}`,
					ephemeral: true,
				});
		}
	},
};
