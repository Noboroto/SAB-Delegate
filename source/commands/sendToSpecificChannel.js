const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("send-to-specific-channel")
		.setDescription("Send a messsage to specific channel!")
		.addChannelOption(Option =>
			Option.setName("destination")
				.addChannelTypes(ChannelType.GuildText)
				.setDescription("destination channel")
				.setRequired(true),
		)
		.addStringOption(Option =>
			Option.setName("content")
				.setDescription("message content")
				.setRequired(true),
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),
	async execute(interaction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const targetChannel = interaction.options.getChannel("destination");
		const response = interaction.options.getString("content");
		const message = {
			content: response,
		};
		await targetChannel.send(message);
		await interaction.reply({
			content: "Done!",
			ephemeral: true,
		});
	},
};