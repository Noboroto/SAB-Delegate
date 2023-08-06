import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChatInputCommandInteraction,
	ChannelType,
	TextChannel,
} from "discord.js";
import { getMessageFromOption } from "../ultils";

const emojiPoll = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export default {
	data: new SlashCommandBuilder()
		.setName("send-message")
		.setDescription("Send a messsage to this channel or another")
		.addStringOption((Option) =>
			Option.setName("content")
				.setDescription("message content")
				.setRequired(true)
		)

		.addChannelOption((Option) =>
			Option.setName("destination")
				.addChannelTypes(ChannelType.GuildText)
				.addChannelTypes(ChannelType.GuildAnnouncement)
				.addChannelTypes(ChannelType.AnnouncementThread)
				.addChannelTypes(ChannelType.PublicThread)
				.addChannelTypes(ChannelType.PrivateThread)
				.setDescription("destination channel")
				.setRequired(false)
		)

		.addStringOption((Option) =>
			Option.setName("reply-message")
				.setDescription("reply message link")
				.setRequired(false)
		)

		.addIntegerOption((Option) =>
			Option.setName("poll-choice-count")
				.setDescription("number of choices for poll")
				.setMinValue(0)
				.setMaxValue(10)
				.setRequired(false)
		)

		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		await interaction.deferReply({ ephemeral: true });

		const targetChannel = (interaction.options.getChannel("destination") ??
			interaction.channel) as TextChannel;
		const response = interaction.options.getString("content");
		const pollChoiceCount =
			interaction.options.getInteger("poll-choice-count") ?? 0;
		const messageFromID = await getMessageFromOption(
			interaction,
			"reply-message"
		);

		const message = {
			content: response,
		};

		let resultMsg = null;
		if (messageFromID) {
			resultMsg = messageFromID.reply(message);
		} else {
			resultMsg = await targetChannel.send(message);
		}

		for (let i = 0; i < pollChoiceCount; i++) {
			await resultMsg.react(emojiPoll[i]);
		}

		interaction.editReply({
			content: "Sent!",
		});
	},
};
