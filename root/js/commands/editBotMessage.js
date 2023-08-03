const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("edit-bot-message")
		.setDescription("Edit a message send by this bot!")
		.addStringOption((Option) =>
			Option.setName("bot-message-link").setDescription("bot message link").setRequired(true)
		)
		.addStringOption((Option) =>
			Option.setName("new-message-link").setDescription("new message link").setRequired(true)
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),
	async execute(interaction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		await interaction.deferReply({ ephemeral: true });

		const botMessageFromID = await getMessageFromOption(interaction, "bot-message-link");
		const newMessageFromID = await getMessageFromOption(interaction, "new-message-link");

		const message = {
			content: newMessageFromID.content,
			files: []
		};
		for (const file of newMessageFromID.attachments) {
			message.files.push({
				attachment: file[1].attachment,
				name: file[1].name,
				description: file[1].description
			});
		}
		botMessageFromID.edit(message);
		await interaction.editReply({
			content: "Done!",
			ephemeral: true
		});
	}
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
