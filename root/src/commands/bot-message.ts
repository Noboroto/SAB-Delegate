import copyPaste from "./bot-message/copy-paste";
import scheduleCopy from "./bot-message/schedule-copy";
import edit from "./bot-message/edit";
import react from "./bot-message/react";
import send from "./bot-message/send";
import { SlashCommandBuilder } from "discord.js";

export default {
	data: new SlashCommandBuilder()
		.setName("bot-message")
		.setDescription("Using bot to send message to channel")
		.addSubcommand(copyPaste.addCommand)
		.addSubcommand(scheduleCopy.addCommand)
		.addSubcommand(edit.addCommand)
		.addSubcommand(react.addCommand)
		.addSubcommand(send.addCommand),
		
	async execute(interaction) {
		const commands = interaction.options.getSubcommand();
		console.info(`subcommand: ${commands}`)
		switch (commands) {
			case "copy-paste":
				copyPaste.execute(interaction);
				break;
			case "schedule-copy":
				scheduleCopy.execute(interaction);
				break;
			case "edit":
				edit.execute(interaction);
				break;
			case "react":
				react.execute(interaction);
				break;
			case "send":
				send.execute(interaction);
				break;
			default:
				interaction.reply({
					content: `Invalid subcommand ${commands}`,
					ephemeral: true,
				});
		}
	},
};
