import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import list from "./createPrivateThread/list";
import byReaction from "./createPrivateThread/byReaction";

export default {
	data: new SlashCommandBuilder()
		.setName("create-private-thread")
		.setDescription("Create a private thread for each member by condition")
		.addSubcommand(list.addCommand)
		.addSubcommand(byReaction.addCommand)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	async execute(interaction) {
		const commands = interaction.options.getSubcommand();
		console.info(`subcommand: ${commands}`)
		switch (commands) {
			case "list":
				list.execute(interaction);
				break;
			case "by-reaction":
				byReaction.execute(interaction);
				break;
			default:
				interaction.reply({
					content: `Invalid subcommand ${commands}`,
					ephemeral: true,
				});
		}
	},
};
