import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import getCmd from "./scheduler/get";
import cancelCmd from "./scheduler/cancel";

export default {
	data: new SlashCommandBuilder()
		.setName("scheduler")
		.setDescription("Scheduler command")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
		.addSubcommand((subcommad) => getCmd.addCommand(subcommad))
		.addSubcommand((subcommad) => cancelCmd.addCommand(subcommad)),
	async execute(interaction) {
		const commands = interaction.options.getSubcommand();
		console.info(`subcommand: ${commands}`)
		switch (commands) {
			case "get":
				getCmd.execute(interaction);
				break;
			case "cancel":
				cancelCmd.execute(interaction);
				break;
			default:
				interaction.reply({
					content: `Invalid subcommand ${commands}`,
					ephemeral: true,
				});
		}
	},
};
