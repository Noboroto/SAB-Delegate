import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	Role,
	ChatInputCommandInteraction,
} from "discord.js";
import { getMessageFromOption } from "../ultils";


export default {
	data: new SlashCommandBuilder()
		.setName("mention-who-not-reaction")
		.setDescription("Mention who didn't react to a message")
		.addStringOption((Option) =>
			Option.setName("message-link")
				.setDescription("message link")
				.setRequired(true)
		)
		.addRoleOption((Option) =>
			Option.setName("role")
				.setDescription("Role you want to check")
				.setRequired(true)
		)

		.addBooleanOption((Option) =>
			Option.setName("is-reply")
				.setDescription("default is false")
				.setRequired(false)
		)
		.addStringOption((Option) =>
			Option.setName("content")
				.setDescription("message content")
				.setRequired(false)
		)

		.setDefaultMemberPermissions(PermissionFlagsBits.ViewChannel)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild

		const isReply = interaction.options.getBoolean("is-reply");
		const response = interaction.options.getString("content");

		const messageFromID = await getMessageFromOption(
			interaction,
			"message-link"
		);

		const role = interaction.options.getRole("role") as Role;
		const members = role.members;

		if (!messageFromID) {
			await interaction.editReply({
				content: "Please provide a valid message link",
			});
			return;
		}

		const reactMemberListID: string[] = [];

		const reactionList = await messageFromID.reactions.cache;

		for (const reactionFromMessage of reactionList.values()) {
			await reactionFromMessage.users.fetch().then((users) => {
				users.forEach((user) => {
					if (user.bot) return;
					reactMemberListID.push(user.id);
				});
			});
		}

		const absent = members.filter(
			(member) =>
				reactMemberListID.find((id) => id === member.id) === undefined
		);
		let replyMsg = `Reply to ${interaction.user}, there are ${absent.size} user(s) who didn't reacted are: \n`;

		if (absent.size === 0) {
			interaction.reply({
				content: "Everyone in role reacted to the message",
				ephemeral: true,
			});
		} else {
			for (const member of absent.values()) {
				replyMsg += `${member}\n`;
			}
			replyMsg += response ? `\n${response}` : "";
			if (!isReply) {
				interaction.reply(replyMsg);
			} else messageFromID.reply(replyMsg);
		}
	},
};

