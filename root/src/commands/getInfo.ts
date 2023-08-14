import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	TextChannel,
	ChatInputCommandInteraction,
} from "discord.js";

export default {
	data: new SlashCommandBuilder()
		.setName("get-intro")
		.setDescription("get first introduction of a user in intro channels (set by admin)")

		.addUserOption((Option) =>
			Option.setName("user").setDescription("user to get introduction").setRequired(true)
		)

		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const srcChannel = (await interaction.client.channels.fetch("1082277720462995566")) as TextChannel;
		const user = interaction.options.getUser("user");
		const messages = await srcChannel.messages.fetch({ limit: 100 });
		
		const message = messages.reverse().find((msg) => msg.author.id === user.id);
		if (!message) {
			await interaction.reply({
				content: "User has no introduction",
				ephemeral: true,
			});
			return;
		}

		const messageContent = message.content;
		const replyMessage = 
		{
			content: `${user}'s introduction: \n ${messageContent}`,
		}
		interaction.reply(replyMessage);
	},
};
