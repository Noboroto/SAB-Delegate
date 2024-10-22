import {
	SlashCommandSubcommandBuilder,
	TextChannel,
	ChatInputCommandInteraction,
	Message,
	Collection,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

const FETCH_LIMIT = 100;
const commandName = "any";

export default {
	name: commandName,
	addCommand(builder: SlashCommandSubcommandBuilder) {
		return builder
			.setName(commandName)
			.setDescription(
				"Purge messages in this channel. Default is the latest messages."
			)
			.addStringOption((Option) =>
				Option.setName("until-link")
					.setDescription("stop purging at (not included)")
					.setRequired(true)
			)
			.addStringOption((Option) =>
				Option.setName("from-link")
					.setDescription("start purging at (will be included)")
					.setRequired(false)
			);
	},
	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.deferReply({ ephemeral: true });

		const thisChannel = interaction.channel as TextChannel;
		let fromMessage = await getMessageFromOption(interaction, "from-link");
		const untilMessage = await getMessageFromOption(interaction, "until-link");

		if (!untilMessage) {
			await interaction.editReply({
				content: "Invalid until message",
			});
			return;
		}

		if (!fromMessage) {
			fromMessage = (
				await thisChannel.messages.fetch({ cache: true, limit: 1 })
			).first();
		}

		const fromChannel = fromMessage?.channel as TextChannel;
		const untilChannel = untilMessage?.channel as TextChannel;
		if (fromChannel && untilChannel && fromChannel.id !== untilChannel.id) {
			interaction.reply({
				content: "Messages must be in the same channel",
				ephemeral: true,
			});
			return;
		}
		const initMsg = fromMessage;
		let deleteMessages: Collection<string, Message> = new Collection();
		do {
			let messages = await thisChannel.messages.fetch({
				cache: false,
				limit: FETCH_LIMIT,
				before: fromMessage.id,
			});
			messages = messages.sort(
				(a, b) => a.createdTimestamp - b.createdTimestamp
			);
			fromMessage = messages.last();
			deleteMessages = deleteMessages.concat(messages);
			if (messages.has(untilMessage.id) || messages.size < FETCH_LIMIT) {
				break;
			}
		} while (true);
		deleteMessages = deleteMessages.sort(
			(a, b) => a.createdTimestamp - b.createdTimestamp
		);
		fromMessage = initMsg;
		deleteMessages.set(fromMessage.id, fromMessage);
		deleteMessages = deleteMessages.filter((msg) => {
			return (
				untilMessage.createdTimestamp < msg.createdTimestamp &&
				msg.createdTimestamp <= fromMessage.createdTimestamp && !msg.system
			);
		});

		const tasks = deleteMessages.map((msg) =>
			thisChannel.messages.delete(msg.id).catch((e) => {
				console.error(`Failed to delete message ${msg.id}---------`, e);
				console.info(JSON.stringify(msg, null, 2));
				console.info('-----------------------------------');
			})
		);
		await Promise.all(tasks);
		await interaction.followUp({
			content: `Deleted ${deleteMessages.size} messages.`,
		});
	},
};
