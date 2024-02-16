import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import list from "./bulk-assign/list";
import byReaction from "./bulk-assign/byReaction";

export default {
	data: new SlashCommandBuilder()
		.setName("bulk-assign-role")
		.setDescription("Assign or remove a role for many members")
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
