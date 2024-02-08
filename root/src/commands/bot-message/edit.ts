import {
	ChatInputCommandInteraction,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName("edit")
			.setDescription("Edit a message send by this bot!")
			.addStringOption((Option) =>
				Option.setName("new-message-link")
					.setDescription("new message link")
					.setRequired(true)
			)
			.addStringOption((Option) =>
				Option.setName("old-bot-message-link")
					.setDescription("bot message link")
					.setRequired(true)
			)
	},
	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.deferReply({ ephemeral: true });

		const botMessageFromID = await getMessageFromOption(
			interaction,
			"old-bot-message-link"
		);
		const newMessageFromID = await getMessageFromOption(
			interaction,
			"new-message-link"
		);

		const attachments = await newMessageFromID.attachments.values();
		const message = {
			content: newMessageFromID.content,
			files: [],
		};

		for (const file of attachments) {
			message.files.push(file);
		}

		botMessageFromID.edit(message);

		await interaction.editReply({
			content: "Done!",
		});
	},
};
