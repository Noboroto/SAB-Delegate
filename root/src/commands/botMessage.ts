import copyPaste from "./bot-message/copy-paste";
import scheduleCopy from "./bot-message/schedule-copy";
import editCopy from "./bot-message/edit-copy";
import editSend from "./bot-message/edit-send";
import react from "./bot-message/react";
import send from "./bot-message/send";
import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export default {
	data: new SlashCommandBuilder()
		.setName("bot-message")
		.setDescription("Using bot to send message to channel")
		.addSubcommand(copyPaste.addCommand)
		.addSubcommand(scheduleCopy.addCommand)
		.addSubcommand(editCopy.addCommand)
		.addSubcommand(editSend.addCommand)
		.addSubcommand(react.addCommand)
		.addSubcommand(send.addCommand)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
		
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
			case "edit-copy":
				editCopy.execute(interaction);
				break;
			case "edit-send":
				editSend.execute(interaction);
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
