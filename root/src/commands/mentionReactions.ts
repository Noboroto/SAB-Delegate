import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChatInputCommandInteraction,
} from "discord.js";
import { getMessageFromOption } from "../ultils";


export default {
	data: new SlashCommandBuilder()
		.setName("mention-reaction")
		.setDescription("Mention who reacted to a message")
		.addStringOption((Option) =>
			Option.setName("message-link")
				.setDescription("message link")
				.setRequired(true)
		)
		.addStringOption((Option) =>
			Option.setName("emoji").setDescription("emoji").setRequired(true)
		)

		.addStringOption((Option) =>
			Option.setName("reply-message")
				.setDescription("reply message link")
				.setRequired(false)
		)

		.setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const reaction = interaction.options.getString("emoji")?.trim() ?? "";
		const messageFromID = await getMessageFromOption(
			interaction,
			"message-link"
		);

		const replyMessage = await getMessageFromOption(
			interaction,
			"reply-message"
		);

		if (!messageFromID) {
			await interaction.editReply({
				content: "Please provide a valid message link",
			});
			return;
		}

		const reactMemberListID: string[] = [];
		const reactionList = await messageFromID.reactions.cache;

		for (const reactionFromMessage of reactionList.values()) {
			if (reactionFromMessage.emoji.toString() !== reaction) return;
			await reactionFromMessage.users
				.fetch()
				.then(async (users) => {
					await users.forEach(async (user) => {
						if (user.bot) return;
						if (user.id === interaction.user.id) return;
						reactMemberListID.push(user.id);
					});
				});
		}

		let replyMsg = `There are ${reactMemberListID.length} user(s) who reacted with ${reaction}: \n`;
		for (const userID of reactMemberListID) {
			replyMsg += `<@${userID}>\n`;
		}

		if (replyMessage) {
			await replyMessage.reply(replyMsg);
		} else await interaction.reply(replyMsg);

		if (!reactMemberListID.length) {
			interaction.reply({
				content: "No one reacted with that emoji",
				ephemeral: true,
			});
		}
	},
};

