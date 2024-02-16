import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import list from "./privateThread/list";
import byReaction from "./privateThread/byReaction";
import removeByPrefix from "./privateThread/removeByPrefix";

export default {
	data: new SlashCommandBuilder()
		.setName("private-thread")
		.setDescription("Manage a private thread for each member by condition")
		.addSubcommand(list.addCommand)
		.addSubcommand(byReaction.addCommand)
		.addSubcommand(removeByPrefix.addCommand)
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
