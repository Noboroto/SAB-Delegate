import { SlashCommandBuilder } from "discord.js";
import setCmd from "./word/set";
import resetCmd from "./word/reset";

export default {
	data: new SlashCommandBuilder()
		.setName("word")
		.setDescription("Trò chơi nối chữ")
		.addSubcommand((subcommad) => setCmd.addCommand(subcommad))
		.addSubcommand((subcommad) => resetCmd.addCommand(subcommad)),
	async execute(interaction) {
		const commands = interaction.options.getSubcommand();
		console.info(`subcommand: ${commands}`)
		switch (commands) {
			case "set":
				setCmd.execute(interaction);
				break;
			case "reset":
				resetCmd.execute(interaction);
				break;
			default:
				interaction.reply({
					content: `Invalid subcommand ${commands}`,
					ephemeral: true,
				});
		}
	},
};
