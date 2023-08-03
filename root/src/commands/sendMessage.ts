import { SlashCommandBuilder, PermissionFlagsBits, ChatInputCommandInteraction } from "discord.js";

export default {
	data: new SlashCommandBuilder()
		.setName("send-message")
		.setDescription("Send a messsage to this channel!")
		.addStringOption((Option) => Option.setName("content").setDescription("message content").setRequired(true))
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const targetChannel = interaction.channel;
		const response = interaction.options.getString("content");
		const message = {
			content: response
		};
		const resultMsg = await targetChannel.send(message);
		if (resultMsg.content.indexOf("react ok") != -1) {
			resultMsg.react("👌");
		}

		interaction.reply({
			content: "Message send!",
			ephemeral: true
		});
	}
};
