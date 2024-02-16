import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import intro from "./get/intro";
import idByAReaction from "./get/idByReaction";
import idByRole from "./get/idByRole";

export default {
	data: new SlashCommandBuilder()
		.setName("get")
		.setDescription("Get usefull information")
		.addSubcommand(intro.addCommand)
		.addSubcommand(idByAReaction.addCommand)
		.addSubcommand(idByRole.addCommand)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
	async execute(interaction) {
		const commands = interaction.options.getSubcommand();
		console.info(`subcommand: ${commands}`)
		switch (commands) {
			case "intro":
				await intro.execute(interaction);
				break;
			case "id-by-reaction":
				await idByAReaction.execute(interaction);
				break;
			case "id-by-role":
				await idByRole.execute(interaction);
				break;
			default:
				interaction.reply({
					content: `Invalid subcommand ${commands}`,
					ephemeral: true,
				});
		}
	},
};
