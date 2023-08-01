const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("copy-to-channel")
		.setDescription("Copy a messsage to specific channel!")
		.addChannelOption(Option =>
			Option.setName("destination")
				.addChannelTypes(ChannelType.GuildText)
				.addChannelTypes(ChannelType.GuildAnnouncement)
				.addChannelTypes(ChannelType.AnnouncementThread)
				.setDescription("destination channel")
				.setRequired(true),
		)
		.addStringOption(Option =>
			Option.setName("message-link")
				.setDescription("message link")
				.setRequired(true),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),
	async execute(interaction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const targetChannel = interaction.options.getChannel("destination");
		targetChannel.sendTyping();

		const messageLink = interaction.options.getString("message-link");
		const part = messageLink.split("/");
		const channelId = part[part.length - 2];
		const messageId = part[part.length - 1];

		const channel = await interaction.client.channels.fetch(channelId);
		// const message = await channel.messages.fetch(messageId);
		// console.log(message);
		const messageFromID = await channel.messages.fetch(messageId);
		const message = {
			content: messageFromID.content,
			files: [],
		};
		for (const file of messageFromID.attachments) {
			message.files.push(
				{
					attachment: file[1].attachment,
					name: file[1].name,
					description: file[1].description,
				});
		}
		await interaction.deferReply({ ephemeral: true });
		const resultMsg = await targetChannel.send(message);
		if (resultMsg.content.indexOf("react ok") != -1) {
			await resultMsg.react("👌");
		}

		await interaction.editReply({
			content: "Done!",
			ephemeral: true,
		});
	},
};