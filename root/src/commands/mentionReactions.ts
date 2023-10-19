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

		let replyMsg = `Users who reacted with ${reaction} are: \n`;
		const reactionList = await messageFromID.reactions.cache;

		reactionList.forEach((reactionFromMessage) => {
			if (reactionFromMessage.emoji.name !== reaction) return;
			reactionFromMessage.users
				.fetch()
				.then(async (users) => {
					await users.forEach(async (user) => {
						if (user.bot) return;
						if (user.id === interaction.user.id) return;
						replyMsg += user.toString() + "\n";
					});
				})
				.then(() => {
					if (replyMessage) {
						replyMessage.reply(replyMsg);
					}
					else interaction.reply(replyMsg);
				});
		});
	},
};

