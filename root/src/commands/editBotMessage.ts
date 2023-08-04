import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction } from "discord.js";

const emojiPoll = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export default {
	data: new SlashCommandBuilder()
		.setName("edit-bot-message")
		.setDescription("Edit a message send by this bot!")
		.addStringOption((Option) =>
			Option.setName("bot-message-link").setDescription("bot message link").setRequired(true)
		)
		.addStringOption((Option) =>
			Option.setName("new-message-link").setDescription("new message link").setRequired(true)
		)

		.addIntegerOption((Option) =>
			Option.setName("poll-choice-count")
				.setDescription("number of choices for poll")
				.setMinValue(0)
				.setMaxValue(10)
				.setRequired(false)
		)

		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.deferReply({ ephemeral: true });

		const botMessageFromID = await getMessageFromOption(interaction, "bot-message-link");
		const newMessageFromID = await getMessageFromOption(interaction, "new-message-link");
		const pollChoiceCount = interaction.options.getInteger("poll-choice-count") ?? 0;


		const message = {
			content: newMessageFromID.content,
			files: [],
		};
		for (const file of newMessageFromID.attachments) {
			message.files.push({
				attachment: file[1].attachment,
				name: file[1].name,
				description: file[1].description,
			});
		}
		botMessageFromID.edit(message);
		for (let i = 0; i < pollChoiceCount; i++) {
			await botMessageFromID.react(emojiPoll[i]);
		}

		await interaction.editReply({
			content: "Done!",
		});
	},
};

const getMessageFromOption = async (interaction, optionName) => {
	const messageLink = await interaction.options.getString(optionName);
	const part = messageLink.split("/");
	const channelId = part[part.length - 2];
	const messageId = part[part.length - 1];
	const channel = await interaction.client.channels.fetch(channelId);
	const messageFromID = await channel.messages.fetch(messageId);
	return messageFromID;
};
