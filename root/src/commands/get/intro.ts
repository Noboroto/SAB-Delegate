import {
	SlashCommandSubcommandBuilder,
	TextChannel,
	ChatInputCommandInteraction,
	FetchMessagesOptions,
} from "discord.js";

const lots_of_messages_getter = async (channel, limit = 1000) => {
	let sum_messages = [];
	let last_id;

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const options: FetchMessagesOptions = { limit: 100 };
		if (last_id) {
			options.before = last_id;
		}

		const messages = await channel.messages.fetch(options);
		sum_messages = sum_messages.concat([messages]);
		last_id = messages.last().id;

		if (messages.size != 100 || sum_messages.length >= limit) {
			break;
		}
	}

	return sum_messages;
};

export default {
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder.setName("intro")
		.setDescription(
			"get first introduction of a user in intro channels (set by admin)"
		)

		.addUserOption((Option) =>
			Option.setName("user")
				.setDescription("user to get introduction")
				.setRequired(true)
		)

	},
	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const srcChannel = (await interaction.client.channels.fetch(
			"1082277720462995566"
		)) as TextChannel;
		const user = interaction.options.getUser("user");
		const messageCollections = await lots_of_messages_getter(srcChannel);

		let message = null;
		messageCollections.forEach((messages) => {
			const tempMessage = messages
				.reverse()
				.find((msg) => msg.author.id === user.id);
			if (tempMessage) {
				message = tempMessage;
				return;
			}
		});

		if (!message) {
			await interaction.reply({
				content: "User has no introduction",
				ephemeral: true,
			});
			return;
		}

		const messageContent = message.content;
		const replyMessage = {
			content: `${user}'s introduction: \n${messageContent}`,
		};
		interaction.reply(replyMessage);
	},
};
